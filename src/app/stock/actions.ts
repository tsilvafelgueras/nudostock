'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import {
  subirPlanilla,
  getSignedUrl,
  MIME_TYPES_ACEPTADOS,
} from '@/lib/storage/planillas'
import {
  ESTADOS_EDITABLES,
  type EstadoEditable,
} from './constants'
import { validarUbicacionActiva } from '@/lib/ubicacionesServer'

export type StockActionResult = { ok: true } | { ok: false; error: string }

export async function moverUbicacion(
  rolloId: string,
  ubicacion: string
): Promise<StockActionResult> {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'Tu sesión expiró. Volvé a entrar.' }

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()

  if (profile?.role !== 'operario' && profile?.role !== 'admin') {
    return {
      ok: false,
      error: 'Solo el operario o el administrador pueden mover ubicación.',
    }
  }

  const ubic = ubicacion.trim()
  if (!ubic) return { ok: false, error: 'La ubicación no puede estar vacía.' }
  if (ubic.length > 50) {
    return { ok: false, error: 'La ubicación es demasiado larga (máx. 50).' }
  }
  const ubicacionValida = await validarUbicacionActiva(supabase, ubic)
  if (!ubicacionValida.ok) return ubicacionValida

  // RLS filtra por empresa, así que si no aparece es porque no es de esta empresa
  const { data: rollo, error: fetchError } = await supabase
    .from('rollos')
    .select('id, estado')
    .eq('id', rolloId)
    .single()

  if (fetchError || !rollo) {
    return { ok: false, error: 'No se encontró el rollo.' }
  }
  if (rollo.estado === 'baja' || rollo.estado === 'entregado') {
    return {
      ok: false,
      error:
        'No se puede mover un rollo dado de baja o ya entregado al cliente.',
    }
  }

  const { error } = await supabase
    .from('rollos')
    .update({ ubicacion: ubicacionValida.codigo })
    .eq('id', rolloId)

  if (error) return { ok: false, error: error.message }

  revalidatePath('/stock')
  return { ok: true }
}

export async function darDeBajaRollo(
  rolloId: string
): Promise<StockActionResult> {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'Tu sesión expiró. Volvé a entrar.' }

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()

  if (profile?.role !== 'admin' && profile?.role !== 'operario') {
    return {
      ok: false,
      error: 'No tenés permiso para dar de baja rollos.',
    }
  }

  const { data: rollo, error: fetchError } = await supabase
    .from('rollos')
    .select('id, estado')
    .eq('id', rolloId)
    .single()

  if (fetchError || !rollo) {
    return { ok: false, error: 'No se encontró el rollo.' }
  }
  if (rollo.estado === 'baja') {
    return { ok: false, error: 'El rollo ya está dado de baja.' }
  }
  if (rollo.estado === 'reservado' || rollo.estado === 'entregado') {
    return {
      ok: false,
      error:
        'No se puede dar de baja un rollo reservado o entregado. Liberalo primero.',
    }
  }

  const { error } = await supabase
    .from('rollos')
    .update({ estado: 'baja' })
    .eq('id', rolloId)

  if (error) return { ok: false, error: error.message }

  revalidatePath('/stock')
  return { ok: true }
}

export async function confirmarRolloManual(
  rolloId: string,
  ubicacion: string
): Promise<StockActionResult> {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'Tu sesión expiró. Volvé a entrar.' }

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()

  if (profile?.role !== 'operario' && profile?.role !== 'admin') {
    return {
      ok: false,
      error: 'Solo el operario o el administrador pueden confirmar rollos.',
    }
  }

  const ubic = ubicacion.trim()
  if (!ubic) return { ok: false, error: 'La ubicación es obligatoria para confirmar.' }
  if (ubic.length > 50) {
    return { ok: false, error: 'La ubicación es demasiado larga (máx. 50).' }
  }
  const ubicacionValida = await validarUbicacionActiva(supabase, ubic)
  if (!ubicacionValida.ok) return ubicacionValida

  const { data: rollo, error: fetchError } = await supabase
    .from('rollos')
    .select('id, estado, ingreso_id')
    .eq('id', rolloId)
    .single()

  if (fetchError || !rollo) {
    return { ok: false, error: 'No se encontró el rollo.' }
  }
  if (rollo.estado !== 'pendiente') {
    return {
      ok: false,
      error: 'Solo se puede confirmar manualmente un rollo en estado pendiente.',
    }
  }

  const nowIso = new Date().toISOString()
  const { error } = await supabase
    .from('rollos')
    .update({
      estado: 'en_stock',
      ubicacion: ubicacionValida.codigo,
      auditado_at: nowIso,
      auditado_por: user.id,
    })
    .eq('id', rolloId)

  if (error) return { ok: false, error: error.message }

  // Si todos los rollos del ingreso quedan en_stock, cerrar el ingreso.
  // Espeja la lógica de confirmar/[id]/actions.ts pero sin abortar si falla.
  const { data: hermanos } = await supabase
    .from('rollos')
    .select('estado')
    .eq('ingreso_id', rollo.ingreso_id)

  if (hermanos && hermanos.every((r) => r.estado === 'en_stock')) {
    await supabase
      .from('ingresos')
      .update({ estado: 'confirmado' })
      .eq('id', rollo.ingreso_id)
  }

  revalidatePath('/stock')
  revalidatePath(`/ingresos/${rollo.ingreso_id}`)
  return { ok: true }
}

