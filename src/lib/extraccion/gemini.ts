import {
  GoogleGenAI,
  ThinkingLevel,
  Type,
  type Schema,
} from '@google/genai'
import type { ExtraccionResult } from './extraerPlanilla'
import { buildPrompt } from './prompt'
import { interpretarRespuestaIA } from './resultado'

const MODELO_PRINCIPAL = 'gemini-3.6-flash'
const MODELO_FALLBACK = 'gemini-2.5-flash'
const TIMEOUT_MS = 50_000

export function modeloGeminiPrincipal(): string {
  return process.env.GEMINI_MODEL?.trim() || MODELO_PRINCIPAL
}

export function modeloGeminiFallback(): string {
  return process.env.GEMINI_FALLBACK_MODEL?.trim() || MODELO_FALLBACK
}

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

type DiagnosticoError = {
  codigo:
    | 'AI_QUOTA_EXCEEDED'
    | 'AI_OVERLOADED'
    | 'AI_TIMEOUT'
    | 'AI_UNAVAILABLE'
    | 'AI_MODEL_UNAVAILABLE'
    | 'GEMINI_ERROR'
  mensaje: string
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

function diagnosticarError(e: unknown): DiagnosticoError {
  const code = obtenerCodigoHttp(e)
  const msg = ((e as Error)?.message ?? String(e)).toLowerCase()
  const nombre = ((e as Error)?.name ?? '').toLowerCase()

  if (
    code === 429 ||
    msg.includes('resource_exhausted') ||
    msg.includes('rate limit') ||
    msg.includes('quota')
  ) {
    return {
      codigo: 'AI_QUOTA_EXCEEDED',
      mensaje:
        'Gemini alcanzó el límite de cuota del proyecto (temporal o diario).',
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
    }
  }

  // El SDK de Gemini usa AbortController para su timeout y expone exactamente
  // "This operation was aborted". Antes no lo reconocíamos como timeout.
  if (
    code === 408 ||
    nombre === 'aborterror' ||
    msg.includes('aborted') ||
    msg.includes('timeout') ||
    msg.includes('timed out') ||
    msg.includes('deadline exceeded') ||
    msg.includes('tardó demasiado')
  ) {
    return {
      codigo: 'AI_TIMEOUT',
      mensaje: 'Gemini tardó demasiado en procesar la planilla.',
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
      mensaje: 'Gemini está temporalmente sobrecargado.',
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
      mensaje: 'Gemini tuvo un error interno temporal.',
    }
  }

  return {
    codigo: 'GEMINI_ERROR',
    mensaje: (e as Error)?.message ?? String(e),
  }
}

/** Ejecuta una sola llamada. La selección del proveedor alternativo vive en
 * `extraerPlanilla`, para que un fallo de Gemini pueda derivarse a OpenAI sin
 * consumir primero todo el tiempo disponible en reintentos del mismo servicio.
 */
export async function extraerConGemini(
  fileBuffer: Buffer,
  mimeType: string,
  customPrompt: string | null,
  modelo = modeloGeminiPrincipal()
): Promise<ExtraccionResult> {
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) {
    return {
      ok: false,
      error: 'Falta GEMINI_API_KEY en las variables de entorno',
      codigo: 'NO_API_KEY',
    }
  }

  const ai = new GoogleGenAI({ apiKey })
  const t0 = Date.now()

  try {
    const response = await ai.models.generateContent({
      model: modelo,
      contents: [
        {
          role: 'user',
          parts: [
            {
              inlineData: {
                data: fileBuffer.toString('base64'),
                mimeType,
              },
            },
            { text: buildPrompt(customPrompt) },
          ],
        },
      ],
      config: {
        responseMimeType: 'application/json',
        responseSchema: SCHEMA,
        // La familia 3.x razona por defecto. LOW alcanza para OCR estructurado
        // y evita agotar el timeout. No enviamos esta opción a modelos 2.x,
        // cuya API de thinking usa parámetros diferentes.
        ...(modelo.startsWith('gemini-3')
          ? { thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } }
          : {}),
        httpOptions: {
          timeout: TIMEOUT_MS,
          retryOptions: { attempts: 1 },
        },
      },
    })

    const u = response.usageMetadata
    console.info(
      `[extraccion] ${modelo} respondió en ${Date.now() - t0}ms — tokens in:${u?.promptTokenCount ?? '?'} out:${u?.candidatesTokenCount ?? '?'}`
    )
    return interpretarRespuestaIA(response.text, 'GEMINI_ERROR')
  } catch (e) {
    const diagnostico = diagnosticarError(e)
    console.error(
      `[extraccion] fallo ${modelo} en ${Date.now() - t0}ms code=${obtenerCodigoHttp(e) ?? '?'} tipo=${diagnostico.codigo}: ${(e as Error)?.message ?? String(e)}`
    )
    return {
      ok: false,
      error: diagnostico.mensaje,
      codigo: diagnostico.codigo,
    }
  }
}
