// Lógica pura del resumen de stock (sin dependencias de Supabase/React para
// poder testearla con vitest). La consume `src/app/stock/page.tsx`, que le pasa
// las filas ya fetcheadas.
//
// Modelo de stock ("picking real"): un rollo físico vive en `en_stock` hasta que
// el operario lo pickea para un pedido, momento en que pasa a `reservado`. La
// demanda de los pedidos vive aparte en `pedido_partidas.rollos_solicitados`
// (cuántos rollos pidieron de esa partida), y puede estar todavía sin pickear.
//
// Definiciones (para que las columnas SIEMPRE cierren `Rollos = Libre + Reservado`):
//   - en_stock  = rollos con estado 'en_stock' (físicamente disponibles).
//   - pickeados = rollos con estado 'reservado' (ya asignados a un pedido).
//   - demanda   = suma de rollos_solicitados de pedidos activos para esa partida.
//   - demanda_pendiente = demanda que todavía no se cubrió con un rollo pickeado,
//                         acotada a lo que hay físicamente libre:
//                         min(en_stock, max(0, demanda - pickeados)).
//   - Libre     = en_stock - demanda_pendiente
//   - Reservado = pickeados + demanda_pendiente
//   - Rollos    = en_stock + pickeados  (= Libre + Reservado)
//
// Un rollo `reservado` nunca cuenta como libre porque ya salió de `en_stock`.

export type StockResumenRow = {
  id: string
  kilos: number | null
  estado: string
  articulo_id: string | null
  color_id: string | null
  ubicacion: string | null
  articulos: { id: string; nombre: string } | null
  ingresos: {
    id: string
    numero_lote: string | null
    tintoreria_id: string | null
  } | null
}

export type ReservaResumenRow = {
  ingreso_id: string
  articulo_id: string
  color_id: string
  rollos_solicitados: number
  articulos: { id: string; nombre: string } | null
  ingresos: {
    id: string
    numero_lote: string | null
    tintoreria_id: string | null
  } | null
}

export type StockSummaryPartida = {
  key: string
  lote: string
  rollos: number
  reservado: number
  libre: number
}

export type StockSummaryGroup = {
  key: string
  articulo: string
  color: string
  rollos: number
  kilos: number
  kilos_libre: number
  kilos_reservado: number
  reservado: number
  libre: number
  partidas: StockSummaryPartida[]
}

export type StockReservaBanner = {
  lote: string
  rollos: number
  reservado: number
  libre: number
}

type Color = { id: string; nombre: string }

type PartidaAcc = {
  groupKey: string
  key: string
  lote: string
  en_stock: number
  pickeados: number
  demanda: number
}

type GroupAcc = {
  key: string
  articulo: string
  color: string
  en_stock: number
  pickeados: number
  kilos: number
  kilos_libre: number
  kilos_reservado: number
  demanda: number
}

/**
 * Reparte los rollos físicos de una partida/grupo en libre/reservado de forma
 * que siempre cierre `rollos = libre + reservado`. La demanda que excede lo que
 * hay físicamente libre no se representa (el resumen es de disponibilidad real).
 */
function repartir(en_stock: number, pickeados: number, demanda: number) {
  const demandaPendiente = Math.min(en_stock, Math.max(0, demanda - pickeados))
  return {
    rollos: en_stock + pickeados,
    libre: en_stock - demandaPendiente,
    reservado: pickeados + demandaPendiente,
  }
}