export type EditarRolloInput = {
  numero_pieza?: string
  articulo_id?: string
  color_id?: string
  ubicacion?: string | null
  pantone?: string | null
  kilos?: number | null
  metros?: number | null
  kilos_propios?: number | null
  metros_propios?: number | null
  ancho_propio?: number | null
  gramaje_propio?: number | null
  gramaje_planilla?: number | null
  estado?: EstadoEditable
}

function cleanText(v: string | null | undefined): string | null {
  if (v == null) return null
  const t = v.trim()
  return t === '' ? null : t
}

function cleanNumber(v: number | null | undefined): number | null {
  if (v == null) return null
  if (typeof v !== 'number' || Number.isNaN(v)) return null
  return v
}

export async function editarRollo(
  rolloId: string,
  cambios: EditarRolloInput
): Promise<StockActionResult> {
  try {
    const supabase = await createClient()

    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return { ok: false, error: 'Tu sesión expiró. Volvé a entrar.' }

    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single()

    if (profile?.role !== 'operario' && profile?.role !== 'admin') {
      return {
        ok: false,
        error: 'Solo el operario o el administrador pueden editar rollos.',
      }
    }

    const { data: rollo, error: fetchError } = await supabase
      .from('rollos')
      .select('id, estado')
      .eq('id', rolloId)
      .single()

    if (fetchError || !rollo) {
      return { ok: false, error: 'No se encontró el rollo.' }
    }
    if (rollo.estado === 'baja' || rollo.estado === 'entregado') {
      return {
        ok: false,
        error: 'No se puede editar un rollo dado de baja o ya entregado.',
      }
    }
    if (rollo.estado === 'reservado') {
      return {
        ok: false,
        error:
          'No se puede editar un rollo reservado. Primero liberalo del pedido.',
      }
    }

    if (cambios.numero_pieza !== undefined) {
      const np = cambios.numero_pieza.trim()
      if (!np) return { ok: false, error: 'El número de pieza no puede estar vacío.' }
      if (np.length > 50) {
        return { ok: false, error: 'El número de pieza es demasiado largo (máx. 50).' }
      }
    }

    if (cambios.estado !== undefined) {
      if (!ESTADOS_EDITABLES.includes(cambios.estado)) {
        return {
          ok: false,
          error: `Estado inválido: "${cambios.estado}".`,
        }
      }
    }

    // Artículo y color se cambian juntos: la FK compuesta de rollos exige que
    // el par (articulo_id, color_id) exista en articulo_colores.
    if (cambios.articulo_id !== undefined || cambios.color_id !== undefined) {
      if (!cambios.articulo_id?.trim() || !cambios.color_id?.trim()) {
        return {
          ok: false,
          error: 'Para cambiar el artículo o el color, elegí ambos.',
        }
      }
    }

    if (cambios.kilos !== undefined) {
      if (cambios.kilos == null || !Number.isFinite(cambios.kilos) || cambios.kilos <= 0) {
        return {
          ok: false,
          error: 'Los kilos son obligatorios y deben ser mayores a cero.',
        }
      }
    }

    const update: Record<string, unknown> = {}
    if (cambios.numero_pieza !== undefined) {
      update.numero_pieza = cambios.numero_pieza.trim()
    }
    if (cambios.articulo_id !== undefined && cambios.color_id !== undefined) {
      update.articulo_id = cambios.articulo_id.trim()
      update.color_id = cambios.color_id.trim()
    }
    if (cambios.ubicacion !== undefined) {
      const ubic = cleanText(cambios.ubicacion)
      if (ubic) {
        const ubicacionValida = await validarUbicacionActiva(supabase, ubic)
        if (!ubicacionValida.ok) return ubicacionValida
        update.ubicacion = ubicacionValida.codigo
      } else {
        update.ubicacion = null
      }
    }
    if (cambios.pantone !== undefined) update.pantone = cleanText(cambios.pantone)
    if (cambios.kilos !== undefined) update.kilos = cleanNumber(cambios.kilos)
    if (cambios.metros !== undefined) update.metros = cleanNumber(cambios.metros)
    if (cambios.kilos_propios !== undefined) update.kilos_propios = cleanNumber(cambios.kilos_propios)
    if (cambios.metros_propios !== undefined) update.metros_propios = cleanNumber(cambios.metros_propios)
    if (cambios.ancho_propio !== undefined) update.ancho_propio = cleanNumber(cambios.ancho_propio)
    if (cambios.gramaje_propio !== undefined) update.gramaje_propio = cleanNumber(cambios.gramaje_propio)
    if (cambios.gramaje_planilla !== undefined) update.gramaje_planilla = cleanNumber(cambios.gramaje_planilla)
    if (cambios.estado !== undefined && cambios.estado !== rollo.estado) {
      update.estado = cambios.estado
      // Si sale de segunda hacia otro estado, limpio el detalle de la falla
      // para que no quede inconsistente. Las fotos quedan asociadas igual
      // (por si se vuelve a marcar como segunda más adelante).
      if (rollo.estado === 'segunda' && cambios.estado !== 'segunda') {
        update.falla_categoria = null
        update.falla_descripcion = null
      }
    }

    if (Object.keys(update).length === 0) {
      return { ok: true }
    }

    const { error } = await supabase
      .from('rollos')
      .update(update)
      .eq('id', rolloId)

    if (error) {
      if (error.code === '23505') {
        return {
          ok: false,
          error: 'Ya existe un rollo con ese número de pieza en este ingreso.',
        }
      }
      if (error.code === '23503') {
        return {
          ok: false,
          error:
            'La combinación artículo-color no está asociada. Pedile al admin que la configure.',
        }
      }
      return { ok: false, error: error.message }
    }

    revalidatePath('/stock')
    return { ok: true }
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : 'Error inesperado al editar el rollo.',
    }
  }
}

