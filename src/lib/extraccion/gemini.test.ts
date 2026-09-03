import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  generateContent: vi.fn(),
}))

vi.mock('@google/genai', () => ({
  GoogleGenAI: class {
    models = { generateContent: mocks.generateContent }
  },
  Type: {
    OBJECT: 'OBJECT',
    STRING: 'STRING',
    NUMBER: 'NUMBER',
    ARRAY: 'ARRAY',
  },
}))

import { extraerConGemini } from './gemini'

const respuestaValida = {
  numero_remito: { value: 'R-123', confidence: 0.99 },
  fecha: { value: '13/08/2026', confidence: 0.95 },
  color: { value: 'NEGRO', confidence: 0.98 },
  ot: { value: 'OT-9', confidence: 0.97 },
  rem_tejeduria: { value: null, confidence: 0 },
  referencia: { value: 'ML70', confidence: 0.92 },
  total_rollos_declarado: { value: 1, confidence: 0.99 },
  total_kilos_declarado: { value: 21.5, confidence: 0.99 },
  rollos: [
    {
      numero_pieza: { value: '00123', confidence: 0.99 },
      kilos: { value: 21.5, confidence: 0.99 },
      metros: { value: 50, confidence: 0.9 },
      ratio: { value: 2.33, confidence: 0.9 },
      gramaje_planilla: { value: null, confidence: 0 },
      articulo: { value: 'ML70 Frisada', confidence: 0.9 },
      color: { value: null, confidence: 0 },
    },
  ],
}

describe('extraerConGemini', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.GEMINI_API_KEY = 'test-api-key'
    delete process.env.GEMINI_MODEL
    delete process.env.GEMINI_FALLBACK_MODEL
  })

  afterEach(() => {
    vi.useRealTimers()
    delete process.env.GEMINI_API_KEY
    delete process.env.GEMINI_MODEL
    delete process.env.GEMINI_FALLBACK_MODEL
  })

  it('envia el archivo y el prompt al modelo configurado y normaliza la fecha', async () => {
    mocks.generateContent.mockResolvedValue({
      text: JSON.stringify(respuestaValida),
      usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 50 },
    })

    const result = await extraerConGemini(
      Buffer.from([0, 1, 2]),
      'image/png',
      'INSTRUCCION PARTICULAR DE PRUEBA'
    )

    expect(result).toEqual({
      ok: true,
      data: {
        ...respuestaValida,
        fecha: { value: '2026-08-13', confidence: 0.95 },
      },
    })

    expect(mocks.generateContent).toHaveBeenCalledTimes(1)
    const request = mocks.generateContent.mock.calls[0][0]
    expect(request.model).toBe('gemini-3.6-flash')
    expect(request.contents[0].parts[0].inlineData).toEqual({
      data: 'AAEC',
      mimeType: 'image/png',
    })
    expect(request.contents[0].parts[1].text).toContain(
      'INSTRUCCION PARTICULAR DE PRUEBA'
    )
    expect(request.config.responseMimeType).toBe('application/json')
    expect(request.config.responseSchema).toBeDefined()
    expect(request.config.httpOptions).toEqual({
      timeout: 35_000,
      retryOptions: { attempts: 1 },
    })
  })

  it('usa las instrucciones genericas cuando no hay prompt custom', async () => {
    mocks.generateContent.mockResolvedValue({
      text: JSON.stringify(respuestaValida),
      usageMetadata: {},
    })

    await extraerConGemini(Buffer.from('remito'), 'application/pdf', null)

    const prompt = mocks.generateContent.mock.calls[0][0].contents[0].parts[1].text
    expect(prompt).toContain('numero_remito')
    expect(prompt).toContain('POR CADA ROLLO')
  })

  it('corta antes de invocar el SDK cuando falta la API key', async () => {
    delete process.env.GEMINI_API_KEY

    const result = await extraerConGemini(Buffer.from('x'), 'image/jpeg', null)

    expect(result).toMatchObject({ ok: false, codigo: 'NO_API_KEY' })
    expect(mocks.generateContent).not.toHaveBeenCalled()
  })

  it('rechaza respuestas sin rollos', async () => {
    mocks.generateContent.mockResolvedValue({
      text: JSON.stringify({ ...respuestaValida, rollos: [] }),
      usageMetadata: {},
    })

    const result = await extraerConGemini(Buffer.from('x'), 'image/jpeg', null)

    expect(result).toMatchObject({ ok: false, codigo: 'FORMATO_INVALIDO' })
  })

  it('informa cuando Gemini devuelve JSON invalido', async () => {
    mocks.generateContent.mockResolvedValue({
      text: '{json roto',
      usageMetadata: {},
    })

    const result = await extraerConGemini(Buffer.from('x'), 'image/jpeg', null)

    expect(result).toMatchObject({ ok: false, codigo: 'JSON_INVALID' })
  })

  it('no reintenta errores permanentes del proveedor', async () => {
    mocks.generateContent.mockRejectedValue(new Error('API key not valid'))

    const result = await extraerConGemini(Buffer.from('x'), 'image/jpeg', null)

    expect(result).toMatchObject({ ok: false, codigo: 'GEMINI_ERROR' })
    expect(mocks.generateContent).toHaveBeenCalledTimes(1)
  })

  it('cambia al modelo fallback cuando el principal está sobrecargado', async () => {
    vi.useFakeTimers()
    mocks.generateContent
      .mockRejectedValueOnce(
        Object.assign(new Error('503 UNAVAILABLE: high demand'), { status: 503 })
      )
      .mockResolvedValueOnce({
        text: JSON.stringify(respuestaValida),
        usageMetadata: {},
      })

    const resultPromise = extraerConGemini(
      Buffer.from('remito'),
      'application/pdf',
      null
    )
    await vi.runAllTimersAsync()
    const result = await resultPromise

    expect(result).toMatchObject({ ok: true })
    expect(mocks.generateContent).toHaveBeenCalledTimes(2)
    expect(mocks.generateContent.mock.calls.map(([request]) => request.model)).toEqual([
      'gemini-3.6-flash',
      'gemini-2.5-flash',
    ])
  })

  it('distingue cuota agotada de una sobrecarga 503', async () => {
    vi.useFakeTimers()
    mocks.generateContent.mockRejectedValue(
      Object.assign(new Error('429 RESOURCE_EXHAUSTED: quota exceeded'), {
        status: 429,
      })
    )

    const resultPromise = extraerConGemini(
      Buffer.from('remito'),
      'application/pdf',
      null
    )
    await vi.runAllTimersAsync()
    const result = await resultPromise

    expect(result).toMatchObject({
      ok: false,
      codigo: 'AI_QUOTA_EXCEEDED',
    })
    expect(result.ok || result.error).toContain('cuota')
    expect(mocks.generateContent).toHaveBeenCalledTimes(3)
  })

  it('permite elegir los modelos por variables de entorno', async () => {
    process.env.GEMINI_MODEL = 'gemini-principal-custom'
    process.env.GEMINI_FALLBACK_MODEL = 'gemini-fallback-custom'
    mocks.generateContent.mockResolvedValue({
      text: JSON.stringify(respuestaValida),
      usageMetadata: {},
    })

    await extraerConGemini(Buffer.from('remito'), 'image/jpeg', null)

    expect(mocks.generateContent.mock.calls[0][0].model).toBe(
      'gemini-principal-custom'
    )
  })
})
