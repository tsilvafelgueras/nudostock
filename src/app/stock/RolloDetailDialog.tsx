'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import { toast } from 'sonner'
import type { StockRollo, StockRole } from './StockList'
import SearchableCombobox from '@/components/SearchableCombobox'
import {
  darDeBajaRollo,
  eliminarRollo,
  moverUbicacion,
  marcarComoSegunda,
  confirmarRolloManual,
  subirFotoRollo,
  listarFotosRollo,
  editarRollo,
  devolverRolloAStock,
  reactivarRollo,
  type RolloFotoConUrl,
} from './actions'
import { actualizarOtIngreso } from '@/app/ingresos/otActions'
import {
  ESTADOS_EDITABLES,
  type TipoFallaOption,
  type EstadoEditable,
} from './constants'
import {
  ubicacionesToOptions,
  type UbicacionOption,
} from '@/lib/ubicaciones'

const ESTADO_TEXT: Record<string, string> = {
  pendiente: 'Pendiente',
  en_stock: 'En stock',
  reservado: 'Reservado',
  entregado: 'Entregado',
  baja: 'Baja',
  segunda: 'Segunda',
}

// El padre remonta este componente con `key={rollo.id}` cuando cambia el rollo
// seleccionado, así el estado interno (mode/ubicacion) arranca limpio sin
// necesidad de resetearlo en un useEffect.
export default function RolloDetailDialog({
  rollo,
  role,
  onClose,
  initialMode,
  ubicaciones,
  articulos,
  articuloColores,
  tiposFalla = [],
}: {
  rollo: StockRollo
  role: StockRole
  onClose: () => void
  initialMode?: 'view' | 'editar'
  ubicaciones: UbicacionOption[]
  articulos: { id: string; nombre: string }[]
  articuloColores: Record<string, { id: string; nombre: string }[]>
  tiposFalla?: TipoFallaOption[]
}) {
  const [mode, setMode] = useState<
    'view' | 'mover' | 'baja' | 'eliminar' | 'segunda' | 'confirmar' | 'editar' | 'devolver' | 'reactivar'
  >(initialMode ?? 'view')
  const [ubicacion, setUbicacion] = useState(rollo.ubicacion ?? '')
  const [confirmUbicacion, setConfirmUbicacion] = useState('')
  const [pending, startTransition] = useTransition()

  // OT (partida de tintorería) — editable inline desde stock. Es del ingreso,
  // así que el cambio aplica a toda la partida.
  const [editandoOt, setEditandoOt] = useState(false)
  const [otValue, setOtValue] = useState(rollo.ingresos?.ot ?? '')
  const [otActual, setOtActual] = useState<string | null>(rollo.ingresos?.ot ?? null)
  const ubicacionOptions = ubicacionesToOptions(ubicaciones)

  const [devolverMotivo, setDevolverMotivo] = useState('')

  // Formulario de "segunda"
  const [fallaCategoria, setFallaCategoria] = useState('')
  const [fallaDescripcion, setFallaDescripcion] = useState('')
  const [fallaArchivos, setFallaArchivos] = useState<File[]>([])
  const [subiendoIdx, setSubiendoIdx] = useState<number | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Galería de fotos ya existentes para este rollo. Inicializamos el flag
  // de "cargando" según el estado inicial del rollo para evitar setState
  // síncrono dentro del effect (regla react-hooks/set-state-in-effect).
  const [fotos, setFotos] = useState<RolloFotoConUrl[]>([])
  const [fotosCargando, setFotosCargando] = useState(
    rollo.estado === 'segunda'
  )
  const [fotoAmpliada, setFotoAmpliada] = useState<RolloFotoConUrl | null>(null)

  useEffect(() => {
    if (rollo.estado !== 'segunda') return
    let cancelado = false
    listarFotosRollo(rollo.id)
      .then((res) => {
        if (cancelado) return
        if (res.ok) setFotos(res.fotos)
        setFotosCargando(false)
      })
      .catch(() => {
        // Si algo crashea (red, server action fallida), simplemente no
        // mostramos fotos en lugar de romper la UI del dialog.
        if (!cancelado) setFotosCargando(false)
      })
    return () => {
      cancelado = true
    }
  }, [rollo.id, rollo.estado])

  // Formulario de "Editar campos". El estado solo es editable si el rollo
  // está en un estado "manejable" (no reservado/entregado/baja — esos los
  // bloquea el server). Para los que sí, el dropdown ofrece las
  // transiciones disponibles definidas en ESTADOS_EDITABLES.
  const estadoActualEsEditable = (
    ESTADOS_EDITABLES as readonly string[]
  ).includes(rollo.estado)
  const [editForm, setEditForm] = useState({
    numero_pieza: rollo.numero_pieza,
    articulo_id: rollo.articulos?.id ?? '',
    color_id: rollo.color_id ?? '',
    ubicacion: rollo.ubicacion ?? '',
    pantone: rollo.pantone ?? '',
    kilos: rollo.kilos != null ? String(rollo.kilos) : '',
    metros: rollo.metros != null ? String(rollo.metros) : '',
    kilos_propios:
      rollo.kilos_propios != null ? String(rollo.kilos_propios) : '',
    metros_propios:
      rollo.metros_propios != null ? String(rollo.metros_propios) : '',
    ancho_propio:
      rollo.ancho_propio != null ? String(rollo.ancho_propio) : '',
    gramaje_propio:
      rollo.gramaje_propio != null ? String(rollo.gramaje_propio) : '',
    gramaje_planilla:
      rollo.gramaje_planilla != null ? String(rollo.gramaje_planilla) : '',
    estado: estadoActualEsEditable
      ? (rollo.estado as EstadoEditable)
      : ('en_stock' as EstadoEditable),
  })

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'Escape') return
      if (fotoAmpliada) {
        setFotoAmpliada(null)
      } else {
        onClose()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, fotoAmpliada])

  const esOperarioOAdmin = role === 'operario' || role === 'admin'
  const puedeMover =
    esOperarioOAdmin &&
    (rollo.estado === 'en_stock' || rollo.estado === 'pendiente')
  const puedeSegunda =
    esOperarioOAdmin &&
    (rollo.estado === 'en_stock' || rollo.estado === 'pendiente')
  const puedeBaja =
    esOperarioOAdmin && rollo.estado !== 'baja' && rollo.estado !== 'entregado'
  const puedeEliminar =
    esOperarioOAdmin &&
    rollo.estado !== 'reservado' &&
    rollo.estado !== 'entregado'
  const puedeConfirmar = esOperarioOAdmin && rollo.estado === 'pendiente'
  const puedeEditar =
    esOperarioOAdmin && rollo.estado !== 'baja' && rollo.estado !== 'entregado'
  const puedeDevolver = esOperarioOAdmin && rollo.estado === 'entregado'
  const puedeReactivar = esOperarioOAdmin && (rollo.estado === 'baja' || rollo.estado === 'entregado')

  function handleGuardarOt() {
    const ingresoId = rollo.ingresos?.id
    if (!ingresoId) return
    startTransition(async () => {
      try {
        const res = await actualizarOtIngreso(ingresoId, otValue)
        if (!res.ok) {
          toast.error(res.error)
          return
        }
        const nueva = otValue.trim() || null
        setOtActual(nueva)
        setEditandoOt(false)
        toast.success(
          nueva ? `OT actualizada a ${nueva}.` : 'OT borrada.'
        )
      } catch (e) {
        console.error('[handleGuardarOt] error inesperado', e)
        toast.error('No se pudo actualizar la OT.')
      }
    })
  }

  function handleMover() {
    startTransition(async () => {
      try {
        const res = await moverUbicacion(rollo.id, ubicacion)
        if (!res.ok) {
          toast.error(res.error)
          return
        }
        toast.success(
          `Pieza ${rollo.numero_pieza} movida a ${ubicacion.trim()}.`
        )
        onClose()
      } catch (e) {
        console.error('[handleMover] error inesperado', e)
        toast.error(
          e instanceof Error
            ? `Error: ${e.message}`
            : 'Error inesperado al mover ubicación. Mirá la consola.'
        )
      }
    })
  }

  function handleSegunda() {
    if (!fallaCategoria) {
      toast.error('Elegí una categoría de falla.')
      return
    }
    startTransition(async () => {
      try {
        // Subimos las fotos primero. Si alguna falla, abortamos antes de
        // cambiar el estado del rollo para que el operario pueda reintentar.
        const fotoPaths: string[] = []
        for (let i = 0; i < fallaArchivos.length; i++) {
          setSubiendoIdx(i)
          const fd = new FormData()
          fd.set('archivo', fallaArchivos[i])
          fd.set('rollo_id', rollo.id)
          const res = await subirFotoRollo(fd)
          if (!res.ok) {
            setSubiendoIdx(null)
            toast.error(`No se pudo subir la foto ${i + 1}: ${res.error}`)
            return
          }
          fotoPaths.push(res.path)
        }
        setSubiendoIdx(null)

        const res = await marcarComoSegunda(rollo.id, {
          categoria: fallaCategoria,
          descripcion: fallaDescripcion,
          fotoPaths,
        })
        if (!res.ok) {
          toast.error(res.error)
          return
        }
        toast.success(
          `Pieza ${rollo.numero_pieza} marcada como segunda calidad.`
        )
        onClose()
      } catch (e) {
        setSubiendoIdx(null)
        // Log al console para diagnóstico: el toast a veces se corta y el
        // stack trace ayuda a identificar si el problema vino del frontend,
        // de Next.js o del server action.
        console.error('[marcarComoSegunda] error inesperado', e)
        toast.error(
          e instanceof Error
            ? `Error: ${e.message}`
            : 'Error inesperado al marcar como segunda. Mirá la consola del navegador.'
        )
      }
    })
  }

  function parseNumOpt(s: string): number | null {
    const t = s.trim()
    if (t === '') return null
    const n = Number(t)
    return Number.isFinite(n) ? n : null
  }

  function handleEditarGuardar() {
    if (!editForm.numero_pieza.trim()) {
      toast.error('El número de pieza no puede estar vacío.')
      return
    }
    const kilos = parseNumOpt(editForm.kilos)
    if (kilos == null || kilos <= 0) {
      toast.error('Los kilos son obligatorios y deben ser mayores a cero.')
      return
    }
    startTransition(async () => {
      try {
        const res = await editarRollo(rollo.id, {
          numero_pieza: editForm.numero_pieza,
          // Solo enviamos artículo/color si cambió alguno respecto del rollo.
          ...(editForm.articulo_id !== (rollo.articulos?.id ?? '') ||
          editForm.color_id !== (rollo.color_id ?? '')
            ? { articulo_id: editForm.articulo_id, color_id: editForm.color_id }
            : {}),
          ubicacion: editForm.ubicacion,
          pantone: editForm.pantone,
          kilos: parseNumOpt(editForm.kilos),
          metros: parseNumOpt(editForm.metros),
          kilos_propios: parseNumOpt(editForm.kilos_propios),
          metros_propios: parseNumOpt(editForm.metros_propios),
          ancho_propio: parseNumOpt(editForm.ancho_propio),
          gramaje_propio: parseNumOpt(editForm.gramaje_propio),
          gramaje_planilla: parseNumOpt(editForm.gramaje_planilla),
          // Solo enviamos estado si el rollo arrancó en un estado editable.
          // Si arrancó en 'reservado' por ejemplo, el server lo rechaza
          // antes y no queremos darle motivos.
          ...(estadoActualEsEditable ? { estado: editForm.estado } : {}),
        })
        if (!res.ok) {
          toast.error(res.error)
          return
        }
        toast.success('Cambios guardados.')
        onClose()
      } catch (e) {
        console.error('[handleEditarGuardar] error inesperado', e)
        toast.error(
          e instanceof Error
            ? `Error: ${e.message}`
            : 'Error inesperado al guardar cambios. Mirá la consola.'
        )
      }
    })
  }

  function handleArchivosSeleccionados(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files
    if (!files || files.length === 0) return
    const nuevos = Array.from(files)
    setFallaArchivos((prev) => [...prev, ...nuevos])
    // Reset para permitir volver a elegir el mismo archivo si se quitó
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  function quitarArchivo(idx: number) {
    setFallaArchivos((prev) => prev.filter((_, i) => i !== idx))
  }

  function handleBaja() {
    startTransition(async () => {
      try {
        const res = await darDeBajaRollo(rollo.id)
        if (!res.ok) {
          toast.error(res.error)
          return
        }
        toast.success(`Pieza ${rollo.numero_pieza} dada de baja.`)
        onClose()
      } catch (e) {
        console.error('[handleBaja] error inesperado', e)
        toast.error(
          e instanceof Error
            ? `Error: ${e.message}`
            : 'Error inesperado al dar de baja. Mirá la consola.'
        )
      }
    })
  }

  function handleEliminar() {
    startTransition(async () => {
      try {
        const res = await eliminarRollo(rollo.id)
        if (!res.ok) {
          toast.error(res.error)
          return
        }
        toast.success(`Pieza ${rollo.numero_pieza} eliminada.`)
        onClose()
      } catch (e) {
        console.error('[handleEliminar] error inesperado', e)
        toast.error(
          e instanceof Error
            ? `Error: ${e.message}`
            : 'Error inesperado al eliminar. Mirá la consola.'
        )
      }
    })
  }

  function handleDevolver() {
    startTransition(async () => {
      try {
        const res = await devolverRolloAStock(rollo.id, devolverMotivo)
        if (!res.ok) {
          toast.error(res.error)
          return
        }
        toast.success(
          `Pieza ${rollo.numero_pieza} devuelta al stock como "Sin ubicar".`
        )
        onClose()
      } catch (e) {
        console.error('[devolverRolloAStock] error inesperado', e)
        toast.error(
          e instanceof Error
            ? `Error: ${e.message}`
            : 'Error inesperado al devolver el rollo. Mirá la consola.'
        )
      }
    })
  }

  function handleReactivar() {
    startTransition(async () => {
      try {
        const res = await reactivarRollo(rollo.id)
        if (!res.ok) {
          toast.error(res.error)
          return
        }
        toast.success(
          `Pieza ${rollo.numero_pieza} reactivada y puesta en stock como "Sin ubicar".`
        )
        onClose()
      } catch (e) {
        console.error('[reactivarRollo] error inesperado', e)
        toast.error(
          e instanceof Error
            ? `Error: ${e.message}`
            : 'Error inesperado al reactivar el rollo. Mirá la consola.'
        )
      }
    })
  }

  function handleConfirmar() {
    startTransition(async () => {
      try {
        const res = await confirmarRolloManual(rollo.id, confirmUbicacion)
        if (!res.ok) {
          toast.error(res.error)
          return
        }
        toast.success(
          `Pieza ${rollo.numero_pieza} confirmada en ${confirmUbicacion.trim()}.`
        )
        onClose()
      } catch (e) {
        console.error('[handleConfirmar] error inesperado', e)
        toast.error(
          e instanceof Error
            ? `Error: ${e.message}`
            : 'Error inesperado al confirmar. Mirá la consola.'
        )
      }
    })
  }

  return (
    <div
      className="fixed inset-0 z-40 bg-black/50 flex items-end sm:items-center justify-center p-0 sm:p-4"
      onClick={onClose}
    >
      <div
        className="bg-white w-full max-w-2xl rounded-t-2xl sm:rounded-lg shadow-xl max-h-[92vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b px-4 py-3 sticky top-0 bg-white z-10">
          <div className="min-w-0">
            <h2 className="font-semibold">Pieza {rollo.numero_pieza}</h2>
            <p className="text-xs text-muted-foreground truncate">
              {rollo.articulos?.nombre ?? '—'}
              {rollo.colores?.nombre ? ` · ${rollo.colores.nombre}` : ''}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar"
            className="rounded-md p-1.5 hover:bg-zinc-100 shrink-0"
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div className="p-4 space-y-4">
          {/* Foto: solo si el rollo tiene una. Sin placeholder cuando no hay. */}
          {rollo.foto_url && (
            <div className="aspect-video w-full overflow-hidden rounded-lg bg-zinc-100 flex items-center justify-center">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={rollo.foto_url}
                alt={`Rollo ${rollo.numero_pieza}`}
                className="w-full h-full object-cover"
              />
            </div>
          )}

          {/* Metadata */}
          <dl className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-3 text-sm">
            {/* Estado siempre presente; el resto solo se muestra si tiene valor */}
            <Field
              label="Estado"
              value={ESTADO_TEXT[rollo.estado] ?? rollo.estado}
            />
            <FieldIf label="Ubicación" value={rollo.ubicacion} />
            <FieldIf label="Pantone" value={rollo.pantone} />
            <FieldIf label="Kilos" value={fmtN(rollo.kilos, 'kg')} />
            <FieldIf label="Metros" value={fmtN(rollo.metros, 'm')} />
            <FieldIf
              label="Gramaje (planilla)"
              value={fmtN(rollo.gramaje_planilla)}
            />
            <FieldIf
              label="Kilos propios"
              value={fmtN(rollo.kilos_propios, 'kg')}
            />
            <FieldIf
              label="Metros propios"
              value={fmtN(rollo.metros_propios, 'm')}
            />
            <FieldIf label="Ancho propio" value={fmtN(rollo.ancho_propio, 'cm')} />
            <FieldIf label="Gramaje propio" value={fmtN(rollo.gramaje_propio)} />
          </dl>

          <div className="rounded-md bg-zinc-50 border p-3 text-xs space-y-1">
            <p className="font-medium text-foreground">Origen</p>
            {rollo.ingresos?.tintorerias?.nombre && (
              <p>
                <span className="text-muted-foreground">Tintorería: </span>
                {rollo.ingresos.tintorerias.nombre}
              </p>
            )}
            {rollo.ingresos?.fecha_despacho && (
              <p>
                <span className="text-muted-foreground">Fecha despacho: </span>
                {rollo.ingresos.fecha_despacho}
              </p>
            )}
            {rollo.ingresos?.numero_remito && (
              <p>
                <span className="text-muted-foreground">Remito: </span>
                {rollo.ingresos.numero_remito}
              </p>
            )}
            {/* OT (partida tintorería) — editable inline por operario/admin.
                Aplica a toda la partida. */}
            <div className="flex items-start gap-2">
              <span className="text-muted-foreground">OT (partida): </span>
              {editandoOt ? (
                <span className="flex flex-1 items-center gap-1">
                  <input
                    type="text"
                    value={otValue}
                    onChange={(e) => setOtValue(e.target.value)}
                    placeholder="Orden de trabajo"
                    autoFocus
                    className="min-w-0 flex-1 rounded border border-input bg-white px-2 py-1 text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  />
                  <button
                    type="button"
                    onClick={handleGuardarOt}
                    disabled={pending}
                    className="rounded bg-primary px-2 py-1 text-[11px] font-medium text-primary-foreground disabled:opacity-50"
                  >
                    Guardar
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setOtValue(otActual ?? '')
                      setEditandoOt(false)
                    }}
                    disabled={pending}
                    className="rounded border px-2 py-1 text-[11px] disabled:opacity-50"
                  >
                    Cancelar
                  </button>
                </span>
              ) : (
                <span className="flex flex-1 items-center justify-between gap-2">
                  <span className="text-foreground">{otActual ?? '—'}</span>
                  {esOperarioOAdmin && (
                    <button
                      type="button"
                      onClick={() => {
                        setOtValue(otActual ?? '')
                        setEditandoOt(true)
                      }}
                      className="shrink-0 text-[11px] font-medium text-action hover:underline"
                    >
                      {otActual ? 'Editar' : 'Agregar'}
                    </button>
                  )}
                </span>
              )}
            </div>
            {rollo.ingresos?.referencia && (
              <p>
                <span className="text-muted-foreground">Referencia: </span>
                {rollo.ingresos.referencia}
              </p>
            )}
            {rollo.ingresos?.rem_tejeduria && (
              <p>
                <span className="text-muted-foreground">Rem. tejeduría: </span>
                {rollo.ingresos.rem_tejeduria}
              </p>
            )}
          </div>

          {/* Detalle de segunda calidad */}
          {rollo.estado === 'segunda' && (
            <div className="rounded-md border border-amber-300/60 bg-amber-50 p-3 text-xs space-y-2">
              <div className="flex items-center gap-2">
                <p className="font-medium text-amber-900">Falla registrada</p>
                {rollo.falla_categoria && (
                  <span className="rounded-full bg-amber-200 text-amber-900 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide">
                    {rollo.falla_categoria}
                  </span>
                )}
              </div>
              {rollo.falla_descripcion && (
                <p className="text-amber-900 whitespace-pre-wrap">
                  {rollo.falla_descripcion}
                </p>
              )}
              {!rollo.falla_categoria && !rollo.falla_descripcion && (
                <p className="text-amber-800/70">
                  Sin categoría ni detalle cargados. Marcala de nuevo desde
                  acciones para sumar esa información.
                </p>
              )}

              {fotosCargando ? (
                <p className="text-amber-800/70">Cargando fotos…</p>
              ) : fotos.length > 0 ? (
                <ul className="grid grid-cols-3 sm:grid-cols-4 gap-2 pt-1">
                  {fotos.map((f) => (
                    <li
                      key={f.id}
                      className="aspect-square rounded-md overflow-hidden border bg-white"
                    >
                      {f.signedUrl ? (
                        <button
                          type="button"
                          onClick={() => setFotoAmpliada(f)}
                          className="block w-full h-full"
                          aria-label="Ampliar foto"
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={f.signedUrl}
                            alt={f.descripcion ?? 'Foto de la falla'}
                            className="w-full h-full object-cover"
                          />
                        </button>
                      ) : (
                        <div className="flex h-full items-center justify-center text-[10px] text-muted-foreground p-1 text-center">
                          No se pudo cargar
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          )}

          {/* Acciones */}
          {mode === 'view' && (
              <div className="flex flex-wrap gap-2 pt-2 border-t">
                <a
                  href={`/rollos-sin-etiqueta/etiqueta?ids=${rollo.id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="rounded-md border border-input bg-white px-4 py-2 text-sm font-medium hover:bg-zinc-50 transition-colors"
                >
                  Imprimir etiqueta
                </a>
                {puedeDevolver && (
                  <button
                    type="button"
                    onClick={() => setMode('devolver')}
                    className="rounded-md bg-success text-success-foreground px-4 py-2 text-sm font-medium hover:bg-success/90 transition-colors"
                  >
                    Devolver al stock
                  </button>
                )}
                {puedeReactivar && (
                  <button
                    type="button"
                    onClick={() => setMode('reactivar')}
                    className="rounded-md border border-amber-400/50 text-amber-700 px-4 py-2 text-sm font-medium hover:bg-amber-50 transition-colors"
                  >
                    Corrección de estado
                  </button>
                )}
                {puedeConfirmar && (
                  <button
                    type="button"
                    onClick={() => setMode('confirmar')}
                    className="rounded-md bg-success text-success-foreground px-4 py-2 text-sm font-medium hover:bg-success/90 transition-colors"
                  >
                    Confirmar manualmente
                  </button>
                )}
                {puedeEditar && (
                  <button
                    type="button"
                    onClick={() => setMode('editar')}
                    className="rounded-md border border-input bg-white px-4 py-2 text-sm font-medium hover:bg-zinc-50 transition-colors"
                  >
                    Editar campos
                  </button>
                )}
                {puedeMover && (
                  <button
                    type="button"
                    onClick={() => setMode('mover')}
                    className="rounded-md bg-primary text-primary-foreground px-4 py-2 text-sm font-medium hover:bg-primary/90 transition-colors"
                  >
                    Mover ubicación
                  </button>
                )}
                {puedeSegunda && (
                  <button
                    type="button"
                    onClick={() => setMode('segunda')}
                    className="rounded-md border border-amber-400/40 text-amber-700 px-4 py-2 text-sm font-medium hover:bg-amber-50 transition-colors"
                  >
                    Marcar como segunda
                  </button>
                )}
                {puedeBaja && (
                  <button
                    type="button"
                    onClick={() => setMode('baja')}
                    className="rounded-md border border-destructive/40 text-destructive px-4 py-2 text-sm font-medium hover:bg-destructive/5 transition-colors"
                  >
                    Dar de baja
                  </button>
                )}
                {puedeEliminar && (
                  <button
                    type="button"
                    onClick={() => setMode('eliminar')}
                    className="rounded-md bg-destructive text-white px-4 py-2 text-sm font-medium hover:bg-destructive/90 transition-colors"
                  >
                    Eliminar
                  </button>
                )}
              </div>
            )}

          {mode === 'editar' && (
            <div className="space-y-3 pt-2 border-t">
              <p className="text-sm">
                Editar los campos de la pieza{' '}
                <strong>{rollo.numero_pieza}</strong>. Dejá vacío lo que no
                aplique.
              </p>

              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                <EditField
                  label="N° de pieza"
                  value={editForm.numero_pieza}
                  onChange={(v) =>
                    setEditForm((prev) => ({ ...prev, numero_pieza: v }))
                  }
                  required
                />
                <div className="min-w-0 space-y-1">
                  <label className="text-xs font-medium text-muted-foreground">
                    Artículo
                  </label>
                  <SearchableCombobox
                    value={editForm.articulo_id}
                    onChange={(v) =>
                      setEditForm((prev) => {
                        // Al cambiar de artículo, si el color actual no es válido
                        // para el nuevo artículo, lo reseteamos.
                        const coloresValidos = articuloColores[v] ?? []
                        const colorSigueValido = coloresValidos.some(
                          (c) => c.id === prev.color_id
                        )
                        return {
                          ...prev,
                          articulo_id: v,
                          color_id: colorSigueValido ? prev.color_id : '',
                        }
                      })
                    }
                    options={articulos.map((a) => ({
                      value: a.id,
                      label: a.nombre,
                    }))}
                    placeholder="Seleccionar artículo..."
                    searchPlaceholder="Buscar artículo..."
                    emptyLabel="No hay artículos"
                    allowClear={false}
                  />
                </div>
                <div className="min-w-0 space-y-1">
                  <label className="text-xs font-medium text-muted-foreground">
                    Color
                  </label>
                  <SearchableCombobox
                    value={editForm.color_id}
                    onChange={(v) =>
                      setEditForm((prev) => ({ ...prev, color_id: v }))
                    }
                    options={(articuloColores[editForm.articulo_id] ?? []).map(
                      (c) => ({ value: c.id, label: c.nombre })
                    )}
                    placeholder="Seleccionar color..."
                    searchPlaceholder="Buscar color..."
                    emptyLabel="Elegí primero un artículo"
                    allowClear={false}
                  />
                </div>
                <div className="min-w-0 space-y-1">
                  <label className="text-xs font-medium text-muted-foreground">
                    Estado
                  </label>
                  {estadoActualEsEditable ? (
                    <select
                      value={editForm.estado}
                      onChange={(e) =>
                        setEditForm((prev) => ({
                          ...prev,
                          estado: e.target.value as EstadoEditable,
                        }))
                      }
                      className="w-full rounded-md border bg-white px-3 py-1.5 text-sm"
                    >
                      {ESTADOS_EDITABLES.map((s) => (
                        <option key={s} value={s}>
                          {ESTADO_TEXT[s] ?? s}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      value={ESTADO_TEXT[rollo.estado] ?? rollo.estado}
                      disabled
                      className="w-full rounded-md border bg-zinc-50 px-3 py-1.5 text-sm text-muted-foreground"
                    />
                  )}
                </div>
                <div className="min-w-0 space-y-1">
                  <label className="text-xs font-medium text-muted-foreground">
                    Ubicación
                  </label>
                  <SearchableCombobox
                    value={editForm.ubicacion}
                    onChange={(v) =>
                      setEditForm((prev) => ({ ...prev, ubicacion: v }))
                    }
                    options={withCurrentUbicacion(
                      editForm.ubicacion,
                      ubicacionOptions
                    )}
                    placeholder="Seleccionar ubicacion..."
                    searchPlaceholder="Buscar ubicacion..."
                    emptyLabel="No hay ubicaciones"
                  />
                </div>
                <EditField
                  label="Pantone"
                  value={editForm.pantone}
                  onChange={(v) =>
                    setEditForm((prev) => ({ ...prev, pantone: v }))
                  }
                />
                <EditField
                  label="Kilos"
                  value={editForm.kilos}
                  onChange={(v) =>
                    setEditForm((prev) => ({ ...prev, kilos: v }))
                  }
                  type="number"
                  required
                />
                <EditField
                  label="Metros"
                  value={editForm.metros}
                  onChange={(v) =>
                    setEditForm((prev) => ({ ...prev, metros: v }))
                  }
                  type="number"
                />
                <EditField
                  label="Gramaje (planilla)"
                  value={editForm.gramaje_planilla}
                  onChange={(v) =>
                    setEditForm((prev) => ({ ...prev, gramaje_planilla: v }))
                  }
                  type="number"
                />
                <EditField
                  label="Kilos propios"
                  value={editForm.kilos_propios}
                  onChange={(v) =>
                    setEditForm((prev) => ({ ...prev, kilos_propios: v }))
                  }
                  type="number"
                />
                <EditField
                  label="Metros propios"
                  value={editForm.metros_propios}
                  onChange={(v) =>
                    setEditForm((prev) => ({ ...prev, metros_propios: v }))
                  }
                  type="number"
                />
                <EditField
                  label="Ancho propio"
                  value={editForm.ancho_propio}
                  onChange={(v) =>
                    setEditForm((prev) => ({ ...prev, ancho_propio: v }))
                  }
                  type="number"
                />
                <EditField
                  label="Gramaje propio"
                  value={editForm.gramaje_propio}
                  onChange={(v) =>
                    setEditForm((prev) => ({ ...prev, gramaje_propio: v }))
                  }
                  type="number"
                />
              </div>

              <p className="text-xs text-muted-foreground">
                Si pasás un rollo a &ldquo;Segunda&rdquo; desde acá no quedan
                categoría ni fotos cargadas. Para sumar ese detalle usá
                &ldquo;Marcar como segunda&rdquo; desde la vista del rollo.
              </p>

              <div className="flex gap-2 justify-end pt-1">
                <button
                  type="button"
                  onClick={() => setMode('view')}
                  disabled={pending}
                  className="text-sm px-3 py-2 hover:bg-zinc-100 rounded-md disabled:opacity-50"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={handleEditarGuardar}
                  disabled={pending || !editForm.numero_pieza.trim()}
                  className="rounded-md bg-primary text-primary-foreground px-4 py-2 text-sm font-medium disabled:opacity-50"
                >
                  {pending ? 'Guardando…' : 'Guardar cambios'}
                </button>
              </div>
            </div>
          )}

          {mode === 'confirmar' && (
            <div className="space-y-2 pt-2 border-t">
              <p className="text-sm">
                Confirmar manualmente la pieza{' '}
                <strong>{rollo.numero_pieza}</strong>. El rollo pasa de
                pendiente a en stock.
              </p>
              <label className="text-sm font-medium block">
                Ubicación asignada *
              </label>
              <SearchableCombobox
                value={confirmUbicacion}
                onChange={setConfirmUbicacion}
                options={ubicacionOptions}
                placeholder="Seleccionar ubicacion..."
                searchPlaceholder="Buscar ubicacion..."
                emptyLabel="No hay ubicaciones"
                allowClear={false}
              />
              <p className="text-xs text-muted-foreground">
                Si el rollo ya está en el depósito sin haber sido escaneado por
                cámara, este atajo permite cerrarlo a mano.
              </p>
              <div className="flex gap-2 justify-end pt-1">
                <button
                  type="button"
                  onClick={() => setMode('view')}
                  disabled={pending}
                  className="text-sm px-3 py-2 hover:bg-zinc-100 rounded-md disabled:opacity-50"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={handleConfirmar}
                  disabled={pending || !confirmUbicacion.trim()}
                  className="rounded-md bg-success text-success-foreground px-4 py-2 text-sm font-medium disabled:opacity-50"
                >
                  {pending ? 'Confirmando…' : 'Confirmar y pasar a stock'}
                </button>
              </div>
            </div>
          )}

          {mode === 'mover' && (
            <div className="space-y-2 pt-2 border-t">
              <label className="text-sm font-medium">Nueva ubicación</label>
              <SearchableCombobox
                value={ubicacion}
                onChange={setUbicacion}
                options={withCurrentUbicacion(ubicacion, ubicacionOptions)}
                placeholder="Seleccionar ubicacion..."
                searchPlaceholder="Buscar ubicacion..."
                emptyLabel="No hay ubicaciones"
                allowClear={false}
              />
              <div className="flex gap-2 justify-end pt-1">
                <button
                  type="button"
                  onClick={() => setMode('view')}
                  disabled={pending}
                  className="text-sm px-3 py-2 hover:bg-zinc-100 rounded-md disabled:opacity-50"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={handleMover}
                  disabled={pending}
                  className="rounded-md bg-primary text-primary-foreground px-4 py-2 text-sm font-medium disabled:opacity-50"
                >
                  {pending ? 'Guardando…' : 'Guardar'}
                </button>
              </div>
            </div>
          )}

          {mode === 'segunda' && (
            <div className="space-y-3 pt-2 border-t">
              <p className="text-sm">
                Marcar la pieza <strong>{rollo.numero_pieza}</strong> como
                segunda calidad. Documentá la falla ahora para evitar el ida y
                vuelta con el cliente.
              </p>

              <div className="space-y-1">
                <label className="text-xs font-medium block">
                  Categoría de falla <span className="text-destructive">*</span>
                </label>
                <select
                  value={fallaCategoria}
                  onChange={(e) => setFallaCategoria(e.target.value)}
                  className="w-full rounded-md border px-3 py-2 text-sm bg-white"
                  autoFocus
                >
                  <option value="">Seleccionar...</option>
                  {tiposFalla.map((t) => (
                    <option key={t.id} value={t.nombre}>
                      {t.nombre}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-1">
                <label className="text-xs font-medium block">
                  Detalle (opcional)
                </label>
                <textarea
                  value={fallaDescripcion}
                  onChange={(e) => setFallaDescripcion(e.target.value)}
                  placeholder="Ej. Mancha en el borde a la mitad del rollo. Tono más claro de un costado."
                  rows={3}
                  className="w-full rounded-md border px-3 py-2 text-sm resize-y"
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-medium block">
                  Fotos de la falla (opcional)
                </label>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  capture="environment"
                  multiple
                  onChange={handleArchivosSeleccionados}
                  disabled={pending}
                  className="block w-full text-xs file:mr-3 file:rounded-md file:border-0 file:bg-amber-100 file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-amber-800 hover:file:bg-amber-200"
                />
                {fallaArchivos.length > 0 && (
                  <ul className="mt-2 grid grid-cols-3 sm:grid-cols-4 gap-2">
                    {fallaArchivos.map((file, idx) => {
                      const url = URL.createObjectURL(file)
                      const subiendoEsta = subiendoIdx === idx
                      return (
                        <li
                          key={`${file.name}-${idx}`}
                          className="relative aspect-square rounded-md overflow-hidden border bg-zinc-50"
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={url}
                            alt={`Foto ${idx + 1}`}
                            className="w-full h-full object-cover"
                          />
                          {subiendoEsta && (
                            <div className="absolute inset-0 bg-black/50 flex items-center justify-center text-white text-[10px] font-medium">
                              Subiendo…
                            </div>
                          )}
                          {!pending && (
                            <button
                              type="button"
                              onClick={() => quitarArchivo(idx)}
                              className="absolute top-1 right-1 size-5 rounded-full bg-black/60 text-white text-xs leading-none flex items-center justify-center hover:bg-black/80"
                              aria-label="Quitar foto"
                            >
                              ×
                            </button>
                          )}
                        </li>
                      )
                    })}
                  </ul>
                )}
              </div>

              <div className="flex gap-2 justify-end pt-1">
                <button
                  type="button"
                  onClick={() => setMode('view')}
                  disabled={pending}
                  className="text-sm px-3 py-2 hover:bg-zinc-100 rounded-md disabled:opacity-50"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={handleSegunda}
                  disabled={pending || !fallaCategoria}
                  className="rounded-md bg-amber-500 text-white px-4 py-2 text-sm font-medium disabled:opacity-50"
                >
                  {pending
                    ? subiendoIdx !== null && fallaArchivos.length > 0
                      ? `Subiendo ${subiendoIdx + 1}/${fallaArchivos.length}…`
                      : 'Marcando…'
                    : 'Confirmar segunda'}
                </button>
              </div>
            </div>
          )}

          {mode === 'baja' && (
            <div className="space-y-2 pt-2 border-t">
              <p className="text-sm">
                ¿Confirmás dar de baja la pieza{' '}
                <strong>{rollo.numero_pieza}</strong>?
              </p>
              <p className="text-xs text-muted-foreground">
                El rollo va a quedar en estado &ldquo;Baja&rdquo; y deja de
                figurar como disponible. Esta acción no se puede deshacer desde
                la app.
              </p>
              <div className="flex gap-2 justify-end pt-1">
                <button
                  type="button"
                  onClick={() => setMode('view')}
                  disabled={pending}
                  className="text-sm px-3 py-2 hover:bg-zinc-100 rounded-md disabled:opacity-50"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={handleBaja}
                  disabled={pending}
                  className="rounded-md bg-destructive text-white px-4 py-2 text-sm font-medium disabled:opacity-50"
                >
                  {pending ? 'Dando de baja…' : 'Confirmar baja'}
                </button>
              </div>
            </div>
          )}

          {mode === 'eliminar' && (
            <div className="space-y-2 pt-2 border-t">
              <p className="text-sm">
                ¿Eliminar definitivamente la pieza{' '}
                <strong>{rollo.numero_pieza}</strong>?
              </p>
              <p className="text-xs text-muted-foreground">
                Esto <strong>borra el rollo de la base de datos</strong> y libera
                el número de pieza {rollo.numero_pieza} para reusarlo. La acción
                queda registrada en el historial, pero no se puede deshacer.
              </p>
              <div className="flex gap-2 justify-end pt-1">
                <button
                  type="button"
                  onClick={() => setMode('view')}
                  disabled={pending}
                  className="text-sm px-3 py-2 hover:bg-zinc-100 rounded-md disabled:opacity-50"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={handleEliminar}
                  disabled={pending}
                  className="rounded-md bg-destructive text-white px-4 py-2 text-sm font-medium disabled:opacity-50"
                >
                  {pending ? 'Eliminando…' : 'Eliminar definitivamente'}
                </button>
              </div>
            </div>
          )}

          {mode === 'devolver' && (
            <div className="space-y-3 pt-2 border-t">
              <p className="text-sm">
                Devolver la pieza <strong>{rollo.numero_pieza}</strong> al stock.
                El rollo vuelve a &ldquo;En stock&rdquo; marcado como{' '}
                &ldquo;Sin ubicar&rdquo; para que lo puedas reubicar.
              </p>
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground block">
                  Motivo (opcional)
                </label>
                <input
                  type="text"
                  value={devolverMotivo}
                  onChange={(e) => setDevolverMotivo(e.target.value)}
                  disabled={pending}
                  placeholder="Ej. Devolución por exceso, cambio de diseño..."
                  className="w-full rounded-md border bg-white px-3 py-2 text-sm disabled:opacity-50"
                />
              </div>
              <div className="flex gap-2 justify-end pt-1">
                <button
                  type="button"
                  onClick={() => setMode('view')}
                  disabled={pending}
                  className="text-sm px-3 py-2 hover:bg-zinc-100 rounded-md disabled:opacity-50"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={handleDevolver}
                  disabled={pending}
                  className="rounded-md bg-success text-success-foreground px-4 py-2 text-sm font-medium hover:bg-success/90 disabled:opacity-50"
                >
                  {pending ? 'Devolviendo…' : 'Confirmar devolución'}
                </button>
              </div>
            </div>
          )}

          {mode === 'reactivar' && (
            <div className="space-y-2 pt-2 border-t">
              <p className="text-sm">
                Corrección de estado: pieza <strong>{rollo.numero_pieza}</strong>.
              </p>
              <p className="text-xs text-muted-foreground">
                El rollo va a pasar a &ldquo;En stock&rdquo; y su ubicación se va a
                poner como &ldquo;Sin ubicar&rdquo;. Usá esta opción solo para
                corregir errores de datos.
              </p>
              <div className="flex gap-2 justify-end pt-1">
                <button
                  type="button"
                  onClick={() => setMode('view')}
                  disabled={pending}
                  className="text-sm px-3 py-2 hover:bg-zinc-100 rounded-md disabled:opacity-50"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={handleReactivar}
                  disabled={pending}
                  className="rounded-md border border-amber-400/50 bg-amber-50 text-amber-700 px-4 py-2 text-sm font-medium hover:bg-amber-100 disabled:opacity-50"
                >
                  {pending ? 'Reactivando…' : 'Poner en stock'}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {fotoAmpliada?.signedUrl && (
        <div
          className="fixed inset-0 z-50 bg-black/85 flex items-center justify-center p-4"
          onClick={(e) => {
            e.stopPropagation()
            setFotoAmpliada(null)
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={fotoAmpliada.signedUrl}
            alt={fotoAmpliada.descripcion ?? 'Foto ampliada'}
            className="max-w-full max-h-full object-contain"
          />
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              setFotoAmpliada(null)
            }}
            aria-label="Cerrar foto"
            className="absolute top-3 right-3 rounded-full bg-white/90 text-foreground p-2 hover:bg-white"
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
      )}
    </div>
  )
}

function EditField({
  label,
  value,
  onChange,
  type = 'text',
  required = false,
  list,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  type?: 'text' | 'number'
  required?: boolean
  list?: string
}) {
  return (
    <div className="min-w-0 space-y-1">
      <label className="text-xs font-medium text-muted-foreground">
        {label}
        {required && <span className="text-destructive"> *</span>}
      </label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        list={list}
        step={type === 'number' ? '0.01' : undefined}
        inputMode={type === 'number' ? 'decimal' : undefined}
        className="w-full rounded-md border bg-white px-3 py-1.5 text-sm"
      />
    </div>
  )
}

function withCurrentUbicacion(
  current: string,
  options: { value: string; label: string; description?: string }[]
) {
  if (!current || options.some((o) => o.value === current)) return options
  return [{ value: current, label: current }, ...options]
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="font-medium truncate">{value}</dd>
    </div>
  )
}

// Renderiza el campo solo si el valor existe y no es vacío. Mantiene el grid
// libre de huecos con "—".
function FieldIf({
  label,
  value,
}: {
  label: string
  value: string | null | undefined
}) {
  if (value == null || value === '') return null
  return <Field label={label} value={value} />
}

// fmtN devuelve null si no hay valor (en lugar de "—"), para integrarse con
// FieldIf y que el campo se oculte automáticamente.
function fmtN(v: number | null, suffix?: string): string | null {
  if (v == null) return null
  const num = Number(v)
  if (Number.isNaN(num)) return null
  return `${num.toLocaleString('es-AR', {
    maximumFractionDigits: 2,
  })}${suffix ? ' ' + suffix : ''}`
}
