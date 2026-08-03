'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { BrowserMultiFormatReader, type IScannerControls } from '@zxing/browser'
import { BarcodeFormat, DecodeHintType } from '@zxing/library'
import type { CodeScannerResult } from './CodeScanner'

type ScannerStatus =
  | 'starting'
  | 'ready'
  | 'permission-denied'
  | 'unsupported'
  | 'error'

const STARTING_OVERLAY_MS = 1200
const SUCCESS_MS = 800

const BARCODE_FORMATS = [
  BarcodeFormat.CODE_128,
  BarcodeFormat.CODE_39,
  BarcodeFormat.EAN_13,
  BarcodeFormat.EAN_8,
  BarcodeFormat.UPC_A,
  BarcodeFormat.UPC_E,
  BarcodeFormat.ITF,
]

function formatLabel(f: BarcodeFormat): string {
  switch (f) {
    case BarcodeFormat.CODE_128:
      return 'code_128'
    case BarcodeFormat.CODE_39:
      return 'code_39'
    case BarcodeFormat.EAN_13:
      return 'ean_13'
    case BarcodeFormat.EAN_8:
      return 'ean_8'
    case BarcodeFormat.UPC_A:
      return 'upc_a'
    case BarcodeFormat.UPC_E:
      return 'upc_e'
    case BarcodeFormat.ITF:
      return 'itf'
    default:
      return String(f)
  }
}

/**
 * Lector específico para códigos de barras 1D (@zxing/browser). Misma API
 * pública que CodeScanner para ser usado por ScannerByReaderType cuando la
 * tintorería tiene reader_type='barcode'. No lee QR.
 */
