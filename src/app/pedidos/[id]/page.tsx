import { notFound } from 'next/navigation'
import BackButton from '@/components/BackButton'
import { createClient } from '@/lib/supabase/server'
import { getUbicacionesActivas } from '@/lib/ubicacionesServer'
import {
  demandaPendientePorPartida,
  keyPartida,
  type DemandaPartidaRow,
} from '@/lib/pedidoDisponibilidad'
import PedidoActions from './PedidoActions'
import AgregarRollosPedido, {
  type PartidaParaAgregar,
} from './AgregarRollosPedido'
import RollosPickeadosTable, {
  type RolloPickeadoRow,
} from './RollosPickeadosTable'
import QuitarPartidaButton from './QuitarPartidaButton'
import DevolucionParcialSection from './DevolucionParcialSection'
import { estadoPedidoBadge } from '@/lib/estadoPedido'
import { estadoPedidoRollo } from '@/lib/devoluciones'

type PedidoPartidaRaw = {
  id: string
  ingreso_id: string
  articulo_id: string
  color_id: string
  rollos_solicitados: number
  articulos: { nombre: string } | null
  ingresos: {
    numero_lote: string | null
    ot: string | null
    tintorerias: { nombre: string } | null
  } | null
  pedido_rollos: { id: string; liberado_at: string | null }[] | null
}

type PedidoRolloRaw = {
  id: string
  pedido_partida_id: string | null
  pickeado_at: string | null
  devuelto_at: string | null
  devuelto_motivo: string | null
  liberado_at: string | null
  rollos: {
    id: string
    numero_pieza: string
    ubicacion: string | null
    kilos: number | null
    metros: number | null
    estado: string
    ingreso_id: string | null
    color_id: string | null
    articulos: { nombre: string } | null
    ingresos: { numero_lote: string | null; ot: string | null } | null
  } | null
}

type RolloDisponibleRaw = {
  id: string
  numero_pieza: string
  ubicacion: string | null
  kilos: number | null
  created_at: string
  articulo_id: string
  color_id: string
  articulos: { id: string; nombre: string } | null
  ingresos: {
    id: string
    numero_lote: string | null
    ot: string | null
    tintoreria_id: string | null
    tintorerias: { id: string; nombre: string } | null
  } | null
}


type GrupoPartidaDisponible = {
  ingresoId: string
  numeroLote: string | null
  ot: string | null
  articuloId: string
  articuloNombre: string
  colorId: string
  colorNombre: string
  tintoreriaNombre: string | null
  rollos: Array<{
    numeroPieza: string
    kilos: number
    createdAt: string
  }>
}

