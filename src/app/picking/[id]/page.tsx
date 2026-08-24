import { createClient } from '@/lib/supabase/server'
import BackButton from '@/components/BackButton'
import { notFound } from 'next/navigation'
import PickingScanner, {
  type PickPartida,
  type PickRollo,
} from './PickingScanner'
import ConfirmarEgresoCard from './ConfirmarEgresoCard'
import { estadoPedidoBadge, ESTADO_PEDIDO_LABEL } from '@/lib/estadoPedido'
import {
  buildUbicacionesSugeridas,
  type StockOrientacionRaw,
} from '@/lib/picking'

type PedidoPartidaRaw = {
  id: string
  ingreso_id: string
  articulo_id: string
  color_id: string
  rollos_solicitados: number
  articulos: { nombre: string } | null
  ingresos: {
    numero_lote: string | null
    tintoreria_id: string | null
    tintorerias: { nombre: string } | null
  } | null
  pedido_rollos: { id: string; liberado_at: string | null }[] | null
}

type PedidoRolloRaw = {
  id: string
  pedido_partida_id: string | null
  pickeado_at: string | null
  rollos: {
    id: string
    numero_pieza: string
    ubicacion: string | null
    kilos: number | null
    ingreso_id: string | null
    articulo_id: string | null
    color_id: string | null
    articulos: { nombre: string } | null
    ingresos: { numero_lote: string | null; ot: string | null } | null
  } | null
}

