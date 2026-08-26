import Link from 'next/link'
import { ArrowRight, Bell, CheckCircle2 } from 'lucide-react'
import DashboardBackButton from '@/components/DashboardBackButton'
import {
  getNotificacionesCentro,
  type Notificacion,
} from '@/lib/notificaciones'
import MarcarTodasButton from './MarcarTodasButton'

export const dynamic = 'force-dynamic'

export default async function NotificacionesPage() {
  const { activas, resueltas } = await getNotificacionesCentro()
  const hayNoLeidasActivas = activas.some(
    (n) => n.dismissable !== false && n.leida_at == null
  )

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6 p-4 sm:p-6">
      <div>
        <DashboardBackButton />
        <div className="mt-1 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-xl sm:text-2xl font-bold">Notificaciones</h1>
            <p className="text-sm text-muted-foreground">
              Alertas automáticas del sistema. Las activas son las que
              necesitan acción.
            </p>
          </div>
          {hayNoLeidasActivas && <MarcarTodasButton />}
        </div>
      </div>

      <Section
        titulo="Activas"
        descripcion="Estas alertas siguen vigentes. Desaparecen automáticamente cuando se resuelve la causa (ej: el stock vuelve sobre el mínimo)."
        items={activas}
        icon={Bell}
        tone="warning"
        vacio="No hay alertas activas. Todo en orden."
      />

      <Section
        titulo="Resueltas"
        descripcion="Alertas que ya se resolvieron solas. Quedan acá como historial."
        items={resueltas}
        icon={CheckCircle2}
        tone="success"
        vacio="Todavía no se resolvió ninguna alerta."
        muted
      />
    </div>
  )
}

function Section({
  titulo,
  descripcion,
  items,
  icon: Icon,
  tone,
  vacio,
  muted,
}: {
  titulo: string
  descripcion: string
  items: Notificacion[]
  icon: typeof Bell
  tone: 'warning' | 'success'
  vacio: string
  muted?: boolean
}) {
  const iconBg =
    tone === 'warning'
      ? 'bg-warning/15 text-warning'
      : 'bg-success/15 text-success'

  return (
    <section className="space-y-2">
      <div>
        <h2 className="font-heading text-base font-semibold">
          {titulo}{' '}
          <span className="ml-1 text-sm font-normal text-muted-foreground">
            ({items.length})
          </span>
        </h2>
        <p className="text-xs text-muted-foreground">{descripcion}</p>
      </div>

      {items.length === 0 ? (
        <div className="rounded-lg border bg-white p-6 text-center text-sm text-muted-foreground shadow-sm">
          {vacio}
        </div>
      ) : (
        <ul
          className={`divide-y rounded-lg border bg-white shadow-sm ${muted ? 'opacity-80' : ''}`}
        >
          {items.map((n) => (
            <li key={n.id} className="flex items-start gap-3 p-4">
              <span
                className={`mt-1 flex size-8 shrink-0 items-center justify-center rounded-full ${iconBg}`}
              >
                <Icon className="size-4" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium leading-snug">{n.titulo}</p>
                <p className="mt-0.5 text-xs leading-snug text-muted-foreground">
                  {n.mensaje}
                </p>
                <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                  <span>
                    Creada{' '}
                    {new Date(n.created_at).toLocaleString('es-AR', {
                      dateStyle: 'short',
                      timeStyle: 'short',
                    })}
                  </span>
                  {n.resuelta_at && (
                    <span>
                      · Resuelta{' '}
                      {new Date(n.resuelta_at).toLocaleString('es-AR', {
                        dateStyle: 'short',
                        timeStyle: 'short',
                      })}
                    </span>
                  )}
                  {n.leida_at && !n.resuelta_at && (
                    <span className="text-success">· Leída</span>
                  )}
                </div>
                {!muted && n.href && n.actionLabel && (
                  <Link
                    href={n.href}
                    className="mt-3 inline-flex items-center gap-1.5 rounded-md bg-action px-3 py-2 text-xs font-semibold text-action-foreground transition-colors hover:bg-action/90"
                  >
                    {n.actionLabel}
                    <ArrowRight className="size-3.5" />
                  </Link>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
