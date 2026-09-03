import { GoogleGenAI, Type, type Schema } from '@google/genai'
import type {
  IngresoExtraido,
  ExtraccionResult,
} from './extraerPlanilla'
import { normalizarFechaISO } from '@/lib/fechas'

// 3.6 Flash es estable, multimodal y soporta PDF + Structured Outputs.
// Dejamos 2.5 Flash como respaldo porque las cuotas/capacidad de Gemini se
// aplican por modelo y una caída transitoria no debería bloquear el ingreso.
const MODELO_PRINCIPAL = 'gemini-3.6-flash'
const MODELO_FALLBACK = 'gemini-2.5-flash'
const TIMEOUT_MS = 35_000
const MAX_INTENTOS = 3

// ── Prompt base ────────────────────────────────────────────
//
// Es la parte fija del prompt: rol del asistente + formato de salida.
// Las instrucciones específicas de cada tintorería (campo `extraction_prompt`
// en la tabla `tintorerias`, editado por el superadmin) se concatenan después
// en buildPrompt(). Si no hay prompt custom, usamos DEFAULT_INSTRUCTIONS.

const PROMPT_BASE = `
Sos un asistente experto en procesar planillas de remitos de tintorerías textiles argentinas.

Te paso una imagen o PDF de una planilla. Extraé TODOS los datos en formato JSON estructurado, según el schema dado.

REGLA CRÍTICA — FECHA:
El campo \`fecha\` SIEMPRE debe devolverse como ISO "YYYY-MM-DD" (año-mes-día con guiones, año de 4 dígitos).
NUNCA usar barras "/" ni puntos. NUNCA copiar el formato original de la planilla.
En Argentina la planilla viene en DD/MM/YYYY → SIEMPRE convertir antes de devolver.
Ejemplos obligatorios:
  · "03/05/2026" → "2026-05-03"
  · "3/5/26"     → "2026-05-03"
  · "03-05-26"   → "2026-05-03"

Devolvé el JSON directamente. No agregues explicaciones ni texto adicional fuera del JSON.
`.trim()

const DEFAULT_INSTRUCTIONS = `
La planilla es un remito de una tintorería textil argentina. Extraé los datos en formato JSON.

# HEADER (datos del lote/despacho, uno solo)

- numero_remito: número de la planilla. Aparece como "DESPACHO N°", "REMITO N°", "N° DE REMITO" o similar. Suele estar en una esquina, a veces con código de barras al lado.
- fecha: OBLIGATORIO formato ISO "YYYY-MM-DD" (año-mes-día, con guiones, 4 dígitos de año). NUNCA devolver con barras "/" ni en otro orden. En Argentina la planilla viene como DD/MM/YYYY (día primero, mes segundo) — SIEMPRE convertir. Año de 2 dígitos = 20YY. Ejemplos: "03/05/26" → "2026-05-03"; "3/5/2026" → "2026-05-03"; "03-05-2026" → "2026-05-03".
- color: color del lote a nivel header. Si la planilla declara un único color para TODA la planilla (caso típico: aparece en el header como "COLOR" o "PARTIDA EN COLOR"), ponelo acá. Si la planilla NO declara un color global y cada rollo tiene su propio color en una columna, dejá value: null acá y poné el color en cada rollo.
- ot: número de orden de trabajo de la tintorería ("OT", "O.T.", "ORDEN").
- rem_tejeduria: remito de tejeduría ("REM. TEJ.", "REM TEJEDURIA"), del proveedor de tela cruda.
- referencia: código interno (ej "SBI"), suele ser 2-5 letras.
- total_rollos_declarado: número total de rollos.
- total_kilos_declarado: kilos despachados (NO ingresados).

# POR CADA ROLLO

- numero_pieza: identificador del rollo. String, conservar ceros a la izquierda.
- kilos: peso en kg (decimal, punto NO coma).
- metros: largo en metros (decimal).
- ratio: rendimiento m/kg (decimal). A veces "Ratio", "Rdto", "Rto".
- gramaje_planilla: g/m² (peso por m²). Suele aparecer como "Pm2", "Gramaje", "g/m²".
- articulo: nombre del artículo/tela del rollo (ej "Algodón Pima", "Modal", "Lino"). Algunas planillas traen un único artículo en el header (en ese caso, copialo en todos los rollos). Otras traen una columna "Artículo" o "Tela" por rollo. Si no aparece en ninguna parte, devolvé value: null y confidence: 0.
- color: color del rollo (ej "BLANCO", "NEGRO", "AZUL FRANCIA"). Solo poné value si la planilla tiene una columna "Color" por rollo Y el color de este rollo difiere del color global del header. Si la planilla declara un único color global en el header (y los rollos no tienen columna propia), dejá value: null acá — el color global del header ya cubre el caso. Si no aparece en ninguna parte, devolvé value: null y confidence: 0.

# CONFIANZA

Cada campo tiene un campo "confidence" (0.0-1.0):
- 1.0 = clarísimo, sin ambigüedad
- 0.85-0.95 = legible con riesgo bajo (0/O, 5/S, 1/I confundibles)
- 0.5-0.85 = legible con dudas (mancha, decimal poco claro)
- 0.0-0.5 = casi ilegible, adiviné por contexto

Si un campo NO aparece, devolvé value: null y confidence: 0.

Devolvé solo el JSON. No agregues texto adicional.
`.trim()

