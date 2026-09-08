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
  modelosOpenRouterFallback: () => [
    'openrouter-vision-a',
    'openrouter-vision-b',
  ],
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

function exitoConCantidad(
  declarados: number,
  extraidos: number
): Extract<ExtraccionResult, { ok: true }> {
  if (!exito.ok) throw new Error('Fixture inválido')
  return {
    ok: true,
    data: {
      ...exito.data,
      total_rollos_declarado: { value: declarados, confidence: 1 },
      rollos: Array.from({ length: extraidos }, (_, index) => ({
        ...exito.data.rollos[0],
        numero_pieza: { value: `P-${index + 1}`, confidence: 1 },
      })),
    },
  }
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

  it('ejecuta los respaldos en paralelo cuando Gemini falla', async () => {
    process.env.OPENROUTER_API_KEY = 'openrouter-key'
    mocks.gemini.mockResolvedValue(timeout)
    mocks.openrouter.mockResolvedValue(exito)

    const result = await extraerPlanilla(Buffer.from('x'), 'image/png', null)

    expect(result).toBe(exito)
    expect(mocks.gemini).toHaveBeenCalledTimes(2)
    expect(mocks.openrouter).toHaveBeenCalledTimes(2)
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
    expect(mocks.openrouter).toHaveBeenCalledTimes(2)
    expect(mocks.gemini).toHaveBeenCalledTimes(2)
    expect(mocks.gemini.mock.calls[1][3]).toBe('gemini-respaldo')
    expect(mocks.gemini.mock.calls[0][4]).toBeLessThanOrEqual(45_000)
    expect(mocks.openrouter.mock.calls[0][3]).toBeLessThanOrEqual(60_000)
    expect(mocks.openrouter.mock.calls[0][4]).toBe('openrouter-vision-a')
    expect(mocks.openrouter.mock.calls[1][4]).toBe('openrouter-vision-b')
    expect(mocks.gemini.mock.calls[1][4]).toBeLessThanOrEqual(60_000)
  })

  it('prueba el segundo modelo visual de OpenRouter si el primero no devuelve JSON', async () => {
    process.env.OPENROUTER_API_KEY = 'openrouter-key'
    mocks.gemini.mockResolvedValue(timeout)
    mocks.openrouter
      .mockResolvedValueOnce({
        ok: false,
        codigo: 'JSON_INVALID',
        error: 'respuesta no estructurada',
      })
      .mockResolvedValueOnce(exito)

    const result = await extraerPlanilla(Buffer.from('x'), 'image/png', null)

    expect(result).toBe(exito)
    expect(mocks.openrouter).toHaveBeenCalledTimes(2)
    expect(mocks.openrouter.mock.calls[0][4]).toBe('openrouter-vision-a')
    expect(mocks.openrouter.mock.calls[1][4]).toBe('openrouter-vision-b')
    expect(mocks.gemini).toHaveBeenCalledTimes(2)
  })

  it('continúa al siguiente proveedor si recibe menos rollos que los declarados', async () => {
    process.env.OPENROUTER_API_KEY = 'openrouter-key'
    const parcial = exitoConCantidad(24, 1)
    const completo = exitoConCantidad(24, 24)
    mocks.gemini.mockResolvedValue(parcial)
    mocks.openrouter.mockResolvedValue(completo)

    const result = await extraerPlanilla(Buffer.from('x'), 'image/png', null)

    expect(result).toBe(completo)
    expect(mocks.openrouter).toHaveBeenCalledTimes(2)
    expect(mocks.gemini).toHaveBeenCalledTimes(2)
  })

  it('no acepta un falso 1/1 si otro respaldo encuentra todos los rollos', async () => {
    process.env.OPENROUTER_API_KEY = 'openrouter-key'
    const falsoCompleto = exitoConCantidad(1, 1)
    const completo = exitoConCantidad(24, 24)
    mocks.gemini.mockResolvedValueOnce(timeout).mockResolvedValueOnce(completo)
    mocks.openrouter.mockResolvedValue(falsoCompleto)

    const result = await extraerPlanilla(Buffer.from('x'), 'image/png', null)

    expect(result).toBe(completo)
    expect(result.ok && result.data.rollos).toHaveLength(24)
  })

  it('en un empate elige el respaldo con más campos completos', async () => {
    process.env.OPENROUTER_API_KEY = 'openrouter-key'
    const conColor = structuredClone(exito)
    if (!conColor.ok) throw new Error('Fixture inválido')
    conColor.data.color = { value: 'NEGRO', confidence: 1 }
    mocks.gemini.mockResolvedValueOnce(timeout).mockResolvedValueOnce(conColor)
    mocks.openrouter.mockResolvedValue(exito)

    const result = await extraerPlanilla(Buffer.from('x'), 'image/png', null)

    expect(result).toBe(conColor)
    expect(result.ok && result.data.color.value).toBe('NEGRO')
  })

  it('llega a Gemini de respaldo si OpenRouter devuelve una extracción parcial', async () => {
    process.env.OPENROUTER_API_KEY = 'openrouter-key'
    const parcial = exitoConCantidad(24, 1)
    const completo = exitoConCantidad(24, 24)
    mocks.gemini.mockResolvedValueOnce(timeout).mockResolvedValueOnce(completo)
    mocks.openrouter.mockResolvedValue(parcial)

    const result = await extraerPlanilla(Buffer.from('x'), 'image/png', null)

    expect(result).toBe(completo)
    expect(mocks.openrouter).toHaveBeenCalledTimes(2)
    expect(mocks.gemini).toHaveBeenCalledTimes(2)
  })

  it('conserva el resultado parcial con más rollos si ninguno queda completo', async () => {
    process.env.OPENROUTER_API_KEY = 'openrouter-key'
    const parcialGemini = exitoConCantidad(24, 1)
    const mejorParcial = exitoConCantidad(24, 12)
    const parcialFallback = exitoConCantidad(24, 8)
    mocks.gemini
      .mockResolvedValueOnce(parcialGemini)
      .mockResolvedValueOnce(parcialFallback)
    mocks.openrouter.mockResolvedValue(mejorParcial)

    const result = await extraerPlanilla(Buffer.from('x'), 'image/png', null)

    expect(result).toBe(mejorParcial)
    expect(result.ok && result.data.rollos).toHaveLength(12)
    expect(mocks.gemini).toHaveBeenCalledTimes(2)
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

  it('no oculta las fallas de Gemini detrás de un JSON inválido de OpenRouter', async () => {
    process.env.OPENROUTER_API_KEY = 'openrouter-key'
    mocks.gemini.mockResolvedValue(timeout)
    mocks.openrouter.mockResolvedValue({
      ok: false,
      codigo: 'JSON_INVALID',
      error: 'el modelo gratuito respondió texto libre',
    })

    const result = await extraerPlanilla(Buffer.from('x'), 'application/pdf', null)

    expect(result).toMatchObject({
      ok: false,
      codigo: 'AI_ALL_PROVIDERS_FAILED',
    })
    expect(result.ok || result.error).toContain('Gemini principal')
    expect(result.ok || result.error).toContain('openrouter-vision-a')
    expect(result.ok || result.error).toContain('openrouter-vision-b')
    expect(result.ok || result.error).toContain('Gemini respaldo')
  })
})
