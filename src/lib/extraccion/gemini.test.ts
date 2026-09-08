import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ generateContent: vi.fn() }))

vi.mock('@google/genai', () => ({
  GoogleGenAI: class {
    models = { generateContent: mocks.generateContent }
  },
  ThinkingLevel: { LOW: 'LOW' },
  Type: {
    OBJECT: 'OBJECT',
    STRING: 'STRING',
    NUMBER: 'NUMBER',
    ARRAY: 'ARRAY',
  },
}))

import { extraerConGemini } from './gemini'
import type { IngresoExtraido } from './extraerPlanilla'

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
    delete process.env.GEMINI_API_KEY
    delete process.env.GEMINI_MODEL
    delete process.env.GEMINI_FALLBACK_MODEL
  })

  it('envía el archivo y el prompt al modelo configurado y normaliza la fecha', async () => {
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
    expect(request.contents[0].parts[1].text).toContain(
      'CONTRATO UNIVERSAL DE EXTRACCIÓN'
    )
    expect(request.contents[0].parts[1].text).toContain(
      'Estas pistas complementan el contrato universal'
    )
    expect(request.contents[0].parts[1].text).toContain('POR CADA ROLLO')
    expect(request.config.responseMimeType).toBe('application/json')
    expect(request.config.responseSchema).toBeDefined()
    expect(request.config.thinkingConfig).toEqual({ thinkingLevel: 'LOW' })
    expect(request.config.httpOptions).toEqual({
      timeout: 50_000,
      retryOptions: { attempts: 2 },
    })
  })

  it('usa las instrucciones genéricas cuando no hay prompt custom', async () => {
    mocks.generateContent.mockResolvedValue({
      text: JSON.stringify(respuestaValida),
      usageMetadata: {},
    })

    await extraerConGemini(Buffer.from('remito'), 'application/pdf', null)

    const prompt = mocks.generateContent.mock.calls[0][0].contents[0].parts[1].text
    expect(prompt).toContain('numero_remito')
    expect(prompt).toContain('POR CADA ROLLO')
  })

  it('usa texto OCR sin reenviar el archivo y conserva el schema universal', async () => {
    mocks.generateContent.mockResolvedValue({
      text: JSON.stringify(respuestaValida),
      usageMetadata: {},
    })

    await extraerConGemini(
      Buffer.from('archivo-que-no-debe-enviarse'),
      'image/heic',
      null,
      'gemini-explicito',
      20_000,
      'REMITO 123\nPIEZA    KILOS\n001      21,5'
    )

    const request = mocks.generateContent.mock.calls[0][0]
    expect(request.contents[0].parts).toHaveLength(1)
    expect(request.contents[0].parts[0]).not.toHaveProperty('inlineData')
    expect(request.contents[0].parts[0].text).toContain('FUENTE: TEXTO OCR LOCAL')
    expect(request.contents[0].parts[0].text).toContain('PIEZA')
    expect(request.contents[0].parts[0].text).toContain(
      'CONTRATO UNIVERSAL DE EXTRACCIÓN'
    )
    expect(request.config.responseSchema).toBeDefined()
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

  it('recupera kilos faltantes cuando metros y rendimiento permiten calcularlos', async () => {
    const respuestaSinKilos: IngresoExtraido = structuredClone(respuestaValida)
    respuestaSinKilos.rollos[0].kilos = { value: null, confidence: 0 }
    respuestaSinKilos.rollos[0].metros = { value: 50, confidence: 0.9 }
    respuestaSinKilos.rollos[0].ratio = { value: 2, confidence: 0.8 }
    mocks.generateContent.mockResolvedValue({
      text: JSON.stringify(respuestaSinKilos),
      usageMetadata: {},
    })

    const result = await extraerConGemini(
      Buffer.from('x'),
      'image/jpeg',
      null
    )

    expect(result.ok && result.data.rollos[0].kilos).toEqual({
      value: 25,
      confidence: 0.68,
    })
  })

  it('informa cuando Gemini devuelve JSON inválido', async () => {
    mocks.generateContent.mockResolvedValue({ text: '{json roto', usageMetadata: {} })

    const result = await extraerConGemini(Buffer.from('x'), 'image/jpeg', null)

    expect(result).toMatchObject({ ok: false, codigo: 'JSON_INVALID' })
  })

  it('informa errores permanentes del proveedor', async () => {
    mocks.generateContent.mockRejectedValue(new Error('API key not valid'))

    const result = await extraerConGemini(Buffer.from('x'), 'image/jpeg', null)

    expect(result).toMatchObject({ ok: false, codigo: 'GEMINI_ERROR' })
    expect(mocks.generateContent).toHaveBeenCalledTimes(1)
  })

  it('clasifica "This operation was aborted" como timeout reintentable', async () => {
    mocks.generateContent.mockRejectedValue(
      Object.assign(new Error('This operation was aborted'), { name: 'AbortError' })
    )

    const result = await extraerConGemini(
      Buffer.from('remito'),
      'application/pdf',
      null
    )

    expect(result).toMatchObject({ ok: false, codigo: 'AI_TIMEOUT' })
    expect(mocks.generateContent).toHaveBeenCalledTimes(1)
  })

  it('distingue cuota agotada de una sobrecarga 503', async () => {
    mocks.generateContent.mockRejectedValue(
      Object.assign(new Error('429 RESOURCE_EXHAUSTED: quota exceeded'), {
        status: 429,
      })
    )

    const result = await extraerConGemini(
      Buffer.from('remito'),
      'application/pdf',
      null
    )

    expect(result).toMatchObject({ ok: false, codigo: 'AI_QUOTA_EXCEEDED' })
    expect(result.ok || result.error).toContain('cuota')
    expect(mocks.generateContent).toHaveBeenCalledTimes(1)
  })

  it('permite elegir el modelo por variable de entorno o argumento', async () => {
    process.env.GEMINI_MODEL = 'gemini-principal-custom'
    mocks.generateContent.mockResolvedValue({
      text: JSON.stringify(respuestaValida),
      usageMetadata: {},
    })

    await extraerConGemini(Buffer.from('remito'), 'image/jpeg', null)
    await extraerConGemini(
      Buffer.from('remito'),
      'image/jpeg',
      null,
      'gemini-explicito'
    )

    expect(mocks.generateContent.mock.calls[0][0].model).toBe(
      'gemini-principal-custom'
    )
    expect(mocks.generateContent.mock.calls[1][0].model).toBe('gemini-explicito')
  })

  it('acepta un timeout definido por el orquestador', async () => {
    mocks.generateContent.mockResolvedValue({
      text: JSON.stringify(respuestaValida),
      usageMetadata: {},
    })

    await extraerConGemini(
      Buffer.from('remito'),
      'image/jpeg',
      null,
      'gemini-explicito',
      12_345
    )

    expect(
      mocks.generateContent.mock.calls[0][0].config.httpOptions.timeout
    ).toBe(12_345)
  })
})
