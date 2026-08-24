export type StockOrientacionRaw = {
  ingreso_id: string | null
  articulo_id: string | null
  color_id: string | null
  ubicacion: string | null
  ingresos: { numero_lote: string | null } | null
}

export type PartidaOrientacion = {
  articulo_id: string
  color_id: string
  ingreso_id: string
}

export type ReemplazoSugerido = {
  ubicacion: string
  lote: string | null
}

export type PartidaParaMatch = {
  id: string
  articuloId: string
  colorId: string
  ingresoId: string | null
  rollosSolicitados: number
  rollosAsignados: number
}

export type RolloParaMatch = {
  articuloId: string
  colorId: string
  ingresoId: string | null
}

export type MatchPartidaResult = {
  partidaId: string
  esSustitucionPartida: boolean
}

export type UbicacionesSugeridas = {
  ubicaciones: string[]
  reemplazos: ReemplazoSugerido[]
}

// Un pedido puede tener todos los rollos confirmados y conservar un estado
// viejo. En ese caso la UI debe ofrecer una accion explicita de recuperacion.
export function requiereFinalizarPicking(
  estadoPedido: string,
  totalSolicitado: number,
  totalPickeadoConfirmado: number
): boolean {
  return (
    estadoPedido !== 'lista' &&
    totalSolicitado > 0 &&
    totalPickeadoConfirmado >= totalSolicitado
  )
}

// Ubicaciones donde hay stock en_stock del mismo articulo y color que la
// partida. Las que coinciden con el ingreso/lote solicitado van en
// `ubicaciones`; las de otro lote (sustitucion) van aparte en `reemplazos`,
// con su numero de lote, para mostrarlas en una linea distinta y no
// confundirlas con la partida que se esta pickeando.
export function buildUbicacionesSugeridas(
  partida: PartidaOrientacion,
  stockRows: StockOrientacionRaw[]
): UbicacionesSugeridas {
  const seenUbicaciones = new Set<string>()
  const seenReemplazos = new Set<string>()
  const ubicaciones: string[] = []
  const reemplazos: ReemplazoSugerido[] = []

  const candidatas = stockRows
    .filter(
      (r) =>
        r.articulo_id === partida.articulo_id &&
        r.color_id === partida.color_id &&
        r.ubicacion
    )
    .sort((a, b) =>
      (a.ubicacion ?? '').localeCompare(b.ubicacion ?? '', 'es', {
        numeric: true,
      })
    )

  for (const r of candidatas) {
    const ubicacion = r.ubicacion!
    if (r.ingreso_id === partida.ingreso_id) {
      if (seenUbicaciones.has(ubicacion)) continue
      seenUbicaciones.add(ubicacion)
      if (ubicaciones.length < 4) ubicaciones.push(ubicacion)
    } else {
      if (seenReemplazos.has(ubicacion)) continue
      seenReemplazos.add(ubicacion)
      if (reemplazos.length < 4) {
        reemplazos.push({ ubicacion, lote: r.ingresos?.numero_lote ?? null })
      }
    }
  }

  return { ubicaciones, reemplazos }
}

// Previsualizacion del matching de partida para un rollo escaneado, replicando
// la logica de la RPC aplicar_picking_pedido (preferencia por mismo ingreso,
// primera partida con cupo). `asignadosBorrador` suma lo ya puesto en el
// borrador local (todavia no persistido) por partida, para no ofrecer cupo
// que ya esta tomado dentro de la misma sesion.
export function matchPartidaParaRollo(
  rollo: RolloParaMatch,
  partidas: PartidaParaMatch[],
  asignadosBorrador: Record<string, number> = {}
): MatchPartidaResult | null {
  const candidatas = partidas.filter(
    (p) =>
      p.articuloId === rollo.articuloId &&
      p.colorId === rollo.colorId &&
      p.rollosAsignados + (asignadosBorrador[p.id] ?? 0) < p.rollosSolicitados
  )

  if (candidatas.length === 0) return null

  const [elegida] = [...candidatas].sort((a, b) => {
    const aMatch = a.ingresoId === rollo.ingresoId ? 0 : 1
    const bMatch = b.ingresoId === rollo.ingresoId ? 0 : 1
    return aMatch - bMatch
  })

  return {
    partidaId: elegida.id,
    esSustitucionPartida: elegida.ingresoId !== rollo.ingresoId,
  }
}
