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

type ResultadoExitoso = Extract<ExtraccionResult, { ok: true }>

type CandidatoParcial = {
  proveedor: string
  modelo: string
  resultado: ResultadoExitoso
}

type IntentoPendiente = {
  proveedor: string
  proveedorLog: string
  modelo: string
  ejecutar: () => Promise<ExtraccionResult>
}

// La Server Action dispone de 120 s. Reservamos 15 s para descargar el archivo,
// serializar la respuesta y cualquier latencia de la plataforma. Después del
// intento principal, los respaldos corren en paralelo para que un proveedor
// lento no consuma el tiempo disponible del siguiente.
const PRESUPUESTO_TOTAL_MS = 105_000
const TIMEOUT_GEMINI_PRINCIPAL_MS = 45_000
const TIMEOUT_FALLBACK_PARALELO_MAX_MS = 60_000
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

function cantidadValoresExtraidos(resultado: ResultadoExitoso): number {
  const { data } = resultado
  const conValor = (campo: Field<unknown>) =>
    campo.value !== null &&
    campo.value !== undefined &&
    (typeof campo.value !== 'string' || campo.value.trim().length > 0)

  const header = [
    data.numero_remito,
    data.fecha,
    data.color,
    data.ot,
    data.rem_tejeduria,
    data.referencia,
    data.total_rollos_declarado,
    data.total_kilos_declarado,
  ].filter(conValor).length
  const rollos = data.rollos.reduce(
    (total, rollo) =>
      total +
      [
        rollo.numero_pieza,
        rollo.kilos,
        rollo.metros,
        rollo.ratio,
        rollo.gramaje_planilla,
        rollo.articulo,
        rollo.color,
      ].filter(conValor).length,
    0
  )

  return header + rollos
}