export async function eliminarRollo(
  rolloId: string
): Promise<StockActionResult> {
  try {
    const supabase = await createClient()

    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return { ok: false, error: 'Tu sesión expiró. Volvé a entrar.' }

    const { data: profile } = await supabase
      .from('profiles')
      .select('role, nombre, empresa_id')
      .eq('id', user.id)
      .single()

    if (profile?.role !== 'operario' && profile?.role !== 'admin') {
      return {
        ok: false,
        error: 'No tenés permiso para eliminar rollos.',
      }
    }

    const { data: rollo, error: fetchError } = await supabase
      .from('rollos')
      .select(`
        id, estado, numero_pieza,
        articulos ( nombre ),
        colores ( nombre )
      `)
      .eq('id', rolloId)
      .single()

    if (fetchError || !rollo) {
      return { ok: false, error: 'No se encontró el rollo.' }
    }
    if (rollo.estado === 'reservado' || rollo.estado === 'entregado') {
      return {
        ok: false,
        error:
          'No se puede eliminar un rollo reservado o entregado. Liberalo del pedido primero.',
      }
    }

    const { error } = await supabase.from('rollos').delete().eq('id', rolloId)

    if (error) {
      // FK RESTRICT desde pedido_rollos o muestras: el rollo tiene historial
      // que no se puede borrar en cascada.
      if (error.code === '23503') {
        return {
          ok: false,
          error:
            'No se puede eliminar: el rollo está vinculado a un pedido o muestra. Liberalo primero.',
        }
      }
      return { ok: false, error: error.message }
    }

    // Notificar al admin que un rollo fue eliminado del inventario.
    if (profile.empresa_id) {
      const articulo = (rollo.articulos as unknown as { nombre: string } | null)?.nombre ?? null
      const color = (rollo.colores as unknown as { nombre: string } | null)?.nombre ?? null
      await supabase.rpc('notificar_rollo_eliminado', {
        p_empresa_id:     profile.empresa_id,
        p_numero_pieza:   rollo.numero_pieza as string,
        p_articulo:       articulo,
        p_color:          color,
        p_usuario_nombre: profile.nombre ?? null,
      })
    }

    revalidatePath('/stock')
    return { ok: true }
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : 'Error inesperado al eliminar el rollo.',
    }
  }
}

