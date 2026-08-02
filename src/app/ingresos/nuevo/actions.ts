'use server'

import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import {
  extraerPlanilla,
  type IngresoExtraido,
  UMBRAL_BAJA_CONFIANZA,
} from '@/lib/extraccion/extraerPlanilla'
import { subirPlanilla } from '@/lib/storage/planillas'
import { validarUbicacionActiva } from '@/lib/ubicacionesServer'

// ── Tipos del flow manual + IA ─────────────────────────────

export type RolloInput = {
  numero_pieza: string
  kilos: string
  metros: string
  rinde: string
  gramaje_planilla?: string
  ubicacion: string
  estado: 'en_stock' | 'pendiente'
  /** FK al artículo. Una planilla puede traer rollos de varios artículos. */
  articulo_id?: string | null
  /** FK al color. Debe pertenecer a `articulo_colores` del artículo elegido. */
  color_id?: string | null
  /** Confianza promedio reportada por la IA para este rollo (0-1). Solo se setea en flow IA. */
  confianza_ia?: number

  // ── Segunda calidad (opcional, marcado desde el ingreso) ──
  segunda?: boolean
  falla_categoria?: string | null
  falla_descripcion?: string | null
  /** Path en Supabase Storage (bucket planillas) de la foto de la falla. */
  foto_falla_path?: string | null
}

export type IngresoInput = {
  tintoreria_id: string
  fecha: string
  numero_remito: string
  ot?: string
  rem_tejeduria?: string
  referencia?: string
  comentario?: string
  total_rollos_declarado: string
  total_kilos_declarado: string
  /** Path en Storage (bucket planillas) si vino por flow IA. */
  imagen_path?: string
  origen?: 'manual' | 'planilla_ia'
  rollos: RolloInput[]
}

// ── Server action: procesar planilla con IA ────────────────

export type ProcesarPlanillaResult =
  | {
      ok: true
      imagen_path: string
      datos: IngresoExtraido
      warnings: string[]
    }
  | {
      ok: false
      error: string
      codigo:
        | 'NO_FILE'
        | 'NO_TINTORERIA'
        | 'TIPO_INVALIDO'
        | 'NO_AUTH'
        | 'SIN_EMPRESA'
        | 'STORAGE_ERROR'
        | 'GEMINI_ERROR'
        | 'JSON_INVALID'
        | 'NO_API_KEY'
        | 'FORMATO_INVALIDO'
        | 'OTHER'
      /** Si la imagen ya se subió pero la IA falló, devolvemos el path para reintento. */
      imagen_path?: string
    }

const MIME_ACEPTADOS = [
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
  'application/pdf',
]

const MIME_FOTOS = [
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
]

/**
 * Procesa una planilla con IA aplicando el prompt custom de la tintorería
 * elegida. Si la tintorería no tiene `extraction_prompt`, usa el default.
 */
export async function procesarPlanillaConIA(
  formData: FormData
): Promise<ProcesarPlanillaResult> {
  const file = formData.get('archivo')
  const tintoreriaId = formData.get('tintoreria_id')

  if (!(file instanceof File)) {
    return { ok: false, error: 'No se recibió archivo.', codigo: 'NO_FILE' }
  }
  if (typeof tintoreriaId !== 'string' || !tintoreriaId.trim()) {
    return {
      ok: false,
      error: 'Hay que seleccionar la tintorería antes de subir la planilla.',
      codigo: 'NO_TINTORERIA',
    }
  }
  if (!MIME_ACEPTADOS.includes(file.type)) {
    return {
      ok: false,
      error: `Tipo de archivo no soportado: ${file.type}. Aceptamos JPG, PNG, WebP, HEIC y PDF.`,
      codigo: 'TIPO_INVALIDO',
    }
  }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return { ok: false, error: 'Sesión expirada — volvé a iniciar sesión.', codigo: 'NO_AUTH' }
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('empresa_id')
    .eq('id', user.id)
    .single()
  if (!profile?.empresa_id) {
    return {
      ok: false,
      error: 'Tu usuario no tiene empresa asignada.',
      codigo: 'SIN_EMPRESA',
    }
  }

  const { data: tintoreria } = await supabase
    .from('tintorerias')
    .select('extraction_prompt')
    .eq('id', tintoreriaId)
    .single()

  const customPrompt = tintoreria?.extraction_prompt ?? null

  const buffer = Buffer.from(await file.arrayBuffer())

  const upload = await subirPlanilla(buffer, file.type, profile.empresa_id)
  if (!upload.ok) {
    return { ok: false, error: upload.error, codigo: 'STORAGE_ERROR' }
  }

  const extraccion = await extraerPlanilla(buffer, file.type, customPrompt)
  if (!extraccion.ok) {
    return {
      ok: false,
      error: extraccion.error,
      codigo: extraccion.codigo,
      imagen_path: upload.path,
    }
  }

  const warnings = calcularWarnings(extraccion.data)

  return {
    ok: true,
    imagen_path: upload.path,
    datos: extraccion.data,
    warnings,
  }
}

