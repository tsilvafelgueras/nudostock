'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { matchPartidaParaRollo, type PartidaParaMatch } from '@/lib/picking'

export type PickearRolloResult =
  | {
      ok: true
      rolloId: string
      numeroPieza: string
      kilos: number | null
      ubicacion: string | null
      articuloId: string | null
      colorId: string | null
      pedidoPartidaId: string
      partidaRealLote: string | null
      partidaSolicitadaLote: string | null
      esSustitucionPartida: boolean
      pendientes: number
      total: number
      pedidoCompleto: boolean
    }
  | { ok: false; error: string }

export async function pickearRollo(
  pedidoId: string,
  textoEscaneado: string
): Promise<PickearRolloResult> {
  const supabase = await createClient()

  if (!textoEscaneado.trim()) {
    return { ok: false, error: 'Falta el número de pieza.' }
  }

  const numeroPieza = textoEscaneado.trim()

  const { data, error } = await supabase.rpc('pickear_rollo', {
    p_pedido_id: pedidoId,
    p_numero_pieza: numeroPieza,
  })

  if (error) return { ok: false, error: error.message }

  const json = data as {
    rollo_id: string
    numero_pieza: string
    kilos: number | null
    ubicacion: string | null
    articulo_id: string | null
    color_id: string | null
    pedido_partida_id: string
    partida_real_lote: string | null
    partida_solicitada_lote: string | null
    es_sustitucion_partida: boolean
    pendientes: number
    total: number
    pedido_completo: boolean
  }

  revalidatePath(`/picking/${pedidoId}`)
  revalidatePath('/picking')
  revalidatePath(`/pedidos/${pedidoId}`)
  revalidatePath('/pedidos')

  return {
    ok: true,
    rolloId: json.rollo_id,
    numeroPieza: json.numero_pieza,
    kilos: json.kilos,
    ubicacion: json.ubicacion,
    articuloId: json.articulo_id,
    colorId: json.color_id,
    pedidoPartidaId: json.pedido_partida_id,
    partidaRealLote: json.partida_real_lote,
    partidaSolicitadaLote: json.partida_solicitada_lote,
    esSustitucionPartida: Boolean(json.es_sustitucion_partida),
    pendientes: json.pendientes,
    total: json.total,
    pedidoCompleto: json.pedido_completo,
  }
}

// ── Reemplazo de rollo por falla detectada en picking ───────

export type ReemplazoResult =
  | {
      ok: true
      pedidoRolloId: string
      rolloId: string
      numeroPieza: string
      kilos: number | null
      ubicacion: string | null
      articuloId: string | null
      colorId: string | null
      pedidoPartidaId: string
      partidaRealLote: string | null
      partidaSolicitadaLote: string | null
      esSustitucionPartida: boolean
    }
  | { ok: false; error: string }

export async function reemplazarRolloEnPicking(input: {
  pedidoId: string
  rolloViejoId: string
  numeroPiezaNuevo: string
  motivo: string
}): Promise<ReemplazoResult> {
  const supabase = await createClient()

  if (!input.numeroPiezaNuevo.trim()) {
    return { ok: false, error: 'Falta el numero de pieza nuevo.' }
  }

  const { data, error } = await supabase.rpc('reemplazar_rollo_picking', {
    p_pedido_id: input.pedidoId,
    p_rollo_viejo_id: input.rolloViejoId,
    p_numero_pieza_nuevo: input.numeroPiezaNuevo.trim(),
    p_motivo: input.motivo.trim() || null,
  })
  if (error) return { ok: false, error: error.message }

  return mapReemplazo(data, input.pedidoId)
}

// ── Quitar rollo ya pickeado ────────────────────────────────

export type QuitarRolloResult =
  | {
      ok: true
      pedidoRolloId: string
      rolloId: string
      numeroPieza: string
      pedidoPartidaId: string | null
      pendientes: number
      total: number
    }
  | { ok: false; error: string }

export async function quitarRolloDePicking(input: {
  pedidoId: string
  pedidoRolloId: string
  motivo?: string
}): Promise<QuitarRolloResult> {
  const supabase = await createClient()

  const { data, error } = await supabase.rpc('quitar_rollo_picking', {
    p_pedido_id: input.pedidoId,
    p_pedido_rollo_id: input.pedidoRolloId,
    p_motivo: input.motivo?.trim() || null,
  })
  if (error) return { ok: false, error: error.message }

  const json = data as {
    pedido_rollo_id: string
    rollo_id: string
    numero_pieza: string
    pedido_partida_id: string | null
    pendientes: number
    total: number
  }

  revalidatePath(`/picking/${input.pedidoId}`)
  revalidatePath('/picking')
  revalidatePath(`/pedidos/${input.pedidoId}`)
  revalidatePath('/pedidos')

  return {
    ok: true,
    pedidoRolloId: json.pedido_rollo_id,
    rolloId: json.rollo_id,
    numeroPieza: json.numero_pieza,
    pedidoPartidaId: json.pedido_partida_id,
    pendientes: json.pendientes,
    total: json.total,
  }
}

