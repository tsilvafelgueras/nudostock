'use server'

import { createClient } from '@/lib/supabase/server'

export type RolloEntregadoInfo = {
  id: string
  numero_pieza: string
  kilos: number | null
  metros: number | null
  articulo: string
  color: string
  ingreso_id: string
  numero_lote: string | null
  tintoreria: string
  pedido_numero: string | null
}

export type PartidaConEntregadosRow = {
  ingreso_id: string
  ot: string | null
  numero_remito: string | null
  fecha_despacho: string | null
  tintoreria_nombre: string
  articulo_nombre: string
  numero_lote: string | null
  rollos_entregados: number
}

export type DevolucionItem = {
  rolloId: string
  segunda: boolean
  fallaTipo?: string
}

export type DevolucionResult =
  | { ok: true; devueltos: number; errores: { rollo_id: string; error: string }[] }
  | { ok: false; error: string }

export type BuscarPartidasResult =
  | { ok: true; rows: PartidaConEntregadosRow[] }
  | { ok: false; error: string }

export type BuscarRollosResult =
  | { ok: true; rollos: RolloEntregadoInfo[] }
  | { ok: false; error: string }

type RolloEntregadoRpcRow = {
  rollo_id: string
  numero_pieza: string
  kilos: number | null
  metros: number | null
  articulo: string | null
  color: string | null
  ingreso_id: string
  numero_lote: string | null
  tintoreria: string | null
  pedido_numero: string | null
}

function mapRolloEntregado(row: RolloEntregadoRpcRow): RolloEntregadoInfo {
  return {
    id: row.rollo_id,
    numero_pieza: row.numero_pieza,
    kilos: row.kilos,
    metros: row.metros,
    articulo: row.articulo ?? '-',
    color: row.color ?? '-',
    ingreso_id: row.ingreso_id,
    numero_lote: row.numero_lote,
    tintoreria: row.tintoreria ?? '-',
    pedido_numero: row.pedido_numero,
  }
}

export async function getRolloEntregado(
  codigos: string[]
): Promise<{ ok: true; rollo: RolloEntregadoInfo } | { ok: false; error: string }> {
  const candidatos = Array.from(
    new Set(codigos.map((codigo) => codigo.trim()).filter(Boolean))
  ).slice(0, 20)

  if (candidatos.length === 0) {
    return { ok: false, error: 'No se recibió un código de rollo válido.' }
  }

  const supabase = await createClient()
  const { data, error } = await supabase.rpc(
    'buscar_rollo_entregado_por_codigos',
    { p_codigos: candidatos }
  )

  if (error) {
    console.error('[getRolloEntregado] RPC error:', error)
    return {
      ok: false,
      error: `Error al buscar el rollo: ${error.message}${error.code ? ` (${error.code})` : ''}`,
    }
  }

  const rows = (data ?? []) as RolloEntregadoRpcRow[]
  if (rows.length === 0) {
    return {
      ok: false,
      error:
        'No se encontró un rollo egresado y pendiente de devolución con ese número. Revisá el código o verificá que no haya sido devuelto antes.',
    }
  }

  if (rows.length > 1) {
    return {
      ok: false,
      error:
        'El código coincide con más de un rollo egresado. Ingresá el número de pieza completo, incluyendo los ceros iniciales.',
    }
  }

  return { ok: true, rollo: mapRolloEntregado(rows[0]) }
}

export async function buscarPartidasConEntregados(
  query: string
): Promise<BuscarPartidasResult> {
  const busqueda = query.trim()
  if (!busqueda) return { ok: false, error: 'Ingresá una OT, partida o pedido.' }

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('buscar_partidas_con_entregados', {
    p_query: busqueda,
  })

  if (error) {
    console.error('[buscarPartidasConEntregados] RPC error:', error)
    return {
      ok: false,
      error: `Error al buscar partidas: ${error.message}${error.code ? ` (${error.code})` : ''}`,
    }
  }

  const rows = ((data ?? []) as PartidaConEntregadosRow[]).map((row) => ({
    ...row,
    rollos_entregados: Number(row.rollos_entregados),
  }))
  return { ok: true, rows }
}

export async function getRollosEntregadosByIngreso(
  ingresoId: string
): Promise<BuscarRollosResult> {
  if (!ingresoId.trim()) {
    return { ok: false, error: 'La partida seleccionada no es válida.' }
  }

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('rollos_entregados_por_ingreso', {
    p_ingreso_id: ingresoId,
  })

  if (error) {
    console.error('[getRollosEntregadosByIngreso] RPC error:', error)
    return {
      ok: false,
      error: `Error al cargar los rollos de la partida: ${error.message}${error.code ? ` (${error.code})` : ''}`,
    }
  }

  return {
    ok: true,
    rollos: ((data ?? []) as RolloEntregadoRpcRow[]).map(mapRolloEntregado),
  }
}

export async function devolverRollos(
  items: DevolucionItem[],
  motivo: string
): Promise<DevolucionResult> {
  if (!items.length) return { ok: false, error: 'No hay rollos para devolver.' }
  if (!motivo.trim()) return { ok: false, error: 'El motivo es obligatorio.' }

  const supabase = await createClient()
  const p_items = items.map((item) => ({
    rollo_id: item.rolloId,
    segunda: item.segunda,
    falla_categoria: item.fallaTipo ?? null,
  }))

  const { data, error } = await supabase.rpc('devolver_rollos_deposito', {
    p_items,
    p_motivo: motivo.trim(),
  })

  if (error) return { ok: false, error: error.message }

  const result = data as {
    devueltos: number
    errores: { rollo_id: string; error: string }[]
  }
  return {
    ok: true,
    devueltos: result.devueltos,
    errores: result.errores ?? [],
  }
}
