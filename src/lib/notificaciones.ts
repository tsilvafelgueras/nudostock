import { createClient } from '@/lib/supabase/server'

export type Notificacion = {
  id: string
  tipo:
    | 'stock_minimo'
    | 'solicitud_color'
    | 'ingreso_pendiente'
    | 'pedido_pendiente'
    | 'rollo_liberado'
    | 'rollo_devuelto'
    | 'rollo_eliminado'
  titulo: string
  mensaje: string
  articulo_id: string | null
  color_id: string | null
  rollo_id: string | null
  leida_at: string | null
  resuelta_at: string | null
  created_at: string
  /** Destino contextual calculado al cargar la notificación. */
  href?: string
  /** Texto visible de la acción que permite atender la notificación. */
  actionLabel?: string
  /** false = no se puede descartar: se resuelve al corregir la causa. */
  dismissable?: boolean
}

const NOTIFICACION_SELECT =
  'id, tipo, titulo, mensaje, articulo_id, color_id, rollo_id, leida_at, resuelta_at, created_at'

export function agregarAccionNotificacion(
  notificacion: Notificacion
): Notificacion {
  if (
    notificacion.tipo === 'rollo_liberado' ||
    notificacion.tipo === 'rollo_devuelto'
  ) {
    return {
      ...notificacion,
      href: notificacion.rollo_id
        ? `/stock?rollo=${encodeURIComponent(notificacion.rollo_id)}&accion=ubicacion`
        : '/stock?ubicacion=Sin+ubicar',
      actionLabel: 'Asignar ubicación',
      // Se cierra automáticamente cuando el rollo deja de estar Sin ubicar.
      dismissable: false,
    }
  }

  if (notificacion.tipo === 'stock_minimo' && notificacion.articulo_id) {
    const params = new URLSearchParams({
      articulo: notificacion.articulo_id,
      estado: 'en_stock',
    })
    if (notificacion.color_id) params.set('color', notificacion.color_id)

    return {
      ...notificacion,
      href: `/stock?${params.toString()}`,
      actionLabel: 'Revisar stock',
    }
  }

  return notificacion
}

function agregarAcciones(notificaciones: Notificacion[]): Notificacion[] {
  return notificaciones.map(agregarAccionNotificacion)
}

/**
 * Notificaciones que el badge cuenta: no resueltas + no leídas.
 * Visible para admin + ventas (RLS lo filtra del lado DB).
 */
export async function getNotificacionesNoLeidas(): Promise<Notificacion[]> {
  const supabase = await createClient()
  const { data } = await supabase
    .from('notificaciones')
    .select(NOTIFICACION_SELECT)
    .is('resuelta_at', null)
    .is('leida_at', null)
    // Son tareas de depósito; no ensuciamos la campanita de admin/ventas.
    .not('tipo', 'in', '(rollo_liberado,rollo_devuelto)')
    .order('created_at', { ascending: false })
    .limit(50)
  return agregarAcciones((data ?? []) as Notificacion[])
}

/**
 * Notificaciones activas (no resueltas): incluye leídas y no leídas.
 * Las usamos en el banner de dashboards (siguen apareciendo aunque las hayas
 * abierto, hasta que el stock vuelva a subir).
 */
export async function getNotificacionesActivas(): Promise<Notificacion[]> {
  const supabase = await createClient()
  const { data } = await supabase
    .from('notificaciones')
    .select(NOTIFICACION_SELECT)
    .is('resuelta_at', null)
    .not('tipo', 'in', '(rollo_liberado,rollo_devuelto)')
    .order('created_at', { ascending: false })
  return agregarAcciones((data ?? []) as Notificacion[])
}

/**
 * Notificaciones sintéticas para el operario (no viven en la tabla
 * `notificaciones`): se calculan en cada carga a partir del estado real del
 * depósito y se autoresuelven solas cuando deja de aplicar la condición
 * (por eso son `dismissable: false`). Cubren las dos tareas del operario:
 * confirmar llegadas y preparar pedidos (picking).
 */
