import { normalizarFechaISO } from '@/lib/fechas'
import type {
  CodigoErrorExtraccion,
  ExtraccionResult,
  IngresoExtraido,
} from './extraerPlanilla'

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
