'use client'

import { Fragment, useEffect, useMemo, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { toast } from 'sonner'
import { Camera, QrCode, Barcode, X, RefreshCw } from 'lucide-react'
import {
  crearIngreso,
  procesarPlanillaConIA,
  subirFotoFalla,
  type RolloInput,
} from './actions'
import { createColor, solicitarColor } from '@/app/admin/colores/actions'
import { createClient } from '@/lib/supabase/client'
import {
  UMBRAL_BAJA_CONFIANZA,
  type IngresoExtraido,
  type Field,
} from '@/lib/extraccion/extraerPlanilla'
import { ubicacionesToOptions, type UbicacionOption } from '@/lib/ubicaciones'
import ScannerByReaderType from '@/components/ScannerByReaderType'
import SearchableCombobox from '@/components/SearchableCombobox'
import type { CodeScannerResult } from '@/components/CodeScanner'
import { extraerCodigoCandidato } from '@/lib/scanner'
import type { PatronCodigo } from '@/lib/scanner'

type PatronConTintoreria = PatronCodigo & { tintoreria_id: string | null }

type Catalog = { id: string; nombre: string }
type ArticuloCatalog = { id: string; nombre: string; colores: Catalog[] }

type Modo = 'manual' | 'ia'

type Role = 'operario' | 'ventas' | 'admin' | 'super'

type Confianzas = {
  numero_remito: number
  fecha: number
  ot: number
  rem_tejeduria: number
  referencia: number
  total_rollos_declarado: number
  total_kilos_declarado: number
  rollos: Array<{
    numero_pieza: number
    kilos: number
    metros: number
    rinde: number
    gramaje_planilla: number
    articulo: number
    color: number
  }>
}


function normNombre(s: string): string {
  return s
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ')
}

function normColor(raw: string | null | undefined): string | null {
  const trimmed = raw?.trim()
  if (!trimmed) return null
  return trimmed.toLowerCase().replace(/\b\p{L}/gu, (c) => c.toUpperCase())
}

/** Tokeniza un nombre normalizado en palabras significativas (len ≥ 2). */
function tokens(s: string): string[] {
  return s.split(/\W+/).filter((t) => t.length >= 2)
}

/** ¿La distancia de edición entre `a` y `b` es ≤ 1 (1 sustitución/alta/baja)? */
function casiIgual(a: string, b: string): boolean {
  if (a === b) return true
  const la = a.length
  const lb = b.length
  if (Math.abs(la - lb) > 1) return false
  let i = 0
  let j = 0
  let diffs = 0
  while (i < la && j < lb) {
    if (a[i] === b[j]) {
      i++
      j++
      continue
    }
    if (++diffs > 1) return false
    if (la > lb) i++ // sobra un char en a
    else if (lb > la) j++ // falta un char en a
    else {
      i++
      j++
    } // sustitución
  }
  if (i < la || j < lb) diffs++
  return diffs <= 1
}

/**
 * ¿El token del catálogo matchea el token del texto? Matchea si: son iguales;
 * uno es prefijo del otro (≥ 3 chars, ej. "ml70" ↔ "ml70c"); o difieren en 1
 * sola letra en tokens de ≥ 4 chars (variantes de género/typo, ej. "frisado"
 * ↔ "frisada", "negro" ↔ "negra").
 */
function tokenMatch(catTok: string, txtTok: string): boolean {
  if (catTok === txtTok) return true
  if (catTok.length >= 3 && txtTok.startsWith(catTok)) return true
  if (txtTok.length >= 3 && catTok.startsWith(txtTok)) return true
  if (Math.min(catTok.length, txtTok.length) >= 4 && casiIgual(catTok, txtTok))
    return true
  return false
}

/**
 * Confianza para el resaltado naranja por celda. Si el campo vino vacío
 * (null/''), no hay nada que revisar → devolvemos 1 (sin warning). Solo los
 * campos CON valor y baja confianza se resaltan.
 */
function confDe(
  f: { value: unknown; confidence: number } | null | undefined
): number {
  if (!f) return 1
  const v = f.value
  const tiene = v !== null && v !== undefined && String(v).trim() !== ''
  return tiene ? f.confidence : 1
}

function emptyRollo(): RolloInput {
  return {
    numero_pieza: '',
    kilos: '',
    metros: '',
    rinde: '',
    gramaje_planilla: '',
    ubicacion: '',
    estado: 'pendiente',
    articulo_id: null,
    color_id: null,
  }
}

function todayISO() {
  return new Date().toISOString().split('T')[0]
}

function fmt(v: number | null): string {
  return v === null || v === undefined ? '' : String(v)
}

function parseDecimalInput(value: string): number | null {
  const trimmed = value.trim()
  if (!trimmed) return null
  const parsed = Number(trimmed.replace(',', '.'))
  return Number.isFinite(parsed) ? parsed : Number.NaN
}

function valOf<T>(f: Field<T>): string {
  if (f.value === null || f.value === undefined) return ''
  return String(f.value)
}

function avg(nums: number[]): number {
  if (!nums.length) return 0
  return nums.reduce((a, b) => a + b, 0) / nums.length
}

function celdaCls(confianza: number | undefined): string {
  if (confianza === undefined) return 'border-input'
  return confianza < UMBRAL_BAJA_CONFIANZA
    ? 'border-warning ring-1 ring-warning/40'
    : 'border-input'
}

/**
 * Estado UI por rollo para la foto de segunda calidad. Mantenemos el
 * `File` cliente-side hasta el submit; ahí lo subimos al bucket y lo
 * persistimos en `rollos[].foto_falla_path` que viaja al server.
 */
type FotoPendiente = { file: File; previewUrl: string }

export default function NuevoIngresoForm({
  tintorerias: initialTintorerias,
  articulos: initialArticulos,
  colores: initialColores,
  ubicaciones,
  role,
  patrones,
  tiposFalla = [],
}: {
  tintorerias: Catalog[]
  articulos: ArticuloCatalog[]
  colores: Catalog[]
  ubicaciones: UbicacionOption[]
  role: Role
  patrones: PatronConTintoreria[]
  tiposFalla?: { id: string; nombre: string }[]
}) {
  const router = useRouter()
  const fileInputRef = useRef<HTMLInputElement>(null)

  const tintorerias = initialTintorerias
  const [articulos, setArticulos] = useState(initialArticulos)
  const [colores, setColores] = useState(initialColores)
  const [refrescandoColores, setRefrescandoColores] = useState(false)

  const [modo, setModo] = useState<Modo>('manual')

  const [archivo, setArchivo] = useState<File | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [imagenPath, setImagenPath] = useState<string | null>(null)
  const [extrayendo, setExtrayendo] = useState(false)
  const [extraccionError, setExtraccionError] = useState<string | null>(null)
  const [warnings, setWarnings] = useState<string[]>([])
  const [confianzas, setConfianzas] = useState<Confianzas | null>(null)

  const [tintoreriaId, setTintoreriaId] = useState('')
  const [fecha, setFecha] = useState(todayISO())
  const [numeroRemito, setNumeroRemito] = useState('')
  const [ot, setOt] = useState('')
  const [remTejeduria, setRemTejeduria] = useState('')
  const [referencia, setReferencia] = useState('')
  const [totalRollosDeclarado, setTotalRollosDeclarado] = useState('')
  const [totalKilosDeclarado, setTotalKilosDeclarado] = useState('')
  const [comentario, setComentario] = useState('')

  const [rollos, setRollos] = useState<RolloInput[]>([emptyRollo()])
  const [fotosFalla, setFotosFalla] = useState<Record<number, FotoPendiente>>({})
  const [bulkUbicacion, setBulkUbicacion] = useState('')
  const [bulkArticuloId, setBulkArticuloId] = useState('')
  const [bulkColorId, setBulkColorId] = useState('')

  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [otDuplicadaId, setOtDuplicadaId] = useState<string | null>(null)

  const [scannerTipo, setScannerTipo] = useState<'qr' | 'barcode' | null>(null)
  const [scanFlowState, setScanFlowState] = useState<'form' | 'editing_rollo'>('form')
  const [lastScannedIdx, setLastScannedIdx] = useState<number | null>(null)
  const [lastScannerTipo, setLastScannerTipo] = useState<'qr' | 'barcode' | null>(null)
  const ubicacionOptions = useMemo(
    () => ubicacionesToOptions(ubicaciones),
    [ubicaciones]
  )

  // Anti-rebote del scanner: la cámara re-detecta el mismo QR muchas veces por
  // segundo mientras está en cuadro. Guardamos la última lectura para ignorar
  // repeticiones inmediatas (cooldown).
  const lastScanRef = useRef<{ code: string; at: number }>({ code: '', at: 0 })
  // Espejo siempre-actualizado de `rollos` para chequear duplicados sin races.
  const rollosRef = useRef(rollos)
  useEffect(() => {
    rollosRef.current = rollos
  }, [rollos])

  function updateRollo<K extends keyof RolloInput>(
    idx: number,
    field: K,
    value: RolloInput[K]
  ) {
    setRollos((prev) =>
      prev.map((r, i) => (i === idx ? { ...r, [field]: value } : r))
    )
  }

  /**
   * Cambia el artículo de un rollo. El color es independiente del artículo
   * (todos los artículos aceptan todos los colores), así que no lo tocamos.
   */
  function setRolloArticulo(idx: number, nuevoArticuloId: string | null) {
    setRollos((prev) =>
      prev.map((r, i) =>
        i === idx ? { ...r, articulo_id: nuevoArticuloId } : r
      )
    )
  }

  // Rollo nuevo que hereda los valores elegidos arriba ("Asignar a todos los
  // rollos"): artículo, color y ubicación. Así lo que se carga/escanea nuevo
  // ya viene con esos defaults, sin tener que apretar "Aplicar" cada vez.
  function rolloConDefaults(): RolloInput {
    const base = emptyRollo()
    if (bulkArticuloId) base.articulo_id = bulkArticuloId
    if (bulkColorId) base.color_id = bulkColorId
    if (bulkUbicacion.trim()) base.ubicacion = bulkUbicacion.trim()
    return base
  }

  function addRow() {
    setRollos([...rollos, rolloConDefaults()])
  }

  // Re-consulta el catálogo de colores y los colores por artículo SIN recargar
  // la página, así un color recién creado/aprobado aparece sin perder lo que ya
  // se cargó en el formulario.
  async function refrescarCatalogos() {
    setRefrescandoColores(true)
    try {
      const supabase = createClient()
      const [{ data: coloresData }, { data: articulosData }] = await Promise.all([
        supabase.from('colores').select('id, nombre').eq('activo', true).order('nombre'),
        supabase
          .from('articulos')
          .select('id, nombre, articulo_colores(fijado, colores(id, nombre))')
          .eq('activo', true)
          .order('nombre'),
      ])
      if (coloresData) setColores(coloresData as Catalog[])
      if (articulosData) {
        type ACRow = {
          fijado: boolean | null
          colores: { id: string; nombre: string } | { id: string; nombre: string }[] | null
        }
        const arts: ArticuloCatalog[] = (
          articulosData as unknown as {
            id: string
            nombre: string
            articulo_colores: ACRow[] | null
          }[]
        ).map((a) => {
          const cols = (a.articulo_colores ?? [])
            .map((ac) => {
              const color = Array.isArray(ac.colores) ? ac.colores[0] : ac.colores
              return color ? { ...color, fijado: ac.fijado ?? false } : null
            })
            .filter((c): c is { id: string; nombre: string; fijado: boolean } => !!c)
            .sort((x, y) =>
              x.fijado !== y.fijado
                ? x.fijado
                  ? -1
                  : 1
                : x.nombre.localeCompare(y.nombre, 'es')
            )
            .map(({ id, nombre }) => ({ id, nombre }))
          return { id: a.id, nombre: a.nombre, colores: cols }
        })
        setArticulos(arts)
      }
      toast.success('Colores actualizados.')
    } catch {
      toast.error('No se pudieron actualizar los colores.')
    } finally {
      setRefrescandoColores(false)
    }
  }

  function removeRow(idx: number) {
    if (rollos.length === 1) {
      setRollos([emptyRollo()])
    } else {
      setRollos(rollos.filter((_, i) => i !== idx))
    }
    if (confianzas) {
      const nuevas = { ...confianzas }
      nuevas.rollos = nuevas.rollos.filter((_, i) => i !== idx)
      setConfianzas(nuevas)
    }
    setFotosFalla((prev) => {
      const next: Record<number, FotoPendiente> = {}
      for (const [k, v] of Object.entries(prev)) {
        const kNum = Number(k)
        if (kNum < idx) next[kNum] = v
        else if (kNum > idx) next[kNum - 1] = v
      }
      return next
    })
  }

  function toggleSegunda(idx: number, valor: boolean) {
    setRollos((prev) =>
      prev.map((r, i) =>
        i === idx
          ? {
              ...r,
              segunda: valor,
              // Al destildar, limpiar campos asociados.
              falla_categoria: valor ? r.falla_categoria : null,
              falla_descripcion: valor ? r.falla_descripcion : null,
            }
          : r
      )
    )
    if (!valor) {
      setFotosFalla((prev) => {
        const next = { ...prev }
        delete next[idx]
        return next
      })
    }
  }

  function setFotoFalla(idx: number, file: File | null) {
    setFotosFalla((prev) => {
      const next = { ...prev }
      if (file) {
        const previewUrl = URL.createObjectURL(file)
        next[idx] = { file, previewUrl }
      } else {
        if (prev[idx]) URL.revokeObjectURL(prev[idx].previewUrl)
        delete next[idx]
      }
      return next
    })
  }

  function applyBulkUbicacion() {
    if (!bulkUbicacion.trim()) return
    const ubic = bulkUbicacion.trim()
    setRollos((prev) => prev.map((r) => ({ ...r, ubicacion: ubic })))
    toast.success(
      `Ubicación ${ubic} asignada a ${rollos.length} ${rollos.length === 1 ? 'rollo' : 'rollos'}.`
    )
  }

  function applyBulkArticulo() {
    if (!bulkArticuloId) return
    const articulo = articulos.find((a) => a.id === bulkArticuloId)
    // El color es independiente del artículo, así que lo mantenemos tal cual.
    setRollos((prev) =>
      prev.map((r) => ({ ...r, articulo_id: bulkArticuloId }))
    )
    toast.success(
      `Artículo "${articulo?.nombre ?? ''}" asignado a ${rollos.length} ${rollos.length === 1 ? 'rollo' : 'rollos'}.`
    )
  }

  function applyBulkColor() {
    if (!bulkColorId) return
    const colorNombre = colores.find((c) => c.id === bulkColorId)?.nombre ?? ''
    // Todos los artículos aceptan todos los colores (ver migración 051), así que
    // aplicamos el color a todos los rollos sin depender del artículo asignado.
    setRollos((prev) => prev.map((r) => ({ ...r, color_id: bulkColorId })))
    toast.success(
      `Color "${colorNombre}" asignado a ${rollos.length} ${rollos.length === 1 ? 'rollo' : 'rollos'}.`
    )
  }

  function resetIA() {
    setArchivo(null)
    setPreviewUrl(null)
    setImagenPath(null)
    setExtrayendo(false)
    setExtraccionError(null)
    setWarnings([])
    setConfianzas(null)
  }

  function cambiarModo(nuevo: Modo) {
    if (nuevo === modo) return
    if (nuevo === 'manual') resetIA()
    setModo(nuevo)
  }

  async function handleArchivoSeleccionado(file: File) {
    if (!tintoreriaId) {
      setExtraccionError('Primero seleccioná la tintorería arriba.')
      return
    }
    setArchivo(file)
    setExtraccionError(null)
    setWarnings([])
    setConfianzas(null)

    if (file.type.startsWith('image/')) {
      const reader = new FileReader()
      reader.onload = (e) => setPreviewUrl(e.target?.result as string)
      reader.readAsDataURL(file)
    } else {
      setPreviewUrl(null)
    }

    setExtrayendo(true)
    const formData = new FormData()
    formData.set('archivo', file)
    formData.set('tintoreria_id', tintoreriaId)
    const result = await procesarPlanillaConIA(formData)
    setExtrayendo(false)

    if (!result.ok) {
      setExtraccionError(result.error)
      if (result.imagen_path) setImagenPath(result.imagen_path)
      return
    }

    setImagenPath(result.imagen_path)
    setWarnings(result.warnings)
    aplicarDatosIA(result.datos)
  }

  function aplicarDatosIA(datos: IngresoExtraido) {
    setNumeroRemito(valOf(datos.numero_remito))
    if (datos.fecha.value) setFecha(datos.fecha.value)
    setOt(valOf(datos.ot))
    setRemTejeduria(valOf(datos.rem_tejeduria))
    setReferencia(valOf(datos.referencia))
    setTotalRollosDeclarado(
      datos.total_rollos_declarado.value !== null
        ? String(datos.total_rollos_declarado.value)
        : ''
    )
    setTotalKilosDeclarado(
      datos.total_kilos_declarado.value !== null
        ? String(datos.total_kilos_declarado.value)
        : ''
    )

    // Resolución de color: matchea el texto extraído contra el catálogo
    // por nombre normalizado. Devuelve el ID o null.
    function colorIdFromText(raw: string | null | undefined): string | null {
      const norm = normColor(raw)
      if (!norm) return null
      return colores.find((c) => c.nombre === norm)?.id ?? null
    }
    const colorGlobalId = colorIdFromText(datos.color.value)
    if (colorGlobalId) setBulkColorId(colorGlobalId)

    // Match de artículo por nombre. Si la combinación (articulo, color)
    // no está asociada en la pivot, el server rechazaría con FK 23503.
    // Acá filtramos: si el color global no está en los colores del articulo
    // encontrado, dejamos color_id en null para que el usuario lo elija.
    function articuloIdFromText(nombreRaw: string): string | null {
      const texto = normNombre(nombreRaw)
      if (!texto) return null
      const tokensTexto = tokens(texto)
      const cat = articulos
        .map((a) => ({ a, n: normNombre(a.nombre), toks: tokens(normNombre(a.nombre)) }))
        .filter(({ n }) => n)

      // 1. Match exacto.
      const exacto = cat.find(({ n }) => n === texto)
      if (exacto) return exacto.a.id

      // 2. Match por tokens: contamos cuántos tokens del catálogo aparecen en
      //    el texto extraído (exacto o por prefijo, ej. "ml70" ↔ "ml70c").
      //    Es candidato si coincide la MAYORÍA de sus tokens (≥ 60%), así
      //    tolera palabras extra en cualquiera de los dos lados:
      //    catálogo "ML70 Frisada" ↔ texto "...TELA ML70C FRISADA TERMINADA".
      //    Elegimos el de más coincidencias (más específico).
      const candidatos = cat
        .map(({ a, n, toks }) => {
          const coinc = toks.filter((ct) =>
            tokensTexto.some((tt) => tokenMatch(ct, tt))
          ).length
          return { a, n, total: toks.length, coinc, ratio: coinc / toks.length }
        })
        .filter((c) => c.total > 0 && c.coinc >= 1 && c.ratio >= 0.6)
        .sort(
          (x, y) =>
            y.coinc - x.coinc || y.ratio - x.ratio || y.n.length - x.n.length
        )
      if (candidatos.length) return candidatos[0].a.id

      return null
    }

    // Nombre del artículo a nivel header: algunas planillas lo traen en la
    // columna "REFERENCIA" (la IA lo mete en `referencia`), no en `articulo`.
    // Probamos ese valor contra el catálogo como fallback global.
    const articuloHeaderId = articuloIdFromText(datos.referencia.value ?? '')

    const rollosFromIA: RolloInput[] = datos.rollos.map((r) => {
      const articuloNombre = r.articulo?.value?.trim() ?? ''
      const articuloId = articuloIdFromText(articuloNombre) ?? articuloHeaderId
      const colorRolloId = colorIdFromText(r.color?.value)
      const colorEfectivoId = colorRolloId ?? colorGlobalId

      // Si el artículo matcheó, solo aplicamos el color si está asociado a ese
      // artículo en la pivot (si no, lo limpiamos para que el usuario elija y
      // evitar el error de FK al guardar). Si el artículo NO matcheó (null),
      // aplicamos igual el color global: no hay riesgo de FK porque articulo_id
      // queda null, y así el color no se pierde.
      const articulo = articuloId
        ? articulos.find((a) => a.id === articuloId)
        : null
      const colorValido = articulo
        ? articulo.colores.some((c) => c.id === colorEfectivoId)
        : true

      return {
        numero_pieza: valOf(r.numero_pieza),
        kilos: fmt(r.kilos.value),
        metros: fmt(r.metros.value),
        rinde: fmt(r.ratio.value),
        gramaje_planilla: fmt(r.gramaje_planilla.value),
        ubicacion: '',
        estado: 'pendiente',
        articulo_id: articuloId,
        color_id: colorValido ? colorEfectivoId : null,
        confianza_ia: avg([
          r.numero_pieza.confidence,
          r.kilos.confidence,
          r.metros.confidence,
          r.ratio.confidence,
          r.gramaje_planilla.confidence,
        ]),
      }
    })
    setRollos(rollosFromIA.length > 0 ? rollosFromIA : [emptyRollo()])

    setConfianzas({
      numero_remito: confDe(datos.numero_remito),
      fecha: confDe(datos.fecha),
      ot: confDe(datos.ot),
      rem_tejeduria: confDe(datos.rem_tejeduria),
      referencia: confDe(datos.referencia),
      total_rollos_declarado: confDe(datos.total_rollos_declarado),
      total_kilos_declarado: confDe(datos.total_kilos_declarado),
      rollos: datos.rollos.map((r) => ({
        numero_pieza: confDe(r.numero_pieza),
        kilos: confDe(r.kilos),
        metros: confDe(r.metros),
        rinde: confDe(r.ratio),
        gramaje_planilla: confDe(r.gramaje_planilla),
        articulo: confDe(r.articulo),
        // El color efectivo puede venir del rollo o del header; si ninguno
        // tiene valor, no resaltamos (confianza 1).
        color: r.color?.value?.trim()
          ? (r.color?.confidence ?? 1)
          : datos.color.value?.trim()
            ? datos.color.confidence
            : 1,
      })),
    })
  }

  const validations = useMemo(() => {
    const sumaKilos = rollos.reduce(
      (acc, r) => {
        const kilos = parseDecimalInput(r.kilos)
        return acc + (Number.isNaN(kilos) ? 0 : (kilos ?? 0))
      },
      0
    )
    const rollosConPieza = rollos.filter((r) => r.numero_pieza.trim())
    const cantidadRollos = rollosConPieza.length

    const numeros = rollos.map((r) => r.numero_pieza.trim()).filter(Boolean)
    const seen = new Set<string>()
    const duplicadosSet = new Set<string>()
    for (const n of numeros) {
      if (seen.has(n)) duplicadosSet.add(n)
      seen.add(n)
    }
    const duplicados = Array.from(duplicadosSet)

    const totalRollosNum = parseInt(totalRollosDeclarado) || null
    const totalKilosNum = parseDecimalInput(totalKilosDeclarado)

    // El total de rollos declarado es obligatorio (debe ser un entero > 0).
    const totalRollosVacio = totalRollosNum === null

    const cantidadCoincide =
      totalRollosNum === null || totalRollosNum === cantidadRollos
    // Tolerancia: las planillas OCR (y a veces el propio total impreso) tienen
    // ruido de decimales/redondeo. Solo avisamos si la diferencia es
    // significativa (> 0.5 kg o > 0.1% del total declarado). Una diferencia
    // chica como 0.2 kg en 477 no es un error accionable; un rollo mal leído
    // por varios kg o uno que falta sí supera la tolerancia y se avisa.
    const toleranciaKilos = Math.max(0.5, (totalKilosNum ?? 0) * 0.001)
    const kilosCoinciden =
      totalKilosNum === null ||
      Math.abs(totalKilosNum - sumaKilos) <= toleranciaKilos

    const rollosSinArticulo = rollosConPieza.filter((r) => !r.articulo_id).length
    const rollosSinColor = rollosConPieza.filter((r) => !r.color_id).length
    const rollosSinUbicacion =
      modo === 'manual'
        ? rollosConPieza.filter((r) => !r.ubicacion.trim()).length
        : 0
    const rollosSegundaSinCategoria = rollosConPieza.filter(
      (r) => r.segunda && !r.falla_categoria
    ).length
    const rollosKilosInvalidos = rollosConPieza.filter((r) => {
      const kilos = parseDecimalInput(r.kilos)
      return kilos == null || Number.isNaN(kilos) || kilos <= 0
    }).length

    // Cross-check Kilos vs Metros/Rdto. En la planilla Rdto = Metros / Kilos,
    // así que los kilos esperados ≈ Metros / Rdto. Si los kilos cargados no
    // cierran con ese cálculo por más del umbral, el rollo probablemente tiene
    // un error de lectura (un decimal mal leído de varios kg). El umbral (3%)
    // está por encima del ruido de redondeo del propio Rdto (2 decimales), así
    // que no genera falsos positivos por diferencias chicas.
    const TOLERANCIA_RDTO = 0.03
    const rollosInconsistentes: {
      numero_pieza: string
      kilos: number
      esperado: number
    }[] = []
    for (const r of rollos) {
      const kg = parseDecimalInput(r.kilos)
      const m = parseFloat(r.metros)
      const rd = parseFloat(r.rinde)
      if (
        !r.numero_pieza.trim() ||
        kg == null ||
        Number.isNaN(kg) ||
        kg <= 0 ||
        !(m > 0) ||
        !(rd > 0)
      ) {
        continue
      }
      const esperado = m / rd
      if (Math.abs(kg - esperado) / esperado > TOLERANCIA_RDTO) {
        rollosInconsistentes.push({
          numero_pieza: r.numero_pieza.trim(),
          kilos: kg,
          esperado,
        })
      }
    }

    return {
      sumaKilos,
      cantidadRollos,
      duplicados,
      totalRollosVacio,
      cantidadCoincide,
      kilosCoinciden,
      rollosSinArticulo,
      rollosSinColor,
      rollosSinUbicacion,
      rollosSegundaSinCategoria,
      rollosKilosInvalidos,
      rollosInconsistentes,
    }
  }, [rollos, totalRollosDeclarado, totalKilosDeclarado, modo])

  function handleScanIngreso(result: CodeScannerResult) {
    const raw = result.texto.trim()
    if (!raw) return

    // Cooldown: ignorar en silencio la misma lectura repetida en una ventana
    // corta (mientras el QR sigue en cuadro la cámara dispara muchas veces).
    const ahora = Date.now()
    if (
      lastScanRef.current.code === raw &&
      ahora - lastScanRef.current.at < 2500
    ) {
      return
    }
    lastScanRef.current = { code: raw, at: ahora }

    const limiteRollos = parseInt(totalRollosDeclarado) || null
    if (limiteRollos !== null) {
      const yaEscaneados = rollosRef.current.filter(r => r.numero_pieza.trim()).length
      if (yaEscaneados >= limiteRollos) {
        toast.error(`Ya cargaste los ${limiteRollos} rollos declarados.`)
        return
      }
    }

    // 1. Extraer numero_pieza usando patrones de la tintorería seleccionada
    const patronesFiltrados = patrones.filter(
      (p) => p.tintoreria_id === tintoreriaId || p.tintoreria_id === null
    )
    let numeroPieza = extraerCodigoCandidato(raw, patronesFiltrados) ?? ''
    if (!numeroPieza) {
      // Sin patrón configurado para esta tintorería (ej. Lecotex, cuyo QR trae
      // "204024331 MORLEY POL C/LY NEGRO 9001 21.00"): el número de pieza es el
      // PRIMER número del payload. Lo demás (color/artículo por nombre, kilos
      // por el decimal) se extrae aparte y va a sus campos correspondientes.
      const primero = raw.match(/\d+/)?.[0] ?? ''
      numeroPieza = primero ? primero.replace(/^0+/, '') || primero : raw
    }

    // 2. Extraer kilos: último número decimal en el payload
    const kilosMatches = [...raw.matchAll(/\d+[.,]\d+/g)]
    const kilosStr = kilosMatches.length > 0
      ? kilosMatches[kilosMatches.length - 1][0].replace(',', '.')
      : ''

    // 3. Extraer color: buscar token exacto en catálogo
    const rawNorm = raw.toLowerCase()
    const colorEncontrado = colores.find((c) => {
      const cn = normNombre(c.nombre)
      return cn.length >= 3 && rawNorm.includes(cn)
    })
    const colorId = colorEncontrado?.id ?? null

    // 4. Extraer artículo: fuzzy match por tokens
    const rawToks = tokens(rawNorm)
    const articuloEncontrado = articulos.find((a) => {
      const toksArt = tokens(normNombre(a.nombre))
      if (!toksArt.length) return false
      const coinc = toksArt.filter((ct) => rawToks.some((rt) => tokenMatch(ct, rt))).length
      return coinc >= 1 && coinc / toksArt.length >= 0.6
    })
    const articuloId = articuloEncontrado?.id ?? null

    // Base con los defaults elegidos arriba; lo escaneado pisa lo que detecta.
    const base = rolloConDefaults()
    const articuloFinal = articuloId ?? base.articulo_id
    const articuloFinalObj = articulos.find((a) => a.id === articuloFinal)
    const colorFinal = (() => {
      // Color escaneado tiene prioridad si es válido para el artículo final.
      if (colorId && articuloFinalObj?.colores.some((c) => c.id === colorId)) {
        return colorId
      }
      // Si no, mantener el color default si sigue siendo válido.
      if (
        base.color_id &&
        articuloFinalObj?.colores.some((c) => c.id === base.color_id)
      ) {
        return base.color_id
      }
      return null
    })()

    const nuevoRollo: RolloInput = {
      ...base,
      numero_pieza: numeroPieza,
      kilos: kilosStr || base.kilos,
      articulo_id: articuloFinal,
      color_id: colorFinal,
    }

    // Duplicado: si ese número de pieza ya está cargado, avisamos y NO
    // generamos otra fila (rollosRef tiene el estado actual, sin races).
    if (
      numeroPieza &&
      rollosRef.current.some((r) => r.numero_pieza.trim() === numeroPieza)
    ) {
      toast.warning(`El código ${numeroPieza} ya fue ingresado.`)
      return
    }

    // Calcular el índice del nuevo rollo antes de actualizar el estado
    const rollosActuales = rollosRef.current
    const ultimoActual = rollosActuales[rollosActuales.length - 1]
    // Una fila es "reemplazable" si no tiene numero_pieza. El artículo/color/ubicación
    // aplicados en bulk son defaults y no convierten la fila en "usada".
    const reemplazaUltimo = !ultimoActual.numero_pieza.trim()
    const newIdx = reemplazaUltimo ? rollosActuales.length - 1 : rollosActuales.length

    setRollos((prev) => {
      const ultimo = prev[prev.length - 1]
      const ultimoVacio = !ultimo.numero_pieza.trim()
      if (ultimoVacio) return [...prev.slice(0, -1), nuevoRollo]
      return [...prev, nuevoRollo]
    })

    setLastScannedIdx(newIdx)
    setScanFlowState('editing_rollo')
    setScannerTipo(null)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    setSubmitError(null)

    // Subir fotos de falla en paralelo y atar el path al rollo correspondiente.
    const rollosFiltrados = rollos.filter((r) => r.numero_pieza.trim())
    const rollosConFoto: RolloInput[] = await Promise.all(
      rollosFiltrados.map(async (r) => {
        // Buscar la fotoPendiente cuyo índice apunta a este rollo en la
        // lista filtrada. fotosFalla está indexada por idx en `rollos`
        // (no filtrado). Resolvemos el mapeo recorriendo.
        const idxEnTodos = rollos.indexOf(r)
        const foto = fotosFalla[idxEnTodos]
        if (!foto || !r.segunda) return r
        const fd = new FormData()
        fd.set('archivo', foto.file)
        const res = await subirFotoFalla(fd)
        if (!res.ok) {
          throw new Error(`No se pudo subir la foto del rollo ${r.numero_pieza}: ${res.error}`)
        }
        return { ...r, foto_falla_path: res.path }
      })
    ).catch((err) => {
      setSubmitError(err instanceof Error ? err.message : 'Error subiendo fotos.')
      setSubmitting(false)
      return null as unknown as RolloInput[]
    })

    if (!rollosConFoto) return

    const result = await crearIngreso({
      tintoreria_id: tintoreriaId,
      fecha,
      numero_remito: numeroRemito,
      ot,
      rem_tejeduria: remTejeduria,
      referencia,
      comentario,
      total_rollos_declarado: totalRollosDeclarado,
      total_kilos_declarado: totalKilosDeclarado,
      imagen_path: imagenPath ?? undefined,
      origen: modo === 'ia' ? 'planilla_ia' : 'manual',
      rollos: rollosConFoto,
    })

    if (result?.error) {
      setSubmitError(result.error)
      if ('ingresoExistente_id' in result && result.ingresoExistente_id) {
        setOtDuplicadaId(result.ingresoExistente_id as string)
      }
      setSubmitting(false)
    }
  }

  const blockSubmit =
    submitting ||
    extrayendo ||
    !tintoreriaId ||
    !fecha ||
    validations.cantidadRollos === 0 ||
    validations.duplicados.length > 0 ||
    validations.rollosSinArticulo > 0 ||
    validations.rollosSinColor > 0 ||
    validations.rollosSinUbicacion > 0 ||
    validations.rollosSegundaSinCategoria > 0 ||
    validations.rollosKilosInvalidos > 0 ||
    validations.totalRollosVacio ||
    !validations.cantidadCoincide ||
    !validations.kilosCoinciden

  const totalRollosNum = parseInt(totalRollosDeclarado) || null
  const rollosSaturado = totalRollosNum !== null && validations.cantidadRollos >= totalRollosNum

  const tintoreriaBloqueada = modo === 'ia' && archivo !== null

  return (
    <form onSubmit={handleSubmit} className="space-y-5 sm:space-y-6">
      {/* Toggle modo */}
      <div className="rounded-lg border bg-white p-3 sm:p-4 shadow-sm grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={() => cambiarModo('manual')}
          className={`rounded-md px-3 py-2 text-sm font-medium transition-colors ${
            modo === 'manual'
              ? 'bg-primary text-primary-foreground'
              : 'bg-zinc-100 hover:bg-zinc-200'
          }`}
        >
          Cargar a mano
        </button>
        <button
          type="button"
          onClick={() => cambiarModo('ia')}
          className={`rounded-md px-3 py-2 text-sm font-medium transition-colors ${
            modo === 'ia'
              ? 'bg-primary text-primary-foreground'
              : 'bg-zinc-100 hover:bg-zinc-200'
          }`}
        >
          Planilla con IA
        </button>
      </div>

      {scanFlowState === 'editing_rollo' && lastScannedIdx !== null ? (
        <EditingRolloView
          rollo={rollos[lastScannedIdx]}
          scannerTipo={lastScannerTipo}
          articulos={articulos}
          colores={colores}
          ubicacionOptions={ubicacionOptions}
          fotoFalla={fotosFalla[lastScannedIdx]}
          confianzas={confianzas?.rollos[lastScannedIdx]}
          onUpdate={(f, v) => updateRollo(lastScannedIdx, f, v)}
          onChangeArticulo={(id) => setRolloArticulo(lastScannedIdx, id)}
          onToggleSegunda={(v) => toggleSegunda(lastScannedIdx, v)}
          onFotoFalla={(f) => setFotoFalla(lastScannedIdx, f)}
          onSiguienteRollo={() => {
            setScanFlowState('form')
            setScannerTipo(lastScannerTipo)
          }}
          onVerTodos={() => {
            setScanFlowState('form')
            setScannerTipo(null)
          }}
          rolloNumber={lastScannedIdx + 1}
          totalRollos={rollos.filter((r) => r.numero_pieza.trim()).length}
          tiposFalla={tiposFalla}
        />
      ) : (<>

      {/* Modo IA */}
      {modo === 'ia' && (
        <div className="rounded-lg border bg-white p-4 sm:p-5 shadow-sm space-y-4">
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <span className="flex-shrink-0 inline-flex items-center justify-center w-6 h-6 rounded-full bg-primary text-primary-foreground text-xs font-bold">
                1
              </span>
              <label className="text-sm font-medium">
                Tintorería de la que viene la planilla *
              </label>
            </div>
            <select
              value={tintoreriaId}
              onChange={(e) => setTintoreriaId(e.target.value)}
              disabled={tintoreriaBloqueada}
              required
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:bg-zinc-50 disabled:cursor-not-allowed"
            >
              <option value="">Seleccionar tintorería...</option>
              {tintorerias.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.nombre}
                </option>
              ))}
            </select>
          </div>

          {tintoreriaId && (
            <div className="space-y-2 pt-3 border-t">
              <div className="flex items-center gap-2">
                <span
                  className={`flex-shrink-0 inline-flex items-center justify-center w-6 h-6 rounded-full text-xs font-bold ${
                    archivo
                      ? 'bg-success text-success-foreground'
                      : 'bg-primary text-primary-foreground'
                  }`}
                >
                  2
                </span>
                <label className="text-sm font-medium">Subir planilla</label>
              </div>

              {!archivo && !extrayendo && !extraccionError && (
                <UploadArea
                  onFile={handleArchivoSeleccionado}
                  fileInputRef={fileInputRef}
                />
              )}

              {extrayendo && (
                <div className="flex items-center gap-3 rounded-md bg-zinc-50 px-4 py-6 text-sm">
                  <Spinner />
                  <div>
                    <p className="font-medium">Procesando planilla con IA...</p>
                    <p className="text-xs text-muted-foreground">
                      Esto suele tomar 5-10 segundos.
                    </p>
                  </div>
                </div>
              )}

              {extraccionError && (
                <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 sm:p-4 space-y-3">
                  <p className="text-sm font-medium text-destructive">
                    ⚠ La IA no pudo procesar la planilla
                  </p>
                  <p className="text-xs text-muted-foreground break-words">
                    {extraccionError}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        archivo && handleArchivoSeleccionado(archivo)
                      }
                      className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90"
                    >
                      Reintentar IA
                    </button>
                    <button
                      type="button"
                      onClick={() => cambiarModo('manual')}
                      className="rounded-md border bg-white px-3 py-1.5 text-xs hover:bg-zinc-50"
                    >
                      Cargar a mano
                    </button>
                    <button
                      type="button"
                      onClick={resetIA}
                      className="rounded-md border bg-white px-3 py-1.5 text-xs hover:bg-zinc-50"
                    >
                      Subir otra
                    </button>
                  </div>
                </div>
              )}

              {archivo && !extrayendo && !extraccionError && (
                <div className="space-y-3">
                  <div className="flex items-start gap-3 rounded-md border bg-zinc-50 p-3">
                    {previewUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={previewUrl}
                        alt="Planilla"
                        className="h-16 w-16 sm:h-20 sm:w-20 object-cover rounded flex-shrink-0"
                      />
                    ) : (
                      <div className="h-16 w-16 sm:h-20 sm:w-20 rounded bg-zinc-200 flex items-center justify-center text-xs text-muted-foreground flex-shrink-0">
                        PDF
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">
                        {archivo.name}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {(archivo.size / 1024).toFixed(1)} KB · datos extraídos
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={resetIA}
                      className="text-xs text-muted-foreground hover:text-destructive flex-shrink-0"
                    >
                      Quitar
                    </button>
                  </div>

                  {warnings.length > 0 && (
                    <div className="rounded-md border border-warning/30 bg-warning/5 p-3 space-y-1">
                      {warnings.map((w, i) => (
                        <p key={i} className="text-xs text-foreground">
                          💡 {w}
                        </p>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Header del ingreso */}
      <div className="rounded-lg border bg-white p-4 sm:p-5 shadow-sm space-y-4">
        <h2 className="font-semibold">Datos del ingreso</h2>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
          {modo === 'manual' && (
            <div className="space-y-1">
              <label className="text-sm font-medium">Tintorería *</label>
              <select
                value={tintoreriaId}
                onChange={(e) => setTintoreriaId(e.target.value)}
                required
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <option value="">Seleccionar...</option>
                {tintorerias.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.nombre}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="space-y-1">
            <label className="text-sm font-medium">Fecha *</label>
            <input
              type="date"
              value={fecha}
              onChange={(e) => setFecha(e.target.value)}
              required
              className={`w-full rounded-md border bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${celdaCls(confianzas?.fecha)}`}
            />
          </div>

          <div className="space-y-1">
            <label className="text-sm font-medium">Número de remito</label>
            <input
              type="text"
              value={numeroRemito}
              onChange={(e) => setNumeroRemito(e.target.value)}
              placeholder="Ej: 49447"
              className={`w-full rounded-md border bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${celdaCls(confianzas?.numero_remito)}`}
            />
          </div>

          <div className="space-y-1">
            <label className="text-sm font-medium">
              Total de rollos declarado *
            </label>
            <input
              type="number"
              min="1"
              required
              inputMode="numeric"
              value={totalRollosDeclarado}
              onChange={(e) => setTotalRollosDeclarado(e.target.value)}
              placeholder="Ej: 24"
              className={`w-full rounded-md border bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                validations.totalRollosVacio
                  ? 'border-destructive'
                  : celdaCls(confianzas?.total_rollos_declarado)
              }`}
            />
            {validations.totalRollosVacio && (
              <p className="text-xs text-destructive">
                Ingresá el total de rollos declarado.
              </p>
            )}
          </div>

          <div className="space-y-1">
            <label className="text-sm font-medium">
              Total de kilos declarado
            </label>
            <input
              type="text"
              inputMode="decimal"
              value={totalKilosDeclarado}
              onChange={(e) => setTotalKilosDeclarado(e.target.value)}
              placeholder="Ej: 480.50 o 480,50"
              className={`w-full rounded-md border bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${celdaCls(confianzas?.total_kilos_declarado)}`}
            />
          </div>

          <div className="space-y-1">
            <label className="text-sm font-medium">OT (partida tintorería)</label>
            <input
              type="text"
              value={ot}
              onChange={(e) => { setOt(e.target.value); setOtDuplicadaId(null) }}
              placeholder="Orden de trabajo"
              className={`w-full rounded-md border bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${celdaCls(confianzas?.ot)}`}
            />
          </div>

          <div className="space-y-1">
            <label className="text-sm font-medium">Remito tejeduría</label>
            <input
              type="text"
              value={remTejeduria}
              onChange={(e) => setRemTejeduria(e.target.value)}
              placeholder="Remito de la tejeduría"
              className={`w-full rounded-md border bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${celdaCls(confianzas?.rem_tejeduria)}`}
            />
          </div>

          <div className="space-y-1">
            <label className="text-sm font-medium">Referencia</label>
            <input
              type="text"
              value={referencia}
              onChange={(e) => setReferencia(e.target.value)}
              placeholder="Ej: SBI"
              className={`w-full rounded-md border bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${celdaCls(confianzas?.referencia)}`}
            />
          </div>
        </div>

        <div className="space-y-1">
          <label className="text-sm font-medium">Comentario</label>
          <textarea
            value={comentario}
            onChange={(e) => setComentario(e.target.value)}
            rows={2}
            placeholder="Opcional. Ej: faltó un rollo, se reclama a la tintorería. Lo podés editar o borrar después."
            className="w-full rounded-md border bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </div>
      </div>

      {/* Atajos bulk */}
      <div className="rounded-lg border bg-white p-4 sm:p-5 shadow-sm space-y-3">
        <div>
          <h2 className="font-semibold">Artículo, color y ubicación por defecto</h2>
          <p className="text-xs text-muted-foreground">
            Lo que elijas acá se aplica automáticamente a cada rollo nuevo que
            cargues o escanees. Con &quot;Aplicar&quot; también se lo asignás a
            los rollos ya cargados.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 sm:gap-4">
          <div className="space-y-1">
            <label className="text-sm font-medium">Artículo</label>
            <div className="flex gap-2">
              <select
                value={bulkArticuloId}
                onChange={(e) => setBulkArticuloId(e.target.value)}
                className="min-w-0 flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <option value="">Seleccionar...</option>
                {articulos.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.nombre}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={applyBulkArticulo}
                disabled={!bulkArticuloId}
                className="shrink-0 whitespace-nowrap rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-40 transition-colors"
              >
                Aplicar
              </button>
            </div>
            <p className="text-xs text-muted-foreground">
              ¿Falta un artículo?{' '}
              <a href="/admin/articulos" className="underline">
                Crealo desde administración
              </a>
              .
            </p>
          </div>

          <div className="space-y-1">
            <label className="text-sm font-medium">Color</label>
            <div className="flex gap-2">
              <select
                value={bulkColorId}
                onChange={(e) => setBulkColorId(e.target.value)}
                className="min-w-0 flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <option value="">Seleccionar...</option>
                {colores.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.nombre}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={applyBulkColor}
                disabled={!bulkColorId}
                className="shrink-0 whitespace-nowrap rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-40 transition-colors"
              >
                Aplicar
              </button>
            </div>
            <p className="text-xs text-muted-foreground">
              Solo se aplica a los rollos cuyo artículo ya incluye ese color.
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <SolicitarColorButton
                role={role}
                onCreated={(c) => {
                  if (!colores.find((x) => x.id === c.id)) {
                    setColores((prev) => [...prev, c])
                  }
                  setBulkColorId(c.id)
                }}
              />
              <button
                type="button"
                onClick={refrescarCatalogos}
                disabled={refrescandoColores}
                className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground disabled:opacity-50"
                title="Volver a cargar la lista de colores sin perder lo que cargaste"
              >
                <RefreshCw
                  className={`size-3.5 ${refrescandoColores ? 'animate-spin' : ''}`}
                />
                {refrescandoColores ? 'Actualizando…' : 'Actualizar colores'}
              </button>
            </div>
          </div>

          <div className="space-y-1">
            <label className="text-sm font-medium">Ubicación</label>
            <div className="flex gap-2">
              <SearchableCombobox
                value={bulkUbicacion}
                onChange={setBulkUbicacion}
                options={ubicacionOptions}
                placeholder="Seleccionar..."
                searchPlaceholder="Buscar ubicacion..."
                emptyLabel="No hay ubicaciones"
                allowClear={false}
                className="min-w-0 flex-1"
              />
              <button
                type="button"
                onClick={applyBulkUbicacion}
                disabled={!bulkUbicacion.trim()}
                className="shrink-0 whitespace-nowrap rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-40 transition-colors"
              >
                Aplicar
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Rollos */}
      <div className="rounded-lg border bg-white shadow-sm overflow-hidden">
        <div className="px-3 sm:px-4 py-3 border-b bg-zinc-50 flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-semibold text-sm">Rollos</h2>
          <span className="text-xs text-muted-foreground">
            {validations.cantidadRollos} cargados · suma{' '}
            {validations.sumaKilos.toFixed(2)} kg
          </span>
        </div>

        {/* Scanner de etiquetas — solo en modo manual */}
        {modo === 'manual' && (
          <div className="px-3 sm:px-4 py-3 border-b bg-zinc-50/50 space-y-3">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Escanear etiquetas
            </p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={rollosSaturado}
                onClick={() => {
                  const next = scannerTipo === 'qr' ? null : ('qr' as const)
                  setScannerTipo(next)
                  if (next) setLastScannerTipo(next)
                }}
                className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium border transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
                  scannerTipo === 'qr'
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'bg-white border-input hover:bg-zinc-50'
                }`}
              >
                <QrCode className="size-3.5" />
                Código QR
              </button>
              <button
                type="button"
                disabled={rollosSaturado}
                onClick={() => {
                  const next = scannerTipo === 'barcode' ? null : ('barcode' as const)
                  setScannerTipo(next)
                  if (next) setLastScannerTipo(next)
                }}
                className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium border transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
                  scannerTipo === 'barcode'
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'bg-white border-input hover:bg-zinc-50'
                }`}
              >
                <Barcode className="size-3.5" />
                Código de barras
              </button>
              {scannerTipo && (
                <button
                  type="button"
                  onClick={() => setScannerTipo(null)}
                  className="inline-flex items-center gap-1 rounded-md px-2 py-1.5 text-xs text-muted-foreground hover:text-foreground"
                >
                  <X className="size-3.5" /> Cerrar
                </button>
              )}
            </div>
            {!scannerTipo && (
              <p className="text-xs text-muted-foreground">
                Seleccioná el tipo de etiqueta para activar la cámara. Se agrega una fila por cada código escaneado.
              </p>
            )}
            {scannerTipo && (
              <ScannerByReaderType
                readerType={scannerTipo}
                onRead={handleScanIngreso}
                title={scannerTipo === 'qr' ? 'Escanear código QR' : 'Escanear código de barras'}
                hideManualInput
              />
            )}
          </div>
        )}

        {/* Mobile */}
        <div className="sm:hidden divide-y-2 divide-zinc-200">
          {[...rollos].map((r, i) => ({ r, i })).reverse().map(({ r, i }) => (
            <RolloCardMobile
              key={i}
              rollo={r}
              index={i}
              articulos={articulos}
              colores={colores}
              ubicacionOptions={ubicacionOptions}
              fotoFalla={fotosFalla[i]}
              confianzas={confianzas?.rollos[i]}
              isDuplicate={
                !!r.numero_pieza.trim() &&
                validations.duplicados.includes(r.numero_pieza.trim())
              }
              onUpdate={(field, value) => updateRollo(i, field, value)}
              onChangeArticulo={(id) => setRolloArticulo(i, id)}
              onToggleSegunda={(v) => toggleSegunda(i, v)}
              onFotoFalla={(f) => setFotoFalla(i, f)}
              onRemove={() => removeRow(i)}
              tiposFalla={tiposFalla}
            />
          ))}
        </div>

        {/* Desktop */}
        <div className="hidden sm:block overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left border-b">
              <tr>
                <th className="px-3 py-2 font-medium w-10">#</th>
                <th className="px-3 py-2 font-medium">N° Pieza *</th>
                <th className="px-3 py-2 font-medium w-40">Artículo *</th>
                <th className="px-3 py-2 font-medium w-32">Color *</th>
                <th className="px-3 py-2 font-medium w-24">Kilos *</th>
                <th className="px-3 py-2 font-medium w-24">Metros</th>
                <th className="px-3 py-2 font-medium w-20">Rinde</th>
                <th className="px-3 py-2 font-medium w-20">Gramaje</th>
                <th className="px-3 py-2 font-medium w-28">Segunda</th>
                <th className="px-3 py-2 font-medium w-28">Ubicación *</th>
                <th className="px-3 py-2 w-10"></th>
              </tr>
            </thead>
            <tbody>
              {[...rollos].map((r, i) => ({ r, i })).reverse().map(({ r, i }) => {
                const conf = confianzas?.rollos[i]
                const isDuplicate =
                  r.numero_pieza.trim() &&
                  validations.duplicados.includes(r.numero_pieza.trim())
                return (
                  <Fragment key={i}>
                    <tr
                      className={`border-b-2 border-zinc-200 last:border-0 ${
                        isDuplicate ? 'bg-destructive/5' : ''
                      } ${r.segunda ? 'bg-amber-50/40' : ''}`}
                    >
                      <td className="px-3 py-1 text-muted-foreground">{i + 1}</td>
                      <td className="px-3 py-1">
                        <input
                          type="text"
                          inputMode="numeric"
                          pattern="[0-9]*"
                          value={r.numero_pieza}
                          onChange={(e) =>
                            updateRollo(i, 'numero_pieza', e.target.value)
                          }
                          placeholder="204021911"
                          className={`w-full rounded border px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring ${
                            isDuplicate
                              ? 'border-destructive'
                              : celdaCls(conf?.numero_pieza)
                          }`}
                        />
                      </td>
                      <td className="px-3 py-1">
                        <select
                          value={r.articulo_id ?? ''}
                          onChange={(e) =>
                            setRolloArticulo(i, e.target.value || null)
                          }
                          className={`w-full rounded border bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring ${
                            r.numero_pieza.trim() && !r.articulo_id
                              ? 'border-destructive'
                              : celdaCls(conf?.articulo)
                          }`}
                        >
                          <option value="">Seleccionar...</option>
                          {articulos.map((a) => (
                            <option key={a.id} value={a.id}>
                              {a.nombre}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="px-3 py-1">
                        <select
                          value={r.color_id ?? ''}
                          onChange={(e) =>
                            updateRollo(i, 'color_id', e.target.value || null)
                          }
                          className={`w-full rounded border bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring ${
                            r.numero_pieza.trim() && !r.color_id
                              ? 'border-destructive'
                              : celdaCls(conf?.color)
                          }`}
                        >
                          <option value="">Seleccionar...</option>
                          {colores.map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.nombre}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="px-3 py-1">
                        <input
                          type="text"
                          inputMode="decimal"
                          value={r.kilos}
                          onChange={(e) => updateRollo(i, 'kilos', e.target.value)}
                          placeholder="20.5 o 20,5"
                          className={`w-full rounded border px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring ${
                            r.numero_pieza.trim() &&
                            (() => {
                              const k = parseDecimalInput(r.kilos)
                              return k == null || Number.isNaN(k) || k <= 0
                            })()
                              ? 'border-destructive'
                              : celdaCls(conf?.kilos)
                          }`}
                        />
                      </td>
                      <td className="px-3 py-1">
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          inputMode="decimal"
                          value={r.metros}
                          onChange={(e) =>
                            updateRollo(i, 'metros', e.target.value)
                          }
                          placeholder="50"
                          className={`w-full rounded border px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring ${celdaCls(conf?.metros)}`}
                        />
                      </td>
                      <td className="px-3 py-1">
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          inputMode="decimal"
                          value={r.rinde}
                          onChange={(e) =>
                            updateRollo(i, 'rinde', e.target.value)
                          }
                          placeholder="2.4"
                          className={`w-full rounded border px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring ${celdaCls(conf?.rinde)}`}
                        />
                      </td>
                      <td className="px-3 py-1">
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          inputMode="decimal"
                          value={r.gramaje_planilla ?? ''}
                          onChange={(e) =>
                            updateRollo(i, 'gramaje_planilla', e.target.value)
                          }
                          placeholder="142"
                          className={`w-full rounded border px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring ${celdaCls(conf?.gramaje_planilla)}`}
                        />
                      </td>
                      <td className="px-3 py-1">
                        <label className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                          <input
                            type="checkbox"
                            checked={!!r.segunda}
                            onChange={(e) => toggleSegunda(i, e.target.checked)}
                            className="size-4 rounded border-input text-action focus:ring-1 focus:ring-ring"
                          />
                          Marcar
                        </label>
                      </td>
                      <td className="px-3 py-1">
                        <SearchableCombobox
                          value={r.ubicacion}
                          onChange={(value) =>
                            updateRollo(i, 'ubicacion', value)
                          }
                          options={ubicacionOptions}
                          placeholder="Seleccionar..."
                          searchPlaceholder="Buscar ubicacion..."
                          emptyLabel="No hay ubicaciones"
                          allowClear={false}
                        />
                      </td>
                      <td className="px-3 py-1 text-center">
                        <button
                          type="button"
                          onClick={() => removeRow(i)}
                          className="text-muted-foreground hover:text-destructive text-lg leading-none"
                          aria-label="Eliminar fila"
                        >
                          ×
                        </button>
                      </td>
                    </tr>

                    {r.segunda && (
                      <tr className="border-b last:border-0 bg-amber-50/40">
                        <td></td>
                        <td colSpan={10} className="px-3 py-3">
                          <SegundaCalidadFields
                            rollo={r}
                            foto={fotosFalla[i]}
                            onUpdate={(field, value) =>
                              updateRollo(i, field, value)
                            }
                            onFoto={(f) => setFotoFalla(i, f)}
                            tiposFalla={tiposFalla}
                          />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                )
              })}
            </tbody>
          </table>
        </div>

        <div className="px-3 sm:px-4 py-3 border-t bg-zinc-50">
          <button
            type="button"
            onClick={addRow}
            className="text-sm font-medium text-primary hover:underline"
          >
            + Agregar fila
          </button>
        </div>
      </div>

      {/* Validaciones */}
      {(validations.duplicados.length > 0 ||
        validations.rollosSinArticulo > 0 ||
        validations.rollosSinColor > 0 ||
        validations.rollosSinUbicacion > 0 ||
        validations.rollosSegundaSinCategoria > 0 ||
        validations.rollosKilosInvalidos > 0 ||
        validations.rollosInconsistentes.length > 0 ||
        !validations.cantidadCoincide ||
        !validations.kilosCoinciden) && (
        <div className="rounded-lg border bg-warning/10 border-warning/30 p-3 sm:p-4 space-y-1 text-sm">
          {validations.duplicados.length > 0 && (
            <p className="text-destructive">
              ⚠ Números de pieza duplicados:{' '}
              {validations.duplicados.join(', ')}
            </p>
          )}
          {validations.rollosSinArticulo > 0 && (
            <p className="text-destructive">
              ⚠ {validations.rollosSinArticulo} rollo
              {validations.rollosSinArticulo === 1 ? '' : 's'} sin artículo asignado.
            </p>
          )}
          {validations.rollosSinColor > 0 && (
            <p className="text-destructive">
              ⚠ {validations.rollosSinColor} rollo
              {validations.rollosSinColor === 1 ? '' : 's'} sin color asignado.
            </p>
          )}
          {validations.rollosSinUbicacion > 0 && (
            <p className="text-destructive">
              ⚠ {validations.rollosSinUbicacion} rollo
              {validations.rollosSinUbicacion === 1 ? '' : 's'} sin ubicación asignada.
            </p>
          )}
          {validations.rollosSegundaSinCategoria > 0 && (
            <p className="text-destructive">
              ⚠ {validations.rollosSegundaSinCategoria} rollo
              {validations.rollosSegundaSinCategoria === 1 ? '' : 's'} marcado como segunda sin categoría de falla.
            </p>
          )}
          {validations.rollosKilosInvalidos > 0 && (
            <p className="text-destructive">
              ⚠ {validations.rollosKilosInvalidos} rollo
              {validations.rollosKilosInvalidos === 1 ? '' : 's'} con kilos inválidos.
            </p>
          )}
          {!validations.cantidadCoincide && (
            <p className="text-destructive">
              ⚠ Cargaste {validations.cantidadRollos} rollos, pero declaraste{' '}
              {totalRollosDeclarado}.
            </p>
          )}
          {!validations.kilosCoinciden && (
            <p className="text-destructive">
              ⚠ Suma de kilos {validations.sumaKilos.toFixed(2)} kg vs{' '}
              {totalKilosDeclarado} kg declarados.
            </p>
          )}
          {validations.rollosInconsistentes.length > 0 && (
            <div className="text-warning">
              <p>
                ⚠ {validations.rollosInconsistentes.length} rollo
                {validations.rollosInconsistentes.length === 1 ? '' : 's'} con
                Kilos que no cierran con Metros/Rdto — posible error de lectura,
                revisá el peso:
              </p>
              <ul className="mt-0.5 list-disc pl-5 text-xs">
                {validations.rollosInconsistentes.map((r) => (
                  <li key={r.numero_pieza}>
                    <strong>#{r.numero_pieza}</strong>: {r.kilos.toFixed(2)} kg
                    cargados vs ≈ {r.esperado.toFixed(2)} kg esperados (según
                    Metros/Rdto)
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {otDuplicadaId ? (
        <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          <p className="font-medium">Ya existe un ingreso con la OT &ldquo;{ot.trim()}&rdquo;.</p>
          <p className="mt-1">
            Para agregar rollos faltantes,{' '}
            <Link href={`/ingresos/${otDuplicadaId}`} className="underline font-medium">
              ir al ingreso existente
            </Link>{' '}
            y usar &ldquo;Agregar rollo faltante&rdquo;.
          </p>
        </div>
      ) : submitError ? (
        <p className="text-sm text-destructive">{submitError}</p>
      ) : null}

      <div className="flex flex-col-reverse sm:flex-row gap-3">
        <button
          type="button"
          onClick={() => router.push('/ingresos')}
          className="rounded-md border bg-white px-5 py-2.5 text-sm font-medium hover:bg-zinc-50 transition-colors"
        >
          Cancelar
        </button>
        <button
          type="submit"
          disabled={blockSubmit}
          className="rounded-md bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {submitting ? 'Guardando...' : 'Guardar ingreso'}
        </button>
      </div>
      </>)}
    </form>
  )
}

// ── Bloque expandible de segunda calidad ────────────────────

function SegundaCalidadFields({
  rollo,
  foto,
  onUpdate,
  onFoto,
  tiposFalla = [],
}: {
  rollo: RolloInput
  foto: FotoPendiente | undefined
  onUpdate: <K extends keyof RolloInput>(field: K, value: RolloInput[K]) => void
  onFoto: (file: File | null) => void
  tiposFalla?: { id: string; nombre: string }[]
}) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
      <div className="space-y-1">
        <label className="text-xs font-semibold text-foreground">
          Categoría de falla *
        </label>
        <select
          value={rollo.falla_categoria ?? ''}
          onChange={(e) =>
            onUpdate('falla_categoria', e.target.value || null)
          }
          className={`w-full rounded border bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring ${
            !rollo.falla_categoria ? 'border-destructive' : 'border-input'
          }`}
        >
          <option value="">Seleccionar...</option>
          {tiposFalla.map((t) => (
            <option key={t.id} value={t.nombre}>
              {t.nombre}
            </option>
          ))}
        </select>
      </div>
      <div className="space-y-1">
        <label className="text-xs font-semibold text-foreground">
          Descripción
        </label>
        <textarea
          value={rollo.falla_descripcion ?? ''}
          onChange={(e) =>
            onUpdate('falla_descripcion', e.target.value || null)
          }
          rows={2}
          placeholder="Ej. mancha de 2cm en el centro del rollo"
          className="w-full rounded border border-input bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring resize-none"
        />
      </div>
      <div className="space-y-1">
        <label className="text-xs font-semibold text-foreground">
          Foto de la falla
        </label>
        {foto ? (
          <div className="flex items-center gap-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={foto.previewUrl}
              alt="Falla"
              className="h-12 w-12 rounded object-cover border"
            />
            <button
              type="button"
              onClick={() => onFoto(null)}
              className="text-xs text-destructive hover:underline"
            >
              Quitar
            </button>
          </div>
        ) : (
          <label className="inline-flex items-center gap-1.5 rounded-md border border-input bg-white px-2 py-1.5 text-xs cursor-pointer hover:bg-zinc-50">
            <Camera className="size-3.5" />
            Sacar / subir foto
            <input
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) onFoto(f)
              }}
            />
          </label>
        )}
      </div>
    </div>
  )
}

// ── Card de rollo (mobile) ──────────────────────────────────

function RolloCardMobile({
  rollo,
  index,
  articulos,
  colores,
  ubicacionOptions,
  fotoFalla,
  confianzas,
  isDuplicate,
  onUpdate,
  onChangeArticulo,
  onToggleSegunda,
  onFotoFalla,
  onRemove,
  tiposFalla = [],
}: {
  rollo: RolloInput
  index: number
  articulos: ArticuloCatalog[]
  colores: Catalog[]
  ubicacionOptions: ReturnType<typeof ubicacionesToOptions>
  fotoFalla: FotoPendiente | undefined
  confianzas:
    | {
        numero_pieza: number
        kilos: number
        metros: number
        rinde: number
        gramaje_planilla: number
        articulo: number
        color: number
      }
    | undefined
  isDuplicate: boolean
  onUpdate: <K extends keyof RolloInput>(field: K, value: RolloInput[K]) => void
  onChangeArticulo: (id: string | null) => void
  onToggleSegunda: (v: boolean) => void
  onFotoFalla: (file: File | null) => void
  onRemove: () => void
  tiposFalla?: { id: string; nombre: string }[]
}) {
  return (
    <div
      className={`p-3 space-y-2 ${isDuplicate ? 'bg-destructive/5' : ''} ${
        rollo.segunda ? 'bg-amber-50/40' : ''
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-muted-foreground">#{index + 1}</span>
        <button
          type="button"
          onClick={onRemove}
          className="text-muted-foreground hover:text-destructive text-xl leading-none px-2"
          aria-label="Eliminar fila"
        >
          ×
        </button>
      </div>

      <div className="space-y-1">
        <label className="text-xs font-semibold text-foreground">
          N° Pieza *
        </label>
        <input
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          value={rollo.numero_pieza}
          onChange={(e) => onUpdate('numero_pieza', e.target.value)}
          placeholder="204021911"
          className={`w-full rounded border px-3 py-2 text-base focus:outline-none focus:ring-1 focus:ring-ring ${
            isDuplicate
              ? 'border-destructive'
              : celdaCls(confianzas?.numero_pieza)
          }`}
        />
      </div>

      <div className="space-y-1">
        <label className="text-xs font-semibold text-foreground">
          Artículo *
        </label>
        <select
          value={rollo.articulo_id ?? ''}
          onChange={(e) => onChangeArticulo(e.target.value || null)}
          className={`w-full rounded border bg-background px-3 py-2 text-base focus:outline-none focus:ring-1 focus:ring-ring ${
            rollo.numero_pieza.trim() && !rollo.articulo_id
              ? 'border-destructive'
              : celdaCls(confianzas?.articulo)
          }`}
        >
          <option value="">Seleccionar...</option>
          {articulos.map((a) => (
            <option key={a.id} value={a.id}>
              {a.nombre}
            </option>
          ))}
        </select>
      </div>

      <div className="space-y-1">
        <label className="text-xs font-semibold text-foreground">
          Color *
        </label>
        <select
          value={rollo.color_id ?? ''}
          onChange={(e) => onUpdate('color_id', e.target.value || null)}
          className={`w-full rounded border bg-background px-3 py-2 text-base focus:outline-none focus:ring-1 focus:ring-ring ${
            rollo.numero_pieza.trim() && !rollo.color_id
              ? 'border-destructive'
              : celdaCls(confianzas?.color)
          }`}
        >
          <option value="">Seleccionar...</option>
          {colores.map((c) => (
            <option key={c.id} value={c.id}>
              {c.nombre}
            </option>
          ))}
        </select>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <label className="text-xs font-semibold text-foreground">
            Kilos <span className="text-destructive">*</span>
          </label>
          <input
            type="text"
            inputMode="decimal"
            value={rollo.kilos}
            onChange={(e) => onUpdate('kilos', e.target.value)}
            placeholder="20.5 o 20,5"
            className={`w-full rounded border px-3 py-2 text-base focus:outline-none focus:ring-1 focus:ring-ring ${
              rollo.numero_pieza.trim() &&
              (() => {
                const k = parseDecimalInput(rollo.kilos)
                return k == null || Number.isNaN(k) || k <= 0
              })()
                ? 'border-destructive'
                : celdaCls(confianzas?.kilos)
            }`}
          />
        </div>
        <div className="space-y-1">
          <label className="text-xs font-semibold text-foreground">Metros</label>
          <input
            type="number"
            step="0.01"
            min="0"
            inputMode="decimal"
            value={rollo.metros}
            onChange={(e) => onUpdate('metros', e.target.value)}
            placeholder="50"
            className={`w-full rounded border px-3 py-2 text-base focus:outline-none focus:ring-1 focus:ring-ring ${celdaCls(confianzas?.metros)}`}
          />
        </div>
        <div className="space-y-1">
          <label className="text-xs font-semibold text-foreground">Rinde</label>
          <input
            type="number"
            step="0.01"
            min="0"
            inputMode="decimal"
            value={rollo.rinde}
            onChange={(e) => onUpdate('rinde', e.target.value)}
            placeholder="2.4"
            className={`w-full rounded border px-3 py-2 text-base focus:outline-none focus:ring-1 focus:ring-ring ${celdaCls(confianzas?.rinde)}`}
          />
        </div>
        <div className="space-y-1">
          <label className="text-xs font-semibold text-foreground">Gramaje</label>
          <input
            type="number"
            step="0.01"
            min="0"
            inputMode="decimal"
            value={rollo.gramaje_planilla ?? ''}
            onChange={(e) => onUpdate('gramaje_planilla', e.target.value)}
            placeholder="142"
            className={`w-full rounded border px-3 py-2 text-base focus:outline-none focus:ring-1 focus:ring-ring ${celdaCls(confianzas?.gramaje_planilla)}`}
          />
        </div>
        <div className="space-y-1">
          <label className="text-xs font-semibold text-foreground">
            Ubicación *
          </label>
          <SearchableCombobox
            value={rollo.ubicacion}
            onChange={(value) => onUpdate('ubicacion', value)}
            options={ubicacionOptions}
            placeholder="Seleccionar..."
            searchPlaceholder="Buscar ubicacion..."
            emptyLabel="No hay ubicaciones"
            allowClear={false}
          />
        </div>
        <div className="space-y-1">
          <label className="inline-flex items-center gap-2 text-xs font-medium text-muted-foreground mt-1">
            <input
              type="checkbox"
              checked={!!rollo.segunda}
              onChange={(e) => onToggleSegunda(e.target.checked)}
              className="size-4 rounded border-input text-action focus:ring-1 focus:ring-ring"
            />
            Segunda calidad
          </label>
        </div>
      </div>

      {rollo.segunda && (
        <SegundaCalidadFields
          rollo={rollo}
          foto={fotoFalla}
          onUpdate={onUpdate}
          onFoto={onFotoFalla}
          tiposFalla={tiposFalla}
        />
      )}
    </div>
  )
}

// ── Vista de edición post-escaneo ──────────────────────────

function EditingRolloView({
  rollo,
  scannerTipo,
  articulos,
  colores,
  ubicacionOptions,
  fotoFalla,
  confianzas,
  onUpdate,
  onChangeArticulo,
  onToggleSegunda,
  onFotoFalla,
  onSiguienteRollo,
  onVerTodos,
  rolloNumber,
  totalRollos,
  tiposFalla = [],
}: {
  rollo: RolloInput
  scannerTipo: 'qr' | 'barcode' | null
  articulos: ArticuloCatalog[]
  colores: Catalog[]
  ubicacionOptions: ReturnType<typeof ubicacionesToOptions>
  fotoFalla: FotoPendiente | undefined
  confianzas:
    | {
        numero_pieza: number
        kilos: number
        metros: number
        rinde: number
        gramaje_planilla: number
        articulo: number
        color: number
      }
    | undefined
  onUpdate: <K extends keyof RolloInput>(field: K, value: RolloInput[K]) => void
  onChangeArticulo: (id: string | null) => void
  onToggleSegunda: (v: boolean) => void
  onFotoFalla: (file: File | null) => void
  onSiguienteRollo: () => void
  onVerTodos: () => void
  tiposFalla?: { id: string; nombre: string }[]
  rolloNumber: number
  totalRollos: number
}) {
  const faltaArticulo = !rollo.articulo_id
  const faltaColor = !rollo.color_id
  const kilosInvalidos = (() => {
    const k = parseDecimalInput(rollo.kilos)
    return k == null || Number.isNaN(k) || k <= 0
  })()
  const faltaUbicacion = !rollo.ubicacion.trim()

  return (
    <div className="space-y-4">
      {/* Header: tipo de scanner + contador */}
      <div className="rounded-lg border bg-white p-3 shadow-sm flex items-center justify-between gap-3">
        <span className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium bg-primary/10 text-primary border-primary/20">
          {scannerTipo === 'qr' ? (
            <><QrCode className="size-3" /> Código QR</>
          ) : (
            <><Barcode className="size-3" /> Código de barras</>
          )}
        </span>
        <span className="text-sm text-muted-foreground">
          Rollo {rolloNumber} de {totalRollos}
        </span>
      </div>

      {/* Datos del rollo */}
      <div className="rounded-lg border bg-white shadow-sm overflow-hidden">
        <div className="px-4 py-3 border-b bg-zinc-50">
          <h2 className="font-semibold text-sm">Datos del rollo escaneado</h2>
        </div>
        <div className="p-4 space-y-3">
          <div className="space-y-1">
            <label className="text-xs font-semibold text-foreground">N° Pieza</label>
            <input
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              value={rollo.numero_pieza}
              onChange={(e) => onUpdate('numero_pieza', e.target.value)}
              placeholder="204021911"
              className={`w-full rounded border px-3 py-2 text-base focus:outline-none focus:ring-1 focus:ring-ring ${celdaCls(confianzas?.numero_pieza)}`}
            />
          </div>

          <div className="space-y-1">
            <label className="text-xs font-semibold text-foreground">Artículo *</label>
            <select
              value={rollo.articulo_id ?? ''}
              onChange={(e) => onChangeArticulo(e.target.value || null)}
              className={`w-full rounded border bg-background px-3 py-2 text-base focus:outline-none focus:ring-1 focus:ring-ring ${
                faltaArticulo ? 'border-destructive' : celdaCls(confianzas?.articulo)
              }`}
            >
              <option value="">Seleccionar...</option>
              {articulos.map((a) => (
                <option key={a.id} value={a.id}>{a.nombre}</option>
              ))}
            </select>
          </div>

          <div className="space-y-1">
            <label className="text-xs font-semibold text-foreground">Color *</label>
            <select
              value={rollo.color_id ?? ''}
              onChange={(e) => onUpdate('color_id', e.target.value || null)}
              className={`w-full rounded border bg-background px-3 py-2 text-base focus:outline-none focus:ring-1 focus:ring-ring ${
                faltaColor ? 'border-destructive' : celdaCls(confianzas?.color)
              }`}
            >
              <option value="">Seleccionar...</option>
              {colores.map((c) => (
                <option key={c.id} value={c.id}>{c.nombre}</option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-xs font-semibold text-foreground">Kilos *</label>
              <input
                type="text"
                inputMode="decimal"
                value={rollo.kilos}
                onChange={(e) => onUpdate('kilos', e.target.value)}
                placeholder="20.5 o 20,5"
                className={`w-full rounded border px-3 py-2 text-base focus:outline-none focus:ring-1 focus:ring-ring ${
                  kilosInvalidos ? 'border-destructive' : celdaCls(confianzas?.kilos)
                }`}
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-semibold text-foreground">Metros</label>
              <input
                type="number"
                step="0.01"
                min="0"
                inputMode="decimal"
                value={rollo.metros}
                onChange={(e) => onUpdate('metros', e.target.value)}
                placeholder="50"
                className={`w-full rounded border px-3 py-2 text-base focus:outline-none focus:ring-1 focus:ring-ring ${celdaCls(confianzas?.metros)}`}
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-semibold text-foreground">Rinde</label>
              <input
                type="number"
                step="0.01"
                min="0"
                inputMode="decimal"
                value={rollo.rinde}
                onChange={(e) => onUpdate('rinde', e.target.value)}
                placeholder="2.4"
                className={`w-full rounded border px-3 py-2 text-base focus:outline-none focus:ring-1 focus:ring-ring ${celdaCls(confianzas?.rinde)}`}
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-semibold text-foreground">Gramaje</label>
              <input
                type="number"
                step="0.01"
                min="0"
                inputMode="decimal"
                value={rollo.gramaje_planilla ?? ''}
                onChange={(e) => onUpdate('gramaje_planilla', e.target.value)}
                placeholder="142"
                className={`w-full rounded border px-3 py-2 text-base focus:outline-none focus:ring-1 focus:ring-ring ${celdaCls(confianzas?.gramaje_planilla)}`}
              />
            </div>
          </div>

          <div className="space-y-1">
            <label className="text-xs font-semibold text-foreground">Ubicación *</label>
            <SearchableCombobox
              value={rollo.ubicacion}
              onChange={(value) => onUpdate('ubicacion', value)}
              options={ubicacionOptions}
              placeholder="Seleccionar..."
              searchPlaceholder="Buscar ubicacion..."
              emptyLabel="No hay ubicaciones"
              allowClear={false}
            />
          </div>

          <div>
            <label className="inline-flex items-center gap-2 text-xs font-medium text-muted-foreground">
              <input
                type="checkbox"
                checked={!!rollo.segunda}
                onChange={(e) => onToggleSegunda(e.target.checked)}
                className="size-4 rounded border-input text-action focus:ring-1 focus:ring-ring"
              />
              Segunda calidad
            </label>
          </div>

          {rollo.segunda && (
            <SegundaCalidadFields
              rollo={rollo}
              foto={fotoFalla}
              onUpdate={onUpdate}
              onFoto={onFotoFalla}
              tiposFalla={tiposFalla}
            />
          )}
        </div>
      </div>

      {/* Alertas inline (informativas, no bloquean) */}
      {(faltaArticulo || faltaColor || kilosInvalidos || faltaUbicacion) && (
        <div className="rounded-lg border border-warning/30 bg-warning/10 p-3 space-y-1 text-sm">
          {faltaArticulo && <p>⚠ Falta asignar artículo.</p>}
          {faltaColor && <p>⚠ Falta asignar color.</p>}
          {kilosInvalidos && <p>⚠ Kilos inválidos o vacíos.</p>}
          {faltaUbicacion && <p>⚠ Falta asignar ubicación.</p>}
          <p className="text-xs text-muted-foreground">
            Podés completarlo ahora o desde &quot;Ver todos los rollos&quot;.
          </p>
        </div>
      )}

      {/* Acciones */}
      <div className="flex flex-col gap-3">
        <button
          type="button"
          onClick={onSiguienteRollo}
          className="w-full rounded-md bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground hover:bg-primary/90 transition-colors"
        >
          Cargar siguiente rollo →
        </button>
        <button
          type="button"
          onClick={onVerTodos}
          className="w-full rounded-md border bg-white px-5 py-3 text-sm font-medium hover:bg-zinc-50 transition-colors"
        >
          Ver todos los rollos
        </button>
      </div>
    </div>
  )
}

// ── Botón "Solicitar color al admin" / "Crear color" ────────

function SolicitarColorButton({
  role,
  onCreated,
}: {
  role: Role
  onCreated: (c: Catalog) => void
}) {
  const [open, setOpen] = useState(false)
  const [value, setValue] = useState('')
  const [pending, startTransition] = useTransition()

  function submit() {
    const limpio = value.trim()
    if (!limpio) return
    startTransition(async () => {
      // El admin puede crear el color directo (tiene permiso). Operario y
      // ventas mandan una solicitud que el admin aprueba desde /admin/colores.
      if (role === 'admin') {
        const res = await createColor({ nombre: limpio })
        if ('error' in res && res.error) {
          toast.error(res.error)
          return
        }
        if ('color' in res && res.color) onCreated(res.color as Catalog)
        toast.success(
          'alreadyExists' in res && res.alreadyExists
            ? `"${limpio}" ya existía en el catálogo.`
            : `Color "${limpio}" creado.`
        )
        setValue('')
        setOpen(false)
        return
      }

      const res = await solicitarColor({ nombre: limpio })
      if ('error' in res) {
        toast.error(res.error ?? 'No se pudo enviar la solicitud.')
        return
      }
      if ('alreadyExists' in res && res.alreadyExists) {
        toast.success(`"${limpio}" ya existe en el catálogo.`)
        onCreated(res.color as Catalog)
      } else if ('alreadyPending' in res) {
        toast.info(`Ya hay una solicitud pendiente para "${limpio}".`)
      } else {
        toast.success(
          `Solicitud enviada al admin. Te avisamos cuando aprueben "${limpio}".`
        )
      }
      setValue('')
      setOpen(false)
    })
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-xs text-primary hover:underline"
      >
        {role === 'admin' || role === 'super'
          ? '+ Crear color nuevo'
          : '+ Solicitar color al admin'}
      </button>
    )
  }

  return (
    <div className="space-y-2 rounded-md border border-input bg-zinc-50/40 p-2">
      <input
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Nombre del color"
        autoFocus
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            submit()
          }
          if (e.key === 'Escape') {
            setOpen(false)
            setValue('')
          }
        }}
        className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      />
      <div className="flex gap-2">
        <button
          type="button"
          onClick={submit}
          disabled={pending || !value.trim()}
          className="flex-1 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          {pending ? '...' : 'Enviar'}
        </button>
        <button
          type="button"
          onClick={() => {
            setOpen(false)
            setValue('')
          }}
          className="flex-1 rounded-md border bg-white px-3 py-1.5 text-xs hover:bg-zinc-50"
        >
          <X className="inline size-3" /> Cancelar
        </button>
      </div>
    </div>
  )
}

// ── Auxiliares ──────────────────────────────────────────────

function UploadArea({
  onFile,
  fileInputRef,
}: {
  onFile: (file: File) => void
  fileInputRef: React.RefObject<HTMLInputElement | null>
}) {
  const [dragOver, setDragOver] = useState(false)

  return (
    <label
      onDragOver={(e) => {
        e.preventDefault()
        setDragOver(true)
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault()
        setDragOver(false)
        const file = e.dataTransfer.files?.[0]
        if (file) onFile(file)
      }}
      className={`flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed p-6 sm:p-8 cursor-pointer transition-colors ${
        dragOver
          ? 'border-primary bg-primary/5'
          : 'border-input hover:bg-zinc-50'
      }`}
    >
      <p className="text-sm font-medium text-center">
        Arrastrá la planilla acá o tocá para elegir
      </p>
      <p className="text-xs text-muted-foreground text-center">
        JPG, PNG, WebP, HEIC o PDF
      </p>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/jpeg,image/jpg,image/png,image/webp,image/heic,image/heif,application/pdf"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) onFile(file)
        }}
      />
    </label>
  )
}

function Spinner() {
  return (
    <svg
      className="h-5 w-5 animate-spin text-primary"
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
    >
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="4"
      ></circle>
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
      ></path>
    </svg>
  )
}
