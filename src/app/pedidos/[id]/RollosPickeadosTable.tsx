'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { liberarRolloDePedido } from '../actions'

export type RolloPickeadoRow = {
  pedidoRolloId: string
  pedidoPartidaId: string | null
  numeroPieza: string
  articulo: string | null
  color: string
  kilos: number | null
  ubicacion: string | null
  pickeadoAt: string | null
  devueltoAt: string | null
  devueltoMotivo: string | null
  liberadoAt: string | null
  ot: string | null
  partidaRealLote: string | null
  partidaSolicitadaLote: string | null
  esSustitucionPartida: boolean
}

export default function RollosPickeadosTable({
  pedidoId,
  rollos,
  puedeQuitar,
}: {
  pedidoId: string
  rollos: RolloPickeadoRow[]
  puedeQuitar: boolean
}) {
  const router = useRouter()
  const [itemsLocales, setItemsLocales] = useState(rollos)
  const [quitarTarget, setQuitarTarget] = useState<RolloPickeadoRow | null>(null)
  const [quitando, setQuitando] = useState(false)

  async function ejecutarQuitar() {
    if (!quitarTarget) return

    setQuitando(true)
    const res = await liberarRolloDePedido({
      pedidoId,
      pedidoRolloId: quitarTarget.pedidoRolloId,
    })
    setQuitando(false)

    if (!res.ok) {
      toast.error(res.error)
      return
    }

    setItemsLocales((prev) =>
      prev.filter((item) => item.pedidoRolloId !== quitarTarget.pedidoRolloId)
    )
    toast.success(`Rollo ${quitarTarget.numeroPieza} quitado del pedido.`)
    setQuitarTarget(null)
    router.refresh()
  }

  const colSpan = puedeQuitar ? 9 : 8

  return (
    <>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] text-sm">
          <thead className="border-b text-left">
            <tr>
              <th className="px-4 py-2 font-medium">Pieza</th>
              <th className="px-4 py-2 font-medium">Articulo</th>
              <th className="px-4 py-2 font-medium">Color</th>
              <th className="px-4 py-2 font-medium">Kilos</th>
              <th className="px-4 py-2 font-medium">Partida real</th>
              <th className="px-4 py-2 font-medium">OT</th>
              <th className="px-4 py-2 font-medium">Ubicacion</th>
              <th className="px-4 py-2 font-medium">Estado</th>
              {puedeQuitar && <th className="px-4 py-2 text-right font-medium"></th>}
            </tr>
          </thead>
          <tbody>
            {itemsLocales.length > 0 ? (
              itemsLocales.map((r) => (
                <tr
                  key={r.pedidoRolloId}
                  className={`border-b last:border-0 ${
                    r.devueltoAt ? 'bg-zinc-50/80' : ''
                  }`}
                >
                  <td className="px-4 py-2 font-medium">{r.numeroPieza}</td>
                  <td className="px-4 py-2">{r.articulo ?? '-'}</td>
                  <td className="px-4 py-2">{r.color}</td>
                  <td className="px-4 py-2 tabular-nums">
                    {r.kilos != null ? Number(r.kilos).toFixed(2) : '-'}
                  </td>
                  <td className="px-4 py-2 text-xs">
                    <span className={r.esSustitucionPartida ? 'text-warning' : ''}>
                      {r.partidaRealLote ?? '-'}
                    </span>
                    {r.esSustitucionPartida && (
                      <span className="block text-[11px] text-muted-foreground">
                        Solicitada: {r.partidaSolicitadaLote ?? '-'}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2 font-mono text-xs">
                    {r.ot ?? '—'}
                  </td>
                  <td className="px-4 py-2 text-muted-foreground">
                    {r.ubicacion ?? '-'}
                  </td>
                  <td className="px-4 py-2 text-xs">
                    {r.devueltoAt ? (
                      <div>
                        <span className="inline-flex rounded-full bg-warning/15 px-2 py-0.5 font-medium text-warning">
                          Devuelto
                        </span>
                        <span className="mt-1 block text-[11px] text-muted-foreground">
                          {new Date(r.devueltoAt).toLocaleString('es-AR')}
                        </span>
                        {r.devueltoMotivo && (
                          <span className="block max-w-48 text-[11px] text-muted-foreground">
                            {r.devueltoMotivo}
                          </span>
                        )}
                      </div>
                    ) : r.pickeadoAt ? (
                      <span className="text-success">Pickeado</span>
                    ) : (
                      <span className="text-muted-foreground">Pendiente</span>
                    )}
                  </td>
                  {puedeQuitar && (
                    <td className="px-4 py-2 text-right">
                      {!r.devueltoAt && !r.liberadoAt ? (
                        <button
                          type="button"
                          onClick={() => setQuitarTarget(r)}
                          className="rounded-md border border-destructive/30 px-2 py-1 text-xs text-destructive hover:bg-destructive/5"
                        >
                          Quitar
                        </button>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                  )}
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={colSpan} className="px-4 py-8 text-center text-sm text-muted-foreground">
                  Deposito todavia no pickeo rollos para este pedido.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {quitarTarget && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-4 sm:items-center">
          <div className="w-full max-w-sm space-y-4 rounded-xl bg-white p-5 shadow-xl">
            <div>
              <p className="text-xs uppercase tracking-wide text-muted-foreground">
                Quitar rollo del pedido
              </p>
              <p className="mt-1 text-sm">
                El rollo{' '}
                <strong className="font-mono">{quitarTarget.numeroPieza}</strong>{' '}
                vuelve a stock como <strong>&ldquo;Sin ubicar&rdquo;</strong> y el
                depósito recibe un aviso para reubicarlo. Deja de contar para este
                pedido.
              </p>
            </div>

            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setQuitarTarget(null)}
                disabled={quitando}
                className="flex-1 rounded-md border px-4 py-2.5 text-sm transition-colors hover:bg-zinc-50 disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={ejecutarQuitar}
                disabled={quitando}
                className="flex-1 rounded-md bg-destructive px-4 py-2.5 text-sm font-medium text-destructive-foreground transition-colors hover:bg-destructive/90 disabled:opacity-50"
              >
                {quitando ? 'Quitando...' : 'Quitar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
