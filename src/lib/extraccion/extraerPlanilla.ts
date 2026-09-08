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
  | 'OPENROUTER_ERROR' // falla técnica no clasificada de OpenRouter
  | 'AI_ALL_PROVIDERS_FAILED' // fallaron todos los intentos disponibles
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

type ResultadoFallido = Extract<ExtraccionResult, { ok: false }>

type IntentoFallido = ResultadoFallido & {
  proveedor: string
  modelo: string
}

// La Server Action dispone de 120 s. Reservamos 15 s para descargar el archivo,
// serializar la respuesta y cualquier latencia de la plataforma.
const PRESUPUESTO_TOTAL_MS = 105_000
const TIMEOUT_GEMINI_PRINCIPAL_MS = 45_000
const TIMEOUT_OPENROUTER_MAX_MS = 75_000
const TIMEOUT_GEMINI_FALLBACK_MAX_MS = 30_000
const RESERVA_GEMINI_FALLBACK_MS = 15_000
const TIMEOUT_MINIMO_INTENTO_MS = 8_000

function idExtraccion(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

async function ejecutarIntento(
  id: string,
  proveedor: string,
  modelo: string,
  timeoutMs: number,
  fileBuffer: Buffer,
  mimeType: string,
  ejecutar: () => Promise<ExtraccionResult>
): Promise<ExtraccionResult> {
  const inicio = Date.now()
  console.info(
    `[extraccion:${id}] inicio proveedor=${proveedor} modelo=${modelo} mime=${mimeType} bytes=${fileBuffer.byteLength} timeout_ms=${timeoutMs}`
  )
  const resultado = await ejecutar()
  const detalle = resultado.ok ? 'ok=true' : `ok=false codigo=${resultado.codigo}`
  console.info(
    `[extraccion:${id}] fin proveedor=${proveedor} modelo=${modelo} duracion_ms=${Date.now() - inicio} ${detalle}`
  )
  return resultado
}

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
 * Gemini es el proveedor principal, OpenRouter es el respaldo independiente y
 * el segundo modelo de Gemini queda como tercer y último intento. Los tres
 * comparten un presupuesto de tiempo menor al límite de la Server Action.
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

  const inicio = Date.now()
  const deadline = inicio + PRESUPUESTO_TOTAL_MS
  const id = idExtraccion()
  const fallos: IntentoFallido[] = []
  const restante = () => Math.max(0, deadline - Date.now())
  const registrarFallo = (
    proveedor: string,
    modelo: string,
    resultado: ResultadoFallido
  ) => fallos.push({ proveedor, modelo, ...resultado })

  console.info(
    `[extraccion:${id}] solicitud mime=${mimeType} bytes=${fileBuffer.byteLength} presupuesto_ms=${PRESUPUESTO_TOTAL_MS}`
  )

  const modeloPrincipal = modeloGeminiPrincipal()
  const timeoutPrincipal = Math.min(
    TIMEOUT_GEMINI_PRINCIPAL_MS,
    restante()
  )
  const resultadoPrincipal = await ejecutarIntento(
    id,
    'gemini',
    modeloPrincipal,
    timeoutPrincipal,
    fileBuffer,
    mimeType,
    () =>
      extraerConGemini(
        fileBuffer,
        mimeType,
        customPrompt,
        modeloPrincipal,
        timeoutPrincipal
      )
  )
  if (resultadoPrincipal.ok) return resultadoPrincipal
  registrarFallo('Gemini principal', modeloPrincipal, resultadoPrincipal)

  const modeloFallback = modeloGeminiFallback()
  const puedeUsarGeminiFallback =
    Boolean(process.env.GEMINI_API_KEY?.trim()) &&
    modeloFallback !== modeloPrincipal

  if (process.env.OPENROUTER_API_KEY?.trim()) {
    const {
      archivoCompatibleConOpenRouter,
      extraerConOpenRouter,
      modeloOpenRouterFallback,
    } = await import('./openrouter')
    if (archivoCompatibleConOpenRouter(mimeType)) {
      const modeloOpenRouter = modeloOpenRouterFallback()
      const reservaFallback = puedeUsarGeminiFallback
        ? RESERVA_GEMINI_FALLBACK_MS
        : 0
      const timeoutOpenRouter = Math.min(
        TIMEOUT_OPENROUTER_MAX_MS,
        Math.max(0, restante() - reservaFallback)
      )
      if (timeoutOpenRouter >= TIMEOUT_MINIMO_INTENTO_MS) {
        console.warn(
          `[extraccion:${id}] activando OpenRouter por ${resultadoPrincipal.codigo}; restante_ms=${restante()}`
        )
        const resultadoOpenRouter = await ejecutarIntento(
          id,
          'openrouter',
          modeloOpenRouter,
          timeoutOpenRouter,
          fileBuffer,
          mimeType,
          () =>
            extraerConOpenRouter(
              fileBuffer,
              mimeType,
              customPrompt,
              timeoutOpenRouter
            )
        )
        if (resultadoOpenRouter.ok) return resultadoOpenRouter
        registrarFallo('OpenRouter', modeloOpenRouter, resultadoOpenRouter)
      } else {
        console.warn(
          `[extraccion:${id}] OpenRouter omitido: presupuesto insuficiente restante_ms=${restante()}`
        )
      }
    } else {
      console.warn(
        `[extraccion:${id}] OpenRouter omitido: mime no compatible (${mimeType})`
      )
    }
  }

  if (puedeUsarGeminiFallback) {
    const timeoutFallback = Math.min(
      TIMEOUT_GEMINI_FALLBACK_MAX_MS,
      restante()
    )
    if (timeoutFallback >= TIMEOUT_MINIMO_INTENTO_MS) {
      console.warn(
        `[extraccion:${id}] activando Gemini de respaldo; restante_ms=${restante()}`
      )
      const resultadoFallback = await ejecutarIntento(
        id,
        'gemini',
        modeloFallback,
        timeoutFallback,
        fileBuffer,
        mimeType,
        () =>
          extraerConGemini(
            fileBuffer,
            mimeType,
            customPrompt,
            modeloFallback,
            timeoutFallback
          )
      )
      if (resultadoFallback.ok) return resultadoFallback
      registrarFallo('Gemini respaldo', modeloFallback, resultadoFallback)
    } else {
      console.warn(
        `[extraccion:${id}] Gemini de respaldo omitido: presupuesto insuficiente restante_ms=${restante()}`
      )
    }
  }

  if (
    resultadoPrincipal.codigo === 'NO_API_KEY' &&
    !process.env.OPENROUTER_API_KEY?.trim()
  ) {
    return {
      ok: false,
      codigo: 'NO_API_KEY',
      error:
        'No hay ningún proveedor de IA configurado. Falta GEMINI_API_KEY u OPENROUTER_API_KEY.',
    }
  }

  if (fallos.length === 1) return resultadoPrincipal

  const falloConcreto = [...fallos]
    .reverse()
    .find(
      ({ codigo }) =>
        codigo === 'FORMATO_INVALIDO' || codigo === 'JSON_INVALID'
    )
  if (falloConcreto) {
    return {
      ok: false,
      codigo: falloConcreto.codigo,
      error: falloConcreto.error,
    }
  }

  const diagnostico = fallos
    .map(
      ({ proveedor, modelo, error }) =>
        `${proveedor} (${modelo}): ${error}`
    )
    .join(' | ')

  return {
    ok: false,
    codigo: 'AI_ALL_PROVIDERS_FAILED',
    error: `No se pudo procesar la planilla con ninguno de los intentos. ${diagnostico}`,
  }
}

/**
 * Umbral por debajo del cual marcamos una celda como "baja confianza"
 * (borde de warning en la UI). Decidido en grilling de Etapa 3 (mayo 2026).
 */
export const UMBRAL_BAJA_CONFIANZA = 0.85
