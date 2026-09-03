import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ fetch: vi.fn() }))

import { extraerConOpenRouter } from './openrouter'

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

function httpOk() {
  return {
    ok: true,
    status: 200,
    json: vi.fn().mockResolvedValue({
      model: 'dots-studio/dots-3-note-preview:free',
      choices: [{ message: { content: JSON.stringify(respuestaValida) } }],
      usage: { prompt_tokens: 100, completion_tokens: 50 },
    }),
  }
}

describe('extraerConOpenRouter', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('fetch', mocks.fetch)
    process.env.OPENROUTER_API_KEY = 'test-openrouter-key'
    delete process.env.OPENROUTER_FALLBACK_MODEL
    mocks.fetch.mockResolvedValue(httpOk())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    delete process.env.OPENROUTER_API_KEY
    delete process.env.OPENROUTER_FALLBACK_MODEL
  })

  it('usa el router gratuito con imagen y JSON Schema', async () => {
    const result = await extraerConOpenRouter(
      Buffer.from([0, 1, 2]),
      'image/png',
      'PROMPT PARTICULAR'
    )

    expect(result).toMatchObject({
      ok: true,
      data: { fecha: { value: '2026-08-13' } },
    })
    expect(mocks.fetch).toHaveBeenCalledTimes(1)
    const [url, options] = mocks.fetch.mock.calls[0]
    expect(url).toBe('https://openrouter.ai/api/v1/chat/completions')
    expect(options.headers.Authorization).toBe('Bearer test-openrouter-key')
    const body = JSON.parse(options.body)
    expect(body.model).toBe('openrouter/free')
    expect(body.messages[0].content[0].text).toContain('PROMPT PARTICULAR')
    expect(body.messages[0].content[1]).toEqual({
      type: 'image_url',
      image_url: { url: 'data:image/png;base64,AAEC' },
    })
    expect(body.response_format).toMatchObject({
      type: 'json_schema',
      json_schema: { name: 'ingreso_planilla', strict: true },
    })
    expect(body.response_format.json_schema.schema.additionalProperties).toBe(
      false
    )
    expect(body.plugins).toBeUndefined()
  })

  it('procesa PDF con el parser gratuito de Cloudflare', async () => {
    await extraerConOpenRouter(Buffer.from('pdf'), 'application/pdf', null)

    const body = JSON.parse(mocks.fetch.mock.calls[0][1].body)
    expect(body.messages[0].content[1]).toEqual({
      type: 'file',
      file: {
        filename: 'planilla.pdf',
        file_data: `data:application/pdf;base64,${Buffer.from('pdf').toString('base64')}`,
      },
    })
    expect(body.plugins).toEqual([
      { id: 'file-parser', pdf: { engine: 'cloudflare-ai' } },
    ])
  })

  it('no invoca la API sin OPENROUTER_API_KEY', async () => {
    delete process.env.OPENROUTER_API_KEY

    const result = await extraerConOpenRouter(
      Buffer.from('x'),
      'image/jpeg',
      null
    )

    expect(result).toMatchObject({ ok: false, codigo: 'NO_API_KEY' })
    expect(mocks.fetch).not.toHaveBeenCalled()
  })

  it('rechaza HEIC antes de invocar el proveedor', async () => {
    const result = await extraerConOpenRouter(
      Buffer.from('x'),
      'image/heic',
      null
    )

    expect(result).toMatchObject({ ok: false, codigo: 'OPENROUTER_ERROR' })
    expect(mocks.fetch).not.toHaveBeenCalled()
  })

  it('clasifica el límite gratuito como cuota agotada', async () => {
    mocks.fetch.mockResolvedValue({
      ok: false,
      status: 429,
      json: vi.fn().mockResolvedValue({
        error: { code: 429, message: 'Rate limit exceeded' },
      }),
    })

    const result = await extraerConOpenRouter(
      Buffer.from('x'),
      'image/jpeg',
      null
    )

    expect(result).toMatchObject({ ok: false, codigo: 'AI_QUOTA_EXCEEDED' })
  })

  it('clasifica timeouts abortados', async () => {
    mocks.fetch.mockRejectedValue(
      Object.assign(new Error('The operation was aborted'), {
        name: 'TimeoutError',
      })
    )

    const result = await extraerConOpenRouter(
      Buffer.from('x'),
      'image/jpeg',
      null
    )

    expect(result).toMatchObject({ ok: false, codigo: 'AI_TIMEOUT' })
  })
})