export async function devolverRolloAStock(
  rolloId: string,
  motivo: string
): Promise<StockActionResult & { pedidoId?: string; numeroPieza?: string }> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('devolver_rollo_por_rollo_id', {
    p_rollo_id: rolloId,
    p_motivo:   motivo.trim() || null,
  })
  if (error) return { ok: false, error: error.message }

  const json = data as { devuelto: boolean; pedido_id: string; numero_pieza: string } | null
  revalidatePath('/stock')
  revalidatePath('/pedidos')
  if (json?.pedido_id) revalidatePath(`/pedidos/${json.pedido_id}`)
  return { ok: true, pedidoId: json?.pedido_id, numeroPieza: json?.numero_pieza }
}

export type MarcarSegundaParams = {
  categoria: string
  descripcion?: string
  fotoPaths?: string[]
}

export async function marcarComoSegunda(
  rolloId: string,
  params: MarcarSegundaParams
): Promise<StockActionResult> {
  try {
    const supabase = await createClient()

    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return { ok: false, error: 'Tu sesión expiró. Volvé a entrar.' }

    const { data: profile } = await supabase
      .from('profiles')
      .select('role, empresa_id')
      .eq('id', user.id)
      .single()

    if (profile?.role !== 'operario' && profile?.role !== 'admin') {
      return {
        ok: false,
        error: 'Solo el operario o el administrador pueden marcar rollos.',
      }
    }

    if (!params?.categoria?.trim()) {
      return {
        ok: false,
        error: 'Elegí una categoría de falla para marcar como segunda.',
      }
    }

    const descripcion = params.descripcion?.trim() || null
    const fotoPaths = (params.fotoPaths ?? []).filter(
      (p) => p && p.trim() !== ''
    )

    const { data: rollo, error: fetchError } = await supabase
      .from('rollos')
      .select('id, estado')
      .eq('id', rolloId)
      .single()

    if (fetchError || !rollo) {
      return { ok: false, error: 'No se encontró el rollo.' }
    }
    if (!['pendiente', 'en_stock'].includes(rollo.estado)) {
      return {
        ok: false,
        error:
          'Solo se puede marcar como segunda un rollo pendiente o en stock.',
      }
    }

    const { error } = await supabase
      .from('rollos')
      .update({
        estado: 'segunda',
        falla_categoria: params.categoria,
        falla_descripcion: descripcion,
      })
      .eq('id', rolloId)

    if (error) return { ok: false, error: friendlyMarcarSegundaError(error) }

    if (fotoPaths.length > 0) {
      const rows = fotoPaths.map((path) => ({
        rollo_id: rolloId,
        path,
        tipo: 'falla' as const,
        created_by: user.id,
      }))
      const { error: insertError } = await supabase
        .from('rollo_fotos')
        .insert(rows)
      if (insertError) {
        // Intencionalmente no revertimos el cambio de estado: el rollo ya está
        // como segunda con categoría. Las fotos pueden volver a subirse después.
        return {
          ok: false,
          error: `Rollo marcado como segunda, pero falló el guardado de fotos: ${insertError.message}`,
        }
      }
    }

    revalidatePath('/stock')
    return { ok: true }
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : 'Error inesperado al marcar como segunda.',
    }
  }
}

// Traduce errores típicos de PostgREST a algo accionable. El más probable hoy
// es que la migración 029 no se haya aplicado y las columnas/tabla nuevas
// no existan todavía.
function friendlyMarcarSegundaError(error: { message: string; code?: string }) {
  const msg = error.message ?? ''
  const code = error.code ?? ''
  if (
    code === '42703' ||
    /column .*(falla_categoria|falla_descripcion).* does not exist/i.test(msg)
  ) {
    return 'Faltan columnas en la base de datos. Aplicá la migración 029_segunda_calidad_detalle.sql.'
  }
  if (
    code === '42P01' ||
    /relation .*rollo_fotos.* does not exist/i.test(msg)
  ) {
    return 'Falta la tabla rollo_fotos. Aplicá la migración 029_segunda_calidad_detalle.sql.'
  }
  if (code === '23514' || /violates check constraint/i.test(msg)) {
    return 'La categoría de falla no es válida. Volvé a elegir una opción del menú.'
  }
  return msg || 'Error desconocido al marcar como segunda.'
}

