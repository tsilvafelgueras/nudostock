import { describe, expect, it } from 'vitest'

import type {
  Field,
  IngresoExtraido,
  RolloExtraido,
} from './extraerPlanilla'
import { interpretarRespuestaIA } from './resultado'

function field<T>(value: T | null, confidence = 1): Field<T> {
  return { value, confidence }
}

function rollo(
  numero: string,
  kilos: number,
  metros: number
): RolloExtraido {
  return {
    numero_pieza: field(numero),
    kilos: field(kilos, 0.9),
    metros: field(metros, 0.95),
    ratio: field(Math.round((metros / kilos) * 100) / 100, 0.9),
    gramaje_planilla: field<number>(null, 0),
    articulo: field<string>(null, 0),
    color: field<string>(null, 0),
  }
}

function ingreso(totalKilos: number): IngresoExtraido {
  return {
    numero_remito: field('123'),
    fecha: field('08/09/2026'),
    color: field<string>(null, 0),
    ot: field<string>(null, 0),
    rem_tejeduria: field<string>(null, 0),
    referencia: field<string>(null, 0),
    total_rollos_declarado: field(2),
    total_kilos_declarado: field(totalKilos, 0.99),
    rollos: [rollo('1', 153, 360), rollo('2', 154.34, 362.27)],
  }
}

describe('interpretarRespuestaIA', () => {
  it('corrige un total de metros leído como total de kilos', () => {
    const result = interpretarRespuestaIA(
      JSON.stringify(ingreso(722.27)),
      'GEMINI_ERROR'
    )

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data.total_kilos_declarado).toEqual({
      value: 307.34,
      confidence: 0.81,
    })
  })

  it('conserva un total de kilos correcto', () => {
    const result = interpretarRespuestaIA(
      JSON.stringify(ingreso(307.34)),
      'GEMINI_ERROR'
    )

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data.total_kilos_declarado).toEqual({
      value: 307.34,
      confidence: 0.99,
    })
  })
})
