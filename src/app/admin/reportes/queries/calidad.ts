import {
  type ReportesFilters,
  type SupabaseClient,
  colorNameById,
  listOrSingle,
  rangoPeriodo,
} from './_shared'
import {
  FALLA_CATEGORIAS,
  FALLA_LABEL,
  type FallaCategoria,
} from './tintorerias'

// ════════════════════════════════════════════════════════════
//  BLOQUE D — Calidad y mermas
//  "¿Dónde se me cae la calidad?"
// ════════════════════════════════════════════════════════════

// ── Distribución de fallas por categoría ────────────────────

export type FallaCategoriaRow = {
  categoria: FallaCategoria
  label: string
  rollos: number
}

export async function reporteFallasPorCategoria(
  supabase: SupabaseClient,
  filters: ReportesFilters = {}
): Promise<FallaCategoriaRow[]> {
  const { desde, hasta } = rangoPeriodo(filters)
  const articuloIds = listOrSingle(filters.articuloIds, filters.articuloId)
  const tintoreriaIds = listOrSingle(filters.tintoreriaIds, filters.tintoreriaId)

  let query = supabase
    .from('rollos')
    .select('falla_categoria, articulo_id, ingresos!inner ( tintoreria_id )')
    .eq('estado', 'segunda')
    .gte('created_at', desde)
    .lt('created_at', hasta)
    .limit(10000)
  if (articuloIds.length > 1) query = query.in('articulo_id', articuloIds)
  else if (articuloIds.length === 1) query = query.eq('articulo_id', articuloIds[0])
  if (tintoreriaIds.length > 1)
    query = query.in('ingresos.tintoreria_id', tintoreriaIds)
  else if (tintoreriaIds.length === 1)
    query = query.eq('ingresos.tintoreria_id', tintoreriaIds[0])

  const { data } = await query

  const counts = new Map<FallaCategoria, number>()
  for (const r of (data ?? []) as { falla_categoria: string | null }[]) {
    const cat = (r.falla_categoria ?? 'Otro') as FallaCategoria
    const key = FALLA_CATEGORIAS.includes(cat) ? cat : 'Otro'
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }

  return FALLA_CATEGORIAS.map((categoria) => ({
    categoria,
    label: FALLA_LABEL[categoria],
    rollos: counts.get(categoria) ?? 0,
  })).filter((r) => r.rollos > 0)
}

// ── Kilos degradados (baja + segunda) por mes ───────────────

export type DegradadosMes = {
  ym: string
  label: string
  kgBaja: number
  kgSegunda: number
}

export type DegradadosResult = {
  meses: DegradadosMes[]
  totalKgBaja: number
  totalKgSegunda: number
  rollosBaja: number
  rollosSegunda: number
}

const MES_CORTO = [
  'ene', 'feb', 'mar', 'abr', 'may', 'jun',
  'jul', 'ago', 'sep', 'oct', 'nov', 'dic',
]

function ymLabel(ym: string): string {
  const [y, m] = ym.split('-')
  return `${MES_CORTO[Number(m) - 1]} ${y.slice(2)}`
}

export async function reporteKilosDegradados(
  supabase: SupabaseClient,
  filters: ReportesFilters = {}
): Promise<DegradadosResult> {
  const { desde, hasta } = rangoPeriodo(filters)
  const articuloIds = listOrSingle(filters.articuloIds, filters.articuloId)
  const tintoreriaIds = listOrSingle(filters.tintoreriaIds, filters.tintoreriaId)

  let query = supabase
    .from('rollos')
    .select('estado, kilos, created_at, articulo_id, ingresos!inner ( tintoreria_id )')
    .in('estado', ['baja', 'segunda'])
    .gte('created_at', desde)
    .lt('created_at', hasta)
    .limit(10000)
  if (articuloIds.length > 1) query = query.in('articulo_id', articuloIds)
  else if (articuloIds.length === 1) query = query.eq('articulo_id', articuloIds[0])
  if (tintoreriaIds.length > 1)
    query = query.in('ingresos.tintoreria_id', tintoreriaIds)
  else if (tintoreriaIds.length === 1)
    query = query.eq('ingresos.tintoreria_id', tintoreriaIds[0])

  const { data } = await query

  type Raw = { estado: string; kilos: number | null; created_at: string }
  const rows = (data ?? []) as unknown as Raw[]

  const porMes = new Map<string, DegradadosMes>()
  let totalKgBaja = 0
  let totalKgSegunda = 0
  let rollosBaja = 0
  let rollosSegunda = 0

  for (const r of rows) {
    const ym = r.created_at.slice(0, 7)
    const kg = Number(r.kilos ?? 0)
    const mes =
      porMes.get(ym) ?? { ym, label: ymLabel(ym), kgBaja: 0, kgSegunda: 0 }
    if (r.estado === 'baja') {
      mes.kgBaja += kg
      totalKgBaja += kg
      rollosBaja += 1
    } else {
      mes.kgSegunda += kg
      totalKgSegunda += kg
      rollosSegunda += 1
    }
    porMes.set(ym, mes)
  }

  return {
    meses: [...porMes.values()].sort((a, b) => a.ym.localeCompare(b.ym)),
    totalKgBaja,
    totalKgSegunda,
    rollosBaja,
    rollosSegunda,
  }
}