export function buildStockSummary(
  stockRows: StockResumenRow[],
  reservaRows: ReservaResumenRow[],
  colorById: Map<string, Color>
): StockSummaryGroup[] {
  const groups = new Map<string, GroupAcc>()
  const partidas = new Map<string, PartidaAcc>()

  function groupKeyOf(articuloId: string, colorId: string) {
    return `${articuloId}|||${colorId}`
  }
  function partidaKeyOf(groupKey: string, ingresoId: string) {
    return `${groupKey}|||${ingresoId}`
  }

  function ensureGroup(
    articuloId: string,
    colorId: string,
    articulo: string,
    color: string
  ): GroupAcc {
    const key = groupKeyOf(articuloId, colorId)
    const existing = groups.get(key)
    if (existing) return existing
    const group: GroupAcc = {
      key,
      articulo,
      color,
      en_stock: 0,
      pickeados: 0,
      kilos: 0,
      kilos_libre: 0,
      kilos_reservado: 0,
      demanda: 0,
    }
    groups.set(key, group)
    return group
  }

  function ensurePartida(
    groupKey: string,
    ingresoId: string,
    lote: string
  ): PartidaAcc {
    const key = partidaKeyOf(groupKey, ingresoId)
    const existing = partidas.get(key)
    if (existing) return existing
    const partida: PartidaAcc = {
      groupKey,
      key,
      lote,
      en_stock: 0,
      pickeados: 0,
      demanda: 0,
    }
    partidas.set(key, partida)
    return partida
  }

  // 1) Rollos físicos (en_stock + reservado).
  for (const r of stockRows) {
    const articuloId = r.articulo_id ?? r.articulos?.id ?? 'sin-articulo'
    const colorId = r.color_id ?? 'sin-color'
    const group = ensureGroup(
      articuloId,
      colorId,
      r.articulos?.nombre ?? '-',
      r.color_id ? colorById.get(r.color_id)?.nombre ?? '-' : '-'
    )
    const kilos = Number(r.kilos ?? 0)
    group.kilos += kilos

    const partida = ensurePartida(
      group.key,
      r.ingresos?.id ?? 'sin-partida',
      r.ingresos?.numero_lote ?? 'Sin partida'
    )

    if (r.estado === 'reservado') {
      group.pickeados += 1
      group.kilos_reservado += kilos
      partida.pickeados += 1
    } else {
      group.en_stock += 1
      group.kilos_libre += kilos
      partida.en_stock += 1
    }
  }

  // 2) Demanda de pedidos activos (rollos_solicitados).
  for (const r of reservaRows) {
    const group = ensureGroup(
      r.articulo_id,
      r.color_id,
      r.articulos?.nombre ?? '-',
      colorById.get(r.color_id)?.nombre ?? '-'
    )
    const cantidad = Number(r.rollos_solicitados ?? 0)
    group.demanda += cantidad

    const partida = ensurePartida(
      group.key,
      r.ingresos?.id ?? r.ingreso_id,
      r.ingresos?.numero_lote ?? 'Sin partida'
    )
    partida.demanda += cantidad
  }

  // 3) Reparto final. El total libre/reservado del grupo se calcula con los
  //    agregados del grupo (robusto frente a sustituciones de partida, que
  //    mantienen mismo artículo+color). El desglose por partida es informativo.
  const result: StockSummaryGroup[] = []
  for (const group of groups.values()) {
    const propias = [...partidas.values()]
      .filter((p) => p.groupKey === group.key)
      .map((p) => {
        const { rollos, libre, reservado } = repartir(
          p.en_stock,
          p.pickeados,
          p.demanda
        )
        return { key: p.key, lote: p.lote, rollos, reservado, libre }
      })
      .sort((a, b) => a.lote.localeCompare(b.lote, 'es', { numeric: true }))

    const totales = repartir(group.en_stock, group.pickeados, group.demanda)

    result.push({
      key: group.key,
      articulo: group.articulo,
      color: group.color,
      kilos: group.kilos,
      kilos_libre: group.kilos_libre,
      kilos_reservado: group.kilos_reservado,
      rollos: totales.rollos,
      reservado: totales.reservado,
      libre: totales.libre,
      partidas: propias,
    })
  }

  return result.sort((a, b) => {
    if (b.rollos !== a.rollos) return b.rollos - a.rollos
    return a.articulo.localeCompare(b.articulo, 'es')
  })
}

export function buildReservaBanner(
  summary: StockSummaryGroup[],
  lote?: string
): StockReservaBanner | null {
  if (!lote) return null

  const matches = summary.flatMap((g) =>
    g.partidas.filter((p) => p.lote === lote)
  )
  if (matches.length === 0) return null

  return {
    lote,
    rollos: matches.reduce((acc, p) => acc + p.rollos, 0),
    reservado: matches.reduce((acc, p) => acc + p.reservado, 0),
    libre: matches.reduce((acc, p) => acc + p.libre, 0),
  }
}