// ── Borrador local de picking: previsualizar + aceptar ──────

export type PrevisualizarPickeoResult =
  | {
      ok: true
      rolloId: string
      numeroPieza: string
      kilos: number | null
      ubicacion: string | null
      articuloId: string | null
      colorId: string | null
      ingresoId: string | null
      pedidoPartidaId: string
      partidaRealLote: string | null
      partidaSolicitadaLote: string | null
      esSustitucionPartida: boolean
    }
  | { ok: false; error: string }

// Solo lectura: no escribe en pedido_rollos/rollos. Sirve para que el
// operario vea el resultado tentativo del escaneo en su borrador local.
// La validacion definitiva (y la escritura) ocurre en aplicarPickingPedido.
export async function previsualizarPickeo(
  textoEscaneado: string,
  idsRollosEnBorrador: string[],
  partidas: PartidaParaMatch[],
  asignadosBorrador: Record<string, number>
): Promise<PrevisualizarPickeoResult> {
  const supabase = await createClient()

  const numeroPieza = textoEscaneado.trim()
  if (!numeroPieza) {
    return { ok: false, error: 'Falta el número de pieza.' }
  }

  const { data: rollo, error } = await supabase
    .from('rollos')
    .select(
      `
        id,
        numero_pieza,
        kilos,
        ubicacion,
        articulo_id,
        color_id,
        ingreso_id,
        estado,
        ingresos ( numero_lote )
      `
    )
    .eq('numero_pieza', numeroPieza)
    .maybeSingle<{
      id: string
      numero_pieza: string
      kilos: number | null
      ubicacion: string | null
      articulo_id: string | null
      color_id: string | null
      ingreso_id: string | null
      estado: string
      ingresos: { numero_lote: string | null } | null
    }>()

  if (error) return { ok: false, error: error.message }
  if (!rollo) return { ok: false, error: 'No se encontró este rollo.' }

  if (idsRollosEnBorrador.includes(rollo.id)) {
    return { ok: false, error: 'Ese rollo ya está en el borrador.' }
  }

  if (rollo.estado !== 'en_stock') {
    if (rollo.estado === 'reservado') {
      return { ok: false, error: 'Este rollo ya fue pickeado.' }
    }
    return {
      ok: false,
      error: `Este rollo no está disponible (estado: ${rollo.estado}).`,
    }
  }

  if (!rollo.articulo_id || !rollo.color_id) {
    return { ok: false, error: 'Este rollo no tiene articulo/color asignado.' }
  }

  const match = matchPartidaParaRollo(
    {
      articuloId: rollo.articulo_id,
      colorId: rollo.color_id,
      ingresoId: rollo.ingreso_id,
    },
    partidas,
    asignadosBorrador
  )

  if (!match) {
    return {
      ok: false,
      error:
        'Este rollo no coincide con articulo/color pendiente del pedido, o todas las lineas ya estan completas.',
    }
  }

  const partida = partidas.find((p) => p.id === match.partidaId) ?? null
  let partidaSolicitadaLote: string | null = null
  if (partida && !match.esSustitucionPartida) {
    partidaSolicitadaLote = rollo.ingresos?.numero_lote ?? null
  } else if (partida) {
    const { data: ingresoPartida } = await supabase
      .from('ingresos')
      .select('numero_lote')
      .eq('id', partida.ingresoId)
      .maybeSingle<{ numero_lote: string | null }>()
    partidaSolicitadaLote = ingresoPartida?.numero_lote ?? null
  }

  return {
    ok: true,
    rolloId: rollo.id,
    numeroPieza: rollo.numero_pieza,
    kilos: rollo.kilos,
    ubicacion: rollo.ubicacion,
    articuloId: rollo.articulo_id,
    colorId: rollo.color_id,
    ingresoId: rollo.ingreso_id,
    pedidoPartidaId: match.partidaId,
    partidaRealLote: rollo.ingresos?.numero_lote ?? null,
    partidaSolicitadaLote,
    esSustitucionPartida: match.esSustitucionPartida,
  }
}

export type AplicarPickingItem = {
  rolloId: string
  numeroPieza: string
  kilos: number | null
  ubicacion: string | null
  articuloId: string | null
  colorId: string | null
  ingresoId: string | null
  pedidoPartidaId: string
  partidaRealLote: string | null
  partidaSolicitadaLote: string | null
  esSustitucionPartida: boolean
}

export type AplicarPickingResult =
  | {
      ok: true
      aplicados: AplicarPickingItem[]
      errores: { numeroPieza: string; error: string }[]
      pendientes: number
      total: number
      pedidoCompleto: boolean
    }
  | { ok: false; error: string }

