import {
  type ReportesFilters,
  type SupabaseClient,
  listOrSingle,
  rangoPeriodo,
} from './_shared'

// ════════════════════════════════════════════════════════════
//  BLOQUE C — Performance de tintorerías
//  "¿Con cuál sigo trabajando?"
// ════════════════════════════════════════════════════════════

// Categorías de falla base (teñido vs tejeduría). Normalizado a Title Case
// para coincidir con los valores almacenados en rollos.falla_categoria desde
// la migración 064 en adelante.
export const FALLAS_TEÑIDO = ['Mancha', 'Color disparejo', 'Tono diferente'] as const
export const FALLAS_TEJEDURIA = ['Agujero', 'Rotura de tejido'] as const
export const FALLA_CATEGORIAS = [
  ...FALLAS_TEÑIDO,
  ...FALLAS_TEJEDURIA,
  'Otro',
] as const
export type FallaCategoria = (typeof FALLA_CATEGORIAS)[number]

export const FALLA_LABEL: Record<FallaCategoria, string> = {
  Mancha: 'Mancha',
  'Color disparejo': 'Color disparejo',
  'Tono diferente': 'Tono diferente',
  Agujero: 'Agujero',
  'Rotura de tejido': 'Rotura de tejido',
  Otro: 'Otro',
}

export type ScorecardRow = {
  tintoreria_id: string | null
  tintoreria: string
  rollosRecibidos: number
  rindePonderado: number | null
  rollosSegunda: number
  tasaFallasPct: number
  rollosMedidos: number
  kilosDeclaradoMedido: number
  kilosPropios: number
  difKg: number | null // declarado - propio (solo sobre rollos medidos)
  difPct: number | null
  tiempoCicloDias: number | null
}

export type FallasTintoreriaRow = {
  tintoreria: string
} & Record<FallaCategoria, number>

export type TintoreriaPerformance = {
  scorecard: ScorecardRow[]
  fallas: FallasTintoreriaRow[]
}

type Agg = {
  tintoreria_id: string | null
  tintoreria: string
  rollosRecibidos: number
  rindeKilosSum: number // Σ(rinde * kilos)
  kilosConRinde: number // Σ kilos donde hay rinde
  rollosSegunda: number
  rollosMedidos: number
  kilosDeclaradoMedido: number
  kilosPropios: number
  cicloSumaMs: number
  cicloN: number
  fallas: Record<FallaCategoria, number>
}

function nuevaFallas(): Record<FallaCategoria, number> {
  return {
    Mancha: 0,
    'Color disparejo': 0,
    'Tono diferente': 0,
    Agujero: 0,
    'Rotura de tejido': 0,
    Otro: 0,
  }
}