// ── Muestras ─────────────────────────────────────────────────

export type MuestraClienteRow = {
  cliente: string
  kilos: number
  muestras: number
}

export type MuestrasResult = {
  totalMuestras: number
  kilosTotales: number
  vinculadas: number
  vinculadasPct: number
  topClientes: MuestraClienteRow[]
}

export async function reporteMuestras(
  supabase: SupabaseClient,
  filters: ReportesFilters = {}
): Promise<MuestrasResult> {
  const { desde, hasta } = rangoPeriodo(filters)

  const { data } = await supabase
    .from('muestras')
    .select('cliente, kilos_descontados, vinculado_a_pedido_id, created_at')
    .gte('created_at', desde)
    .lt('created_at', hasta)
    .limit(10000)

  type Raw = {
    cliente: string
    kilos_descontados: number | null
    vinculado_a_pedido_id: string | null
  }
  const rows = (data ?? []) as unknown as Raw[]

  let kilosTotales = 0
  let vinculadas = 0
  const porCliente = new Map<string, MuestraClienteRow>()

  for (const r of rows) {
    const kg = Number(r.kilos_descontados ?? 0)
    kilosTotales += kg
    if (r.vinculado_a_pedido_id) vinculadas += 1
    const c =
      porCliente.get(r.cliente) ?? { cliente: r.cliente, kilos: 0, muestras: 0 }
    c.kilos += kg
    c.muestras += 1
    porCliente.set(r.cliente, c)
  }

  return {
    totalMuestras: rows.length,
    kilosTotales,
    vinculadas,
    vinculadasPct: rows.length > 0 ? (vinculadas / rows.length) * 100 : 0,
    topClientes: [...porCliente.values()]
      .sort((a, b) => b.kilos - a.kilos)
      .slice(0, 10),
  }
}

// ── Merma de teñido por partida (crudo → teñido) ────────────
// Habilitado por la migración 046: ingresos.kilos_crudo_enviado.
// Merma = kg de crudo enviados a teñir − kg teñidos recibidos (suma de
// rollos de la partida). Positivo = se perdió peso en el proceso.

export type MermaPartidaRow = {
  ingreso_id: string
  partida: string
  tintoreria: string
  fecha: string
  crudo: number
  tenido: number
  mermaKg: number
  mermaPct: number
}

export type MermaTintoreriaRow = {
  tintoreria: string
  crudo: number
  tenido: number
  mermaKg: number
  mermaPct: number
}

export type MermaPartidaResult = {
  partidas: MermaPartidaRow[]
  porTintoreria: MermaTintoreriaRow[]
  totalCrudo: number
  totalTenido: number
  totalMermaKg: number
  totalMermaPct: number
}

export async function reporteMermaPartida(
  supabase: SupabaseClient,
  filters: ReportesFilters = {}
): Promise<MermaPartidaResult> {
  const { desde, hasta } = rangoPeriodo(filters)
  const articuloIds = listOrSingle(filters.articuloIds, filters.articuloId)
  const tintoreriaIds = listOrSingle(filters.tintoreriaIds, filters.tintoreriaId)

  let query = supabase
    .from('ingresos')
    .select(
      `id, numero_lote, numero_remito, fecha_despacho, created_at,
       kilos_crudo_enviado, tintoreria_id,
       tintorerias ( nombre ),
       rollos ( kilos )`
    )
    .not('kilos_crudo_enviado', 'is', null)
    .gte('created_at', desde)
    .lt('created_at', hasta)
    .limit(5000)
  if (tintoreriaIds.length > 1) query = query.in('tintoreria_id', tintoreriaIds)
  else if (tintoreriaIds.length === 1)
    query = query.eq('tintoreria_id', tintoreriaIds[0])
  if (articuloIds.length > 1) query = query.in('articulo_id', articuloIds)
  else if (articuloIds.length === 1) query = query.eq('articulo_id', articuloIds[0])

  const { data } = await query

  type Raw = {
    id: string
    numero_lote: string | null
    numero_remito: string | null
    fecha_despacho: string | null
    created_at: string
    kilos_crudo_enviado: number | null
    tintorerias: { nombre: string } | null
    rollos: { kilos: number | null }[] | null
  }
  const rows = (data ?? []) as unknown as Raw[]

  const partidas: MermaPartidaRow[] = rows.map((r) => {
    const crudo = Number(r.kilos_crudo_enviado ?? 0)
    const tenido = (r.rollos ?? []).reduce(
      (s, x) => s + Number(x.kilos ?? 0),
      0
    )
    const mermaKg = crudo - tenido
    return {
      ingreso_id: r.id,
      partida: r.numero_lote
        ? `Partida ${r.numero_lote}`
        : r.numero_remito
          ? `Remito ${r.numero_remito}`
          : r.fecha_despacho ?? r.created_at.slice(0, 10),
      tintoreria: r.tintorerias?.nombre ?? 'Sin tintorería',
      fecha: r.fecha_despacho ?? r.created_at,
      crudo,
      tenido,
      mermaKg,
      mermaPct: crudo > 0 ? (mermaKg / crudo) * 100 : 0,
    }
  })
  partidas.sort((a, b) => b.mermaPct - a.mermaPct)

  const tintMap = new Map<string, { crudo: number; tenido: number }>()
  for (const p of partidas) {
    const acc = tintMap.get(p.tintoreria) ?? { crudo: 0, tenido: 0 }
    acc.crudo += p.crudo
    acc.tenido += p.tenido
    tintMap.set(p.tintoreria, acc)
  }
  const porTintoreria: MermaTintoreriaRow[] = [...tintMap.entries()]
    .map(([tintoreria, v]) => {
      const mermaKg = v.crudo - v.tenido
      return {
        tintoreria,
        crudo: v.crudo,
        tenido: v.tenido,
        mermaKg,
        mermaPct: v.crudo > 0 ? (mermaKg / v.crudo) * 100 : 0,
      }
    })
    .sort((a, b) => b.mermaPct - a.mermaPct)

  const totalCrudo = partidas.reduce((s, p) => s + p.crudo, 0)
  const totalTenido = partidas.reduce((s, p) => s + p.tenido, 0)
  const totalMermaKg = totalCrudo - totalTenido

  return {
    partidas,
    porTintoreria,
    totalCrudo,
    totalTenido,
    totalMermaKg,
    totalMermaPct: totalCrudo > 0 ? (totalMermaKg / totalCrudo) * 100 : 0,
  }
}

