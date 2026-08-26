import Link from 'next/link'
import { AlertTriangle } from 'lucide-react'
import { getNotificacionesActivas } from '@/lib/notificaciones'

/**
 * Banner que muestra las notificaciones activas (no resueltas) al tope del
 * dashboard. Server Component — se rerenderea con cada navegación.
 * Si no hay alertas activas, no renderea nada.
 */
export default async function NotificationBanner() {
  const activas = await getNotificacionesActivas()
  if (activas.length === 0) return null

  // Mostrar las primeras 3 inline; el resto via link al historial
  const visibles = activas.slice(0, 3)
  const sobrante = activas.length - visibles.length

  return (
    <div className="rounded-lg border border-warning/30 bg-warning/10 p-4 shadow-sm">
      <div className="flex items-start gap-3">
        <AlertTriangle className="mt-0.5 size-5 shrink-0 text-warning" />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-3">
            <p className="text-sm font-semibold">
              {activas.length === 1
                ? 'Tenés 1 alerta activa'
                : `Tenés ${activas.length} alertas activas`}
            </p>
            <Link
              href="/notificaciones"
              className="shrink-0 text-xs font-medium text-action underline-offset-2 hover:underline"
            >
              Ver todas
            </Link>
          </div>
          <ul className="mt-2 space-y-1">
            {visibles.map((n) => (
              <li key={n.id} className="text-xs text-muted-foreground">
                {n.href ? (
                  <Link href={n.href} className="hover:underline">
                    <span className="font-medium text-foreground">{n.titulo}</span>
                    {' — '}
                    {n.mensaje}
                    {n.actionLabel ? ` ${n.actionLabel} →` : ''}
                  </Link>
                ) : (
                  <>
                    <span className="font-medium text-foreground">{n.titulo}</span>
                    {' — '}
                    {n.mensaje}
                  </>
                )}
              </li>
            ))}
            {sobrante > 0 && (
              <li className="text-xs italic text-muted-foreground">
                + {sobrante} {sobrante === 1 ? 'alerta más' : 'alertas más'}…
              </li>
            )}
          </ul>
        </div>
      </div>
    </div>
  )
}
