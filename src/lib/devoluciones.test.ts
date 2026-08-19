import { describe, expect, it } from 'vitest'
import {
  construirCandidatosDevolucion,
  estadoPedidoRollo,
  pasoAnteriorDevoluciones,
} from './devoluciones'

const patrones = [
  { pattern: 'PIEZA\\s+(\\d+)', capture_group: 1, prioridad: 10 },
  { pattern: 'OT\\s+(\\d+)', capture_group: 1, prioridad: 20 },
]

describe('helpers de devoluciones', () => {
  it('extrae todos los candidatos de un scan y conserva el payload como fallback', () => {
    expect(
      construirCandidatosDevolucion(
        'OT 777 PIEZA 000123',
        false,
        patrones
      )
    ).toEqual(['000123', '777', 'OT 777 PIEZA 000123'])
  })

  it('usa el número manual tal cual, sin aplicarle regex de tintorería', () => {
    expect(
      construirCandidatosDevolucion('  000123  ', true, patrones)
    ).toEqual(['000123'])
  })

  it('descarta códigos vacíos o excesivamente largos', () => {
    expect(construirCandidatosDevolucion('   ', true, patrones)).toEqual([])
    expect(
      construirCandidatosDevolucion('x'.repeat(129), true, patrones)
    ).toEqual([])
  })

  it('define una vuelta real para cada etapa intermedia', () => {
    expect(pasoAnteriorDevoluciones('scan_rollos', false)).toBe('tipo')
    expect(pasoAnteriorDevoluciones('buscar_partida', true)).toBe('tipo')
    expect(pasoAnteriorDevoluciones('seleccionar_rollos', true)).toBe(
      'buscar_partida'
    )
    expect(pasoAnteriorDevoluciones('motivo_segunda', false)).toBe(
      'scan_rollos'
    )
    expect(pasoAnteriorDevoluciones('motivo_segunda', true)).toBe(
      'seleccionar_rollos'
    )
    expect(pasoAnteriorDevoluciones('tipo', false)).toBeNull()
    expect(pasoAnteriorDevoluciones('exito', false)).toBeNull()
  })

  it('conserva la marca de devuelto aunque la asignación también esté liberada', () => {
    expect(
      estadoPedidoRollo({
        devuelto_at: '2026-08-19T15:00:00.000Z',
        liberado_at: '2026-08-19T15:00:00.000Z',
      })
    ).toBe('devuelto')
  })

  it('diferencia asignaciones activas de liberaciones que no son devoluciones', () => {
    expect(
      estadoPedidoRollo({ devuelto_at: null, liberado_at: null })
    ).toBe('activo')
    expect(
      estadoPedidoRollo({
        devuelto_at: null,
        liberado_at: '2026-08-19T15:00:00.000Z',
      })
    ).toBe('liberado')
  })
})