function buildPrompt(customPrompt: string | null): string {
  const instrucciones = customPrompt?.trim() || DEFAULT_INSTRUCTIONS
  return `${PROMPT_BASE}\n\n${instrucciones}`
}

// ── Schema (Gemini responseSchema) ──────────────────────────
//
// Cada campo de la planilla se envuelve en `{ value, confidence }` para
// que la IA reporte su confianza por celda.

function fieldString(): Schema {
  return {
    type: Type.OBJECT,
    properties: {
      value: { type: Type.STRING, nullable: true },
      confidence: { type: Type.NUMBER },
    },
    required: ['value', 'confidence'],
  }
}

function fieldNumber(): Schema {
  return {
    type: Type.OBJECT,
    properties: {
      value: { type: Type.NUMBER, nullable: true },
      confidence: { type: Type.NUMBER },
    },
    required: ['value', 'confidence'],
  }
}

const SCHEMA: Schema = {
  type: Type.OBJECT,
  properties: {
    numero_remito: fieldString(),
    fecha: fieldString(),
    color: fieldString(),
    ot: fieldString(),
    rem_tejeduria: fieldString(),
    referencia: fieldString(),
    total_rollos_declarado: fieldNumber(),
    total_kilos_declarado: fieldNumber(),
    rollos: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          numero_pieza: fieldString(),
          kilos: fieldNumber(),
          metros: fieldNumber(),
          ratio: fieldNumber(),
          gramaje_planilla: fieldNumber(),
          articulo: fieldString(),
          color: fieldString(),
        },
        required: [
          'numero_pieza',
          'kilos',
          'metros',
          'ratio',
          'gramaje_planilla',
          'articulo',
          'color',
        ],
      },
    },
  },
  required: [
    'numero_remito',
    'fecha',
    'color',
    'ot',
    'rem_tejeduria',
    'referencia',
    'total_rollos_declarado',
    'total_kilos_declarado',
    'rollos',
  ],
}

// ── Implementación ──────────────────────────────────────────

type DiagnosticoError = {
  codigo:
    | 'AI_QUOTA_EXCEEDED'
    | 'AI_OVERLOADED'
    | 'AI_TIMEOUT'
    | 'AI_UNAVAILABLE'
    | 'AI_MODEL_UNAVAILABLE'
    | 'GEMINI_ERROR'
  mensaje: string
  reintentable: boolean
}

function obtenerCodigoHttp(e: unknown): number | null {
  const err = e as { status?: unknown; code?: unknown }
  for (const valor of [err?.status, err?.code]) {
    if (typeof valor === 'number') return valor
    const match = String(valor ?? '').match(/\b([45]\d\d)\b/)
    if (match) return Number(match[1])
  }
  const match = ((e as Error)?.message ?? String(e)).match(/\b([45]\d\d)\b/)
  return match ? Number(match[1]) : null
}

// No agrupamos todos los errores transitorios bajo "sobrecargado": un 429
// suele ser cuota/rate-limit, un 503 sí es capacidad, y un timeout puede ser
// de red o del proveedor. Distinguirlos hace que el diagnóstico sea accionable.
function diagnosticarError(e: unknown): DiagnosticoError {
  const code = obtenerCodigoHttp(e)
  const msg = ((e as Error)?.message ?? String(e)).toLowerCase()

  if (
    code === 429 ||
    msg.includes('resource_exhausted') ||
    msg.includes('rate limit') ||
    msg.includes('quota')
  ) {
    return {
      codigo: 'AI_QUOTA_EXCEEDED',
      mensaje:
        'Gemini alcanzó el límite de cuota del proyecto (temporal o diario). Revisá Usage y Rate limits en Google AI Studio; si el uso es normal, activá facturación o aumentá la cuota.',
      reintentable: true,
    }
  }

  if (
    code === 404 ||
    msg.includes('model not found') ||
    msg.includes('model is not found') ||
    (msg.includes('model') && msg.includes('not supported'))
  ) {
    return {
      codigo: 'AI_MODEL_UNAVAILABLE',
      mensaje:
        'El modelo de Gemini configurado no está disponible para este proyecto o versión de API.',
      reintentable: true,
    }
  }

  if (
    code === 408 ||
    msg.includes('timeout') ||
    msg.includes('timed out') ||
    msg.includes('deadline exceeded') ||
    msg.includes('tardó demasiado')
  ) {
    return {
      codigo: 'AI_TIMEOUT',
      mensaje:
        'Gemini tardó demasiado en procesar la planilla. Probá nuevamente; si se repite, usá una foto o PDF más liviano.',
      reintentable: true,
    }
  }

  if (
    code === 503 ||
    msg.includes('overloaded') ||
    msg.includes('high demand') ||
    msg.includes('service unavailable') ||
    msg.includes('unavailable')
  ) {
    return {
      codigo: 'AI_OVERLOADED',
      mensaje:
        'Gemini está temporalmente sobrecargado. La app ya probó con un modelo alternativo; esperá unos segundos y volvé a intentar.',
      reintentable: true,
    }
  }

  if (
    code === 500 ||
    code === 502 ||
    code === 504 ||
    msg.includes('internal error')
  ) {
    return {
      codigo: 'AI_UNAVAILABLE',
      mensaje:
        'Gemini tuvo un error interno temporal. La app ya reintentó automáticamente; volvé a intentar en unos segundos.',
      reintentable: true,
    }
  }

  return {
    codigo: 'GEMINI_ERROR',
    mensaje: (e as Error)?.message ?? String(e),
    reintentable: false,
  }
}