export default function BarcodeScanner({
  onRead,
  paused = false,
  title = 'Escanear código de barras',
  manualLabel = 'Código manual',
  manualPlaceholder = 'Escaneá o ingresá el código',
  hideManualInput = false,
  variant = 'embedded',
  className = '',
}: {
  onRead: (result: CodeScannerResult) => void
  paused?: boolean
  title?: string
  manualLabel?: string
  manualPlaceholder?: string
  hideManualInput?: boolean
  variant?: 'standalone' | 'embedded'
  className?: string
}) {
  const onReadRef = useRef(onRead)
  const successTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const controlsRef = useRef<IScannerControls | null>(null)
  const pausedRef = useRef(paused)
  const videoRef = useRef<HTMLVideoElement | null>(null)

  const [status, setStatus] = useState<ScannerStatus>('starting')
  const [manualValue, setManualValue] = useState('')
  const [scanSuccess, setScanSuccess] = useState(false)

  useEffect(() => {
    onReadRef.current = onRead
  }, [onRead])

  useEffect(() => {
    pausedRef.current = paused
  }, [paused])

  const emitRead = useCallback((result: CodeScannerResult) => {
    const raw = result.texto.trim()
    if (!raw) return
    // numero_pieza es TEXT: los ceros a la izquierda son significativos, se conservan tal cual.
    const texto = raw

    setScanSuccess(true)
    if (successTimeoutRef.current) clearTimeout(successTimeoutRef.current)
    successTimeoutRef.current = setTimeout(() => {
      setScanSuccess(false)
    }, SUCCESS_MS)

    beep()
    navigator.vibrate?.(100)
    onReadRef.current({ texto, formato: result.formato, manual: result.manual })
  }, [])

  useEffect(() => {
    if (
      typeof navigator === 'undefined' ||
      !navigator.mediaDevices?.getUserMedia
    ) {
      queueMicrotask(() => setStatus('unsupported'))
      return
    }

    const startTimer = setTimeout(() => {
      setStatus((s) => (s === 'starting' ? 'ready' : s))
    }, STARTING_OVERLAY_MS)

    const hints = new Map()
    hints.set(DecodeHintType.POSSIBLE_FORMATS, BARCODE_FORMATS)
    hints.set(DecodeHintType.TRY_HARDER, true)
    const reader = new BrowserMultiFormatReader(hints)

    let cancelled = false

    const constraints: MediaStreamConstraints = {
      audio: false,
      video: { facingMode: { ideal: 'environment' } },
    }

    reader
      .decodeFromConstraints(constraints, videoRef.current!, (result) => {
        if (pausedRef.current) return
        if (!result) return
        const formato = formatLabel(result.getBarcodeFormat())
        emitRead({ texto: result.getText(), formato })
      })
      .then((controls) => {
        if (cancelled) {
          controls.stop()
          return
        }
        controlsRef.current = controls
      })
      .catch((err: unknown) => {
        const name = (err as Error)?.name ?? ''
        const msg = (err as Error)?.message ?? String(err)
        if (name === 'NotAllowedError' || name === 'SecurityError') {
          setStatus('permission-denied')
          return
        }
        if (
          name === 'NotFoundError' ||
          name === 'OverconstrainedError' ||
          msg.toLowerCase().includes('insecure')
        ) {
          setStatus('unsupported')
          return
        }
        console.warn('BarcodeScanner start error:', err)
        setStatus('error')
      })

    return () => {
      cancelled = true
      clearTimeout(startTimer)
      if (successTimeoutRef.current) clearTimeout(successTimeoutRef.current)
      const controls = controlsRef.current
      controlsRef.current = null
      if (controls) {
        try {
          controls.stop()
        } catch {
          /* noop */
        }
      }
    }
  }, [emitRead])

  function handleManualSubmit(e: React.FormEvent) {
    e.preventDefault()
    const texto = manualValue.trim()
    if (!texto) return
    emitRead({ texto, formato: null, manual: true })
    setManualValue('')
  }

  const standalone = variant === 'standalone'

  return (
    <section
      className={`space-y-3 ${
        standalone ? 'mx-auto w-full max-w-xl p-4 sm:p-6' : ''
      } ${className}`}
    >
      <div className="rounded-lg border bg-white p-4 shadow-sm">
        <div className="flex items-center justify-between gap-3">
          <h2 className="font-heading text-base font-semibold">{title}</h2>
          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700">
            Barcode
          </span>
        </div>

        {status === 'unsupported' ? (
          <CameraMessage
            title="Este navegador no permite usar la cámara"
            text="Usá HTTPS o localhost para habilitar getUserMedia. Mientras tanto, podés ingresar el código manualmente con el campo de abajo."
          />
        ) : (
          <div className="mt-3 overflow-hidden rounded-lg bg-black">
            <div className="relative aspect-[4/3] w-full">
              <video
                ref={videoRef}
                className="absolute inset-0 h-full w-full object-cover"
                muted
                playsInline
              />

              <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-6">
                <div
                  className={`relative h-24 w-64 max-w-[80vw] transition-colors ${
                    scanSuccess ? 'scan-success' : ''
                  }`}
                >
                  <div className="scanner-corner absolute left-0 top-0 size-10 rounded-tl border-l-4 border-t-4 border-white/80" />
                  <div className="scanner-corner absolute right-0 top-0 size-10 rounded-tr border-r-4 border-t-4 border-white/80" />
                  <div className="scanner-corner absolute bottom-0 left-0 size-10 rounded-bl border-b-4 border-l-4 border-white/80" />
                  <div className="scanner-corner absolute bottom-0 right-0 size-10 rounded-br border-b-4 border-r-4 border-white/80" />
                </div>
              </div>

              {status === 'starting' && (
                <CameraOverlay>Iniciando cámara…</CameraOverlay>
              )}

              {status === 'permission-denied' && (
                <CameraOverlay>
                  <span className="block font-semibold">
                    No tenemos permiso para usar la cámara.
                  </span>
                  <span className="mt-1 block text-xs text-white/75">
                    Habilitá la cámara desde el candado del navegador y recargá
                    la página. También podés ingresar el código manualmente.
                  </span>
                </CameraOverlay>
              )}

              {status === 'error' && (
                <CameraOverlay>
                  No se pudo iniciar la cámara. Probá recargar la página o usá
                  HTTPS/localhost y el ingreso manual.
                </CameraOverlay>
              )}
            </div>
          </div>
        )}

        {!hideManualInput && (
          <form onSubmit={handleManualSubmit} className="mt-4 space-y-2">
            <label className="text-xs font-medium text-muted-foreground">
              {manualLabel}
            </label>
            <div className="flex flex-col gap-2 sm:flex-row">
              <input
                value={manualValue}
                onChange={(e) => setManualValue(e.target.value)}
                placeholder={manualPlaceholder}
                inputMode="numeric"
                pattern="[0-9]*"
                className="min-w-0 flex-1 rounded-md border border-input bg-white px-3 py-2.5 text-sm"
              />
              <button
                type="submit"
                disabled={!manualValue.trim()}
                className="inline-flex min-h-11 items-center justify-center rounded-md bg-action px-4 text-sm font-semibold text-action-foreground transition-colors hover:bg-action/90 disabled:opacity-50"
              >
                Usar código
              </button>
            </div>
          </form>
        )}
      </div>
    </section>
  )
}

function CameraOverlay({ children }: { children: React.ReactNode }) {
  return (
    <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/70 px-6 text-center text-sm text-white">
      <p>{children}</p>
    </div>
  )
}

function CameraMessage({ title, text }: { title: string; text: string }) {
  return (
    <div className="mt-3 rounded-lg border border-warning/30 bg-warning/10 p-4 text-sm">
      <p className="font-medium text-foreground">{title}</p>
      <p className="mt-1 text-muted-foreground">{text}</p>
    </div>
  )
}

function beep() {
  try {
    const AudioContextCtor = window.AudioContext || window.webkitAudioContext
    if (!AudioContextCtor) return

    const ctx = new AudioContextCtor()
    const oscillator = ctx.createOscillator()
    const gain = ctx.createGain()

    oscillator.type = 'sine'
    oscillator.frequency.value = 1200
    gain.gain.value = 0.08

    oscillator.connect(gain)
    gain.connect(ctx.destination)
    oscillator.start()
    oscillator.stop(ctx.currentTime + 0.15)
    oscillator.onended = () => {
      void ctx.close()
    }
  } catch {
    // Audio feedback is best-effort only.
  }
}
