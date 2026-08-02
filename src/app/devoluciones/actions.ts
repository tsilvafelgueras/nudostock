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

export async function getRolloEntregado(
  numeroPieza: string
): Promise<{ ok: true; rollo: RolloEntregadoInfo } | { ok: false; error: string }> {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('rollos')
    .select(`
      id, numero_pieza, kilos, metros, ingreso_id,
      articulos ( nombre ),
      colores: color_id ( nombre ),
      ingresos!inner (
        id, numero_lote,
        tintorerias ( nombre )
      )
    `)
    .eq('numero_pieza', numeroPieza.trim())
    .eq('estado', 'entregado')
    .single()

  if (error || !data) {
    if (error?.code === 'PGRST116') {
      return {
        ok: false,
        error: `No se encontró ningún rollo entregado con número de pieza "${numeroPieza}". Verificá que el rollo haya sido entregado a un cliente.`,
      }
    }
    return { ok: false, error: 'Error al buscar el rollo.' }
  }

  type Raw = typeof data & {
    articulos: { nombre: string } | null
    colores: { nombre: string } | null
    ingresos: { id: string; numero_lote: string | null; tintorerias: { nombre: string } | null } | null
  }
  const r = data as unknown as Raw

  // Buscar el pedido asociado
  const { data: prData } = await supabase
    .from('pedido_rollos')
    .select('pedidos!inner ( numero_pedido )')
    .eq('rollo_id', r.id)
    .is('devuelto_at', null)
    .is('liberado_at', null)
    .limit(1)
    .single()

  type PrRaw = { pedidos: { numero_pedido: string } | null }
  const pedidoNumero = (prData as unknown as PrRaw | null)?.pedidos?.numero_pedido ?? null

  return {
    ok: true,
    rollo: {
      id: r.id,
      numero_pieza: r.numero_pieza,
      kilos: r.kilos,
      metros: r.metros,
      articulo: (r.articulos as unknown as { nombre: string } | null)?.nombre ?? '-',
      color: (r.colores as unknown as { nombre: string } | null)?.nombre ?? '-',
      ingreso_id: r.ingresos?.id ?? '',
      numero_lote: r.ingresos?.numero_lote ?? null,
      tintoreria: (r.ingresos?.tintorerias as unknown as { nombre: string } | null)?.nombre ?? '-',
      pedido_numero: pedidoNumero,
    },
  }
}

export async function buscarPartidasConEntregados(
  query: string
): Promise<BuscarPartidasResult> {
  const supabase = await createClient()

  const { data, error } = await supabase.rpc('buscar_partidas_con_entregados', {
    p_query: query.trim(),
  })

  if (error) {
    console.error('[buscarPartidasConEntregados] RPC error:', error)
    return {
      ok: false,
      error: `Error al buscar partidas: ${error.message}${error.code ? ` (${error.code})` : ''}`,
    }
  }
  return { ok: true, rows: (data ?? []) as PartidaConEntregadosRow[] }
}

export async function getRollosEntregadosByIngreso(
  ingresoId: string
): Promise<RolloEntregadoInfo[]> {
  const supabase = await createClient()

  const { data, error } = await supabase.rpc('rollos_entregados_por_ingreso', {
    p_ingreso_id: ingresoId,
  })

  if (error) {
    console.error('[getRollosEntregadosByIngreso] RPC error:', error)
    return []
  }

  type RpcRow = {
    rollo_id: string
    numero_pieza: string
    kilos: number | null
    metros: number | null
    pedido_numero: string | null
  }

  // We need articulo/color/tintoreria info — join separately
  const rolloIds = ((data ?? []) as RpcRow[]).map((r) => r.rollo_id)
  if (rolloIds.length === 0) return []

  const { data: rollosData } = await supabase
    .from('rollos')
    .select(`
      id, numero_pieza, kilos, metros, ingreso_id,
      articulos ( nombre ),
      colores: color_id ( nombre ),
      ingresos!inner ( id, numero_lote, tintorerias ( nombre ) )
    `)
    .in('id', rolloIds)

  type RolloRaw = {
    id: string
    numero_pieza: string
    kilos: number | null
    metros: number | null
    ingreso_id: string
    articulos: { nombre: string } | null
    colores: { nombre: string } | null
    ingresos: { id: string; numero_lote: string | null; tintorerias: { nombre: string } | null } | null
  }

  const rpcByRolloId = new Map(((data ?? []) as RpcRow[]).map((r) => [r.rollo_id, r]))

  return ((rollosData ?? []) as unknown as RolloRaw[]).map((r) => ({
    id: r.id,
    numero_pieza: r.numero_pieza,
    kilos: r.kilos,
    metros: r.metros,
    articulo: r.articulos?.nombre ?? '-',
    color: r.colores?.nombre ?? '-',
    ingreso_id: r.ingresos?.id ?? '',
    numero_lote: r.ingresos?.numero_lote ?? null,
    tintoreria: r.ingresos?.tintorerias?.nombre ?? '-',
    pedido_numero: rpcByRolloId.get(r.id)?.pedido_numero ?? null,
  }))
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

  const result = data as { devueltos: number; errores: { rollo_id: string; error: string }[] }
  return {
    ok: true,
    devueltos: result.devueltos,
    errores: result.errores ?? [],
  }
}
