'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { type CodeScannerResult } from '@/components/CodeScanner'
import ScannerByReaderType, {
  type ReaderType,
} from '@/components/ScannerByReaderType'
import { extraerCodigoCandidato, type PatronCodigo } from '@/lib/scanner'
import {
  requiereFinalizarPicking,
  type PartidaParaMatch,
  type ReemplazoSugerido,
} from '@/lib/picking'
import {
  aplicarPickingPedido,
  finalizarPickingPedido,
  marcarSesionPicking,
  previsualizarPickeo,
  reemplazarRolloEnPicking,
  quitarRolloDePicking,
} from './actions'

export type PickPartida = {
  id: string
  numeroLote: string | null
  ingresoId: string
  articuloId: string
  colorId: string
  articulo: string
  color: string
  tintoreria: string | null
  rollosSolicitados: number
  rollosAsignados: number
  ubicacionesSugeridas: string[]
  reemplazosSugeridos: ReemplazoSugerido[]
}

export type PickRollo = {
  pedido_rollo_id: string
  pedido_partida_id: string | null
  pickeado_at: string | null
  rollo_id: string
  numero_pieza: string
  ubicacion: string | null
  kilos: number | null
  articulo_id: string | null
  color_id: string | null
  articulo: string | null
  color: string | null
  ot: string | null
  partidaRealLote: string | null
  partidaSolicitadaLote: string | null
  esSustitucionPartida: boolean
}

export type DraftRollo = {
  rolloId: string
  numeroPieza: string
  ubicacion: string | null
  kilos: number | null
  articuloId: string | null
  colorId: string | null
  ingresoId: string | null
  pedidoPartidaId: string
  partidaRealLote: string | null
  partidaSolicitadaLote: string | null
  esSustitucionPartida: boolean
  error?: string
}

export type AlternativaRollo = {
  id: string
  numero_pieza: string
  ubicacion: string | null
  kilos: number | null
  articulo_id: string
  color_id: string
  articulo_nombre: string
  color_nombre: string
}

type ReemplazoTarget =
  | { tipo: 'confirmado'; item: PickRollo }
  | { tipo: 'borrador'; item: DraftRollo }

type QuitarTarget =
  | { tipo: 'confirmado'; item: PickRollo }
  | { tipo: 'borrador'; item: DraftRollo }