export default async function PedidoDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ creado?: string }>
}) {
  const { id } = await params
  const { creado } = await searchParams
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user!.id)
    .single()
  const role = profile?.role as 'ventas' | 'admin' | 'operario' | undefined

  const { data: pedido } = await supabase
    .from('pedidos')
    .select(
      `
        id,
        numero_pedido,
        cliente,
        numero_remito_externo,
        numero_remito_salida,
        fecha_entrega_comprometida,
        salida_comentario,
        confirmada_egreso_at,
        estado,
        caida_motivo,
        caida_comentario,
        caida_at,
        created_at
      `
    )
    .eq('id', id)
    .single()

  if (!pedido) notFound()

  const [
    { data: partidasRaw },
    { data: prRaw },
    { data: coloresRaw },
    ubicaciones,
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
              ot,
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
            devuelto_at,
            devuelto_motivo,
            liberado_at,
            rollos (
              id,
              numero_pieza,
              ubicacion,
              kilos,
              metros,
              estado,
              ingreso_id,
              color_id,
              articulos ( nombre ),
              ingresos ( numero_lote, ot )
            )
          `
        )
        .eq('pedido_id', id)
        .order('created_at', { ascending: true }),
      supabase.from('colores').select('id, nombre'),
      getUbicacionesActivas(supabase),
    ])

  const colorById = new Map(
    ((coloresRaw ?? []) as { id: string; nombre: string }[]).map((c) => [
      c.id,
      c.nombre,
    ])
  )

  const puedeAgregarRollos =
    (role === 'ventas' || role === 'admin') &&
    ['pendiente', 'en_preparacion', 'lista'].includes(pedido.estado)
  const partidasParaAgregar = puedeAgregarRollos
    ? await cargarPartidasParaAgregar(supabase, colorById)
    : []
  const puedeQuitarRollo =
    (role === 'ventas' || role === 'operario' || role === 'admin') &&
    ['pendiente', 'en_preparacion', 'lista'].includes(pedido.estado)
  const puedeQuitarPartida =
    (role === 'ventas' || role === 'admin') &&
    ['pendiente', 'en_preparacion', 'lista'].includes(pedido.estado)
  const puedeDevolver =
    (role === 'ventas' || role === 'admin' || role === 'operario') &&
    pedido.estado === 'confirmada_egreso'

  const partidas = ((partidasRaw ?? []) as unknown as PedidoPartidaRaw[]).map((p) => ({
    ...p,
    colorNombre: colorById.get(p.color_id) ?? '-',
    asignados: p.pedido_rollos?.filter((pr) => pr.liberado_at == null).length ?? 0,
  }))
  const partidaById = new Map(partidas.map((p) => [p.id, p]))

  const rollos = ((prRaw ?? []) as unknown as PedidoRolloRaw[])
    .filter((r) => r.rollos != null)
    .filter((r) => estadoPedidoRollo(r) !== 'liberado')
    .map((r) => {
      const partidaSolicitada = r.pedido_partida_id
        ? partidaById.get(r.pedido_partida_id)
        : null
      const partidaRealLote = r.rollos!.ingresos?.numero_lote ?? null
      const partidaSolicitadaLote =
        partidaSolicitada?.ingresos?.numero_lote ?? null
      const esSustitucionPartida =
        Boolean(partidaSolicitada?.ingreso_id && r.rollos!.ingreso_id) &&
        partidaSolicitada?.ingreso_id !== r.rollos!.ingreso_id
      return {
        ...r,
        partidaRealLote,
        partidaSolicitadaLote,
        esSustitucionPartida,
        rollos: {
          ...r.rollos!,
          colorNombre: r.rollos!.color_id ? colorById.get(r.rollos!.color_id) ?? '-' : '-',
        },
      }
    })

  const rollosRows: RolloPickeadoRow[] = rollos.map((r) => ({
    pedidoRolloId: r.id,
    pedidoPartidaId: r.pedido_partida_id,
    numeroPieza: r.rollos.numero_pieza,
    articulo: r.rollos.articulos?.nombre ?? null,
    color: r.rollos.colorNombre,
    kilos: r.rollos.kilos,
    ubicacion: r.rollos.ubicacion,
    pickeadoAt: r.pickeado_at,
    devueltoAt: r.devuelto_at,
    devueltoMotivo: r.devuelto_motivo,
    liberadoAt: r.liberado_at,
    ot: r.rollos.ingresos?.ot ?? null,
    partidaRealLote: r.partidaRealLote,
    partidaSolicitadaLote: r.partidaSolicitadaLote,
    esSustitucionPartida: r.esSustitucionPartida,
  }))

  const rollosActivos = rollos.filter(
    (r) => estadoPedidoRollo(r) === 'activo'
  )
  const rollosActivosRows = rollosRows.filter(
    (r) => !r.devueltoAt && !r.liberadoAt
  )
  const totalDevueltos = rollos.filter(
    (r) => estadoPedidoRollo(r) === 'devuelto'
  ).length

  const totalSolicitado = partidas.reduce(
    (acc, p) => acc + Number(p.rollos_solicitados ?? 0),
    0
  )
  const totalReal = rollosActivos.length
  const kilosReales = rollosActivos.reduce(
    (acc, r) => acc + Number(r.rollos?.kilos ?? 0),
    0
  )
  const estado = estadoPedidoBadge(pedido.estado)
  const hoy = new Date()
  hoy.setHours(0, 0, 0, 0)
  const demorado =
    !!pedido.fecha_entrega_comprometida &&
    ['pendiente', 'en_preparacion', 'lista'].includes(pedido.estado) &&
    pedido.fecha_entrega_comprometida < hoy.toISOString().slice(0, 10)

  return (
    <div className="p-4 sm:p-6 max-w-5xl mx-auto space-y-6">
      {creado === '1' && (
        <div className="rounded-lg border bg-success/10 border-success/30 px-4 py-3 text-sm text-foreground">
          Pedido creado correctamente con {totalSolicitado}{' '}
          {totalSolicitado === 1 ? 'rollo solicitado' : 'rollos solicitados'}.
        </div>
      )}

      <div>
        <BackButton href="/pedidos" label="Volver a pedidos" />
        <div className="flex flex-wrap items-center gap-3 mt-1">
          <h1 className="text-xl sm:text-2xl font-bold">
            Pedido {pedido.numero_pedido ?? '-'}
          </h1>
          <span className={`text-xs rounded-full px-2 py-0.5 ${estado.className}`}>
            {estado.text}
          </span>
          {demorado && (
            <span className="text-xs rounded-full px-2 py-0.5 bg-destructive/15 text-destructive">
              Demorado
            </span>
          )}
        </div>
      </div>

      <div className="rounded-lg border bg-white p-4 sm:p-5 shadow-sm grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
        <Field label="Cliente" value={pedido.cliente} />
        <Field
          label="Fecha"
          value={new Date(pedido.created_at).toLocaleDateString('es-AR')}
        />
        <Field
          label="Compromiso"
          value={
            pedido.fecha_entrega_comprometida
              ? new Date(pedido.fecha_entrega_comprometida).toLocaleDateString('es-AR')
              : '-'
          }
        />
        <Field label="Remito externo" value={pedido.numero_remito_externo ?? '-'} />
        <Field label="Remito salida" value={pedido.numero_remito_salida ?? '-'} />
        <Field
          label="Solicitado"
          value={`${totalSolicitado} rollos`}
        />
        <Field
          label="Real pickeado"
          value={
            totalReal > 0
              ? `${totalReal} rollos - ${kilosReales.toFixed(2)} kg`
              : 'Pendiente de picking'
          }
        />
        {totalDevueltos > 0 && (
          <Field label="Devueltos" value={`${totalDevueltos} rollos`} />
        )}
        <Field
          label="Egreso confirmado"
          value={
            pedido.confirmada_egreso_at
              ? new Date(pedido.confirmada_egreso_at).toLocaleString('es-AR')
              : '-'
          }
        />
      </div>

      {pedido.salida_comentario && (
        <Note title="Comentario de egreso" text={pedido.salida_comentario} />
      )}
      {pedido.estado === 'cancelada' && (
        <Note
          title="Cancelacion del pedido"
          text={[
            pedido.caida_motivo ? motivoCaidaLabel(pedido.caida_motivo) : null,
            pedido.caida_comentario,
            pedido.caida_at
              ? `Registrada el ${new Date(pedido.caida_at).toLocaleString('es-AR')}`
              : null,
          ]
            .filter(Boolean)
            .join(' - ')}
        />
      )}

      {role && (
        <PedidoActions
          pedidoId={pedido.id}
          estado={pedido.estado}
          role={role}
          ubicaciones={ubicaciones}
          numeroRemitoExterno={pedido.numero_remito_externo}
        />
      )}

      {puedeAgregarRollos && (
        <AgregarRollosPedido
          pedidoId={pedido.id}
          estado={pedido.estado}
          partidas={partidasParaAgregar}
        />
      )}

      {rollos.some((r) => r.esSustitucionPartida) && (
        <div className="rounded-lg border border-warning/30 bg-warning/10 px-4 py-3 text-sm text-foreground">
          Se pickeó al menos un rollo de una partida distinta a la solicitada,
          manteniendo el mismo artículo y color.
        </div>
      )}

      <section className="rounded-lg border bg-white shadow-sm overflow-hidden">
        <div className="px-4 py-3 border-b bg-zinc-50">
          <h2 className="font-semibold text-sm">
            Partidas solicitadas ({partidas.length})
          </h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm">
            <thead className="border-b text-left">
              <tr>
                <th className="px-4 py-2 font-medium">Partida</th>
                <th className="px-4 py-2 font-medium">OT</th>
                <th className="px-4 py-2 font-medium">Articulo</th>
                <th className="px-4 py-2 font-medium">Color</th>
                <th className="px-4 py-2 font-medium">Tintoreria</th>
                <th className="px-4 py-2 text-right font-medium">Solicitado</th>
                <th className="px-4 py-2 text-right font-medium">Pickeado</th>
                {puedeQuitarPartida && (
                  <th className="px-4 py-2 text-right font-medium"></th>
                )}
              </tr>
            </thead>
            <tbody>
              {partidas.length > 0 ? (
                partidas.map((p) => (
                  <tr key={p.id} className="border-b last:border-0">
                    <td className="px-4 py-2 font-medium">
                      {p.ingresos?.numero_lote ?? '-'}
                    </td>
                    <td className="px-4 py-2 font-mono text-xs">
                      {p.ingresos?.ot ?? '—'}
                    </td>
                    <td className="px-4 py-2">{p.articulos?.nombre ?? '-'}</td>
                    <td className="px-4 py-2">{p.colorNombre}</td>
                    <td className="px-4 py-2 text-muted-foreground">
                      {p.ingresos?.tintorerias?.nombre ?? '-'}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums">
                      {p.rollos_solicitados}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums">
                      {p.asignados}
                    </td>
                    {puedeQuitarPartida && (
                      <td className="px-4 py-2 text-right">
                        <QuitarPartidaButton
                          pedidoId={pedido.id}
                          pedidoPartidaId={p.id}
                          lote={p.ingresos?.numero_lote ?? null}
                          asignados={p.asignados}
                        />
                      </td>
                    )}
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={puedeQuitarPartida ? 8 : 7} className="px-4 py-8 text-center text-sm text-muted-foreground">
                    Sin partidas solicitadas.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-lg border bg-white shadow-sm overflow-hidden">
        <div className="px-4 py-3 border-b bg-zinc-50">
          <h2 className="font-semibold text-sm">
            Rollos del pedido ({rollos.length})
          </h2>
        </div>
        <RollosPickeadosTable
          pedidoId={pedido.id}
          rollos={rollosRows}
          puedeQuitar={puedeQuitarRollo}
        />
      </section>

      {puedeDevolver && (
        <DevolucionParcialSection
          pedidoId={pedido.id}
          rollos={rollosActivosRows}
        />
      )}
    </div>
  )
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="font-medium mt-0.5 truncate">{value}</p>
    </div>
  )
}

function Note({ title, text }: { title: string; text: string }) {
  if (!text) return null
  return (
    <div className="rounded-lg border bg-white p-4 shadow-sm">
      <p className="text-sm font-semibold">{title}</p>
      <p className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground">
        {text}
      </p>
    </div>
  )
}

function motivoCaidaLabel(value: string): string {
  switch (value) {
    case 'cliente_cancelo':
      return 'Cliente cancelo'
    case 'precio':
      return 'Precio'
    case 'otro_proveedor':
      return 'Se fue con otro proveedor'
    case 'sin_respuesta':
      return 'Sin respuesta'
    case 'otro':
      return 'Otro'
    default:
      return value
  }
}

async function cargarPartidasParaAgregar(
  supabase: Awaited<ReturnType<typeof createClient>>,
  colorById: Map<string, string>
): Promise<PartidaParaAgregar[]> {
  const [{ data: rollosRaw }, { data: pendientesRaw }] = await Promise.all([
    supabase
      .from('rollos')
      .select(
        `
          id,
          numero_pieza,
          ubicacion,
          kilos,
          created_at,
          articulo_id,
          color_id,
          articulos ( id, nombre ),
          ingresos!inner (
            id,
            numero_lote,
            ot,
            tintoreria_id,
            tintorerias ( id, nombre )
          )
        `
      )
      .eq('estado', 'en_stock')
      .order('created_at', { ascending: true })
      .order('numero_pieza', { ascending: true })
      .limit(1500),
    supabase
      .from('pedido_partidas')
      .select(
        `
          ingreso_id,
          articulo_id,
          color_id,
          rollos_solicitados,
          pedidos!inner ( estado ),
          pedido_rollos ( id, liberado_at )
        `
      )
      .in('pedidos.estado', ['pendiente', 'en_preparacion', 'lista']),
  ])

  // Demanda pendiente = solicitados − ya pickeados (los pickeados ya salieron de
  // en_stock). Descontar la demanda completa contaría dos veces a los pickeados.
  const reservadosPorPartida = demandaPendientePorPartida(
    (pendientesRaw ?? []) as unknown as DemandaPartidaRow[]
  )

  const grupos = new Map<string, GrupoPartidaDisponible>()
  for (const r of (rollosRaw ?? []) as unknown as RolloDisponibleRaw[]) {
    if (!r.ingresos || !r.articulo_id || !r.color_id) continue
    const key = keyPartida(r.ingresos.id, r.articulo_id, r.color_id)
    const grupo =
      grupos.get(key) ??
      ({
        ingresoId: r.ingresos.id,
        numeroLote: r.ingresos.numero_lote,
        ot: r.ingresos.ot,
        articuloId: r.articulo_id,
        articuloNombre: r.articulos?.nombre ?? 'Articulo',
        colorId: r.color_id,
        colorNombre: colorById.get(r.color_id) ?? 'Color',
        tintoreriaNombre: r.ingresos.tintorerias?.nombre ?? null,
        rollos: [],
      } satisfies GrupoPartidaDisponible)

    grupo.rollos.push({
      numeroPieza: r.numero_pieza,
      kilos: Number(r.kilos ?? 0),
      createdAt: r.created_at,
    })
    grupos.set(key, grupo)
  }

  return Array.from(grupos.values())
    .map((g) => {
      g.rollos.sort((a, b) => {
        const byDate = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
        if (byDate !== 0) return byDate
        return a.numeroPieza.localeCompare(b.numeroPieza, 'es', { numeric: true })
      })
      const key = keyPartida(g.ingresoId, g.articuloId, g.colorId)
      const reservados = reservadosPorPartida.get(key) ?? 0
      const rollosLibres = g.rollos.slice(reservados)
      return {
        key,
        ingresoId: g.ingresoId,
        numeroLote: g.numeroLote,
        ot: g.ot,
        articuloId: g.articuloId,
        articuloNombre: g.articuloNombre,
        colorId: g.colorId,
        colorNombre: g.colorNombre,
        tintoreriaNombre: g.tintoreriaNombre,
        rollosDisponibles: rollosLibres.length,
        kilosDisponibles: rollosLibres.reduce((acc, r) => acc + r.kilos, 0),
      }
    })
    .filter((p) => p.rollosDisponibles > 0)
    .sort((a, b) => {
      const byLote = (a.numeroLote ?? '').localeCompare(b.numeroLote ?? '', 'es', {
        numeric: true,
      })
      if (byLote !== 0) return byLote
      return a.articuloNombre.localeCompare(b.articuloNombre, 'es')
    })
}