export async function reporteTintoreriaPerformance(
  supabase: SupabaseClient,
  filters: ReportesFilters = {}
): Promise<TintoreriaPerformance> {
  const { desde, hasta } = rangoPeriodo(filters)
  const articuloIds = listOrSingle(filters.articuloIds, filters.articuloId)
  const tintoreriaIds = listOrSingle(filters.tintoreriaIds, filters.tintoreriaId)

  // Rollos recibidos en el período (por fecha de alta del rollo, proxy de
  // recepción), con su ingreso/tintorería.
  let query = supabase
    .from('rollos')
    .select(
      `id, rinde, kilos, kilos_propios, estado, falla_categoria, created_at,
       ingresos!inner ( tintoreria_id, fecha_despacho, tintorerias ( id, nombre ) )`
    )
    .gte('created_at', desde)
    .lt('created_at', hasta)
    .limit(10000)
  if (articuloIds.length > 1) query = query.in('articulo_id', articuloIds)
  else if (articuloIds.length === 1) query = query.eq('articulo_id', articuloIds[0])
  if (tintoreriaIds.length > 1)
    query = query.in('ingresos.tintoreria_id', tintoreriaIds)
  else if (tintoreriaIds.length === 1)
    query = query.eq('ingresos.tintoreria_id', tintoreriaIds[0])

  // Primera reserva de cada rollo = menor pedido_rollos.created_at.
  // ⚠ PROXY: usamos la fecha de asignación al pedido como "reserva".
  const [{ data: rollosData }, { data: prData }] = await Promise.all([
    query,
    supabase.from('pedido_rollos').select('rollo_id, created_at').limit(20000),
  ])

  const primeraReserva = new Map<string, number>()
  for (const pr of prData ?? []) {
    const ts = new Date(pr.created_at).getTime()
    const prev = primeraReserva.get(pr.rollo_id)
    if (prev == null || ts < prev) primeraReserva.set(pr.rollo_id, ts)
  }

  type Raw = {
    id: string
    rinde: number | null
    kilos: number | null
    kilos_propios: number | null
    estado: string
    falla_categoria: string | null
    ingresos: {
      tintoreria_id: string | null
      fecha_despacho: string | null
      tintorerias: { id: string; nombre: string } | null
    } | null
  }
  const rollos = (rollosData ?? []) as unknown as Raw[]

  const map = new Map<string, Agg>()
  for (const r of rollos) {
    const ting = r.ingresos?.tintorerias
    const key = ting?.id ?? 'sin'
    const acc =
      map.get(key) ??
      ({
        tintoreria_id: ting?.id ?? null,
        tintoreria: ting?.nombre ?? 'Sin tintorería',
        rollosRecibidos: 0,
        rindeKilosSum: 0,
        kilosConRinde: 0,
        rollosSegunda: 0,
        rollosMedidos: 0,
        kilosDeclaradoMedido: 0,
        kilosPropios: 0,
        cicloSumaMs: 0,
        cicloN: 0,
        fallas: nuevaFallas(),
      } as Agg)

    acc.rollosRecibidos += 1

    const kilos = Number(r.kilos ?? 0)
    if (r.rinde != null && kilos > 0) {
      acc.rindeKilosSum += Number(r.rinde) * kilos
      acc.kilosConRinde += kilos
    }

    if (r.estado === 'segunda') {
      acc.rollosSegunda += 1
      const cat = (r.falla_categoria ?? 'Otro') as FallaCategoria
      if (cat in acc.fallas) acc.fallas[cat] += 1
      else acc.fallas['Otro'] += 1
    }

    // Diferencia declarado vs propio: solo donde hay kilos_propios (no asumir 0).
    if (r.kilos_propios != null) {
      acc.rollosMedidos += 1
      acc.kilosDeclaradoMedido += kilos
      acc.kilosPropios += Number(r.kilos_propios)
    }

    // Tiempo de ciclo: fecha_despacho → primera reserva del rollo.
    const reserva = primeraReserva.get(r.id)
    const fechaDespacho = r.ingresos?.fecha_despacho
    if (reserva != null && fechaDespacho) {
      const despachoMs = new Date(fechaDespacho).getTime()
      if (reserva >= despachoMs) {
        acc.cicloSumaMs += reserva - despachoMs
        acc.cicloN += 1
      }
    }

    map.set(key, acc)
  }

  const scorecard: ScorecardRow[] = []
  const fallas: FallasTintoreriaRow[] = []

  for (const a of map.values()) {
    const difKg =
      a.rollosMedidos > 0 ? a.kilosDeclaradoMedido - a.kilosPropios : null
    scorecard.push({
      tintoreria_id: a.tintoreria_id,
      tintoreria: a.tintoreria,
      rollosRecibidos: a.rollosRecibidos,
      rindePonderado:
        a.kilosConRinde > 0 ? a.rindeKilosSum / a.kilosConRinde : null,
      rollosSegunda: a.rollosSegunda,
      tasaFallasPct:
        a.rollosRecibidos > 0
          ? (a.rollosSegunda / a.rollosRecibidos) * 100
          : 0,
      rollosMedidos: a.rollosMedidos,
      kilosDeclaradoMedido: a.kilosDeclaradoMedido,
      kilosPropios: a.kilosPropios,
      difKg,
      difPct:
        difKg != null && a.kilosDeclaradoMedido > 0
          ? (difKg / a.kilosDeclaradoMedido) * 100
          : null,
      tiempoCicloDias:
        a.cicloN > 0 ? a.cicloSumaMs / a.cicloN / 86_400_000 : null,
    })

    fallas.push({ tintoreria: a.tintoreria, ...a.fallas })
  }

  scorecard.sort((a, b) => b.rollosRecibidos - a.rollosRecibidos)
  // Las fallas siguen el mismo orden que el scorecard.
  const orden = new Map(scorecard.map((s, i) => [s.tintoreria, i]))
  fallas.sort(
    (a, b) => (orden.get(a.tintoreria) ?? 0) - (orden.get(b.tintoreria) ?? 0)
  )

  return { scorecard, fallas }
}
