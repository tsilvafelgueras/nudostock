'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import Link from 'next/link'
import { Bell, Check, CheckCheck } from 'lucide-react'
import { toast } from 'sonner'
import {
  marcarLeida,
  marcarTodasLeidas,
} from '@/app/notificaciones/actions'
import type { Notificacion } from '@/lib/notificaciones'

export default function NotificationBell({
  notificaciones,
}: {
  notificaciones: Notificacion[]
}) {
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState<Notificacion[]>(notificaciones)
  const [prevNotificaciones, setPrevNotificaciones] = useState(notificaciones)
  const [pending, startTransition] = useTransition()
  const panelRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)

  // Sync prop → state without an effect (React render-time update pattern).
  // When the parent re-validates and passes a fresh list, reset items to match.
  if (prevNotificaciones !== notificaciones) {
    setPrevNotificaciones(notificaciones)
    setItems(notificaciones)
  }

  useEffect(() => {
    if (!open) return
    function handleClickOutside(e: MouseEvent) {
      const target = e.target as Node
      if (
        panelRef.current?.contains(target) ||
        buttonRef.current?.contains(target)
      ) {
        return
      }
      setOpen(false)
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', handleClickOutside)
    document.addEventListener('keydown', handleKey)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleKey)
    }
  }, [open])

  const count = items.length

  function handleMarcarUna(id: string) {
    startTransition(async () => {
      const res = await marcarLeida(id)
      if (!res.ok) {
        toast.error(res.error)
        return
      }
      setItems((prev) => prev.filter((n) => n.id !== id))
    })
  }

  function handleMarcarTodas() {
    if (count === 0) return
    startTransition(async () => {
      const res = await marcarTodasLeidas()
      if (!res.ok) {
        toast.error(res.error)
        return
      }
      // Las sintéticas (no descartables) siguen visibles: se resuelven solas
      // cuando deja de aplicar la condición (ej. ya no hay colores pendientes).
      setItems((prev) => prev.filter((n) => n.dismissable === false))
      toast.success('Notificaciones marcadas como leídas.')
    })
  }

  return (
    <div className="relative">
      <button
        ref={buttonRef}
        type="button"
        data-no-ripple
        onClick={() => setOpen((v) => !v)}
        className="relative flex size-10 items-center justify-center rounded-md text-white/85 transition-colors hover:bg-white/10 hover:text-white"
        aria-label={`Notificaciones${count > 0 ? ` (${count} sin leer)` : ''}`}
        aria-expanded={open}
      >
        <Bell className="size-5" />
        {count > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex min-w-[1.1rem] items-center justify-center rounded-full bg-warning px-1 text-[10px] font-bold leading-tight text-warning-foreground">
            {count > 9 ? '9+' : count}
          </span>
        )}
      </button>

      {open && (
        <div
          ref={panelRef}
          className="
            z-50 overflow-hidden rounded-lg border bg-white text-foreground shadow-xl
            fixed inset-x-3 top-[calc(var(--topbar-height,4rem)+0.5rem)]
            md:absolute md:inset-x-auto md:right-0 md:top-full md:mt-2 md:w-[22rem] md:max-w-[90vw]
          "
          role="dialog"
          aria-label="Notificaciones"
        >
          <div className="flex items-center justify-between border-b px-4 py-3">
            <p className="font-heading text-sm font-semibold">Notificaciones</p>
            {count > 0 && (
              <button
                type="button"
                onClick={handleMarcarTodas}
                disabled={pending}
                className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-action transition-colors hover:bg-action/10 disabled:opacity-50"
              >
                <CheckCheck className="size-3.5" />
                Marcar todas
              </button>
            )}
          </div>

          <div className="max-h-[60vh] overflow-y-auto">
            {items.length === 0 ? (
              <div className="px-4 py-8 text-center">
                <p className="text-sm text-muted-foreground">
                  No tenés notificaciones sin leer.
                </p>
              </div>
            ) : (
              <ul className="divide-y">
                {items.map((n) => {
                  const cuerpo = (
                    <>
                      <p className="text-sm font-medium leading-snug">{n.titulo}</p>
                      <p className="mt-0.5 text-xs leading-snug text-muted-foreground">
                        {n.mensaje}
                      </p>
                      <p className="mt-1 text-[10px] uppercase tracking-wide text-muted-foreground">
                        {new Date(n.created_at).toLocaleString('es-AR', {
                          dateStyle: 'short',
                          timeStyle: 'short',
                        })}
                      </p>
                      {n.href && n.actionLabel && (
                        <p className="mt-2 text-xs font-semibold text-action">
                          {n.actionLabel} &rarr;
                        </p>
                      )}
                    </>
                  )
                  return (
                    <li key={n.id} className="group flex items-start gap-3 px-4 py-3 hover:bg-zinc-50">
                      <span className="mt-1 flex size-7 shrink-0 items-center justify-center rounded-full bg-warning/15 text-warning">
                        <Bell className="size-3.5" />
                      </span>
                      {n.href ? (
                        <Link
                          href={n.href}
                          onClick={() => setOpen(false)}
                          className="min-w-0 flex-1"
                        >
                          {cuerpo}
                        </Link>
                      ) : (
                        <div className="min-w-0 flex-1">{cuerpo}</div>
                      )}
                      {n.dismissable !== false && (
                        <button
                          type="button"
                          onClick={() => handleMarcarUna(n.id)}
                          disabled={pending}
                          className="rounded-md p-1 text-muted-foreground opacity-0 transition-opacity hover:bg-action/10 hover:text-action group-hover:opacity-100 focus-visible:opacity-100 disabled:opacity-50"
                          aria-label="Marcar como leída"
                          title="Marcar como leída"
                        >
                          <Check className="size-4" />
                        </button>
                      )}
                    </li>
                  )
                })}
              </ul>
            )}
          </div>

          <div className="border-t bg-zinc-50 px-4 py-2">
            <Link
              href="/notificaciones"
              onClick={() => setOpen(false)}
              className="text-xs font-medium text-action transition-colors hover:underline"
            >
              Ver historial completo →
            </Link>
          </div>
        </div>
      )}
    </div>
  )
}