export default async function PickingDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const supabase = await createClient()

  const { data: pedido } = await supabase
    .from('pedidos')
    .select('id, numero_pedido, cliente, estado, created_at, numero_remito_salida')
    .eq('id', id)
    .single()

  if (!pedido) notFound()

  const [
    { data: partidasRaw },
    { data: prRaw },
    { data: coloresRaw },
    { data: orientacionRaw },
  ] =
    await Promise.all([
      supabase
        .from('pedido_partidas')
        .select(
          `
            id,
            ingreso_id,
            articulo_id,
            color_id,
            rollos_solicitados,
            articulos ( nombre ),
            ingresos (
              numero_lote,
              tintoreria_id,
              tintorerias ( nombre )
            ),
            pedido_rollos ( id, liberado_at )
          `
        )
        .eq('pedido_id', id),
      supabase
        .from('pedido_rollos')
        .select(
          `
            id,
            pedido_partida_id,
            pickeado_at,
            rollos (
              id,
              numero_pieza,
              ubicacion,
              kilos,
              ingreso_id,
              articulo_id,
              color_id,
              articulos ( nombre ),
              ingresos ( numero_lote, ot )
            )
          `
        )
        .eq('pedido_id', id)
        .is('liberado_at', null),
      supabase.from('colores').select('id, nombre'),
      supabase
        .from('rollos')
        .select(
          `
            ingreso_id,
            articulo_id,
            color_id,
            ubicacion,
            ingresos ( numero_lote )
          `
        )
        .eq('estado', 'en_stock')
        .limit(1500),
    ])

  const colorById = new Map(
    ((coloresRaw ?? []) as { id: string; nombre: string }[]).map((c) => [
      c.id,
      c.nombre,
    ])
  )

  const orientacionRows = (orientacionRaw ?? []) as unknown as StockOrientacionRaw[]

  const partidas: PickPartida[] = ((partidasRaw ?? []) as unknown as PedidoPartidaRaw[])
    .map((p) => {
      const sugeridas = buildUbicacionesSugeridas(p, orientacionRows)
      return {
        id: p.id,
        numeroLote: p.ingresos?.numero_lote ?? null,
        ingresoId: p.ingreso_id,
        articuloId: p.articulo_id,
        colorId: p.color_id,
        articulo: p.articulos?.nombre ?? 'Articulo',
        color: colorById.get(p.color_id) ?? 'Color',
        tintoreria: p.ingresos?.tintorerias?.nombre ?? null,
        rollosSolicitados: Number(p.rollos_solicitados ?? 0),
        rollosAsignados:
          p.pedido_rollos?.filter((pr) => pr.liberado_at == null).length ?? 0,
        ubicacionesSugeridas: sugeridas.ubicaciones,
        reemplazosSugeridos: sugeridas.reemplazos,
      }
    })
    .sort((a, b) => {
      const byLote = (a.numeroLote ?? '').localeCompare(b.numeroLote ?? '', 'es', {
        numeric: true,
      })
      if (byLote !== 0) return byLote
      return a.articulo.localeCompare(b.articulo, 'es')
    })

  const partidaById = new Map(
    ((partidasRaw ?? []) as unknown as PedidoPartidaRaw[]).map((p) => [p.id, p])
  )

  const items: PickRollo[] = ((prRaw ?? []) as unknown as PedidoRolloRaw[])
    .filter((r) => r.rollos != null)
    .map((r) => {
      const partida = r.pedido_partida_id
        ? partidaById.get(r.pedido_partida_id)
        : null
      const partidaRealLote = r.rollos!.ingresos?.numero_lote ?? null
      const partidaSolicitadaLote = partida?.ingresos?.numero_lote ?? null
      return {
        pedido_rollo_id: r.id,
        pedido_partida_id: r.pedido_partida_id,
        pickeado_at: r.pickeado_at,
        rollo_id: r.rollos!.id,
        numero_pieza: r.rollos!.numero_pieza,
        ubicacion: r.rollos!.ubicacion,
        kilos: r.rollos!.kilos,
        articulo_id: r.rollos!.articulo_id,
        color_id: r.rollos!.color_id,
        articulo: r.rollos!.articulos?.nombre ?? null,
        color: r.rollos!.color_id ? colorById.get(r.rollos!.color_id) ?? null : null,
        ot: r.rollos!.ingresos?.ot ?? null,
        partidaRealLote,
        partidaSolicitadaLote,
        esSustitucionPartida:
          Boolean(partida?.ingreso_id && r.rollos!.ingreso_id) &&
          partida?.ingreso_id !== r.rollos!.ingreso_id,
      }
    })

  const tintoreriaIds = Array.from(
    new Set(
      ((partidasRaw ?? []) as unknown as PedidoPartidaRaw[])
        .map((p) => p.ingresos?.tintoreria_id)
        .filter((v): v is string => Boolean(v))
    )
  )

  const patronesQuery = supabase
    .from('tintoreria_codigo_patrones')
    .select('pattern, capture_group, prioridad')
    .eq('activo', true)
    .order('prioridad', { ascending: true })

  const { data: patronesData } =
    tintoreriaIds.length > 0
      ? await patronesQuery.or(
          `tintoreria_id.in.(${tintoreriaIds.join(',')}),tintoreria_id.is.null`
        )
      : await patronesQuery.is('tintoreria_id', null)

  let readerType: 'qr' | 'barcode' | null = null
  if (tintoreriaIds.length > 0) {
    const { data: tintsData } = await supabase
      .from('tintorerias')
      .select('reader_type')
      .in('id', tintoreriaIds)
    const tipos = new Set(
      (tintsData ?? []).map((t) => t.reader_type as 'qr' | 'barcode' | null)
    )
    if (tipos.size === 1) {
      const [unico] = Array.from(tipos)
      readerType = unico ?? null
    }
  }

  const estado = estadoPedidoBadge(pedido.estado)
  const totalSolicitado = partidas.reduce((acc, p) => acc + p.rollosSolicitados, 0)
  const totalPickeado = items.length
  const kilosReales = items.reduce((acc, r) => acc + Number(r.kilos ?? 0), 0)

  const pickeable = pedido.estado === 'pendiente' || pedido.estado === 'en_preparacion'
  const listo = pedido.estado === 'lista'

  return (
    <div className="p-4 sm:p-6 max-w-2xl mx-auto space-y-4">
      <div>
        <BackButton href="/picking" label="Volver a picking" />
        <div className="flex flex-wrap items-center gap-3 mt-1">
          <h1 className="text-xl sm:text-2xl font-bold">
            Picking - {pedido.cliente}
          </h1>
          <span className={`text-xs rounded-full px-2 py-0.5 ${estado.className}`}>
            {estado.text}
          </span>
        </div>
        <p className="text-sm text-muted-foreground mt-1">
          {totalPickeado}/{totalSolicitado} rollos - {kilosReales.toFixed(2)} kg reales
        </p>
        <p className="text-xs text-muted-foreground mt-0.5">
          Pedido {pedido.numero_pedido ?? '-'} - el peso final sale de los rollos escaneados
        </p>
      </div>

      {pickeable || listo ? (
        <>
          <PickingScanner
            pedidoId={id}
            pedidoEstado={pedido.estado}
            partidas={partidas}
            items={items}
            alternativas={[]}
            patrones={patronesData ?? []}
            readerType={readerType}
          />
          {listo && <ConfirmarEgresoCard pedidoId={id} />}
        </>
      ) : (
        <>
          <ResumenPedidoPicking partidas={partidas} items={items} />
          <div className="rounded-lg border bg-success/10 border-success/30 p-5 text-center space-y-2">
            <p className="font-semibold text-success">
              {ESTADO_PEDIDO_LABEL[pedido.estado]?.text ?? pedido.estado}
            </p>
            <p className="text-sm text-muted-foreground">
              Este pedido ya no esta en etapa de picking.
            </p>
          </div>
        </>
      )}
    </div>
  )
}