export async function subirFotoRollo(
  formData: FormData
): Promise<{ ok: true; path: string } | { ok: false; error: string }> {
  try {
    const supabase = await createClient()

    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return { ok: false, error: 'Tu sesión expiró. Volvé a entrar.' }

    const { data: profile } = await supabase
      .from('profiles')
      .select('role, empresa_id')
      .eq('id', user.id)
      .single()

    if (
      !profile?.empresa_id ||
      (profile.role !== 'operario' && profile.role !== 'admin')
    ) {
      return {
        ok: false,
        error: 'Solo operario o admin pueden subir fotos de rollos.',
      }
    }

    const file = formData.get('archivo')
    const rolloId = formData.get('rollo_id')

    if (!(file instanceof File)) {
      return { ok: false, error: 'Falta el archivo de la foto.' }
    }
    if (typeof rolloId !== 'string' || !rolloId) {
      return { ok: false, error: 'Falta el id del rollo.' }
    }
    if (!MIME_TYPES_ACEPTADOS.split(',').includes(file.type)) {
      return {
        ok: false,
        error: 'Formato no soportado. Aceptamos JPG, PNG, WebP o HEIC.',
      }
    }
    // Límite suave: 10 MB por foto
    if (file.size > 10 * 1024 * 1024) {
      return {
        ok: false,
        error: 'La foto pesa más de 10 MB. Comprimila e intentá de nuevo.',
      }
    }

    // RLS filtra por empresa: si el rollo no aparece es porque no pertenece a
    // esta empresa.
    const { data: rollo, error: rolloError } = await supabase
      .from('rollos')
      .select('id')
      .eq('id', rolloId)
      .single()
    if (rolloError || !rollo) {
      return { ok: false, error: 'No se encontró el rollo.' }
    }

    const buffer = Buffer.from(await file.arrayBuffer())
    const upload = await subirPlanilla(buffer, file.type, profile.empresa_id)
    if (!upload.ok) return { ok: false, error: upload.error }

    return { ok: true, path: upload.path }
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : 'Error inesperado subiendo la foto.',
    }
  }
}

export type RolloFotoConUrl = {
  id: string
  path: string
  descripcion: string | null
  tipo: 'falla' | 'general'
  created_at: string
  signedUrl: string | null
}

export async function listarFotosRollo(
  rolloId: string
): Promise<
  { ok: true; fotos: RolloFotoConUrl[] } | { ok: false; error: string }
> {
  try {
    const supabase = await createClient()

    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return { ok: false, error: 'Tu sesión expiró. Volvé a entrar.' }

    const { data: fotos, error } = await supabase
      .from('rollo_fotos')
      .select('id, path, descripcion, tipo, created_at')
      .eq('rollo_id', rolloId)
      .order('created_at', { ascending: true })

    if (error) {
      // Si la tabla no existe (migración 029 sin aplicar), devolvemos lista
      // vacía para no romper la UI del dialog. El usuario ve el rollo sin
      // fotos en lugar de un error fatal.
      if (
        error.code === '42P01' ||
        /relation .*rollo_fotos.* does not exist/i.test(error.message ?? '')
      ) {
        return { ok: true, fotos: [] }
      }
      return { ok: false, error: error.message }
    }

    const conUrl: RolloFotoConUrl[] = await Promise.all(
      (fotos ?? []).map(async (f) => {
        const res = await getSignedUrl(f.path)
        return {
          id: f.id,
          path: f.path,
          descripcion: f.descripcion,
          tipo: f.tipo as 'falla' | 'general',
          created_at: f.created_at,
          signedUrl: res.ok ? res.url : null,
        }
      })
    )

    return { ok: true, fotos: conUrl }
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : 'Error inesperado al listar fotos.',
    }
  }
}

export async function reactivarRollo(
  rolloId: string
): Promise<StockActionResult> {
  try {
    const supabase = await createClient()

    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return { ok: false, error: 'Tu sesión expiró. Volvé a entrar.' }

    const { data: profile } = await supabase
      .from('profiles')
      .select('role, empresa_id')
      .eq('id', user.id)
      .single()

    if (profile?.role !== 'admin' && profile?.role !== 'operario') {
      return { ok: false, error: 'No tenés permiso para corregir el estado de rollos.' }
    }

    const { data: rollo, error: fetchError } = await supabase
      .from('rollos')
      .select('id, estado, empresa_id')
      .eq('id', rolloId)
      .eq('empresa_id', profile.empresa_id)
      .single()

    if (fetchError || !rollo) {
      return { ok: false, error: 'No se encontró el rollo.' }
    }

    if (rollo.estado !== 'entregado' && rollo.estado !== 'baja') {
      return {
        ok: false,
        error: 'Solo se puede reactivar un rollo entregado o dado de baja.',
      }
    }

    const { error: updateError } = await supabase
      .from('rollos')
      .update({ estado: 'en_stock', ubicacion: 'Sin ubicar' })
      .eq('id', rolloId)

    if (updateError) return { ok: false, error: updateError.message }

    revalidatePath('/stock')
    return { ok: true }
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : 'Error inesperado al reactivar el rollo.',
    }
  }
}
