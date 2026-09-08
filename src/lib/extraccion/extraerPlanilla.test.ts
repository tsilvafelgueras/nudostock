import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ExtraccionResult } from './extraerPlanilla'

const mocks = vi.hoisted(() => ({
  gemini: vi.fn(),
  openrouter: vi.fn(),
  compatible: vi.fn(() => true),
}))

vi.mock('./gemini', () => ({
  extraerConGemini: mocks.gemini,
  modeloGeminiPrincipal: () => 'gemini-principal',
  modeloGeminiFallback: () => 'gemini-respaldo',
}))

vi.mock('./openrouter', () => ({
  extraerConOpenRouter: mocks.openrouter,
  archivoCompatibleConOpenRouter: mocks.compatible,
  modeloOpenRouterFallback: () => 'openrouter-gratis',
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
    delete process.env.OPENROUTER_API_KEY
  })

  afterEach(() => {
    delete process.env.GEMINI_API_KEY
    delete process.env.OPENROUTER_API_KEY
  })

  it('devuelve Gemini cuando el proveedor principal funciona', async () => {
    mocks.gemini.mockResolvedValue(exito)

    const result = await extraerPlanilla(Buffer.from('x'), 'image/jpeg', null)

    expect(result).toBe(exito)
    expect(mocks.gemini).toHaveBeenCalledTimes(1)
    expect(mocks.openrouter).not.toHaveBeenCalled()
  })

  it('pasa inmediatamente a OpenRouter cuando Gemini falla', async () => {
    process.env.OPENROUTER_API_KEY = 'openrouter-key'
    mocks.gemini.mockResolvedValue(timeout)
    mocks.openrouter.mockResolvedValue(exito)

    const result = await extraerPlanilla(Buffer.from('x'), 'image/png', null)

    expect(result).toBe(exito)
    expect(mocks.gemini).toHaveBeenCalledTimes(1)
    expect(mocks.openrouter).toHaveBeenCalledTimes(1)
  })

  it('prueba el segundo Gemini si también falla OpenRouter', async () => {
    process.env.OPENROUTER_API_KEY = 'openrouter-key'
    mocks.gemini.mockResolvedValueOnce(timeout).mockResolvedValueOnce(exito)
    mocks.openrouter.mockResolvedValue({
      ok: false,
      codigo: 'AI_UNAVAILABLE',
      error: 'OpenRouter no disponible',
    })

    const result = await extraerPlanilla(Buffer.from('x'), 'image/png', null)

    expect(result).toBe(exito)
    expect(mocks.openrouter).toHaveBeenCalledTimes(1)
    expect(mocks.gemini).toHaveBeenCalledTimes(2)
    expect(mocks.gemini.mock.calls[1][3]).toBe('gemini-respaldo')
    expect(mocks.gemini.mock.calls[0][4]).toBeLessThanOrEqual(45_000)
    expect(mocks.openrouter.mock.calls[0][3]).toBeGreaterThan(50_000)
    expect(mocks.openrouter.mock.calls[0][3]).toBeLessThanOrEqual(75_000)
    expect(mocks.gemini.mock.calls[1][4]).toBeLessThanOrEqual(30_000)
  })

  it('usa el segundo Gemini sólo cuando OpenRouter no está configurado', async () => {
    mocks.gemini.mockResolvedValueOnce(timeout).mockResolvedValueOnce(exito)

    const result = await extraerPlanilla(Buffer.from('x'), 'image/jpeg', null)

    expect(result).toBe(exito)
    expect(mocks.gemini).toHaveBeenCalledTimes(2)
    expect(mocks.gemini.mock.calls[1][3]).toBe('gemini-respaldo')
    expect(mocks.openrouter).not.toHaveBeenCalled()
  })

  it('conserva Gemini como respaldo para HEIC, que OpenRouter no admite', async () => {
    process.env.OPENROUTER_API_KEY = 'openrouter-key'
    mocks.compatible.mockReturnValue(false)
    mocks.gemini.mockResolvedValueOnce(timeout).mockResolvedValueOnce(exito)

    const result = await extraerPlanilla(Buffer.from('x'), 'image/heic', null)

    expect(result).toBe(exito)
    expect(mocks.openrouter).not.toHaveBeenCalled()
    expect(mocks.gemini).toHaveBeenCalledTimes(2)
  })

  it('explica los tres intentos cuando todos fallan', async () => {
    process.env.OPENROUTER_API_KEY = 'openrouter-key'
    mocks.gemini.mockResolvedValue(timeout)
    mocks.openrouter.mockResolvedValue({
      ok: false,
      codigo: 'AI_UNAVAILABLE',
      error: 'OpenRouter no disponible',
    })

    const result = await extraerPlanilla(Buffer.from('x'), 'image/jpeg', null)

    expect(result).toMatchObject({
      ok: false,
      codigo: 'AI_ALL_PROVIDERS_FAILED',
    })
    expect(result.ok || result.error).toContain('Gemini')
    expect(result.ok || result.error).toContain('OpenRouter')
    expect(result.ok || result.error).toContain('gemini-respaldo')
    expect(mocks.gemini).toHaveBeenCalledTimes(2)
  })
})