// ── Diferencia de gramaje (declarado vs medido) ─────────────

export type GramajeRow = {
  tintoreria: string
  articulo: string
  color: string
  rollos: number
  gramajePlanilla: number
  gramajePropio: number
  difPromedio: number
}

export async function reporteDiferenciaGramaje(
  supabase: SupabaseClient,
  filters: ReportesFilters = {}
): Promise<GramajeRow[]> {
  const { desde, hasta } = rangoPeriodo(filters)
  const articuloIds = listOrSingle(filters.articuloIds, filters.articuloId)
  const tintoreriaIds = listOrSingle(filters.tintoreriaIds, filters.tintoreriaId)

  // Solo rollos donde se midió el gramaje propio (no asumir 0 donde es NULL).
  let query = supabase
    .from('rollos')
    .select(
      `gramaje_planilla, gramaje_propio, articulo_id, color_id,
       articulos ( nombre ),
       ingresos!inner ( tintoreria_id, tintorerias ( nombre ) )`
    )
    .not('gramaje_propio', 'is', null)
    .not('gramaje_planilla', 'is', null)
    .gte('created_at', desde)
    .lt('created_at', hasta)
    .limit(10000)
  if (articuloIds.length > 1) query = query.in('articulo_id', articuloIds)
  else if (articuloIds.length === 1) query = query.eq('articulo_id', articuloIds[0])
  if (tintoreriaIds.length > 1)
    query = query.in('ingresos.tintoreria_id', tintoreriaIds)
  else if (tintoreriaIds.length === 1)
    query = query.eq('ingresos.tintoreria_id', tintoreriaIds[0])

  const [{ data }, colorById] = await Promise.all([
    query,
    colorNameById(supabase),
  ])

  type Raw = {
    gramaje_planilla: number | null
    gramaje_propio: number | null
    color_id: string | null
    articulos: { nombre: string } | null
    ingresos: { tintorerias: { nombre: string } | null } | null
  }
  const rows = (data ?? []) as unknown as Raw[]

  type Agg = {
    tintoreria: string
    articulo: string
    color: string
    rollos: number
    sumaPlanilla: number
    sumaPropio: number
  }
  const map = new Map<string, Agg>()
  for (const r of rows) {
    const tintoreria = r.ingresos?.tintorerias?.nombre ?? 'Sin tintorería'
    const articulo = r.articulos?.nombre ?? '—'
    const color = r.color_id ? colorById.get(r.color_id) ?? '—' : '—'
    const key = `${tintoreria}|||${articulo}|||${color}`
    const acc =
      map.get(key) ??
      { tintoreria, articulo, color, rollos: 0, sumaPlanilla: 0, sumaPropio: 0 }
    acc.rollos += 1
    acc.sumaPlanilla += Number(r.gramaje_planilla ?? 0)
    acc.sumaPropio += Number(r.gramaje_propio ?? 0)
    map.set(key, acc)
  }

  return [...map.values()]
    .map((a) => {
      const gramajePlanilla = a.sumaPlanilla / a.rollos
      const gramajePropio = a.sumaPropio / a.rollos
      return {
        tintoreria: a.tintoreria,
        articulo: a.articulo,
        color: a.color,
        rollos: a.rollos,
        gramajePlanilla,
        gramajePropio,
        difPromedio: gramajePropio - gramajePlanilla,
      }
    })
    .sort((a, b) => Math.abs(b.difPromedio) - Math.abs(a.difPromedio))
}