/** Banners de fallback 3-tier: incompleto + calidad pobre. */
function calcularWarnings(data: IngresoExtraido): string[] {
  const warnings: string[] = []

  const declarados = data.total_rollos_declarado.value
  const extraidos = data.rollos.length
  if (declarados !== null && declarados !== extraidos) {
    if (extraidos < declarados) {
      warnings.push(
        `La planilla declara ${declarados} rollos pero la IA extrajo solo ${extraidos}. Agregá los ${declarados - extraidos} faltantes a mano antes de guardar.`
      )
    } else {
      warnings.push(
        `La planilla declara ${declarados} rollos pero la IA extrajo ${extraidos}. Revisá si hay duplicados.`
      )
    }
  }

  // Solo contamos celdas CON valor. Un campo ausente (null) — ej. OT, rinde o
  // gramaje en planillas que no los traen — no es una "lectura de baja
  // confianza", así que no debe inflar el % ni disparar el banner.
  const tieneValor = (f: { value: unknown }): boolean =>
    f.value !== null && f.value !== undefined && String(f.value).trim() !== ''
  const pushSiTiene = (
    acc: number[],
    f: { value: unknown; confidence: number } | null | undefined
  ) => {
    if (f && tieneValor(f)) acc.push(f.confidence)
  }

  const todasLasCeldas: number[] = []
  for (const k of [
    'numero_remito',
    'fecha',
    'color',
    'ot',
    'rem_tejeduria',
    'referencia',
    'total_rollos_declarado',
    'total_kilos_declarado',
  ] as const) {
    pushSiTiene(todasLasCeldas, data[k])
  }
  for (const r of data.rollos) {
    pushSiTiene(todasLasCeldas, r.numero_pieza)
    pushSiTiene(todasLasCeldas, r.kilos)
    pushSiTiene(todasLasCeldas, r.metros)
    pushSiTiene(todasLasCeldas, r.ratio)
    pushSiTiene(todasLasCeldas, r.gramaje_planilla)
    pushSiTiene(todasLasCeldas, r.articulo)
  }
  const bajas = todasLasCeldas.filter((c) => c < UMBRAL_BAJA_CONFIANZA).length
  const pctBajas = todasLasCeldas.length > 0 ? bajas / todasLasCeldas.length : 0
  if (pctBajas > 0.3) {
    warnings.push(
      `La IA detectó muchos campos con baja confianza (${Math.round(pctBajas * 100)}%). Te recomendamos revisar cuidadosamente o cargar a mano.`
    )
  }

  return warnings
}

// ── Server action: subir foto de falla por rollo ────────────
// La UI llama esta acción antes de submit. Devuelve el path para
// que el cliente lo arme en RolloInput.foto_falla_path.

export type SubirFotoResult =
  | { ok: true; path: string }
  | { ok: false; error: string }

export async function subirFotoFalla(formData: FormData): Promise<SubirFotoResult> {
  const file = formData.get('archivo')
  if (!(file instanceof File)) {
    return { ok: false, error: 'No se recibió archivo.' }
  }
  if (!MIME_FOTOS.includes(file.type)) {
    return {
      ok: false,
      error: `Tipo de archivo no soportado: ${file.type}. Subí una foto (JPG/PNG/WebP/HEIC).`,
    }
  }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'Sesión expirada.' }

  const { data: profile } = await supabase
    .from('profiles')
    .select('empresa_id')
    .eq('id', user.id)
    .single()
  if (!profile?.empresa_id) {
    return { ok: false, error: 'Tu usuario no tiene empresa asignada.' }
  }

  const buffer = Buffer.from(await file.arrayBuffer())
  return subirPlanilla(buffer, file.type, profile.empresa_id)
}

// ── Server action: crear ingreso (flow manual o IA) ────────