/**
 * Procesa una imagen (JPG/PNG) o PDF de planilla y devuelve los datos
 * estructurados con confianza por campo.
 *
 * @param fileBuffer Buffer del archivo
 * @param mimeType MIME type del archivo
 * @param customPrompt Pistas de layout y alias de la tintorería (campo
 *   `tintorerias.extraction_prompt` en DB), agregadas al contrato universal.
 *
 * Gemini es el proveedor principal. Si falla o devuelve menos rollos que los
 * declarados, OpenRouter y el segundo Gemini se ejecutan en paralelo. Los
 * intentos comparten un presupuesto menor al límite de la Server Action.
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
  const candidatosParciales: CandidatoParcial[] = []
  let mayorTotalDeclarado = 0
  const restante = () => Math.max(0, deadline - Date.now())
  const registrarFallo = (
    proveedor: string,
    modelo: string,
    resultado: ResultadoFallido
  ) => fallos.push({ proveedor, modelo, ...resultado })
  const registrarTotalDeclarado = (resultado: ResultadoExitoso) => {
    const total = resultado.data.total_rollos_declarado.value
    if (typeof total === 'number' && Number.isFinite(total) && total > 0) {
      mayorTotalDeclarado = Math.max(mayorTotalDeclarado, Math.floor(total))
    }
  }
  const aceptarORegistrarParcial = (
    proveedor: string,
    modelo: string,
    resultado: ResultadoExitoso
  ): boolean => {
    registrarTotalDeclarado(resultado)

    const extraidos = resultado.data.rollos.length
    if (mayorTotalDeclarado > 0 && extraidos < mayorTotalDeclarado) {
      candidatosParciales.push({ proveedor, modelo, resultado })
      console.warn(
        `[extraccion:${id}] resultado incompleto proveedor=${proveedor} modelo=${modelo} declarados=${mayorTotalDeclarado} extraidos=${extraidos}; continuando fallback`
      )
      return false
    }

    return true
  }

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
  if (resultadoPrincipal.ok) {
    if (
      aceptarORegistrarParcial(
        'Gemini principal',
        modeloPrincipal,
        resultadoPrincipal
      )
    ) {
      return resultadoPrincipal
    }
  } else {
    registrarFallo('Gemini principal', modeloPrincipal, resultadoPrincipal)
  }

  const modeloFallback = modeloGeminiFallback()
  const puedeUsarGeminiFallback =
    Boolean(process.env.GEMINI_API_KEY?.trim()) &&
    modeloFallback !== modeloPrincipal

  const intentosFallback: IntentoPendiente[] = []
  const timeoutFallback = Math.min(
    TIMEOUT_FALLBACK_PARALELO_MAX_MS,
    restante()
  )

  if (
    timeoutFallback >= TIMEOUT_MINIMO_INTENTO_MS &&
    process.env.OPENROUTER_API_KEY?.trim()
  ) {
    const {
      archivoCompatibleConOpenRouter,
      extraerConOpenRouter,
      modelosOpenRouterFallback,
    } = await import('./openrouter')
    if (archivoCompatibleConOpenRouter(mimeType)) {
      for (const modelo of modelosOpenRouterFallback()) {
        intentosFallback.push({
          proveedor: 'OpenRouter',
          proveedorLog: 'openrouter',
          modelo,
          ejecutar: () =>
            extraerConOpenRouter(
              fileBuffer,
              mimeType,
              customPrompt,
              timeoutFallback,
              modelo
            ),
        })
      }
    } else {
      console.warn(
        `[extraccion:${id}] OpenRouter omitido: mime no compatible (${mimeType})`
      )
    }
  }

  if (
    timeoutFallback >= TIMEOUT_MINIMO_INTENTO_MS &&
    puedeUsarGeminiFallback
  ) {
    intentosFallback.push({
      proveedor: 'Gemini respaldo',
      proveedorLog: 'gemini',
      modelo: modeloFallback,
      ejecutar: () =>
        extraerConGemini(
          fileBuffer,
          mimeType,
          customPrompt,
          modeloFallback,
          timeoutFallback
        ),
    })
  }

  if (intentosFallback.length > 0) {
    console.warn(
      `[extraccion:${id}] activando respaldos en paralelo intentos=${intentosFallback.length} timeout_ms=${timeoutFallback} motivo=${resultadoPrincipal.ok ? 'EXTRACCION_INCOMPLETA' : resultadoPrincipal.codigo}`
    )
    const resultadosFallback = await Promise.all(
      intentosFallback.map(async (intento) => ({
        intento,
        resultado: await ejecutarIntento(
          id,
          intento.proveedorLog,
          intento.modelo,
          timeoutFallback,
          fileBuffer,
          mimeType,
          intento.ejecutar
        ),
      }))
    )

    // Todos terminaron: primero consolidamos el mayor total declarado. Esto
    // evita aceptar un falso 1/1 de un proveedor cuando otro leyó 24 rollos.
    for (const { resultado } of resultadosFallback) {
      if (resultado.ok) registrarTotalDeclarado(resultado)
    }

    const candidatosCompletos: CandidatoParcial[] = []
    for (const { intento, resultado } of resultadosFallback) {
      if (resultado.ok) {
        if (
          aceptarORegistrarParcial(
            intento.proveedor,
            intento.modelo,
            resultado
          )
        ) {
          candidatosCompletos.push({
            proveedor: intento.proveedor,
            modelo: intento.modelo,
            resultado,
          })
        }
      } else {
        registrarFallo(intento.proveedor, intento.modelo, resultado)
      }
    }

    if (candidatosCompletos.length > 0) {
      // Si más de un respaldo funcionó, priorizamos cantidad de filas y luego
      // cantidad de campos completos (por ejemplo, no perder el color).
      const mejorCompleto = candidatosCompletos.reduce((mejor, candidato) => {
        const filasCandidato = candidato.resultado.data.rollos.length
        const filasMejor = mejor.resultado.data.rollos.length
        if (filasCandidato !== filasMejor) {
          return filasCandidato > filasMejor ? candidato : mejor
        }
        return cantidadValoresExtraidos(candidato.resultado) >
          cantidadValoresExtraidos(mejor.resultado)
          ? candidato
          : mejor
      })
      console.info(
        `[extraccion:${id}] resultado elegido proveedor=${mejorCompleto.proveedor} modelo=${mejorCompleto.modelo} extraidos=${mejorCompleto.resultado.data.rollos.length} declarados=${mayorTotalDeclarado}`
      )
      return mejorCompleto.resultado
    }
  } else if (restante() < TIMEOUT_MINIMO_INTENTO_MS) {
    console.warn(
      `[extraccion:${id}] respaldos omitidos: presupuesto insuficiente restante_ms=${restante()}`
    )
  }

  if (
    !resultadoPrincipal.ok &&
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

  if (candidatosParciales.length > 0) {
    const mejorCandidato = candidatosParciales.reduce((mejor, candidato) =>
      candidato.resultado.data.rollos.length > mejor.resultado.data.rollos.length
        ? candidato
        : mejor
    )
    console.warn(
      `[extraccion:${id}] devolviendo mejor resultado parcial proveedor=${mejorCandidato.proveedor} modelo=${mejorCandidato.modelo} extraidos=${mejorCandidato.resultado.data.rollos.length} declarados=${mayorTotalDeclarado}`
    )
    return mejorCandidato.resultado
  }

  if (fallos.length === 1) return resultadoPrincipal

  const falloConcreto = [...fallos]
    .reverse()
    .find(({ codigo }) => codigo === 'FORMATO_INVALIDO')
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
