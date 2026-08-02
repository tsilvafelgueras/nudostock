import { Boxes, Search } from 'lucide-react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { getUbicacionesActivas } from '@/lib/ubicacionesServer'
import StockFilters from './StockFilters'
import StockList, { type StockRollo, type StockRole } from './StockList'
import {
  buildReservaBanner,
  buildStockSummary,
  type ReservaResumenRow,
  type StockResumenRow,
} from '@/lib/stockResumen'

const ESTADO_LABEL: Record<string, string> = {
  en_stock: 'En stock',
  segunda: 'Segunda',
  reservado: 'Reservado',
  pendiente: 'Pendiente',
  entregado: 'Entregado',
  baja: 'Baja',
  todos: 'Todos',
}

type SearchParams = {
  q?: string
  articulo?: string
  color?: string
  lote?: string
  ot?: string
  tintoreria?: string
  ubicacion?: string
  estado?: string
  orden?: string
}

export default async function StockPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>
}) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const sp = await searchParams
  const estado = sp.estado || 'en_stock'
  const orden = sp.orden || 'reciente'

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user!.id)
    .single()

  const role = (profile?.role ?? 'ventas') as StockRole

  const [
    { data: articulos },
    { data: empresaTints },
    { data: coloresRaw },
    { data: lotesRaw },
    { data: otsRaw },
    { data: articuloColoresRaw },
    ubicaciones,
    { data: tiposFallaRaw },
  ] = await Promise.all([
    supabase
      .from('articulos')
      .select('id, nombre')
      .eq('activo', true)
      .order('nombre'),
    supabase
      .from('empresa_tintorerias')
      .select('tintorerias ( id, nombre )')
      .eq('activo', true),
    supabase
      .from('colores')
      .select('id, nombre')
      .eq('activo', true)
      .order('nombre'),
    supabase
      .from('ingresos')
      .select('numero_lote')
      .not('numero_lote', 'is', null),
    supabase
      .from('ingresos')
      .select('ot')
      .not('ot', 'is', null),
    supabase.from('articulo_colores').select('articulo_id, color_id'),
    getUbicacionesActivas(supabase),
    supabase
      .from('tipos_falla')
      .select('id, nombre')
      .eq('activo', true)
      .order('orden', { ascending: true })
      .order('nombre', { ascending: true }),
  ])

  type EmpresaTintRow = { tintorerias: { id: string; nombre: string } | null }
  const tintorerias = ((empresaTints ?? []) as unknown as EmpresaTintRow[])
    .map((r) => r.tintorerias)
    .filter((t): t is { id: string; nombre: string } => t != null)
    .sort((a, b) => a.nombre.localeCompare(b.nombre))

  const colores = (coloresRaw ?? []) as { id: string; nombre: string }[]
  const colorById = new Map(colores.map((c) => [c.id, c]))

  // Colores válidos por artículo (pivot articulo_colores). Sirve para que al
  // editar un rollo el selector de color se filtre a las combinaciones que la
  // FK compuesta rollos_articulo_color_fk permite.
  const articuloColores: Record<string, { id: string; nombre: string }[]> = {}
  for (const row of (articuloColoresRaw ?? []) as {
    articulo_id: string
    color_id: string
  }[]) {
    const color = colorById.get(row.color_id)
    if (!color) continue
    ;(articuloColores[row.articulo_id] ??= []).push(color)
  }
  for (const lista of Object.values(articuloColores)) {
    lista.sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'))
  }

  const lotes = Array.from(
    new Set(
      ((lotesRaw ?? []) as { numero_lote: string | null }[])
        .map((r) => r.numero_lote?.trim())
        .filter((c): c is string => Boolean(c))
    )
  ).sort((a, b) => b.localeCompare(a, 'es'))

  const ots = Array.from(
    new Set(
      ((otsRaw ?? []) as { ot: string | null }[])
        .map((r) => r.ot?.trim())
        .filter((c): c is string => Boolean(c))
    )
  ).sort((a, b) => a.localeCompare(b, 'es'))

  let query = supabase
    .from('rollos')
    .select(
      `
        id,
        numero_pieza,
        ubicacion,
        pantone,
        foto_url,
        kilos,
        metros,
        kilos_propios,
        metros_propios,
        ancho_propio,
        gramaje_propio,
        gramaje_planilla,
        estado,
        falla_categoria,
        falla_descripcion,
        created_at,
        auditado_at,
        color_id,
        articulos ( id, nombre ),
        ingresos!inner (
          id,
          fecha_despacho,
          numero_remito,
          numero_lote,
          ot,
          rem_tejeduria,
          referencia,
          tintorerias ( id, nombre )
        )
      `
    )
    .order('created_at', { ascending: false })
    .limit(500)

  if (estado !== 'todos') query = query.eq('estado', estado)
  if (sp.articulo) query = query.eq('articulo_id', sp.articulo)
  if (sp.tintoreria) {
    query = query.eq('ingresos.tintoreria_id', sp.tintoreria)
  }
  if (sp.q) query = query.ilike('numero_pieza', `%${sp.q.trim()}%`)
  if (sp.ubicacion) query = query.eq('ubicacion', sp.ubicacion.trim())
  if (sp.color) query = query.eq('color_id', sp.color)
  if (sp.lote) query = query.eq('ingresos.numero_lote', sp.lote)
  if (sp.ot) query = query.eq('ingresos.ot', sp.ot)

  const { data: rollosRaw, error } = await query
  const rollos = ((rollosRaw ?? []) as unknown as (Omit<
    StockRollo,
    'colores'
  > & {
    color_id: string | null
  })[]).map((r) => ({
    ...r,
    colores: r.color_id ? colorById.get(r.color_id) ?? null : null,
  }))

  // Ordenamiento en cliente del set ya filtrado. El query usa
  // `created_at desc` como base; aquí lo reordenamos según la preferencia
  // del usuario sin volver a pegarle a la base.
  rollos.sort(comparadorPorOrden(orden))

  let stockResumenQuery = supabase
    .from('rollos')
    .select(
      `
        id,
        kilos,
        estado,
        articulo_id,
        color_id,
        ubicacion,
        articulos!inner ( id, nombre ),
        ingresos!inner ( id, numero_lote, tintoreria_id )
      `
    )
    .in('estado', ['en_stock', 'reservado'])

  if (sp.articulo) stockResumenQuery = stockResumenQuery.eq('articulo_id', sp.articulo)
  if (sp.tintoreria) {
    stockResumenQuery = stockResumenQuery.eq('ingresos.tintoreria_id', sp.tintoreria)
  }
  if (sp.q) stockResumenQuery = stockResumenQuery.ilike('numero_pieza', `%${sp.q.trim()}%`)
  if (sp.ubicacion) stockResumenQuery = stockResumenQuery.eq('ubicacion', sp.ubicacion.trim())
  if (sp.color) stockResumenQuery = stockResumenQuery.eq('color_id', sp.color)
  if (sp.lote) stockResumenQuery = stockResumenQuery.eq('ingresos.numero_lote', sp.lote)
  if (sp.ot) stockResumenQuery = stockResumenQuery.eq('ingresos.ot', sp.ot)

  let reservasQuery = supabase
    .from('pedido_partidas')
    .select(
      `
        ingreso_id,
        articulo_id,
        color_id,
        rollos_solicitados,
        pedidos!inner ( estado ),
        articulos!inner ( id, nombre ),
        ingresos!inner ( id, numero_lote, tintoreria_id )
      `
    )
    .in('pedidos.estado', ['pendiente', 'en_preparacion', 'lista'])

  if (sp.articulo) reservasQuery = reservasQuery.eq('articulo_id', sp.articulo)
  if (sp.color) reservasQuery = reservasQuery.eq('color_id', sp.color)
  if (sp.tintoreria) {
    reservasQuery = reservasQuery.eq('ingresos.tintoreria_id', sp.tintoreria)
  }
  if (sp.lote) reservasQuery = reservasQuery.eq('ingresos.numero_lote', sp.lote)

  const [{ data: resumenRaw }, { data: reservasRaw }] = await Promise.all([
    stockResumenQuery,
    sp.q || sp.ubicacion ? Promise.resolve({ data: [] }) : reservasQuery,
  ])

  const resumenRows = (resumenRaw ?? []) as unknown as StockResumenRow[]
  const reservaRows = (reservasRaw ?? []) as unknown as ReservaResumenRow[]

  const totalKilosLibre = resumenRows
    .filter((r) => r.estado === 'en_stock')
    .reduce((acc, r) => acc + Number(r.kilos ?? 0), 0)
  const totalKilosReservado = resumenRows
    .filter((r) => r.estado === 'reservado')
    .reduce((acc, r) => acc + Number(r.kilos ?? 0), 0)

  const aggMap = new Map<
    string,
    { articulo: string; color: string; kilos: number }
  >()
  for (const r of resumenRows) {
    if (r.estado !== 'en_stock') continue
    const articulo = r.articulos?.nombre ?? '-'
    const color = r.color_id ? colorById.get(r.color_id)?.nombre ?? '-' : '-'
    const key = `${articulo}|||${color}`
    const prev = aggMap.get(key) ?? { articulo, color, kilos: 0 }
    prev.kilos += Number(r.kilos ?? 0)
    aggMap.set(key, prev)
  }
  const top5 = [...aggMap.values()]
    .sort((a, b) => b.kilos - a.kilos)
    .slice(0, 5)
  const stockSummary = buildStockSummary(resumenRows, reservaRows, colorById)
  const reservaBanner = buildReservaBanner(stockSummary, sp.lote)

  return (
    <div className="mx-auto max-w-7xl space-y-6 px-4 py-5 sm:px-6 md:py-8">
      <div className="rounded-xl bg-white p-5 shadow-sm ring-1 ring-border sm:p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.08em] text-muted-foreground">
              Inventario
            </p>
            <h1 className="mt-2 text-2xl font-bold sm:text-3xl">Stock</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Rollos disponibles en depósito, reservas y ubicaciones.
            </p>
          </div>
          <div className="flex size-12 items-center justify-center rounded-lg bg-accent text-action">
            <Search className="size-6" />
          </div>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_2fr]">
        <div className="rounded-lg border bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs font-medium uppercase tracking-[0.08em] text-muted-foreground">
              Kg disponibles
            </p>
            <Boxes className="size-4 text-action" />
          </div>
          <p className="mt-2 font-heading text-3xl font-bold tabular-nums">
            {totalKilosLibre.toLocaleString('es-AR', {
              maximumFractionDigits: 2,
            })}{' '}
            kg
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {resumenRows.length} {resumenRows.length === 1 ? 'rollo' : 'rollos'}
            {totalKilosReservado > 0 && (
              <span className="ml-1 text-muted-foreground">
                ·{' '}
                {totalKilosReservado.toLocaleString('es-AR', {
                  maximumFractionDigits: 2,
                })}{' '}
                kg reservados
              </span>
            )}
          </p>
        </div>
        <div className="rounded-lg border bg-white p-4 shadow-sm">
          <p className="text-xs font-medium uppercase tracking-[0.08em] text-muted-foreground">
            Top 5 articulo + color (kilos)
          </p>
          {top5.length > 0 ? (
            <ul className="mt-2 space-y-1.5 text-sm">
              {top5.map((row, i) => (
                <li
                  key={`${row.articulo}-${row.color}-${i}`}
                  className="flex items-center justify-between gap-3"
                >
                  <span className="truncate">
                    <span className="font-medium">{row.articulo}</span>
                    <span className="text-muted-foreground"> - {row.color}</span>
                  </span>
                  <span className="shrink-0 tabular-nums">
                    {row.kilos.toLocaleString('es-AR', {
                      maximumFractionDigits: 2,
                    })}{' '}
                    kg
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-sm text-muted-foreground">
              Sin rollos en stock todavía.
            </p>
          )}
        </div>
      </div>

      <StockFilters
        articulos={articulos ?? []}
        tintorerias={tintorerias ?? []}
        colores={colores}
        lotes={lotes}
        ots={ots}
        ubicaciones={ubicaciones}
        current={{
          q: sp.q ?? '',
          articulo: sp.articulo ?? '',
          color: sp.color ?? '',
          lote: sp.lote ?? '',
          ot: sp.ot ?? '',
          tintoreria: sp.tintoreria ?? '',
          ubicacion: sp.ubicacion ?? '',
          estado,
          orden,
        }}
      />

      {error ? (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
          Error al cargar el stock: {error.message}
        </div>
      ) : (
        <>
          {sp.lote && rollos.length === 0 && estado !== 'todos' && (
            <LoteSinResultadosBanner
              lote={sp.lote}
              estado={estado}
              searchParams={sp}
            />
          )}
          <StockList
            rollos={rollos}
            role={role}
            summary={stockSummary}
            reservaBanner={reservaBanner}
            ubicaciones={ubicaciones}
            articulos={articulos ?? []}
            articuloColores={articuloColores}
            tiposFalla={(tiposFallaRaw ?? []) as { id: string; nombre: string }[]}
          />
        </>
      )}
    </div>
  )
}

function comparadorPorOrden(
  orden: string
): (a: StockRollo, b: StockRollo) => number {
  switch (orden) {
    case 'antiguo':
      return (a, b) =>
        new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
    case 'kilos_desc':
      return (a, b) => Number(b.kilos ?? 0) - Number(a.kilos ?? 0)
    case 'kilos_asc':
      return (a, b) => Number(a.kilos ?? 0) - Number(b.kilos ?? 0)
    case 'articulo_asc':
      return (a, b) =>
        (a.articulos?.nombre ?? '').localeCompare(
          b.articulos?.nombre ?? '',
          'es',
          { sensitivity: 'base' }
        )
    case 'articulo_desc':
      return (a, b) =>
        (b.articulos?.nombre ?? '').localeCompare(
          a.articulos?.nombre ?? '',
          'es',
          { sensitivity: 'base' }
        )
    case 'reciente':
    default:
      return (a, b) =>
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  }
}

function LoteSinResultadosBanner({
  lote,
  estado,
  searchParams,
}: {
  lote: string
  estado: string
  searchParams: SearchParams
}) {
  const params = new URLSearchParams()
  for (const [k, v] of Object.entries(searchParams)) {
    if (v && k !== 'estado') params.set(k, v)
  }
  params.set('estado', 'todos')
  const estadoLabel = ESTADO_LABEL[estado] ?? estado

  return (
    <div className="rounded-lg border border-warning/30 bg-warning/10 px-4 py-3 text-sm text-foreground">
      La partida <span className="font-mono font-medium">{lote} </span>  no tiene
      rollos en estado &ldquo;{estadoLabel}&rdquo;.{' '}
      <Link
        href={`/stock?${params.toString()}`}
        className="underline hover:no-underline font-medium"
      >
        Ver todos los rollos de la partida.
      </Link>
    </div>
  )
}
