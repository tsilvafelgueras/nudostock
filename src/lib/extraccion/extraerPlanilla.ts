/**
 * Interfaces públicas para extracción de planillas con IA.
 *
 * La IA nos devuelve cada campo extraído como `{ value, confidence }` para
 * que la UI pueda mostrar borde de "baja confianza" por campo.
 *
 * - `value` puede ser null si la IA no encontró el campo en la planilla.
 * - `confidence` va de 0 a 1. Umbral de "baja confianza" actualmente: 0.85.
 */

export type Field<T> = {
  value: T | null
  confidence: number
}

export type RolloExtraido = {
  numero_pieza: Field<string>
  kilos: Field<number>
  metros: Field<number>
  ratio: Field<number>
  gramaje_planilla: Field<number>
  articulo: Field<string>
  color: Field<string>
}

export type IngresoExtraido = {
  numero_remito: Field<string>
  fecha: Field<string> // ISO 'YYYY-MM-DD'
  // Color del lote a nivel header — fallback opcional para planillas con
  // un único color para todos los rollos. Si viene seteado y los rollos
  // no traen color propio, la UI lo aplica como bulk a todos los rollos.
  color: Field<string>
  ot: Field<string>
  rem_tejeduria: Field<string>
  referencia: Field<string>
  total_rollos_declarado: Field<number>
  total_kilos_declarado: Field<number>
  rollos: RolloExtraido[]
}

export type CodigoErrorExtraccion =
  | 'GEMINI_ERROR' // falla técnica no clasificada de Gemini
  | 'OPENAI_ERROR' // falla técnica no clasificada de OpenAI
  | 'AI_ALL_PROVIDERS_FAILED' // fallaron el proveedor principal y el alternativo
  | 'AI_QUOTA_EXCEEDED' // cuota/rate-limit del proveedor (429)
  | 'AI_OVERLOADED' // capacidad temporal del proveedor (503)
  | 'AI_TIMEOUT' // el proveedor no respondió dentro del límite local
  | 'AI_UNAVAILABLE' // error interno temporal del proveedor (5xx)
  | 'AI_MODEL_UNAVAILABLE' // modelo no disponible para el proyecto/API
  | 'JSON_INVALID' // la IA devolvió texto pero no parseó como JSON
  | 'NO_API_KEY' // API key del proveedor no configurada
  | 'FORMATO_INVALIDO' // la imagen no parece una planilla (0 rollos extraídos)
  | 'OTHER'

export type ExtraccionResult =
  | { ok: true; data: IngresoExtraido }
  | { ok: false; error: string; codigo: CodigoErrorExtraccion }

/**
 * Procesa una imagen (JPG/PNG) o PDF de planilla y devuelve los datos
 * estructurados con confianza por campo.
 *
 * @param fileBuffer Buffer del archivo
 * @param mimeType MIME type del archivo
 * @param customPrompt Prompt custom de la tintorería (campo
 *   `tintorerias.extraction_prompt` en DB). Si es null/vacío, se usa el
 *   prompt default genérico definido en `./prompt.ts`.
 *
 * Gemini es el proveedor principal. OpenAI es el respaldo independiente; si
 * no está configurado o el formato no es compatible (HEIC/HEIF), se conserva
 * el segundo modelo de Gemini como último recurso.
 */
export async function extraerPlanilla(
  fileBuffer: Buffer,
  mimeType: string,
  customPrompt: string | null
): Promise<ExtraccionResult> {
  const {
    extraerConGemini,
    modeloGeminiFallback,
    modeloGeminiPrincipal,
  } = await import('./gemini')

  const modeloPrincipal = modeloGeminiPrincipal()
  const resultadoPrincipal = await extraerConGemini(
    fileBuffer,
    mimeType,
    customPrompt,
    modeloPrincipal
  )
  if (resultadoPrincipal.ok) return resultadoPrincipal

  if (process.env.OPENAI_API_KEY?.trim()) {
    const { archivoCompatibleConOpenAI, extraerConOpenAI } = await import(
      './openai'
    )
    if (archivoCompatibleConOpenAI(mimeType)) {
      console.warn(
        `[extraccion] activando fallback OpenAI por ${resultadoPrincipal.codigo}`
      )
      const resultadoOpenAI = await extraerConOpenAI(
        fileBuffer,
        mimeType,
        customPrompt
      )
      if (resultadoOpenAI.ok) return resultadoOpenAI

      // Si ambos proveedores coincidieron en que el archivo no era una
      // planilla o la respuesta era inválida, devolvemos el diagnóstico más
      // concreto. Para dos fallas técnicas, explicitamos que fallaron ambos.
      if (
        resultadoOpenAI.codigo === 'FORMATO_INVALIDO' ||
        resultadoOpenAI.codigo === 'JSON_INVALID'
      ) {
        return resultadoOpenAI
      }
      return {
        ok: false,
        codigo: 'AI_ALL_PROVIDERS_FAILED',
        error: `No se pudo procesar la planilla con ninguno de los proveedores. Gemini: ${resultadoPrincipal.error} OpenAI: ${resultadoOpenAI.error}`,
      }
    }
  }

  const modeloFallback = modeloGeminiFallback()
  if (
    process.env.GEMINI_API_KEY?.trim() &&
    modeloFallback !== modeloPrincipal
  ) {
    console.warn(
      `[extraccion] OpenAI no disponible para ${mimeType}; probando ${modeloFallback}`
    )
    return extraerConGemini(
      fileBuffer,
      mimeType,
      customPrompt,
      modeloFallback
    )
  }

  if (
    resultadoPrincipal.codigo === 'NO_API_KEY' &&
    !process.env.OPENAI_API_KEY?.trim()
  ) {
    return {
      ok: false,
      codigo: 'NO_API_KEY',
      error:
        'No hay ningún proveedor de IA configurado. Falta GEMINI_API_KEY u OPENAI_API_KEY.',
    }
  }

  return resultadoPrincipal
}

/**
 * Umbral por debajo del cual marcamos una celda como "baja confianza"
 * (borde de warning en la UI). Decidido en grilling de Etapa 3 (mayo 2026).
 */
export const UMBRAL_BAJA_CONFIANZA = 0.85