export async function getNotificacionesOperario(): Promise<Notificacion[]> {
  const supabase = await createClient()
  const now = new Date().toISOString()
  const notifs: Notificacion[] = []

  const [{ data: rollosPendientes }, { count: pedidosCount }, { data: liberados }] =
    await Promise.all([
      // Ingresos por confirmar = ingresos con al menos un rollo 'pendiente'.
      supabase.from('rollos').select('ingreso_id').eq('estado', 'pendiente'),
      // Pedidos para picking = pendientes o en preparación.
      supabase
        .from('pedidos')
        .select('id', { count: 'exact', head: true })
        .in('estado', ['pendiente', 'en_preparacion']),
      // Rollos liberados o devueltos, pendientes de reubicar. Persisten en la
      // tabla y RLS deja que el operario vea esos dos tipos.
      supabase
        .from('notificaciones')
        .select(NOTIFICACION_SELECT)
        .in('tipo', ['rollo_liberado', 'rollo_devuelto'])
        .is('resuelta_at', null)
        .order('created_at', { ascending: false })
        .limit(50),
    ])

  const ingresosPendientes = new Set(
    ((rollosPendientes ?? []) as { ingreso_id: string }[]).map(
      (r) => r.ingreso_id
    )
  ).size

  if (ingresosPendientes > 0) {
    notifs.push({
      id: 'operario-ingresos-por-confirmar',
      tipo: 'ingreso_pendiente',
      titulo: 'Ingresos por confirmar',
      mensaje: `${ingresosPendientes} ${
        ingresosPendientes === 1
          ? 'ingreso pendiente de confirmar la llegada'
          : 'ingresos pendientes de confirmar la llegada'
      }.`,
      articulo_id: null,
      color_id: null,
      rollo_id: null,
      leida_at: null,
      resuelta_at: null,
      created_at: now,
      href: '/confirmar',
      actionLabel: 'Confirmar ingresos',
      dismissable: false,
    })
  }

  if (pedidosCount && pedidosCount > 0) {
    notifs.push({
      id: 'operario-pedidos-picking',
      tipo: 'pedido_pendiente',
      titulo: 'Pedidos para picking',
      mensaje: `${pedidosCount} ${
        pedidosCount === 1
          ? 'pedido pendiente de preparar'
          : 'pedidos pendientes de preparar'
      }.`,
      articulo_id: null,
      color_id: null,
      rollo_id: null,
      leida_at: null,
      resuelta_at: null,
      created_at: now,
      href: '/picking',
      actionLabel: 'Preparar pedidos',
      dismissable: false,
    })
  }

  // Avisos persistidos de reubicación. Cada uno abre el rollo concreto y se
  // resuelve automáticamente cuando cambia la ubicación.
  for (const n of (liberados ?? []) as Notificacion[]) {
    notifs.unshift(agregarAccionNotificacion(n))
  }

  return notifs
}

export async function getNotificacionSolicitudesColor(): Promise<Notificacion | null> {
  const supabase = await createClient()
  const { count } = await supabase
    .from('solicitudes_color')
    .select('id', { count: 'exact', head: true })
    .eq('estado', 'pendiente')

  if (!count) return null

  return {
    id: 'solicitudes-color-pendientes',
    tipo: 'solicitud_color',
    titulo: 'Verificar colores',
    mensaje: `${count} ${
      count === 1
        ? 'color pendiente de verificación'
        : 'colores pendientes de verificación'
    }. Revisalos para aprobarlos o rechazarlos.`,
    articulo_id: null,
    color_id: null,
    rollo_id: null,
    leida_at: null,
    resuelta_at: null,
    created_at: new Date().toISOString(),
    href: '/admin/colores',
    actionLabel: 'Revisar colores',
    dismissable: false,
  }
}

export async function getNotificacionesHistorial(): Promise<Notificacion[]> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  const { data: profile } = user
    ? await supabase.from('profiles').select('role').eq('id', user.id).single()
    : { data: null }

  let query = supabase
    .from('notificaciones')
    .select(NOTIFICACION_SELECT)
    .order('created_at', { ascending: false })
    .limit(200)

  // Ventas no puede mover rollos. Estos avisos quedan en el centro del
  // operario y, como respaldo, del administrador.
  if (profile?.role === 'ventas') {
    query = query.not('tipo', 'in', '(rollo_liberado,rollo_devuelto)')
  }

  const { data } = await query
  return agregarAcciones((data ?? []) as Notificacion[])
}

export async function getNotificacionesCentro(): Promise<{
  activas: Notificacion[]
  resueltas: Notificacion[]
}> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  const { data: profile } = user
    ? await supabase.from('profiles').select('role').eq('id', user.id).single()
    : { data: null }

  const todas = await getNotificacionesHistorial()
  const activasPersistidas = todas.filter((n) => n.resuelta_at == null)
  const resueltas = todas.filter((n) => n.resuelta_at != null)
  let activasSinteticas: Notificacion[] = []

  if (profile?.role === 'operario') {
    activasSinteticas = await getNotificacionesOperario()
  } else if (profile?.role === 'admin') {
    const solicitudesColor = await getNotificacionSolicitudesColor()
    if (solicitudesColor) activasSinteticas = [solicitudesColor]
  }

  const idsSinteticas = new Set(activasSinteticas.map((n) => n.id))
  const activas = [
    ...activasSinteticas,
    ...activasPersistidas.filter((n) => !idsSinteticas.has(n.id)),
  ]

  return { activas, resueltas }
}
