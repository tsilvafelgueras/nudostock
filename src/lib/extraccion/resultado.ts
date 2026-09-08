import { normalizarFechaISO } from '@/lib/fechas'
import type {
  CodigoErrorExtraccion,
  ExtraccionResult,
  IngresoExtraido,
  RolloExtraido,
} from './extraerPlanilla'

function esNumeroPositivo(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
}

function sumarCampoCompleto(
  rollos: RolloExtraido[],
  campo: 'kilos' | 'metros'
): { suma: number; confianzaPromedio: number } | null {
  if (rollos.length === 0) return null

  let suma = 0
  let confianza = 0
  for (const rollo of rollos) {
    const field = rollo[campo]
    if (!esNumeroPositivo(field?.value)) return null
    suma += field.value
    confianza += field.confidence
  }

  return {
    suma: Math.round(suma * 100) / 100,
    confianzaPromedio: confianza / rollos.length,
  }
}

/**
 * Algunos modelos leen el total de metros impreso al pie de la planilla como
 * si fuera el total de kilos. Solo lo corregimos cuando ambas columnas están
 * completas y la coincidencia matemática no deja lugar a esa ambigüedad.
 */
function corregirTotalKilosConfundidoConMetros(parsed: IngresoExtraido): void {
  const totalLeido = parsed.total_kilos_declarado?.value
  if (!esNumeroPositivo(totalLeido)) return

  const kilos = sumarCampoCompleto(parsed.rollos ?? [], 'kilos')
  const metros = sumarCampoCompleto(parsed.rollos ?? [], 'metros')
  if (!kilos || !metros) return

  const toleranciaMetros = Math.max(0.5, metros.suma * 0.001)
  const toleranciaKilos = Math.max(0.5, kilos.suma * 0.01)
  const coincideConMetros =
    Math.abs(totalLeido - metros.suma) <= toleranciaMetros
  const coincideConKilos = Math.abs(totalLeido - kilos.suma) <= toleranciaKilos

  if (!coincideConMetros || coincideConKilos) return

  console.info(
    `[extraccion] total_kilos corregido: el valor leído coincide con total_metros; kilos=${kilos.suma} metros=${metros.suma}`
  )
  parsed.total_kilos_declarado = {
    value: kilos.suma,
    confidence: Math.min(0.95, kilos.confianzaPromedio * 0.9),
  }
}

export function interpretarRespuestaIA(
  text: string | null | undefined,
  codigoSinContenido: CodigoErrorExtraccion
): ExtraccionResult {
  if (!text) {
    return {
      ok: false,
      error: 'La IA no devolvió contenido',
      codigo: codigoSinContenido,
    }
  }

  try {
    const parsed = JSON.parse(text) as IngresoExtraido
    if (parsed.fecha) {
      parsed.fecha.value = normalizarFechaISO(parsed.fecha.value)
    }
    for (const rollo of parsed.rollos ?? []) {
      const kilos = rollo.kilos?.value
      const metros = rollo.metros?.value
      const ratio = rollo.ratio?.value
      if (
        (typeof kilos !== 'number' || !Number.isFinite(kilos) || kilos <= 0) &&
        typeof metros === 'number' &&
        Number.isFinite(metros) &&
        metros > 0 &&
        typeof ratio === 'number' &&
        Number.isFinite(ratio) &&
        ratio > 0
      ) {
        const kilosCalculados = metros / ratio
        if (kilosCalculados > 0 && kilosCalculados <= 1_000) {
          rollo.kilos = {
            value: Math.round(kilosCalculados * 100) / 100,
            confidence:
              Math.min(
                rollo.metros?.confidence ?? 0,
                rollo.ratio?.confidence ?? 0
              ) * 0.85,
          }
        }
      }
    }
    corregirTotalKilosConfundidoConMetros(parsed)
    if (!parsed.rollos || parsed.rollos.length === 0) {
      return {
        ok: false,
        error:
          'La imagen no parece ser una planilla de tintorería válida. La IA no encontró ningún rollo. Verificá que subiste la foto correcta.',
        codigo: 'FORMATO_INVALIDO',
      }
    }
    return { ok: true, data: parsed }
  } catch (e) {
    return {
      ok: false,
      error: `JSON inválido en respuesta de IA: ${(e as Error).message}`,
      codigo: 'JSON_INVALID',
    }
  }
}
