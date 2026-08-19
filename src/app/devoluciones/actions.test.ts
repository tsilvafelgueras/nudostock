import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
}))

vi.mock('@/lib/supabase/server', () => ({ createClient: mocks.createClient }))

import {
  buscarPartidasConEntregados,
  getRolloEntregado,
  getRollosEntregadosByIngreso,
} from './actions'

const ROLLO_ROW = {
  rollo_id: '11111111-1111-4111-8111-111111111111',
  numero_pieza: '000123',
  kilos: 20,
  metros: 40,
  articulo: 'Morley',
  color: 'Negro',
  ingreso_id: '22222222-2222-4222-8222-222222222222',
  numero_lote: 'P-10',
  tintoreria: 'Tintorería Uno',
  pedido_numero: '9001',
}

function supabaseConRpc(
  resolver: (nombre: string, params: unknown) => Promise<unknown>
) {
  return { rpc: vi.fn(resolver) }
}

describe('Server Actions de devoluciones', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
  })

  it('busca el rollo con todos los candidatos y mapea la respuesta de la RPC', async () => {
    const supabase = supabaseConRpc(async () => ({
      data: [ROLLO_ROW],
      error: null,
    }))
    mocks.createClient.mockResolvedValue(supabase)

    const result = await getRolloEntregado(['000123', '123'])

    expect(result).toEqual({
      ok: true,
      rollo: {
        id: ROLLO_ROW.rollo_id,
        numero_pieza: '000123',
        kilos: 20,
        metros: 40,
        articulo: 'Morley',
        color: 'Negro',
        ingreso_id: ROLLO_ROW.ingreso_id,
        numero_lote: 'P-10',
        tintoreria: 'Tintorería Uno',
        pedido_numero: '9001',
      },
    })
    expect(supabase.rpc).toHaveBeenCalledWith(
      'buscar_rollo_entregado_por_codigos',
      { p_codigos: ['000123', '123'] }
    )
  })

  it('rechaza una coincidencia ambigua y exige el número completo', async () => {
    const supabase = supabaseConRpc(async () => ({
      data: [ROLLO_ROW, { ...ROLLO_ROW, rollo_id: 'otro', numero_pieza: '123' }],
      error: null,
    }))
    mocks.createClient.mockResolvedValue(supabase)

    const result = await getRolloEntregado(['123'])

    expect(result).toMatchObject({ ok: false })
    expect(!result.ok && result.error).toContain('más de un rollo')
  })

  it('expone el error real de búsqueda por rollo', async () => {
    const supabase = supabaseConRpc(async () => ({
      data: null,
      error: { message: 'function does not exist', code: 'PGRST202' },
    }))
    mocks.createClient.mockResolvedValue(supabase)

    const result = await getRolloEntregado(['123'])

    expect(result).toEqual({
      ok: false,
      error: 'Error al buscar el rollo: function does not exist (PGRST202)',
    })
  })

  it('no convierte un error de detalle de partida en una lista vacía', async () => {
    const supabase = supabaseConRpc(async () => ({
      data: null,
      error: { message: 'RPC desactualizada', code: '42804' },
    }))
    mocks.createClient.mockResolvedValue(supabase)

    const result = await getRollosEntregadosByIngreso(
      '22222222-2222-4222-8222-222222222222'
    )

    expect(result).toEqual({
      ok: false,
      error:
        'Error al cargar los rollos de la partida: RPC desactualizada (42804)',
    })
  })

  it('devuelve el detalle completo sin una segunda consulta con embeds', async () => {
    const supabase = supabaseConRpc(async () => ({
      data: [ROLLO_ROW],
      error: null,
    }))
    mocks.createClient.mockResolvedValue(supabase)

    const result = await getRollosEntregadosByIngreso(
      '22222222-2222-4222-8222-222222222222'
    )

    expect(result.ok && result.rollos[0].color).toBe('Negro')
    expect(supabase.rpc).toHaveBeenCalledTimes(1)
  })

  it('normaliza el contador bigint de partidas a number', async () => {
    const supabase = supabaseConRpc(async () => ({
      data: [
        {
          ingreso_id: ROLLO_ROW.ingreso_id,
          ot: 'OT-1',
          numero_remito: null,
          fecha_despacho: '2026-08-01',
          tintoreria_nombre: 'Tintorería Uno',
          articulo_nombre: 'Morley',
          numero_lote: 'P-10',
          rollos_entregados: '2',
        },
      ],
      error: null,
    }))
    mocks.createClient.mockResolvedValue(supabase)

    const result = await buscarPartidasConEntregados('OT-1')

    expect(result.ok && result.rows[0].rollos_entregados).toBe(2)
  })
})