function ResumenPedidoPicking({
  partidas,
  items,
}: {
  partidas: PickPartida[]
  items: PickRollo[]
}) {
  return (
    <div className="space-y-3">
      <section className="rounded-lg border bg-white p-4 shadow-sm">
        <h2 className="text-sm font-semibold">Resumen del pedido</h2>
        <ul className="mt-3 space-y-2 text-sm">
          {partidas.map((p) => {
            const faltan = Math.max(0, p.rollosSolicitados - p.rollosAsignados)
            const kilosPartida = items
              .filter((r) => r.pedido_partida_id === p.id)
              .reduce((acc, r) => acc + Number(r.kilos ?? 0), 0)
            return (
              <li key={p.id} className="rounded-md border bg-zinc-50 px-3 py-2">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="font-medium">
                      {p.articulo} - {p.color}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Partida {p.numeroLote ?? 'sin numero'}
                      {p.tintoreria ? ` - ${p.tintoreria}` : ''}
                    </p>
                  </div>
                  <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs">
                    {p.rollosAsignados}/{p.rollosSolicitados}
                  </span>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {faltan === 0 ? 'Completa' : `Faltan ${faltan} rollos`}
                  {kilosPartida > 0 && (
                    <span className="ml-1">· {kilosPartida.toFixed(2)} kg</span>
                  )}
                </p>
              </li>
            )
          })}
        </ul>
      </section>

      <section className="rounded-lg border bg-white p-4 shadow-sm">
        <h2 className="text-sm font-semibold">Rollos seleccionados</h2>
        {items.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">
            Todavia no hay rollos pickeados.
          </p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b text-left text-muted-foreground">
                <tr>
                  <th className="py-2 pr-3 font-medium">Pieza</th>
                  <th className="py-2 pr-3 font-medium">Articulo</th>
                  <th className="py-2 pr-3 font-medium">Partida</th>
                  <th className="py-2 pr-3 font-medium">OT</th>
                  <th className="py-2 pr-3 font-medium">Ubic.</th>
                  <th className="py-2 text-right font-medium">Kg</th>
                </tr>
              </thead>
              <tbody>
                {items.map((r) => (
                  <tr key={r.pedido_rollo_id} className="border-b last:border-0">
                    <td className="py-2 pr-3 font-mono font-medium">
                      {r.numero_pieza}
                    </td>
                    <td className="py-2 pr-3">
                      {r.articulo ?? '-'} - {r.color ?? '-'}
                    </td>
                    <td className="py-2 pr-3 text-xs">
                      <span className={r.esSustitucionPartida ? 'text-warning' : ''}>
                        {r.partidaRealLote ?? '-'}
                      </span>
                      {r.esSustitucionPartida && (
                        <span className="block text-[11px] text-muted-foreground">
                          Solicitada: {r.partidaSolicitadaLote ?? '-'}
                        </span>
                      )}
                    </td>
                    <td className="py-2 pr-3 text-xs">{r.ot ?? '-'}</td>
                    <td className="py-2 pr-3">{r.ubicacion ?? '-'}</td>
                    <td className="py-2 text-right tabular-nums">
                      {r.kilos != null ? Number(r.kilos).toFixed(2) : '-'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}
