import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  clientConfigs: [] as unknown[],
}))

vi.mock('openai', () => ({
  default: class {
    responses = { create: mocks.create }
    constructor(config: unknown) {
      mocks.clientConfigs.push(config)
    }
  },
}))

import { extraerConOpenAI } from './openai'

const respuestaValida = {
  numero_remito: { value: 'R-123', confidence: 0.99 },
  fecha: { value: '13/08/2026', confidence: 0.95 },
  color: { value: 'NEGRO', confidence: 0.98 },
  ot: { value: null, confidence: 0 },
  rem_tejeduria: { value: null, confidence: 0 },
  referencia: { value: null, confidence: 0 },
  total_rollos_declarado: { value: 1, confidence: 0.99 },
  total_kilos_declarado: { value: 21.5, confidence: 0.99 },
  rollos: [
    {
      numero_pieza: { value: '00123', confidence: 0.99 },
      kilos: { value: 21.5, confidence: 0.99 },
      metros: { value: null, confidence: 0 },
      ratio: { value: null, confidence: 0 },
      gramaje_planilla: { value: null, confidence: 0 },
      articulo: { value: 'ML70 Frisada', confidence: 0.9 },
      color: { value: null, confidence: 0 },
    },
  ],
}

describe('extraerConOpenAI', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.clientConfigs.length = 0
    process.env.OPENAI_API_KEY = 'test-openai-key'
    delete process.env.OPENAI_FALLBACK_MODEL
    mocks.create.mockResolvedValue({
      output_text: JSON.stringify(respuestaValida),
      usage: { input_tokens: 100, output_tokens: 50 },
    })
  })

  afterEach(() => {
    delete process.env.OPENAI_API_KEY
    delete process.env.OPENAI_FALLBACK_MODEL
  })

  it('usa GPT-5.6 Luna, imagen original y Structured Outputs estricto', async () => {
    const result = await extraerConOpenAI(
      Buffer.from([0, 1, 2]),
      'image/png',
      'PROMPT PARTICULAR'
    )

    expect(result).toMatchObject({
      ok: true,
      data: { fecha: { value: '2026-08-13' } },
    })
    expect(mocks.clientConfigs).toEqual([
      { apiKey: 'test-openai-key', timeout: 50_000, maxRetries: 0 },
    ])
    const request = mocks.create.mock.calls[0][0]
    expect(request.model).toBe('gpt-5.6-luna')
    expect(request.input[0].content[0]).toEqual({
      type: 'input_image',
      image_url: 'data:image/png;base64,AAEC',
      detail: 'original',
    })
    expect(request.input[0].content[1].text).toContain('PROMPT PARTICULAR')
    expect(request.text.format).toMatchObject({
      type: 'json_schema',
      name: 'ingreso_planilla',
      strict: true,
    })
    expect(request.text.format.schema.additionalProperties).toBe(false)
    expect(request.reasoning).toEqual({ effort: 'low' })
    expect(request.store).toBe(false)
  })

  it('envía los PDF como input_file en Base64', async () => {
    await extraerConOpenAI(Buffer.from('pdf'), 'application/pdf', null)

    expect(mocks.create.mock.calls[0][0].input[0].content[0]).toEqual({
      type: 'input_file',
      filename: 'planilla.pdf',
      file_data: `data:application/pdf;base64,${Buffer.from('pdf').toString('base64')}`,
      detail: 'high',
    })
  })

  it('no invoca el SDK sin OPENAI_API_KEY', async () => {
    delete process.env.OPENAI_API_KEY

    const result = await extraerConOpenAI(Buffer.from('x'), 'image/jpeg', null)

    expect(result).toMatchObject({ ok: false, codigo: 'NO_API_KEY' })
    expect(mocks.create).not.toHaveBeenCalled()
  })

  it('rechaza HEIC antes de invocar el proveedor', async () => {
    const result = await extraerConOpenAI(Buffer.from('x'), 'image/heic', null)

    expect(result).toMatchObject({ ok: false, codigo: 'OPENAI_ERROR' })
    expect(mocks.create).not.toHaveBeenCalled()
  })

  it('clasifica timeouts abortados', async () => {
    mocks.create.mockRejectedValue(
      Object.assign(new Error('Request was aborted'), { name: 'AbortError' })
    )

    const result = await extraerConOpenAI(Buffer.from('x'), 'image/jpeg', null)

    expect(result).toMatchObject({ ok: false, codigo: 'AI_TIMEOUT' })
  })
})
