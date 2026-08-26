import AppShellClient from './AppShellClient'
import {
  getNotificacionesNoLeidas,
  getNotificacionSolicitudesColor,
  getNotificacionesOperario,
  type Notificacion,
} from '@/lib/notificaciones'

type Role = 'operario' | 'ventas' | 'admin' | 'super'

/**
 * Server Component wrapper. Carga las notificaciones para la campanita y se
 * las pasa al AppShellClient (que tiene el state de drawer + sidebar
 * colapsable). Admin/ventas ven las notificaciones de la tabla; el operario
 * ve avisos sintéticos de sus tareas (ingresos por confirmar y pedidos para
 * picking). El super no ve campanita, así que evitamos la query en su caso.
 */
export default async function AppShell({
  role,
  userName,
  empresaNombre,
  children,
}: {
  role: Role
  userName: string
  empresaNombre: string | null
  children: React.ReactNode
}) {
  const notificaciones: Notificacion[] =
    role === 'admin' || role === 'ventas'
      ? await getNotificacionesNoLeidas()
      : role === 'operario'
        ? await getNotificacionesOperario()
        : []

  // El admin además ve una notificación de "verificar colores" mientras haya
  // solicitudes de color pendientes. Es sintética (no vive en la tabla): se
  // autoresuelve cuando el admin las aprueba/rechaza, y linkea a /admin/colores.
  if (role === 'admin') {
    const solicitudesColor = await getNotificacionSolicitudesColor()
    if (solicitudesColor) notificaciones.unshift(solicitudesColor)
  }

  return (
    <AppShellClient
      role={role}
      userName={userName}
      empresaNombre={empresaNombre}
      notificaciones={notificaciones}
    >
      {children}
    </AppShellClient>
  )
}
