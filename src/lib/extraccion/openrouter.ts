import type { ExtraccionResult } from './extraerPlanilla'
import { buildPrompt } from './prompt'
import { interpretarRespuestaIA } from './resultado'

const MODELO_FALLBACK = 'openrouter/free'
const TIMEOUT_MS = 50_000
const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions'

const MIMES_IMAGEN_OPENROUTER = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
])

export function modeloOpenRouterFallback(): string {
  return process.env.OPENROUTER_FALLBACK_MODEL?.trim() || MODELO_FALLBACK
}

export function archivoCompatibleConOpenRouter(mimeType: string): boolean {
  return (
    mimeType === 'application/pdf' ||
    MIMES_IMAGEN_OPENROUTER.has(mimeType)
  )
}

function field(tipo: 'string' | 'number') {
  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      value: { type: [tipo, 'null'] },
      confidence: { type: 'number', minimum: 0, maximum: 1 },
    },
    required: ['value', 'confidence'],
  }
}

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    numero_remito: field('string'),
    fecha: field('string'),
    color: field('string'),
    ot: field('string'),
    rem_tejeduria: field('string'),
    referencia: field('string'),
    total_rollos_declarado: field('number'),
    total_kilos_declarado: field('number'),
    rollos: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          numero_pieza: field('string'),
          kilos: field('number'),
          metros: field('number'),
          ratio: field('number'),
          gramaje_planilla: field('number'),
          articulo: field('string'),
          color: field('string'),
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

type OpenRouterResponse = {
  model?: string
  choices?: Array<{
    message?: {
      content?: string | Array<{ type?: string; text?: string }>
    }
  }>
  usage?: { prompt_tokens?: number; completion_tokens?: number }
  error?: { code?: number; message?: string }
}

function diagnosticarErrorOpenRouter(e: unknown): {
  codigo:
    | 'AI_QUOTA_EXCEEDED'
    | 'AI_OVERLOADED'
    | 'AI_TIMEOUT'
    | 'AI_UNAVAILABLE'
    | 'AI_MODEL_UNAVAILABLE'
    | 'OPENROUTER_ERROR'
  mensaje: string
} {
  const err = e as { status?: unknown; code?: unknown; name?: unknown }
  const code =
    typeof err.status === 'number'
      ? err.status
      : typeof err.code === 'number'
        ? err.code
        : null
  const msg = ((e as Error)?.message ?? String(e)).toLowerCase()
  const nombre = String(err.name ?? '').toLowerCase()

  if (code === 429 || msg.includes('rate limit') || msg.includes('quota')) {
    return {
      codigo: 'AI_QUOTA_EXCEEDED',
      mensaje:
        'OpenRouter alcanzó el límite gratuito de solicitudes. El cupo se restablece automáticamente.',
    }
  }
  if (code === 404 || (msg.includes('model') && msg.includes('not found'))) {
    return {
      codigo: 'AI_MODEL_UNAVAILABLE',
      mensaje: 'No hay un modelo gratuito compatible disponible en OpenRouter.',
    }
  }
  if (
    code === 408 ||
    nombre === 'aborterror' ||
    nombre === 'timeouterror' ||
    msg.includes('aborted') ||
    msg.includes('timeout') ||
    msg.includes('timed out')
  ) {
    return {
      codigo: 'AI_TIMEOUT',
      mensaje: 'OpenRouter tardó demasiado en procesar la planilla.',
    }
  }
  if (
    code === 503 ||
    msg.includes('overloaded') ||
    msg.includes('no endpoints') ||
    msg.includes('service unavailable')
  ) {
    return {
      codigo: 'AI_OVERLOADED',
      mensaje: 'Los modelos gratuitos de OpenRouter están temporalmente ocupados.',
    }
  }
  if ([500, 502, 504].includes(code ?? 0) || msg.includes('provider returned')) {
    return {
      codigo: 'AI_UNAVAILABLE',
      mensaje: 'OpenRouter o el modelo gratuito tuvieron un error temporal.',
    }
  }
  return {
    codigo: 'OPENROUTER_ERROR',
    mensaje: (e as Error)?.message ?? String(e),
  }
}

function contenidoRespuesta(response: OpenRouterResponse): string | null {
  const content = response.choices?.[0]?.message?.content
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    const text = content
      .filter((parte) => parte.type === 'text' && parte.text)
      .map((parte) => parte.text)
      .join('')
    return text || null
  }
  return null
}

export async function extraerConOpenRouter(
  fileBuffer: Buffer,
  mimeType: string,
  customPrompt: string | null
): Promise<ExtraccionResult> {
  const apiKey = process.env.OPENROUTER_API_KEY
  if (!apiKey) {
    return {
      ok: false,
      error: 'Falta OPENROUTER_API_KEY en las variables de entorno',
      codigo: 'NO_API_KEY',
    }
  }
  if (!archivoCompatibleConOpenRouter(mimeType)) {
    return {
      ok: false,
      error: `OpenRouter no admite ${mimeType} como entrada visual.`,
      codigo: 'OPENROUTER_ERROR',
    }
  }

  const modelo = modeloOpenRouterFallback()
  const dataUrl = `data:${mimeType};base64,${fileBuffer.toString('base64')}`
  const esPdf = mimeType === 'application/pdf'
  const archivo = esPdf
    ? {
        type: 'file',
        file: { filename: 'planilla.pdf', file_data: dataUrl },
      }
    : {
        type: 'image_url',
        image_url: { url: dataUrl },
      }

  const body = {
    model: modelo,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: buildPrompt(customPrompt) },
          archivo,
        ],
      },
    ],
    response_format: {
      type: 'json_schema',
      json_schema: {
        name: 'ingreso_planilla',
        strict: true,
        schema: SCHEMA,
      },
    },
    max_tokens: 12_000,
    temperature: 0,
    ...(esPdf
      ? {
          plugins: [
            {
              id: 'file-parser',
              pdf: { engine: 'cloudflare-ai' },
            },
          ],
        }
      : {}),
  }

  const t0 = Date.now()
  try {
    const httpResponse = await fetch(OPENROUTER_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://github.com/tsilvafelgueras/stockapp-tesis',
        'X-OpenRouter-Title': 'Nudo Stock',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    const response = (await httpResponse.json()) as OpenRouterResponse
    if (!httpResponse.ok || response.error) {
      throw Object.assign(
        new Error(
          response.error?.message ||
            `OpenRouter respondió HTTP ${httpResponse.status}`
        ),
        { status: httpResponse.status, code: response.error?.code }
      )
    }

    console.info(
      `[extraccion] fallback ${response.model || modelo} respondió en ${Date.now() - t0}ms — tokens in:${response.usage?.prompt_tokens ?? '?'} out:${response.usage?.completion_tokens ?? '?'}`
    )
    return interpretarRespuestaIA(
      contenidoRespuesta(response),
      'OPENROUTER_ERROR'
    )
  } catch (e) {
    const diagnostico = diagnosticarErrorOpenRouter(e)
    console.error(
      `[extraccion] fallo fallback ${modelo} en ${Date.now() - t0}ms tipo=${diagnostico.codigo}: ${(e as Error)?.message ?? String(e)}`
    )
    return {
      ok: false,
      error: diagnostico.mensaje,
      codigo: diagnostico.codigo,
    }
  }
}