export async function crearIngreso(input: IngresoInput) {
  const supabase = await createClient()

  if (!input.tintoreria_id) return { error: 'Falta seleccionar la tintorería.' }
  if (!input.fecha) return { error: 'Falta la fecha del ingreso.' }
  if (!input.rollos.length) return { error: 'Cargá al menos un rollo.' }

  const origen = input.origen ?? 'manual'
  const totalKilosDeclarado = parseDecimal(input.total_kilos_declarado)
  if (
    Number.isNaN(totalKilosDeclarado) ||
    (totalKilosDeclarado != null && totalKilosDeclarado < 0)
  ) {
    return { error: 'Ingresa un total de kilos declarado valido.' }
  }

  for (const r of input.rollos) {
    if (!r.numero_pieza.trim()) {
      return { error: 'Todos los rollos deben tener número de pieza.' }
    }
    if (!r.articulo_id) {
      return { error: `El rollo "${r.numero_pieza.trim()}" no tiene artículo asignado.` }
    }
    if (!r.color_id) {
      return { error: `El rollo "${r.numero_pieza.trim()}" no tiene color asignado.` }
    }
    const kilos = parseDecimal(r.kilos)
    if (kilos == null || Number.isNaN(kilos) || kilos <= 0) {
      return {
        error: `El rollo "${r.numero_pieza.trim()}" debe tener un peso en kilos mayor a cero.`,
      }
    }
    if (origen === 'manual' && !r.ubicacion.trim()) {
      return {
        error:
          'Todos los rollos del ingreso manual deben tener ubicación asignada.',
      }
    }
    if (r.ubicacion.trim()) {
      const valida = await validarUbicacionActiva(supabase, r.ubicacion)
      if (!valida.ok) return { error: valida.error }
      r.ubicacion = valida.codigo
    }
    if (r.segunda) {
      if (!r.falla_categoria?.trim()) {
        return {
          error: `El rollo "${r.numero_pieza.trim()}" está marcado como segunda pero falta la categoría de falla.`,
        }
      }
    }
  }

  const numeros = input.rollos.map((r) => r.numero_pieza.trim())
  const unicos = new Set(numeros)
  if (unicos.size !== numeros.length) {
    return { error: 'Hay números de pieza duplicados en el ingreso.' }
  }

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'Sesión expirada — volvé a iniciar sesión.' }

  const otTrimmed = input.ot?.trim()
  if (otTrimmed) {
    // Puede haber OTs duplicadas históricas (antes no se validaba), así que
    // tomamos solo la primera fila: `.maybeSingle()` solo tira error si la
    // query devuelve >1 fila, lo que dejaría pasar el duplicado sin querer.
    const { data: ingresoExistente } = await supabase
      .from('ingresos')
      .select('id')
      .eq('ot', otTrimmed)
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle()
    if (ingresoExistente) {
      return {
        error: `Ya existe un ingreso con la OT "${otTrimmed}".`,
        ingresoExistente_id: ingresoExistente.id,
      }
    }
  }

  // Estado del ingreso derivado del origen:
  // - planilla_ia → `auditado` (rollos quedan `pendiente`, se confirman por
  //   conteo físico en depósito, en /confirmar).
  // - manual → `confirmado` directo: el operario ya está recibiendo la
  //   mercadería a mano, así que los rollos entran como `en_stock` al toque
  //   (los de segunda quedan `segunda`). No requiere segundo paso de conteo.
  const ingresoEstado: 'auditado' | 'confirmado' =
    origen === 'planilla_ia' ? 'auditado' : 'confirmado'

  const { data: ingreso, error: iError } = await supabase
    .from('ingresos')
    .insert({
      tintoreria_id: input.tintoreria_id,
      fecha_despacho: input.fecha,
      numero_remito: input.numero_remito.trim() || null,
      ot: input.ot?.trim() || null,
      rem_tejeduria: input.rem_tejeduria?.trim() || null,
      referencia: input.referencia?.trim() || null,
      comentario: input.comentario?.trim() || null,
      total_rollos_declarado: input.total_rollos_declarado
        ? parseInt(input.total_rollos_declarado)
        : null,
      total_kilos_declarado: totalKilosDeclarado,
      imagen_url: input.imagen_path ?? null,
      estado: ingresoEstado,
      origen,
      created_by: user.id,
    })
    .select()
    .single()

  if (iError || !ingreso) {
    return { error: `No se pudo crear el ingreso: ${iError?.message}` }
  }

  // Bulk insert de rollos. La FK compuesta (articulo_id, color_id) garantiza
  // que la combinación esté en `articulo_colores`; si no, Postgres rechaza
  // con 23503.
  const rollosToInsert = input.rollos.map((r) => ({
    ingreso_id: ingreso.id,
    articulo_id: r.articulo_id,
    color_id: r.color_id,
    numero_pieza: r.numero_pieza.trim(),
    kilos: parseDecimal(r.kilos),
    metros: r.metros ? parseFloat(r.metros) : null,
    rinde: r.rinde ? parseFloat(r.rinde) : null,
    gramaje_planilla: r.gramaje_planilla
      ? parseFloat(r.gramaje_planilla)
      : null,
    ubicacion: r.ubicacion.trim() || null,
    // Manual → el rollo entra directo a stock (ya se recibió a mano).
    // Planilla IA → mantiene su estado (pendiente, espera confirmación).
    estado: r.segunda
      ? ('segunda' as const)
      : origen === 'manual'
        ? ('en_stock' as const)
        : r.estado,
    falla_categoria: r.segunda ? r.falla_categoria : null,
    falla_descripcion: r.segunda
      ? r.falla_descripcion?.trim() || null
      : null,
    confianza_ia: r.confianza_ia ?? null,
  }))

  const { data: rollosInsertados, error: rError } = await supabase
    .from('rollos')
    .insert(rollosToInsert)
    .select('id, numero_pieza')

  if (rError) {
    await supabase.from('ingresos').delete().eq('id', ingreso.id)
    if (rError.code === '23505') {
      const match = rError.message.match(/\(empresa_id, numero_pieza\)=\([^,]+, ([^)]+)\)/)
      const numero = match?.[1]
      return {
        error: numero
          ? `El número de pieza "${numero}" ya existe en otro rollo de la empresa. Cambialo y volvé a intentar.`
          : 'Hay números de pieza que ya existen en la empresa. Revisá y volvé a intentar.',
      }
    }
    if (rError.code === '23503') {
      return {
        error:
          'Alguno de los rollos usa una combinación artículo-color que no está asociada. Pedile al administrador que asocie el color al artículo.',
      }
    }
    return { error: `No se pudieron cargar los rollos: ${rError.message}` }
  }

  // Si hay fotos de falla, insertarlas en rollo_fotos. El path ya fue
  // subido por subirFotoFalla; acá solo persistimos la fila.
  const fotosToInsert = (rollosInsertados ?? [])
    .map((rolloDb) => {
      const input2 = input.rollos.find(
        (r) => r.numero_pieza.trim() === rolloDb.numero_pieza
      )
      if (!input2?.foto_falla_path) return null
      return {
        rollo_id: rolloDb.id,
        path: input2.foto_falla_path,
        tipo: 'falla' as const,
        descripcion: input2.falla_descripcion?.trim() || null,
        created_by: user.id,
      }
    })
    .filter((row): row is NonNullable<typeof row> => row !== null)

  if (fotosToInsert.length > 0) {
    const { error: fError } = await supabase
      .from('rollo_fotos')
      .insert(fotosToInsert)
    if (fError) {
      // No abortamos: el ingreso ya es válido, las fotos pueden re-subirse
      // desde el detalle. Solo advertimos.
      console.error('Error al insertar rollo_fotos:', fError.message)
    }
  }

  redirect(`/ingresos/${ingreso.id}?creado=1`)
}

