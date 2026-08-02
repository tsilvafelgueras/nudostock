'use client'

import { useState, useCallback, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import {
  RotateCcw,
  X,
  Search,
  ChevronRight,
  PackageCheck,
  CheckCircle2,
  AlertCircle,
} from 'lucide-react'
import CodeScanner, { type CodeScannerResult } from '@/components/CodeScanner'
import {
  getRolloEntregado,
  buscarPartidasConEntregados,
  getRollosEntregadosByIngreso,
  devolverRollos,
  type RolloEntregadoInfo,
  type PartidaConEntregadosRow,
  type DevolucionItem,
} from './actions'

type TipoFallaOption = { id: string; nombre: string }

type Step =
  | 'tipo'
  | 'scan_rollos'
  | 'buscar_partida'
  | 'seleccionar_rollos'
  | 'motivo_segunda'
  | 'exito'

type RolloDevolucion = RolloEntregadoInfo & {
  segunda: boolean
  fallaTipo: string
}

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

function fmtKg(kg: number | null) {
  if (kg == null) return '—'
  return `${Number(kg).toLocaleString('es-AR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} kg`
}

function StepIndicator({ step }: { step: Step }) {
  const steps: { id: Step; label: string }[] = [
    { id: 'tipo', label: 'Tipo' },
    { id: 'scan_rollos', label: 'Rollos' },
    { id: 'motivo_segunda', label: 'Motivo' },
    { id: 'exito', label: 'Listo' },
  ]

  const pathB: Step[] = ['buscar_partida', 'seleccionar_rollos']
  const visibleSteps =
    step === 'tipo' || step === 'scan_rollos' || step === 'motivo_segunda' || step === 'exito'
      ? steps
      : [
          { id: 'tipo' as Step, label: 'Tipo' },
          { id: 'buscar_partida' as Step, label: 'Buscar' },
          { id: 'seleccionar_rollos' as Step, label: 'Rollos' },
          { id: 'motivo_segunda' as Step, label: 'Motivo' },
          { id: 'exito' as Step, label: 'Listo' },
        ]

  const currentIdx = visibleSteps.findIndex(
    (s) => s.id === step || (step === 'scan_rollos' && s.id === 'scan_rollos') || (pathB.includes(step) && (s.id === step))
  )

  return (
    <div className="flex items-center gap-1.5">
      {visibleSteps.map((s, i) => {
        const active = s.id === step
        const done = i < currentIdx
        return (
          <div key={s.id} className="flex items-center gap-1.5">
            <div
              className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold transition-colors ${
                done
                  ? 'bg-success text-white'
                  : active
                    ? 'bg-action text-action-foreground'
                    : 'bg-muted text-muted-foreground'
              }`}
            >
              {done ? '✓' : i + 1}
            </div>
            <span
              className={`hidden text-xs sm:block ${active ? 'font-semibold text-foreground' : 'text-muted-foreground'}`}
            >
              {s.label}
            </span>
            {i < visibleSteps.length - 1 && (
              <div className="h-px w-4 bg-border sm:w-6" />
            )}
          </div>
        )
      })}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
// Step: Elegir tipo
// ─────────────────────────────────────────────────────────────

function StepElegirTipo({
  onPorRollo,
  onPorPartida,
}: {
  onPorRollo: () => void
  onPorPartida: () => void
}) {
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        ¿Cómo querés registrar la devolución?
      </p>
      <div className="grid gap-4 sm:grid-cols-2">
        <button
          onClick={onPorRollo}
          className="flex flex-col items-start gap-3 rounded-xl border bg-white p-6 text-left shadow-sm transition-all hover:border-action hover:shadow-md"
        >
          <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-action/10">
            <RotateCcw className="h-6 w-6 text-action" />
          </div>
          <div>
            <p className="font-semibold">Por rollo</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Escaneá o ingresá el número de cada rollo que devuelve el cliente.
            </p>
          </div>
          <ChevronRight className="h-4 w-4 self-end text-muted-foreground" />
        </button>

        <button
          onClick={onPorPartida}
          className="flex flex-col items-start gap-3 rounded-xl border bg-white p-6 text-left shadow-sm transition-all hover:border-action hover:shadow-md"
        >
          <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-action/10">
            <PackageCheck className="h-6 w-6 text-action" />
          </div>
          <div>
            <p className="font-semibold">Por partida</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Buscá la OT o remito de la partida y elegí qué rollos devuelve el
              cliente.
            </p>
          </div>
          <ChevronRight className="h-4 w-4 self-end text-muted-foreground" />
        </button>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
// Step: Scan rollos (path A)
// ─────────────────────────────────────────────────────────────

function StepScanRollos({
  rollos,
  onRolloAdded,
  onRolloRemoved,
  onContinuar,
}: {
  rollos: RolloEntregadoInfo[]
  onRolloAdded: (rollo: RolloEntregadoInfo) => void
  onRolloRemoved: (id: string) => void
  onContinuar: () => void
}) {
  const [scanning, startScan] = useTransition()
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const scannedIds = new Set(rollos.map((r) => r.id))

  const handleScan = useCallback(
    (result: CodeScannerResult) => {
      const numeroPieza = result.texto.trim()
      if (!numeroPieza) return
      setErrorMsg(null)

      startScan(async () => {
        const res = await getRolloEntregado(numeroPieza)
        if (!res.ok) {
          setErrorMsg(res.error)
          return
        }
        if (scannedIds.has(res.rollo.id)) {
          setErrorMsg(`El rollo ${numeroPieza} ya fue agregado.`)
          return
        }
        onRolloAdded(res.rollo)
        setErrorMsg(null)
      })
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rollos]
  )

  return (
    <div className="space-y-4">
      <CodeScanner
        onRead={handleScan}
        paused={scanning}
        title="Escanear rollo"
        manualLabel="Número de pieza"
        manualPlaceholder="Ej: 12345"
      />

      {errorMsg && (
        <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
          <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
          <p>{errorMsg}</p>
        </div>
      )}

      {rollos.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground">
            {rollos.length} rollo{rollos.length !== 1 ? 's' : ''} para devolver
          </p>
          <ul className="space-y-1.5">
            {rollos.map((r) => (
              <li
                key={r.id}
                className="flex items-center justify-between gap-2 rounded-lg border bg-white px-3 py-2.5 text-sm"
              >
                <div className="min-w-0">
                  <span className="font-medium">#{r.numero_pieza}</span>
                  <span className="ml-2 text-muted-foreground">
                    {r.articulo} · {r.color} · {fmtKg(r.kilos)}
                  </span>
                  {r.pedido_numero && (
                    <span className="ml-2 text-xs text-muted-foreground">
                      (Pedido {r.pedido_numero})
                    </span>
                  )}
                </div>
                <button
                  onClick={() => onRolloRemoved(r.id)}
                  className="flex-shrink-0 rounded p-1 text-muted-foreground hover:text-destructive"
                  aria-label="Quitar rollo"
                >
                  <X className="h-4 w-4" />
                </button>
              </li>
            ))}
          </ul>

          <button
            onClick={onContinuar}
            className="mt-2 inline-flex min-h-11 w-full items-center justify-center rounded-lg bg-action px-6 text-sm font-semibold text-action-foreground transition-colors hover:bg-action/90"
          >
            Continuar con {rollos.length} rollo{rollos.length !== 1 ? 's' : ''}
          </button>
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
// Step: Buscar partida (path B)
// ─────────────────────────────────────────────────────────────

function StepBuscarPartida({
  onPartidaSeleccionada,
}: {
  onPartidaSeleccionada: (ingresoId: string) => void
}) {
  const [query, setQuery] = useState('')
  const [buscado, setBuscado] = useState('')
  const [resultados, setResultados] = useState<PartidaConEntregadosRow[] | null>(null)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [searching, startSearch] = useTransition()

  function handleBuscar(e: React.FormEvent) {
    e.preventDefault()
    const q = query.trim()
    if (!q) return
    setErrorMsg(null)
    startSearch(async () => {
      const res = await buscarPartidasConEntregados(q)
      if (!res.ok) {
        setErrorMsg(res.error)
        setResultados(null)
        return
      }
      setBuscado(q)
      setResultados(res.rows)
    })
  }

  return (
    <div className="space-y-4">
      <form onSubmit={handleBuscar} className="flex gap-2">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar por OT, partida o número de pedido..."
            className="w-full rounded-lg border border-input bg-white py-2.5 pl-9 pr-3 text-sm"
            autoFocus
          />
        </div>
        <button
          type="submit"
          disabled={!query.trim() || searching}
          className="inline-flex min-h-11 items-center justify-center rounded-lg bg-action px-4 text-sm font-semibold text-action-foreground transition-colors hover:bg-action/90 disabled:opacity-50"
        >
          {searching ? 'Buscando...' : 'Buscar'}
        </button>
      </form>

      {errorMsg && (
        <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
          <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
          <p>{errorMsg}</p>
        </div>
      )}

      {!errorMsg && resultados !== null && resultados.length === 0 && (
        <p className="rounded-lg border bg-muted/50 p-4 text-center text-sm text-muted-foreground">
          No se encontraron partidas con rollos entregados para "{buscado}".
        </p>
      )}

      {resultados !== null && resultados.length > 0 && (
        <ul className="space-y-2">
          {resultados.map((p) => (
            <li key={p.ingreso_id}>
              <button
                onClick={() => onPartidaSeleccionada(p.ingreso_id)}
                className="w-full rounded-lg border bg-white p-4 text-left shadow-sm transition-all hover:border-action"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="space-y-0.5">
                    <p className="font-medium">
                      {p.ot ? `OT ${p.ot}` : p.numero_lote ? `Partida ${p.numero_lote}` : 'Sin identificador'}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {p.tintoreria_nombre} · {p.articulo_nombre}
                    </p>
                    {p.fecha_despacho && (
                      <p className="text-xs text-muted-foreground">
                        Despacho: {new Date(p.fecha_despacho).toLocaleDateString('es-AR')}
                      </p>
                    )}
                  </div>
                  <span className="inline-flex items-center rounded-full bg-warning/15 px-2.5 py-0.5 text-xs font-semibold text-warning-foreground">
                    {p.rollos_entregados} rollos entregados
                  </span>
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
// Step: Seleccionar rollos de una partida (path B)
// ─────────────────────────────────────────────────────────────

function StepSeleccionarRollos({
  ingresoId,
  onContinuar,
  onBack,
}: {
  ingresoId: string
  onContinuar: (rollos: RolloEntregadoInfo[]) => void
  onBack: () => void
}) {
  const [rollos, setRollos] = useState<RolloEntregadoInfo[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [loading, startLoad] = useTransition()
  const [loaded, setLoaded] = useState(false)

  // Load once on mount
  if (!loaded && !loading) {
    startLoad(async () => {
      const data = await getRollosEntregadosByIngreso(ingresoId)
      setRollos(data)
      setSelected(new Set(data.map((r) => r.id)))
      setLoaded(true)
    })
  }

  function toggleAll() {
    if (selected.size === rollos.length) setSelected(new Set())
    else setSelected(new Set(rollos.map((r) => r.id)))
  }

  function toggleOne(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  const seleccionados = rollos.filter((r) => selected.has(r.id))

  if (loading || !loaded) {
    return (
      <div className="space-y-2 py-8 text-center text-sm text-muted-foreground">
        Cargando rollos de la partida...
      </div>
    )
  }

  if (rollos.length === 0) {
    return (
      <div className="space-y-4 py-8 text-center">
        <p className="text-sm text-muted-foreground">
          No se encontraron rollos entregados para esta partida.
        </p>
        <button onClick={onBack} className="text-sm font-medium text-action underline">
          Volver
        </button>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium">
          {rollos.length} rollo{rollos.length !== 1 ? 's' : ''} entregados
        </p>
        <button
          onClick={toggleAll}
          className="text-xs font-medium text-action underline"
        >
          {selected.size === rollos.length ? 'Deseleccionar todos' : 'Seleccionar todos'}
        </button>
      </div>

      <ul className="space-y-1.5">
        {rollos.map((r) => (
          <li key={r.id}>
            <label className="flex cursor-pointer items-center gap-3 rounded-lg border bg-white px-3 py-2.5 text-sm transition-colors hover:bg-muted/30">
              <input
                type="checkbox"
                checked={selected.has(r.id)}
                onChange={() => toggleOne(r.id)}
                className="h-4 w-4 rounded border-input accent-action"
              />
              <div className="min-w-0 flex-1">
                <span className="font-medium">#{r.numero_pieza}</span>
                <span className="ml-2 text-muted-foreground">
                  {r.articulo} · {r.color} · {fmtKg(r.kilos)}
                </span>
                {r.pedido_numero && (
                  <span className="ml-2 text-xs text-muted-foreground">
                    (Pedido {r.pedido_numero})
                  </span>
                )}
              </div>
            </label>
          </li>
        ))}
      </ul>

      <button
        onClick={() => onContinuar(seleccionados)}
        disabled={seleccionados.length === 0}
        className="mt-2 inline-flex min-h-11 w-full items-center justify-center rounded-lg bg-action px-6 text-sm font-semibold text-action-foreground transition-colors hover:bg-action/90 disabled:opacity-50"
      >
        Continuar con {seleccionados.length} rollo{seleccionados.length !== 1 ? 's' : ''}
      </button>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
// Step: Motivo + segunda calidad (compartido)
// ─────────────────────────────────────────────────────────────

function StepMotivoSegunda({
  rollos,
  tiposFalla,
  onConfirmar,
  onBack,
}: {
  rollos: RolloDevolucion[]
  tiposFalla: TipoFallaOption[]
  onConfirmar: (items: RolloDevolucion[], motivo: string) => void
  onBack: () => void
}) {
  const [motivo, setMotivo] = useState('')
  const [items, setItems] = useState<RolloDevolucion[]>(rollos)
  const [pending, startSubmit] = useTransition()

  function setSegunda(rolloId: string, segunda: boolean) {
    setItems((prev) =>
      prev.map((r) => (r.id === rolloId ? { ...r, segunda } : r))
    )
  }

  function setFallaTipo(rolloId: string, fallaTipo: string) {
    setItems((prev) =>
      prev.map((r) => (r.id === rolloId ? { ...r, fallaTipo } : r))
    )
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!motivo.trim()) return
    startSubmit(async () => {
      onConfirmar(items, motivo)
    })
  }

  const totalSegunda = items.filter((r) => r.segunda).length
  const totalStock = items.length - totalSegunda

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div className="space-y-1.5">
        <label className="text-sm font-medium" htmlFor="motivo">
          Motivo de devolución <span className="text-destructive">*</span>
        </label>
        <textarea
          id="motivo"
          value={motivo}
          onChange={(e) => setMotivo(e.target.value)}
          placeholder="Ej: Cliente devuelve por exceso de stock"
          rows={2}
          className="w-full rounded-lg border border-input bg-white px-3 py-2.5 text-sm"
          required
        />
      </div>

      <div className="space-y-2">
        <p className="text-sm font-medium">Destino de cada rollo</p>
        <p className="text-xs text-muted-foreground">
          Por defecto todos vuelven a stock. Activá "Segunda calidad" para los que tienen algún defecto.
        </p>
        <ul className="space-y-2">
          {items.map((r) => (
            <li
              key={r.id}
              className="rounded-lg border bg-white p-3 space-y-2"
            >
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <span className="text-sm font-medium">#{r.numero_pieza}</span>
                  <span className="ml-2 text-xs text-muted-foreground">
                    {r.articulo} · {r.color} · {fmtKg(r.kilos)}
                  </span>
                </div>
                <label className="flex cursor-pointer items-center gap-2">
                  <span className="text-xs text-muted-foreground">Segunda</span>
                  <div className="relative">
                    <input
                      type="checkbox"
                      className="sr-only"
                      checked={r.segunda}
                      onChange={(e) => setSegunda(r.id, e.target.checked)}
                    />
                    <div
                      className={`h-5 w-9 rounded-full transition-colors ${r.segunda ? 'bg-warning' : 'bg-muted'}`}
                    >
                      <div
                        className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${r.segunda ? 'left-4' : 'left-0.5'}`}
                      />
                    </div>
                  </div>
                </label>
              </div>

              {r.segunda && tiposFalla.length > 0 && (
                <div className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground">
                    Tipo de falla
                  </label>
                  <select
                    value={r.fallaTipo}
                    onChange={(e) => setFallaTipo(r.id, e.target.value)}
                    className="w-full rounded-md border border-input bg-white px-3 py-2 text-sm"
                  >
                    <option value="">— Sin especificar —</option>
                    {tiposFalla.map((t) => (
                      <option key={t.id} value={t.nombre}>
                        {t.nombre}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </li>
          ))}
        </ul>
      </div>

      <div className="rounded-lg border border-dashed bg-muted/30 p-3 text-sm">
        <span className="font-medium">{totalStock}</span> rollo{totalStock !== 1 ? 's' : ''} vuelven a stock
        {totalSegunda > 0 && (
          <>
            {' · '}
            <span className="font-medium text-warning-foreground">{totalSegunda}</span> a segunda calidad
          </>
        )}
      </div>

      <div className="flex gap-3">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex min-h-11 flex-1 items-center justify-center rounded-lg border bg-white px-4 text-sm font-medium text-foreground transition-colors hover:bg-muted/50"
        >
          Atrás
        </button>
        <button
          type="submit"
          disabled={!motivo.trim() || pending}
          className="inline-flex min-h-11 flex-[2] items-center justify-center rounded-lg bg-action px-6 text-sm font-semibold text-action-foreground transition-colors hover:bg-action/90 disabled:opacity-50"
        >
          {pending ? 'Confirmando...' : 'Confirmar devolución'}
        </button>
      </div>
    </form>
  )
}

// ─────────────────────────────────────────────────────────────
// Step: Éxito
// ─────────────────────────────────────────────────────────────

function StepExito({
  devueltos,
  errores,
  onNuevaDevolucion,
}: {
  devueltos: number
  errores: { rollo_id: string; error: string }[]
  onNuevaDevolucion: () => void
}) {
  const router = useRouter()

  return (
    <div className="space-y-5 py-4 text-center">
      <div className="flex justify-center">
        <CheckCircle2 className="h-16 w-16 text-success" />
      </div>

      <div>
        <h2 className="text-xl font-semibold">
          {devueltos > 0
            ? `${devueltos} rollo${devueltos !== 1 ? 's' : ''} devuelto${devueltos !== 1 ? 's' : ''}`
            : 'Devolución procesada'}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Los rollos volvieron al sistema con la trazabilidad correspondiente.
        </p>
      </div>

      {errores.length > 0 && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-left text-sm text-destructive">
          <p className="mb-1 font-medium">
            {errores.length} rollo{errores.length !== 1 ? 's' : ''} no pudo{errores.length !== 1 ? 'n' : ''} procesarse:
          </p>
          <ul className="list-inside list-disc space-y-0.5">
            {errores.map((e, i) => (
              <li key={i} className="text-xs">
                {e.error}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex flex-col gap-3">
        <button
          onClick={onNuevaDevolucion}
          className="inline-flex min-h-11 w-full items-center justify-center rounded-lg bg-action px-6 text-sm font-semibold text-action-foreground transition-colors hover:bg-action/90"
        >
          Nueva devolución
        </button>
        <button
          onClick={() => router.push('/stock')}
          className="inline-flex min-h-11 w-full items-center justify-center rounded-lg border bg-white px-6 text-sm font-medium text-foreground transition-colors hover:bg-muted/50"
        >
          Ir al stock
        </button>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
// Main wizard
// ─────────────────────────────────────────────────────────────

export default function DevolucionesWizard({
  tiposFalla,
}: {
  tiposFalla: TipoFallaOption[]
}) {
  const [step, setStep] = useState<Step>('tipo')
  const [rollosBase, setRollosBase] = useState<RolloEntregadoInfo[]>([])
  const [ingresoIdSeleccionado, setIngresoIdSeleccionado] = useState<string | null>(null)
  const [exitoData, setExitoData] = useState<{
    devueltos: number
    errores: { rollo_id: string; error: string }[]
  } | null>(null)
  const [submitting, startSubmit] = useTransition()

  function reset() {
    setStep('tipo')
    setRollosBase([])
    setIngresoIdSeleccionado(null)
    setExitoData(null)
  }

  function handleConfirmar(items: RolloDevolucion[], motivo: string) {
    startSubmit(async () => {
      const payload: DevolucionItem[] = items.map((r) => ({
        rolloId: r.id,
        segunda: r.segunda,
        fallaTipo: r.segunda ? r.fallaTipo || undefined : undefined,
      }))

      const result = await devolverRollos(payload, motivo)

      if (!result.ok) {
        toast.error(result.error)
        return
      }

      setExitoData({ devueltos: result.devueltos, errores: result.errores })
      setStep('exito')
    })
  }

  function toMotivoSegunda(baseRollos: RolloEntregadoInfo[]) {
    setRollosBase(baseRollos)
    setStep('motivo_segunda')
  }

  const title =
    step === 'tipo'
      ? 'Nueva devolución'
      : step === 'scan_rollos'
        ? 'Devolver por rollo'
        : step === 'buscar_partida'
          ? 'Buscar partida'
          : step === 'seleccionar_rollos'
            ? 'Seleccionar rollos'
            : step === 'motivo_segunda'
              ? 'Motivo y calidad'
              : 'Devolución registrada'

  return (
    <div className="mx-auto w-full max-w-2xl space-y-5 p-4 sm:p-6">
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h1 className="font-heading text-xl font-semibold">{title}</h1>
          {step !== 'tipo' && step !== 'exito' && (
            <button
              onClick={reset}
              className="text-xs text-muted-foreground underline"
            >
              Cancelar
            </button>
          )}
        </div>
        {step !== 'exito' && <StepIndicator step={step} />}
      </div>

      {step === 'tipo' && (
        <StepElegirTipo
          onPorRollo={() => setStep('scan_rollos')}
          onPorPartida={() => setStep('buscar_partida')}
        />
      )}

      {step === 'scan_rollos' && (
        <StepScanRollos
          rollos={rollosBase}
          onRolloAdded={(r) => setRollosBase((prev) => [...prev, r])}
          onRolloRemoved={(id) =>
            setRollosBase((prev) => prev.filter((r) => r.id !== id))
          }
          onContinuar={() => toMotivoSegunda(rollosBase)}
        />
      )}

      {step === 'buscar_partida' && (
        <StepBuscarPartida
          onPartidaSeleccionada={(ingresoId) => {
            setIngresoIdSeleccionado(ingresoId)
            setStep('seleccionar_rollos')
          }}
        />
      )}

      {step === 'seleccionar_rollos' && ingresoIdSeleccionado && (
        <StepSeleccionarRollos
          ingresoId={ingresoIdSeleccionado}
          onContinuar={toMotivoSegunda}
          onBack={() => setStep('buscar_partida')}
        />
      )}

      {step === 'motivo_segunda' && (
        <StepMotivoSegunda
          rollos={rollosBase.map((r) => ({ ...r, segunda: false, fallaTipo: '' }))}
          tiposFalla={tiposFalla}
          onConfirmar={handleConfirmar}
          onBack={() =>
            setStep(
              ingresoIdSeleccionado ? 'seleccionar_rollos' : 'scan_rollos'
            )
          }
        />
      )}

      {step === 'exito' && exitoData && (
        <StepExito
          devueltos={exitoData.devueltos}
          errores={exitoData.errores}
          onNuevaDevolucion={reset}
        />
      )}
    </div>
  )
}