function modelosConfigurados(): string[] {
  const principal = process.env.GEMINI_MODEL?.trim() || MODELO_PRINCIPAL
  const fallback =
    process.env.GEMINI_FALLBACK_MODEL?.trim() || MODELO_FALLBACK
  return [...new Set([principal, fallback])]
}

export async function extraerConGemini(
  fileBuffer: Buffer,
  mimeType: string,
  customPrompt: string | null
): Promise<ExtraccionResult> {
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) {
    return {
      ok: false,
      error: 'Falta GEMINI_API_KEY en las variables de entorno',
      codigo: 'NO_API_KEY',
    }
  }

  const prompt = buildPrompt(customPrompt)
  const modelos = modelosConfigurados()
  const ai = new GoogleGenAI({ apiKey })
  const archivoBase64 = fileBuffer.toString('base64')

  const llamarGemini = (modelo: string) =>
    ai.models.generateContent({
      model: modelo,
      contents: [
        {
          role: 'user',
          parts: [
            {
              inlineData: {
                data: archivoBase64,
                mimeType,
              },
            },
            { text: prompt },
          ],
        },
      ],
      config: {
        responseMimeType: 'application/json',
        responseSchema: SCHEMA,
        httpOptions: {
          timeout: TIMEOUT_MS,
          // El SDK reintenta hasta 5 veces por defecto. Como acá controlamos
          // reintentos y fallback, lo desactivamos para no multiplicar llamadas
          // (y empeorar un 429) ni exceder el tiempo de la Server Action.
          retryOptions: { attempts: 1 },
        },
      },
    })

  // Alternamos modelos ante fallos transitorios. Las cuotas de Gemini varían
  // por modelo, por lo que esto también cubre un modelo temporalmente sin cupo.
  let response
  let ultimoDiagnostico: DiagnosticoError | null = null
  let ultimoErrorCrudo = ''
  let cursorModelo = 0
  const modelosNoDisponibles = new Set<string>()
  const t0 = Date.now()
  for (let intento = 1; intento <= MAX_INTENTOS; intento++) {
    const disponibles = modelos.filter(
      (modelo) => !modelosNoDisponibles.has(modelo)
    )
    if (disponibles.length === 0) break
    const modelo = disponibles[cursorModelo % disponibles.length]
    cursorModelo++

    try {
      response = await llamarGemini(modelo)
      const u = response.usageMetadata
      console.info(
        `[extraccion] ${modelo} respondió en ${Date.now() - t0}ms (intento ${intento}) — tokens in:${u?.promptTokenCount ?? '?'} out:${u?.candidatesTokenCount ?? '?'}`
      )
      break
    } catch (e) {
      ultimoErrorCrudo = (e as Error).message ?? String(e)
      ultimoDiagnostico = diagnosticarError(e)
      const errCode = obtenerCodigoHttp(e)
      console.error(
        `[extraccion] fallo ${modelo} (intento ${intento}) code=${errCode ?? '?'} tipo=${ultimoDiagnostico.codigo}: ${ultimoErrorCrudo}`
      )
      if (ultimoDiagnostico.codigo === 'AI_MODEL_UNAVAILABLE') {
        modelosNoDisponibles.add(modelo)
      }
      if (!ultimoDiagnostico.reintentable || intento === MAX_INTENTOS) {
        return {
          ok: false,
          error: ultimoDiagnostico.mensaje,
          codigo: ultimoDiagnostico.codigo,
        }
      }
      // Backoff exponencial con jitter para evitar reintentos sincronizados.
      const demora = 800 * 2 ** (intento - 1) + Math.floor(Math.random() * 400)
      await new Promise((r) => setTimeout(r, demora))
    }
  }

  if (!response) {
    return {
      ok: false,
      error:
        ultimoDiagnostico?.mensaje ||
        ultimoErrorCrudo ||
        'La IA no respondió',
      codigo: ultimoDiagnostico?.codigo || 'GEMINI_ERROR',
    }
  }

  const text = response.text
  if (!text) {
    return {
      ok: false,
      error: 'La IA no devolvió contenido',
      codigo: 'GEMINI_ERROR',
    }
  }

  try {
    const parsed = JSON.parse(text) as IngresoExtraido
    // Blindaje: aunque el prompt pide ISO, a veces Gemini devuelve DD/MM/YYYY
    // y el <input type="date"> lo rechaza. Normalizamos siempre.
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
