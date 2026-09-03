import OpenAI from 'openai'
import type { ResponseInputContent } from 'openai/resources/responses/responses'
import type { ExtraccionResult } from './extraerPlanilla'
import { buildPrompt } from './prompt'
import { interpretarRespuestaIA } from './resultado'

const MODELO_FALLBACK = 'gpt-5.6-luna'
const TIMEOUT_MS = 50_000

const MIMES_IMAGEN_OPENAI = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
])

export function modeloOpenAIFallback(): string {
  return process.env.OPENAI_FALLBACK_MODEL?.trim() || MODELO_FALLBACK
}

export function archivoCompatibleConOpenAI(mimeType: string): boolean {
  return mimeType === 'application/pdf' || MIMES_IMAGEN_OPENAI.has(mimeType)
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

function obtenerCodigoHttp(e: unknown): number | null {
  const err = e as { status?: unknown; code?: unknown }
  for (const valor of [err?.status, err?.code]) {
    if (typeof valor === 'number') return valor
    const match = String(valor ?? '').match(/\b([45]\d\d)\b/)
    if (match) return Number(match[1])
  }
  return null
}

function diagnosticarErrorOpenAI(e: unknown): {
  codigo:
    | 'AI_QUOTA_EXCEEDED'
    | 'AI_OVERLOADED'
    | 'AI_TIMEOUT'
    | 'AI_UNAVAILABLE'
    | 'AI_MODEL_UNAVAILABLE'
    | 'OPENAI_ERROR'
  mensaje: string
} {
  const code = obtenerCodigoHttp(e)
  const msg = ((e as Error)?.message ?? String(e)).toLowerCase()
  const nombre = ((e as Error)?.name ?? '').toLowerCase()

  if (code === 429 || msg.includes('rate limit') || msg.includes('quota')) {
    return {
      codigo: 'AI_QUOTA_EXCEEDED',
      mensaje: 'OpenAI alcanzó el límite de cuota o de solicitudes del proyecto.',
    }
  }
  if (code === 404 || (msg.includes('model') && msg.includes('not found'))) {
    return {
      codigo: 'AI_MODEL_UNAVAILABLE',
      mensaje: 'El modelo de OpenAI configurado no está disponible para este proyecto.',
    }
  }
  if (
    code === 408 ||
    nombre === 'aborterror' ||
    msg.includes('aborted') ||
    msg.includes('timeout') ||
    msg.includes('timed out')
  ) {
    return {
      codigo: 'AI_TIMEOUT',
      mensaje: 'OpenAI tardó demasiado en procesar la planilla.',
    }
  }
  if (
    code === 503 ||
    msg.includes('overloaded') ||
    msg.includes('service unavailable')
  ) {
    return {
      codigo: 'AI_OVERLOADED',
      mensaje: 'OpenAI está temporalmente sobrecargado.',
    }
  }
  if ([500, 502, 504].includes(code ?? 0) || msg.includes('internal error')) {
    return {
      codigo: 'AI_UNAVAILABLE',
      mensaje: 'OpenAI tuvo un error interno temporal.',
    }
  }
  return {
    codigo: 'OPENAI_ERROR',
    mensaje: (e as Error)?.message ?? String(e),
  }
}

function contenidoArchivo(
  fileBuffer: Buffer,
  mimeType: string,
  modelo: string
): ResponseInputContent | null {
  const base64 = fileBuffer.toString('base64')
  if (mimeType === 'application/pdf') {
    return {
      type: 'input_file',
      filename: 'planilla.pdf',
      file_data: `data:application/pdf;base64,${base64}`,
      detail: 'high',
    }
  }
  if (!MIMES_IMAGEN_OPENAI.has(mimeType)) return null
  return {
    type: 'input_image',
    image_url: `data:${mimeType};base64,${base64}`,
    detail: modelo.startsWith('gpt-5.6') ? 'original' : 'high',
  }
}

export async function extraerConOpenAI(
  fileBuffer: Buffer,
  mimeType: string,
  customPrompt: string | null
): Promise<ExtraccionResult> {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) {
    return {
      ok: false,
      error: 'Falta OPENAI_API_KEY en las variables de entorno',
      codigo: 'NO_API_KEY',
    }
  }

  const modelo = modeloOpenAIFallback()
  const archivo = contenidoArchivo(fileBuffer, mimeType, modelo)
  if (!archivo) {
    return {
      ok: false,
      error: `OpenAI no admite ${mimeType} como entrada visual.`,
      codigo: 'OPENAI_ERROR',
    }
  }

  const client = new OpenAI({ apiKey, timeout: TIMEOUT_MS, maxRetries: 0 })
  const t0 = Date.now()

  try {
    const response = await client.responses.create({
      model: modelo,
      input: [
        {
          role: 'user',
          content: [
            archivo,
            { type: 'input_text', text: buildPrompt(customPrompt) },
          ],
        },
      ],
      text: {
        format: {
          type: 'json_schema',
          name: 'ingreso_planilla',
          description: 'Datos extraídos de una planilla textil',
          strict: true,
          schema: SCHEMA,
        },
      },
      reasoning: { effort: 'low' },
      store: false,
    })

    console.info(
      `[extraccion] fallback ${modelo} respondió en ${Date.now() - t0}ms — tokens in:${response.usage?.input_tokens ?? '?'} out:${response.usage?.output_tokens ?? '?'}`
    )
    return interpretarRespuestaIA(response.output_text, 'OPENAI_ERROR')
  } catch (e) {
    const diagnostico = diagnosticarErrorOpenAI(e)
    console.error(
      `[extraccion] fallo fallback ${modelo} en ${Date.now() - t0}ms code=${obtenerCodigoHttp(e) ?? '?'} tipo=${diagnostico.codigo}: ${(e as Error)?.message ?? String(e)}`
    )
    return {
      ok: false,
      error: diagnostico.mensaje,
      codigo: diagnostico.codigo,
    }
  }
}