export default function PickingScanner({
  pedidoId,
  pedidoEstado,
  partidas,
  items,
  patrones,
  readerType,
}: {
  pedidoId: string
  pedidoEstado: string
  partidas: PickPartida[]
  items: PickRollo[]
  alternativas: AlternativaRollo[]
  patrones: PatronCodigo[]
  readerType: ReaderType
}) {
  const router = useRouter()
  const [lastCode, setLastCode] = useState<{ codigo: string; en: number } | null>(null)
  const COOLDOWN_MS = 3000

  const [partidasLocales, setPartidasLocales] = useState<PickPartida[]>(partidas)
  const [itemsLocales, setItemsLocales] = useState<PickRollo[]>(items)
  const [nuevosLocales, setNuevosLocales] = useState<DraftRollo[]>([])
  const [pendingCode, setPendingCode] = useState<string | null>(null)
  const [confirmando, setConfirmando] = useState(false)
  const [aceptando, setAceptando] = useState(false)
  const [finalizando, setFinalizando] = useState(false)
  const [reemplazando, setReemplazando] = useState(false)
  const [reemplazoTarget, setReemplazoTarget] = useState<ReemplazoTarget | null>(null)
  const [numeroReemplazo, setNumeroReemplazo] = useState('')
  const [motivoReemplazo, setMotivoReemplazo] = useState('')
  const [quitarTarget, setQuitarTarget] = useState<QuitarTarget | null>(null)
  const [quitando, setQuitando] = useState(false)
  const [mostrarPartidas, setMostrarPartidas] = useState(true)
  const [mostrarPickeados, setMostrarPickeados] = useState(true)
  const [sesionAviso, setSesionAviso] = useState<{
    otroUsuarioNombre: string
    haceSegundos: number
  } | null>(null)

  const draftKey = `picking_draft_${pedidoId}`

  // Cargar el borrador guardado en localStorage al montar. Se hace en un effect
  // (no en el inicializador de useState) a propósito: el componente se renderiza
  // en el server, donde no existe localStorage, así que leerlo en el primer
  // render rompería la hidratación. El estado arranca vacío (igual que el SSR) y
  // recién al montar en el cliente cargamos el borrador real.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(draftKey)
      if (raw) {
        const parsed = JSON.parse(raw) as DraftRollo[]
        // eslint-disable-next-line react-hooks/set-state-in-effect -- carga inicial desde localStorage (store externo), no es un render en cascada evitable
        if (Array.isArray(parsed)) setNuevosLocales(parsed)
      }
    } catch {
      // localStorage corrupto o no disponible: arrancamos con borrador vacio.
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Persistir el borrador en cada cambio.
  useEffect(() => {
    try {
      if (nuevosLocales.length > 0) {
        localStorage.setItem(draftKey, JSON.stringify(nuevosLocales))
      } else {
        localStorage.removeItem(draftKey)
      }
    } catch {
      // si falla el guardado no rompemos el flujo, solo se pierde la persistencia.
    }
  }, [draftKey, nuevosLocales])

  // Aviso liviano de multi-sesion: marca presencia al entrar y cada 60s.
  useEffect(() => {
    let cancelado = false

    async function heartbeat() {
      const res = await marcarSesionPicking(pedidoId)
      if (cancelado) return
      if (res.ok && res.otroUsuarioNombre) {
        setSesionAviso({
          otroUsuarioNombre: res.otroUsuarioNombre,
          haceSegundos: res.haceSegundos ?? 0,
        })
      } else {
        setSesionAviso(null)
      }
    }

    heartbeat()
    const interval = setInterval(heartbeat, 60_000)
    return () => {
      cancelado = true
      clearInterval(interval)
    }
  }, [pedidoId])

  const total = partidasLocales.reduce((acc, p) => acc + p.rollosSolicitados, 0)
  const pickeadosConfirmados = itemsLocales.filter((r) => r.pickeado_at != null).length
  const draftValidos = nuevosLocales.filter((d) => !d.error)
  const pickeados = pickeadosConfirmados + draftValidos.length
  const progresoPct = total > 0 ? Math.round((pickeados / total) * 100) : 0
  const pendientesConfirmados = Math.max(0, total - pickeadosConfirmados)
  const completo = total > 0 && pendientesConfirmados === 0
  const requiereFinalizacion = requiereFinalizarPicking(
    pedidoEstado,
    total,
    pickeadosConfirmados
  )
  const kilosReales =
    itemsLocales.reduce((acc, r) => acc + Number(r.kilos ?? 0), 0) +
    draftValidos.reduce((acc, d) => acc + Number(d.kilos ?? 0), 0)

  const articuloColorByPartida = useMemo(() => {
    const map = new Map<string, PickPartida>()
    for (const p of partidasLocales) map.set(p.id, p)
    return map
  }, [partidasLocales])

  const partidasParaMatch = useMemo<PartidaParaMatch[]>(
    () =>
      partidasLocales.map((p) => ({
        id: p.id,
        articuloId: p.articuloId,
        colorId: p.colorId,
        ingresoId: p.ingresoId,
        rollosSolicitados: p.rollosSolicitados,
        rollosAsignados: p.rollosAsignados,
      })),
    [partidasLocales]
  )

  const asignadosBorrador = useMemo(() => {
    const map: Record<string, number> = {}
    for (const d of draftValidos) {
      map[d.pedidoPartidaId] = (map[d.pedidoPartidaId] ?? 0) + 1
    }
    return map
  }, [draftValidos])

  const ejecutarPickeo = useCallback(
    async (textoEscaneado: string) => {
      setConfirmando(true)
      const idsEnBorrador = nuevosLocales.map((d) => d.rolloId)
      const res = await previsualizarPickeo(
        textoEscaneado,
        idsEnBorrador,
        partidasParaMatch,
        asignadosBorrador
      )
      setConfirmando(false)

      if (!res.ok) {
        setPendingCode(null)
        if (res.error.includes('ya fue pickeado')) toast.warning(res.error)
        else toast.error(res.error)
        return
      }

      setNuevosLocales((prev) => [
        ...prev,
        {
          rolloId: res.rolloId,
          numeroPieza: res.numeroPieza,
          ubicacion: res.ubicacion,
          kilos: res.kilos,
          articuloId: res.articuloId,
          colorId: res.colorId,
          ingresoId: res.ingresoId,
          pedidoPartidaId: res.pedidoPartidaId,
          partidaRealLote: res.partidaRealLote,
          partidaSolicitadaLote: res.partidaSolicitadaLote,
          esSustitucionPartida: res.esSustitucionPartida,
        },
      ])
      setPendingCode(null)

      if (res.esSustitucionPartida) {
        toast.warning(
          `Pieza ${res.numeroPieza} agregada al borrador desde ${res.partidaRealLote ?? 'otra partida'} en lugar de ${res.partidaSolicitadaLote ?? 'la solicitada'}.`
        )
      } else {
        toast.success(`Pieza ${res.numeroPieza} agregada al borrador.`)
      }
    },
    [nuevosLocales, partidasParaMatch, asignadosBorrador]
  )

  const handleLectura = useCallback(
    (result: CodeScannerResult) => {
      // Ingreso manual: el operario tipeó el número de pieza, se usa tal cual
      // (sin pasar por los regex del QR, que son para el payload de cámara).
      // Escaneo de cámara: se extrae el número de pieza del payload con los patrones.
      const candidato = result.manual
        ? result.texto.trim()
        : extraerCodigoCandidato(result.texto, patrones) ?? result.texto.trim()
      if (!candidato) {
        toast.error('No reconocimos el codigo. Probalo de nuevo o ingresalo manualmente.')
        return
      }

      const ahora = Date.now()
      if (
        lastCode &&
        candidato === lastCode.codigo &&
        ahora - lastCode.en < COOLDOWN_MS
      ) {
        toast.warning('Ese código ya fue ingresado.')
        return
      }
      setLastCode({ codigo: candidato, en: ahora })

      setPendingCode(candidato)
    },
    [patrones, lastCode]
  )

  function quitarDeBorrador(rolloId: string) {
    setNuevosLocales((prev) => prev.filter((d) => d.rolloId !== rolloId))
  }

  async function ejecutarReemplazo() {
    if (!reemplazoTarget) return
    const numero = numeroReemplazo.trim()
    if (!numero) {
      toast.error('Ingresá el número de pieza nuevo.')
      return
    }

    if (reemplazoTarget.tipo === 'borrador') {
      setReemplazando(true)
      const idsEnBorrador = nuevosLocales
        .map((d) => d.rolloId)
        .filter((id) => id !== reemplazoTarget.item.rolloId)
      const res = await previsualizarPickeo(
        numero,
        idsEnBorrador,
        partidasParaMatch,
        asignadosBorrador
      )
      setReemplazando(false)

      if (!res.ok) {
        toast.error(res.error)
        return
      }

      setNuevosLocales((prev) =>
        prev.map((d) =>
          d.rolloId === reemplazoTarget.item.rolloId
            ? {
                rolloId: res.rolloId,
                numeroPieza: res.numeroPieza,
                ubicacion: res.ubicacion,
                kilos: res.kilos,
                articuloId: res.articuloId,
                colorId: res.colorId,
                ingresoId: res.ingresoId,
                pedidoPartidaId: res.pedidoPartidaId,
                partidaRealLote: res.partidaRealLote,
                partidaSolicitadaLote: res.partidaSolicitadaLote,
                esSustitucionPartida: res.esSustitucionPartida,
              }
            : d
        )
      )

      toast.success(
        `Pieza ${reemplazoTarget.item.numeroPieza} reemplazada por ${res.numeroPieza} en el borrador.`
      )
      setReemplazoTarget(null)
      setNumeroReemplazo('')
      setMotivoReemplazo('')
      return
    }

    const target = reemplazoTarget.item
    setReemplazando(true)
    const res = await reemplazarRolloEnPicking({
      pedidoId,
      rolloViejoId: target.rollo_id,
      numeroPiezaNuevo: numero,
      motivo: motivoReemplazo,
    })
    setReemplazando(false)

    if (!res.ok) {
      toast.error(res.error)
      return
    }

    const partida = articuloColorByPartida.get(res.pedidoPartidaId)
    setItemsLocales((prev) =>
      prev.map((item) =>
        item.rollo_id === target.rollo_id
          ? {
              ...item,
              pedido_rollo_id: res.pedidoRolloId,
              pedido_partida_id: res.pedidoPartidaId,
              pickeado_at: new Date().toISOString(),
              rollo_id: res.rolloId,
              numero_pieza: res.numeroPieza,
              ubicacion: res.ubicacion,
              kilos: res.kilos,
              articulo_id: res.articuloId,
              color_id: res.colorId,
              articulo: partida?.articulo ?? item.articulo,
              color: partida?.color ?? item.color,
              ot: null,
              partidaRealLote: res.partidaRealLote,
              partidaSolicitadaLote: res.partidaSolicitadaLote,
              esSustitucionPartida: res.esSustitucionPartida,
            }
          : item
      )
    )

    toast.success(`Rollo ${target.numero_pieza} reemplazado por ${res.numeroPieza}.`)
    setReemplazoTarget(null)
    setNumeroReemplazo('')
    setMotivoReemplazo('')
    router.refresh()
  }

  async function ejecutarQuitar() {
    if (!quitarTarget) return

    if (quitarTarget.tipo === 'borrador') {
      quitarDeBorrador(quitarTarget.item.rolloId)
      toast.success(`Rollo ${quitarTarget.item.numeroPieza} quitado del borrador.`)
      setQuitarTarget(null)
      return
    }

    const target = quitarTarget.item
    setQuitando(true)
    const res = await quitarRolloDePicking({
      pedidoId,
      pedidoRolloId: target.pedido_rollo_id,
    })
    setQuitando(false)

    if (!res.ok) {
      toast.error(res.error)
      return
    }

    setItemsLocales((prev) =>
      prev.filter((item) => item.pedido_rollo_id !== target.pedido_rollo_id)
    )
    if (target.pedido_partida_id) {
      setPartidasLocales((prev) =>
        prev.map((p) =>
          p.id === target.pedido_partida_id
            ? { ...p, rollosAsignados: Math.max(0, p.rollosAsignados - 1) }
            : p
        )
      )
    }

    toast.success(`Rollo ${target.numero_pieza} quitado del pedido.`)
    setQuitarTarget(null)
    router.refresh()
  }

  async function ejecutarAceptar() {
    if (draftValidos.length === 0) {
      toast.error('No hay rollos nuevos en el borrador.')
      return
    }

    setAceptando(true)
    const res = await aplicarPickingPedido(
      pedidoId,
      draftValidos.map((d) => ({ numeroPieza: d.numeroPieza }))
    )
    setAceptando(false)

    if (!res.ok) {
      toast.error(res.error)
      return
    }

    const erroresPorPieza = new Map(res.errores.map((e) => [e.numeroPieza, e.error]))
    const now = new Date().toISOString()

    if (res.aplicados.length > 0) {
      setItemsLocales((prev) => [
        ...prev,
        ...res.aplicados.map((a) => {
          const partida = articuloColorByPartida.get(a.pedidoPartidaId)
          return {
            pedido_rollo_id: a.rolloId,
            pedido_partida_id: a.pedidoPartidaId,
            pickeado_at: now,
            rollo_id: a.rolloId,
            numero_pieza: a.numeroPieza,
            ubicacion: a.ubicacion,
            kilos: a.kilos,
            articulo_id: a.articuloId,
            color_id: a.colorId,
            articulo: partida?.articulo ?? null,
            color: partida?.color ?? null,
            ot: null,
            partidaRealLote: a.partidaRealLote,
            partidaSolicitadaLote: a.partidaSolicitadaLote,
            esSustitucionPartida: a.esSustitucionPartida,
          }
        }),
      ])

      setPartidasLocales((prev) => {
        const incrementos = new Map<string, number>()
        for (const a of res.aplicados) {
          incrementos.set(a.pedidoPartidaId, (incrementos.get(a.pedidoPartidaId) ?? 0) + 1)
        }
        return prev.map((p) =>
          incrementos.has(p.id)
            ? { ...p, rollosAsignados: p.rollosAsignados + (incrementos.get(p.id) ?? 0) }
            : p
        )
      })
    }

    // Los items aplicados se sacan del borrador; los que dieron error quedan
    // marcados para que el operario los reemplace o quite.
    setNuevosLocales((prev) =>
      prev
        .filter((d) => !res.aplicados.some((a) => a.numeroPieza === d.numeroPieza))
        .map((d) =>
          erroresPorPieza.has(d.numeroPieza)
            ? { ...d, error: erroresPorPieza.get(d.numeroPieza) }
            : d
        )
    )

    if (res.errores.length === 0) {
      toast.success(
        res.pedidoCompleto
          ? 'Pedido aceptado. Picking completo, queda Listo.'
          : `Pedido aceptado (${res.total - res.pendientes}/${res.total}).`
      )
    } else {
      toast.warning(
        `Se aceptaron ${res.aplicados.length} de ${res.aplicados.length + res.errores.length} rollos. Revisá los que quedaron con error.`
      )
    }

    if (res.aplicados.length > 0) {
      setTimeout(() => router.refresh(), 900)
    }
  }

  async function ejecutarFinalizar() {
    setFinalizando(true)
    const res = await finalizarPickingPedido(pedidoId)
    setFinalizando(false)

    if (!res.ok) {
      toast.error(res.error)
      return
    }

    toast.success('Pedido aceptado. Picking completo, queda Listo.')
    router.refresh()
  }

  return (
    <div className="flex flex-col gap-4">
      {sesionAviso && (
        <div className="rounded-lg border border-warning/30 bg-warning/10 px-4 py-2 text-sm text-warning">
          {sesionAviso.otroUsuarioNombre} también está pickeando este pedido
          {sesionAviso.haceSegundos < 60
            ? ' (hace instantes)'
            : ` (hace ${Math.round(sesionAviso.haceSegundos / 60)} min)`}
          .
        </div>
      )}

      <div className="space-y-2 rounded-lg border bg-white p-4 shadow-sm">
        <div className="flex items-center justify-between text-sm">
          <span className="font-medium">
            {pickeados} de {total} rollos pickeados
          </span>
          <span className="text-xs text-muted-foreground">{progresoPct}%</span>
        </div>
        <div className="h-2 w-full rounded-full bg-zinc-100">
          <div
            className="h-2 rounded-full bg-primary transition-all duration-500"
            style={{ width: `${progresoPct}%` }}
          />
        </div>
        <p className="text-xs text-muted-foreground tabular-nums">
          Kg reales pickeados:{' '}
          <strong className="text-foreground">{kilosReales.toFixed(2)}</strong>
        </p>
        {draftValidos.length > 0 && (
          <p className="text-xs text-muted-foreground">
            {draftValidos.length} rollo(s) en borrador, todavía sin confirmar.
          </p>
        )}
      </div>

      <section className="rounded-lg border bg-white p-4 shadow-sm">
        <button
          type="button"
          onClick={() => setMostrarPartidas((v) => !v)}
          className="flex w-full items-center justify-between text-left text-sm font-semibold"
        >
          <span>Partidas solicitadas</span>
          <span className="text-xs text-muted-foreground">
            {mostrarPartidas ? 'Ocultar' : 'Ver'}
          </span>
        </button>
        {mostrarPartidas && (
          <ul className="mt-3 space-y-2 text-sm">
            {partidasLocales.map((p) => {
              const asignadosTotal = p.rollosAsignados + (asignadosBorrador[p.id] ?? 0)
              const faltan = Math.max(0, p.rollosSolicitados - asignadosTotal)
              const kilosPartida =
                itemsLocales
                  .filter((r) => r.pedido_partida_id === p.id)
                  .reduce((acc, r) => acc + Number(r.kilos ?? 0), 0) +
                draftValidos
                  .filter((d) => d.pedidoPartidaId === p.id)
                  .reduce((acc, d) => acc + Number(d.kilos ?? 0), 0)
              return (
                <li key={p.id} className="rounded-md border bg-zinc-50 px-3 py-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-medium">
                        Partida {p.numeroLote ?? 'sin numero'}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {p.articulo} - {p.color}
                        {p.tintoreria ? ` - ${p.tintoreria}` : ''}
                      </p>
                    </div>
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs ${
                        faltan === 0
                          ? 'bg-success/15 text-success'
                          : 'bg-warning/15 text-warning'
                      }`}
                    >
                      {asignadosTotal}/{p.rollosSolicitados}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {faltan === 0 ? 'Completa' : `Faltan ${faltan} rollos`}
                    {kilosPartida > 0 && (
                      <span className="ml-1">· {kilosPartida.toFixed(2)} kg</span>
                    )}
                  </p>
                  {p.ubicacionesSugeridas.length > 0 && faltan > 0 && (
                    <p className="mt-1 text-xs text-muted-foreground">
                      Buscar en:{' '}
                      <span className="font-medium text-foreground">
                        {p.ubicacionesSugeridas.join(', ')}
                      </span>
                    </p>
                  )}
                  {p.reemplazosSugeridos.length > 0 && faltan > 0 && (
                    <p className="mt-1 text-xs text-muted-foreground">
                      Reemplazo sugerido:{' '}
                      <span className="font-medium text-foreground">
                        {p.reemplazosSugeridos
                          .map((r) =>
                            r.lote ? `${r.ubicacion} (${r.lote})` : r.ubicacion
                          )
                          .join(', ')}
                      </span>
                    </p>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </section>

      {completo ? (
        <div className="space-y-2 rounded-lg border border-success/30 bg-success/10 p-5 text-center">
          <p className="font-semibold text-success">Pedido listo</p>
          <p className="text-sm text-muted-foreground">
            {requiereFinalizacion
              ? 'Ya se pickearon todos los rollos solicitados. Aceptá el pedido para pasarlo a Listo.'
              : 'Ya se pickearon todos los rollos solicitados. Queda esperando egreso.'}
          </p>
          {requiereFinalizacion && (
            <button
              type="button"
              onClick={ejecutarFinalizar}
              disabled={finalizando}
              className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
            >
              {finalizando ? 'Aceptando...' : 'Aceptar pedido'}
            </button>
          )}
        </div>
      ) : (
        <ScannerByReaderType
          readerType={readerType}
          onRead={handleLectura}
          paused={Boolean(pendingCode) || confirmando}
          title={
            readerType === 'qr'
              ? 'Escanear codigo QR'
              : readerType === 'barcode'
                ? 'Escanear codigo de barras'
                : 'Escanear QR o codigo de barras'
          }
          manualLabel="Ingresar pieza manualmente"
          manualPlaceholder="Ej: 204021911"
        />
      )}

      {nuevosLocales.length > 0 && (
        <section className="space-y-3 rounded-lg border border-primary/30 bg-primary/5 p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold">
              Borrador ({nuevosLocales.length})
            </h3>
            <button
              type="button"
              onClick={ejecutarAceptar}
              disabled={aceptando || draftValidos.length === 0}
              className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
            >
              {aceptando ? 'Aceptando...' : 'Aceptar pedido'}
            </button>
          </div>
          <p className="text-xs text-muted-foreground">
            Estos rollos todavía no se guardaron. Apretá &quot;Aceptar pedido&quot; para
            confirmarlos.
          </p>
          <ul className="space-y-2 text-sm">
            {[...nuevosLocales].reverse().map((d) => (
              <li
                key={d.rolloId}
                className={`flex items-center justify-between gap-2 rounded-md border px-3 py-2 ${
                  d.error ? 'border-destructive/40 bg-destructive/5' : 'bg-white'
                }`}
              >
                <div className="min-w-0">
                  <p className="font-mono font-medium">{d.numeroPieza}</p>
                  <p className="text-xs text-muted-foreground">
                    {d.ubicacion ?? '-'}
                    {d.kilos != null ? ` · ${Number(d.kilos).toFixed(2)} kg` : ''}
                  </p>
                  {d.esSustitucionPartida && !d.error && (
                    <p className="text-[11px] text-warning">
                      Sustitución: {d.partidaRealLote ?? '-'} en lugar de{' '}
                      {d.partidaSolicitadaLote ?? '-'}
                    </p>
                  )}
                  {d.error && (
                    <p className="text-[11px] text-destructive">{d.error}</p>
                  )}
                </div>
                <div className="flex shrink-0 gap-1">
                  <button
                    type="button"
                    onClick={() => {
                      setReemplazoTarget({ tipo: 'borrador', item: d })
                      setNumeroReemplazo('')
                      setMotivoReemplazo('')
                    }}
                    className="rounded-md border px-2 py-1 text-xs hover:bg-zinc-50"
                  >
                    Reemplazar
                  </button>
                  <button
                    type="button"
                    onClick={() => setQuitarTarget({ tipo: 'borrador', item: d })}
                    className="rounded-md border border-destructive/30 px-2 py-1 text-xs text-destructive hover:bg-destructive/5"
                  >
                    Quitar
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="rounded-lg border bg-white p-4 shadow-sm">
        <button
          type="button"
          onClick={() => setMostrarPickeados((v) => !v)}
          className="flex w-full items-center justify-between text-left text-sm font-semibold"
        >
          <span>Rollos confirmados</span>
          <span className="text-xs text-muted-foreground">
            {mostrarPickeados ? 'Ocultar' : 'Ver'} ({itemsLocales.length})
          </span>
        </button>
        {mostrarPickeados && (
          <div className="mt-3 overflow-x-auto">
            {itemsLocales.length === 0 ? (
              <p className="py-4 text-center text-sm text-muted-foreground">
                Todavia no se confirmo ningun rollo.
              </p>
            ) : (
              <table className="w-full text-sm">
                <thead className="border-b text-left text-muted-foreground">
                  <tr>
                    <th className="py-2 pr-3 font-medium">Pieza</th>
                    <th className="py-2 pr-3 font-medium">Articulo</th>
                    <th className="py-2 pr-3 font-medium">Color</th>
                    <th className="py-2 pr-3 font-medium">Partida</th>
                    <th className="py-2 pr-3 font-medium">OT</th>
                    <th className="py-2 pr-3 font-medium">Ubic.</th>
                    <th className="py-2 text-right font-medium">Kg</th>
                    <th className="py-2 pl-3 text-right font-medium"></th>
                  </tr>
                </thead>
                <tbody>
                  {[...itemsLocales].reverse().map((r) => (
                    <tr key={`${r.rollo_id}-${r.pickeado_at}`} className="border-b-2 border-zinc-200 last:border-0">
                      <td className="py-2 pr-3 font-mono font-medium">
                        {r.numero_pieza}
                      </td>
                      <td className="py-2 pr-3">{r.articulo ?? '-'}</td>
                      <td className="py-2 pr-3">{r.color ?? '-'}</td>
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
                      <td className="py-2 pl-3 text-right">
                        <div className="flex justify-end gap-1">
                          <button
                            type="button"
                            onClick={() => {
                              setReemplazoTarget({ tipo: 'confirmado', item: r })
                              setNumeroReemplazo('')
                              setMotivoReemplazo('')
                            }}
                            className="rounded-md border px-2 py-1 text-xs hover:bg-zinc-50"
                          >
                            Reemplazar
                          </button>
                          <button
                            type="button"
                            onClick={() => setQuitarTarget({ tipo: 'confirmado', item: r })}
                            className="rounded-md border border-destructive/30 px-2 py-1 text-xs text-destructive hover:bg-destructive/5"
                          >
                            Quitar
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
      </section>

      {pendingCode && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-4 sm:items-center">
          <div className="w-full max-w-sm space-y-4 rounded-xl bg-white p-5 shadow-xl">
            <div>
              <p className="text-xs uppercase tracking-wide text-muted-foreground">
                Pieza detectada
              </p>
              <p className="mt-0.5 break-all font-mono text-lg font-bold">
                {pendingCode}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                El sistema va a validar que pertenezca a una partida pendiente de este pedido
                y la va a sumar al borrador.
              </p>
            </div>

            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setPendingCode(null)}
                disabled={confirmando}
                className="flex-1 rounded-md border px-4 py-2.5 text-sm transition-colors hover:bg-zinc-50 disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => ejecutarPickeo(pendingCode)}
                disabled={confirmando}
                className="flex-1 rounded-md bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
              >
                {confirmando ? 'Validando...' : 'Agregar al borrador'}
              </button>
            </div>
          </div>
        </div>
      )}

      {reemplazoTarget && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-4 sm:items-center">
          <div className="w-full max-w-sm space-y-4 rounded-xl bg-white p-5 shadow-xl">
            <div>
              <p className="text-xs uppercase tracking-wide text-muted-foreground">
                {reemplazoTarget.tipo === 'borrador'
                  ? 'Reemplazar rollo del borrador'
                  : 'Reemplazar rollo pickeado'}
              </p>
              <p className="mt-1 text-sm">
                Sale{' '}
                <strong className="font-mono">
                  {reemplazoTarget.tipo === 'borrador'
                    ? reemplazoTarget.item.numeroPieza
                    : reemplazoTarget.item.numero_pieza}
                </strong>
                . Ingresá la pieza que queda en su lugar.
              </p>
            </div>

            <div className="space-y-3">
              <Field label="Nueva pieza">
                <input
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  value={numeroReemplazo}
                  onChange={(e) => setNumeroReemplazo(e.target.value)}
                  placeholder="Ej. 204021911"
                  className="w-full rounded-md border px-3 py-2 text-sm"
                />
              </Field>
              {reemplazoTarget.tipo === 'confirmado' && (
                <Field label="Motivo">
                  <textarea
                    value={motivoReemplazo}
                    onChange={(e) => setMotivoReemplazo(e.target.value)}
                    rows={2}
                    placeholder="Ej. error de selección, rollo dañado, cambio solicitado"
                    className="w-full rounded-md border px-3 py-2 text-sm"
                  />
                </Field>
              )}
            </div>

            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setReemplazoTarget(null)}
                disabled={reemplazando}
                className="flex-1 rounded-md border px-4 py-2.5 text-sm transition-colors hover:bg-zinc-50 disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={ejecutarReemplazo}
                disabled={reemplazando || !numeroReemplazo.trim()}
                className="flex-1 rounded-md bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
              >
                {reemplazando ? 'Reemplazando...' : 'Confirmar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {quitarTarget && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-4 sm:items-center">
          <div className="w-full max-w-sm space-y-4 rounded-xl bg-white p-5 shadow-xl">
            <div>
              <p className="text-xs uppercase tracking-wide text-muted-foreground">
                {quitarTarget.tipo === 'borrador'
                  ? 'Quitar rollo del borrador'
                  : 'Quitar rollo del pedido'}
              </p>
              <p className="mt-1 text-sm">
                El rollo{' '}
                <strong className="font-mono">
                  {quitarTarget.tipo === 'borrador'
                    ? quitarTarget.item.numeroPieza
                    : quitarTarget.item.numero_pieza}
                </strong>{' '}
                {quitarTarget.tipo === 'borrador'
                  ? 'se saca del borrador, sin afectar el stock.'
                  : 'vuelve a stock disponible y deja de contar para este pedido.'}
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
    </div>
  )
}

function Field({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="space-y-1">
      <label className="text-xs font-medium text-muted-foreground">{label}</label>
      {children}
    </div>
  )
}
