import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ExtraccionResult } from './extraerPlanilla'

const mocks = vi.hoisted(() => ({
  gemini: vi.fn(),
  openai: vi.fn(),
  compatible: vi.fn(() => true),
}))

vi.mock('./gemini', () => ({
  extraerConGemini: mocks.gemini,
  modeloGeminiPrincipal: () => 'gemini-principal',
  modeloGeminiFallback: () => 'gemini-respaldo',
}))

vi.mock('./openai', () => ({
  extraerConOpenAI: mocks.openai,
  archivoCompatibleConOpenAI: mocks.compatible,
}))

import { extraerPlanilla } from './extraerPlanilla'

const exito: ExtraccionResult = {
  ok: true,
  data: {
    numero_remito: { value: '1', confidence: 1 },
    fecha: { value: '2026-09-03', confidence: 1 },
    color: { value: null, confidence: 0 },
    ot: { value: null, confidence: 0 },
    rem_tejeduria: { value: null, confidence: 0 },
    referencia: { value: null, confidence: 0 },
    total_rollos_declarado: { value: 1, confidence: 1 },
    total_kilos_declarado: { value: 10, confidence: 1 },
    rollos: [
      {
        numero_pieza: { value: 'A', confidence: 1 },
        kilos: { value: 10, confidence: 1 },
        metros: { value: null, confidence: 0 },
        ratio: { value: null, confidence: 0 },
        gramaje_planilla: { value: null, confidence: 0 },
        articulo: { value: null, confidence: 0 },
        color: { value: null, confidence: 0 },
      },
    ],
  },
}

const timeout: ExtraccionResult = {
  ok: false,
  codigo: 'AI_TIMEOUT',
  error: 'proveedor tardó demasiado',
}

describe('extraerPlanilla', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.compatible.mockReturnValue(true)
    process.env.GEMINI_API_KEY = 'gemini-key'
    delete process.env.OPENAI_API_KEY
  })

  afterEach(() => {
    delete process.env.GEMINI_API_KEY
    delete process.env.OPENAI_API_KEY
  })

  it('devuelve Gemini cuando el proveedor principal funciona', async () => {
    mocks.gemini.mockResolvedValue(exito)

    const result = await extraerPlanilla(Buffer.from('x'), 'image/jpeg', null)

    expect(result).toBe(exito)
    expect(mocks.gemini).toHaveBeenCalledTimes(1)
    expect(mocks.openai).not.toHaveBeenCalled()
  })

  it('pasa inmediatamente a OpenAI cuando Gemini falla', async () => {
    process.env.OPENAI_API_KEY = 'openai-key'
    mocks.gemini.mockResolvedValue(timeout)
    mocks.openai.mockResolvedValue(exito)

    const result = await extraerPlanilla(Buffer.from('x'), 'image/png', null)

    expect(result).toBe(exito)
    expect(mocks.gemini).toHaveBeenCalledTimes(1)
    expect(mocks.openai).toHaveBeenCalledTimes(1)
  })

  it('usa el segundo Gemini sólo cuando OpenAI no está configurado', async () => {
    mocks.gemini.mockResolvedValueOnce(timeout).mockResolvedValueOnce(exito)

    const result = await extraerPlanilla(Buffer.from('x'), 'image/jpeg', null)

    expect(result).toBe(exito)
    expect(mocks.gemini).toHaveBeenCalledTimes(2)
    expect(mocks.gemini.mock.calls[1][3]).toBe('gemini-respaldo')
    expect(mocks.openai).not.toHaveBeenCalled()
  })

  it('conserva Gemini como respaldo para HEIC, que OpenAI no admite', async () => {
    process.env.OPENAI_API_KEY = 'openai-key'
    mocks.compatible.mockReturnValue(false)
    mocks.gemini.mockResolvedValueOnce(timeout).mockResolvedValueOnce(exito)

    const result = await extraerPlanilla(Buffer.from('x'), 'image/heic', null)

    expect(result).toBe(exito)
    expect(mocks.openai).not.toHaveBeenCalled()
    expect(mocks.gemini).toHaveBeenCalledTimes(2)
  })

  it('explica cuando fallan ambos proveedores', async () => {
    process.env.OPENAI_API_KEY = 'openai-key'
    mocks.gemini.mockResolvedValue(timeout)
    mocks.openai.mockResolvedValue({
      ok: false,
      codigo: 'AI_UNAVAILABLE',
      error: 'OpenAI no disponible',
    })

    const result = await extraerPlanilla(Buffer.from('x'), 'image/jpeg', null)

    expect(result).toMatchObject({
      ok: false,
      codigo: 'AI_ALL_PROVIDERS_FAILED',
    })
    expect(result.ok || result.error).toContain('Gemini')
    expect(result.ok || result.error).toContain('OpenAI')
  })
})