export async function aplicarPickingPedido(
  pedidoId: string,
  items: { numeroPieza: string }[]
): Promise<AplicarPickingResult> {
  const supabase = await createClient()

  if (items.length === 0) {
    return { ok: false, error: 'El borrador está vacío.' }
  }

  const { data, error } = await supabase.rpc('aplicar_picking_pedido', {
    p_pedido_id: pedidoId,
    p_items: items.map((item) => ({ numeroPieza: item.numeroPieza })),
  })

  if (error) return { ok: false, error: error.message }

  const json = data as {
    aplicados: {
      rollo_id: string
      numero_pieza: string
      kilos: number | null
      ubicacion: string | null
      articulo_id: string | null
      color_id: string | null
      ingreso_id: string | null
      pedido_partida_id: string
      partida_real_lote: string | null
      partida_solicitada_lote: string | null
      es_sustitucion_partida: boolean
    }[]
    errores: { numero_pieza: string; error: string }[]
    pendientes: number
    total: number
    pedido_completo: boolean
  }

  revalidatePath(`/picking/${pedidoId}`)
  revalidatePath('/picking')
  revalidatePath(`/pedidos/${pedidoId}`)
  revalidatePath('/pedidos')

  return {
    ok: true,
    aplicados: json.aplicados.map((a) => ({
      rolloId: a.rollo_id,
      numeroPieza: a.numero_pieza,
      kilos: a.kilos,
      ubicacion: a.ubicacion,
      articuloId: a.articulo_id,
      colorId: a.color_id,
      ingresoId: a.ingreso_id,
      pedidoPartidaId: a.pedido_partida_id,
      partidaRealLote: a.partida_real_lote,
      partidaSolicitadaLote: a.partida_solicitada_lote,
      esSustitucionPartida: Boolean(a.es_sustitucion_partida),
    })),
    errores: json.errores.map((e) => ({
      numeroPieza: e.numero_pieza,
      error: e.error,
    })),
    pendientes: json.pendientes,
    total: json.total,
    pedidoCompleto: Boolean(json.pedido_completo),
  }
}

export type FinalizarPickingResult =
  | {
      ok: true
      total: number
      pickeados: number
      pendientes: number
      pedidoCompleto: boolean
    }
  | { ok: false; error: string }

// Recupera pedidos que ya tienen todos sus rollos confirmados pero cuyo
// estado persistido quedo en pendiente/en_preparacion.
export async function finalizarPickingPedido(
  pedidoId: string
): Promise<FinalizarPickingResult> {
  const supabase = await createClient()

  const { data, error } = await supabase.rpc('finalizar_picking_pedido', {
    p_pedido_id: pedidoId,
  })

  if (error) return { ok: false, error: error.message }

  const json = data as {
    total: number
    pickeados: number
    pendientes: number
    pedido_completo: boolean
  }

  revalidatePath(`/picking/${pedidoId}`)
  revalidatePath('/picking')
  revalidatePath(`/pedidos/${pedidoId}`)
  revalidatePath('/pedidos')

  return {
    ok: true,
    total: json.total,
    pickeados: json.pickeados,
    pendientes: json.pendientes,
    pedidoCompleto: Boolean(json.pedido_completo),
  }
}

// ── Aviso de multi-sesion (heartbeat) ────────────────────────

export type SesionPickingResult =
  | { ok: true; otroUsuarioNombre: string | null; haceSegundos: number | null }
  | { ok: false; error: string }

export async function marcarSesionPicking(
  pedidoId: string
): Promise<SesionPickingResult> {
  const supabase = await createClient()

  const { data, error } = await supabase.rpc('marcar_sesion_picking', {
    p_pedido_id: pedidoId,
  })

  if (error) return { ok: false, error: error.message }

  const json = data as {
    otro_usuario_nombre: string | null
    hace_segundos: number | null
  }

  return {
    ok: true,
    otroUsuarioNombre: json.otro_usuario_nombre,
    haceSegundos: json.hace_segundos,
  }
}

function mapReemplazo(data: unknown, pedidoId: string): ReemplazoResult {
  const json = data as {
    pedido_rollo_id: string
    rollo_id: string
    numero_pieza: string
    kilos: number | null
    ubicacion: string | null
    articulo_id: string | null
    color_id: string | null
    pedido_partida_id: string
    partida_real_lote: string | null
    partida_solicitada_lote: string | null
    es_sustitucion_partida: boolean
  }

  revalidatePath(`/picking/${pedidoId}`)
  revalidatePath('/picking')
  revalidatePath(`/pedidos/${pedidoId}`)
  revalidatePath('/pedidos')

  return {
    ok: true,
    pedidoRolloId: json.pedido_rollo_id,
    rolloId: json.rollo_id,
    numeroPieza: json.numero_pieza,
    kilos: json.kilos,
    ubicacion: json.ubicacion,
    articuloId: json.articulo_id,
    colorId: json.color_id,
    pedidoPartidaId: json.pedido_partida_id,
    partidaRealLote: json.partida_real_lote,
    partidaSolicitadaLote: json.partida_solicitada_lote,
    esSustitucionPartida: Boolean(json.es_sustitucion_partida),
  }
}