// ── Edición de encabezado de ingreso (solo admin) ──────────

export type EditarIngresoInput = {
  ingresoId: string
  tintoreria_id: string
  fecha: string
  numero_remito: string
  ot: string
  rem_tejeduria: string
  referencia: string
  comentario: string
  total_rollos_declarado: string
  total_kilos_declarado: string
}

export async function editarIngreso(input: EditarIngresoInput) {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'Sesión expirada — volvé a iniciar sesión.' }

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()

  if (profile?.role !== 'admin') {
    return { error: 'Solo el administrador puede editar ingresos.' }
  }

  const totalKilosDeclarado = parseDecimal(input.total_kilos_declarado)
  if (
    Number.isNaN(totalKilosDeclarado) ||
    (totalKilosDeclarado != null && totalKilosDeclarado < 0)
  ) {
    return { error: 'Ingresa un total de kilos declarado valido.' }
  }

  const { error } = await supabase
    .from('ingresos')
    .update({
      tintoreria_id: input.tintoreria_id,
      fecha_despacho: input.fecha,
      numero_remito: input.numero_remito.trim() || null,
      ot: input.ot.trim() || null,
      rem_tejeduria: input.rem_tejeduria.trim() || null,
      referencia: input.referencia.trim() || null,
      comentario: input.comentario.trim() || null,
      total_rollos_declarado: input.total_rollos_declarado
        ? parseInt(input.total_rollos_declarado)
        : null,
      total_kilos_declarado: totalKilosDeclarado,
      editado_at: new Date().toISOString(),
      editado_por: user.id,
    })
    .eq('id', input.ingresoId)

  if (error) return { error: error.message }

  redirect(`/ingresos/${input.ingresoId}?editado=1`)
}

function parseDecimal(value: string | undefined): number | null {
  const trimmed = value?.trim()
  if (!trimmed) return null
  const parsed = Number(trimmed.replace(',', '.'))
  return Number.isFinite(parsed) ? parsed : Number.NaN
}
