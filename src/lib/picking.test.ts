import { describe, it, expect } from 'vitest'
import {
  buildUbicacionesSugeridas,
  matchPartidaParaRollo,
  requiereFinalizarPicking,
  type StockOrientacionRaw,
  type PartidaParaMatch,
} from './picking'

describe('requiereFinalizarPicking', () => {
  it('ofrece recuperar un pedido completo que sigue en preparacion', () => {
    expect(requiereFinalizarPicking('en_preparacion', 3, 3)).toBe(true)
  })

  it('no ofrece recuperar un pedido que ya esta listo', () => {
    expect(requiereFinalizarPicking('lista', 3, 3)).toBe(false)
  })

  it('no ofrece finalizar si todavia faltan rollos', () => {
    expect(requiereFinalizarPicking('en_preparacion', 3, 2)).toBe(false)
  })

  it('no considera completo un pedido sin lineas solicitadas', () => {
    expect(requiereFinalizarPicking('en_preparacion', 0, 0)).toBe(false)
  })
})

const partida = {
  articulo_id: 'articulo-1',
  color_id: 'color-1',
  ingreso_id: 'ingreso-1',
}

function row(
  ubicacion: string | null,
  ingreso_id = 'ingreso-1',
  lote: string | null = null,
  articulo_id = 'articulo-1',
  color_id = 'color-1'
): StockOrientacionRaw {
  return {
    articulo_id,
    color_id,
    ingreso_id,
    ubicacion,
    ingresos: { numero_lote: lote },
  }
}

describe('buildUbicacionesSugeridas', () => {
  it('sugiere ubicaciones con stock del mismo articulo, color e ingreso (partida)', () => {
    const stock = [row('F15'), row('F2')]

    expect(buildUbicacionesSugeridas(partida, stock)).toEqual({
      ubicaciones: ['F2', 'F15'],
      reemplazos: [],
    })
  })

  it('separa en "reemplazos" las ubicaciones de stock de otro lote, con su numero de lote', () => {
    const stock = [row('F15'), row('F99', 'ingreso-OTRO', 'LOTE-123')]

    expect(buildUbicacionesSugeridas(partida, stock)).toEqual({
      ubicaciones: ['F15'],
      reemplazos: [{ ubicacion: 'F99', lote: 'LOTE-123' }],
    })
  })

  it('ignora filas de otro articulo o color', () => {
    const stock = [
      row('F1', 'ingreso-1', null, 'articulo-OTRO'),
      row('F2', 'ingreso-1', null, 'articulo-1', 'color-OTRO'),
      row('F3'),
    ]

    expect(buildUbicacionesSugeridas(partida, stock)).toEqual({
      ubicaciones: ['F3'],
      reemplazos: [],
    })
  })

  it('ignora filas sin ubicacion y deduplica', () => {
    const stock = [row(null), row('F1'), row('F1')]

    expect(buildUbicacionesSugeridas(partida, stock)).toEqual({
      ubicaciones: ['F1'],
      reemplazos: [],
    })
  })

  it('limita cada lista a 4 ubicaciones, ordenadas naturalmente', () => {
    const stock = ['F10', 'F1', 'F2', 'F20', 'F3'].map((u) => row(u))

    expect(buildUbicacionesSugeridas(partida, stock)).toEqual({
      ubicaciones: ['F1', 'F2', 'F3', 'F10'],
      reemplazos: [],
    })
  })

  it('devuelve listas vacias si no hay stock disponible que coincida', () => {
    const stock = [row('F1', 'ingreso-1', null, 'articulo-OTRO')]

    expect(buildUbicacionesSugeridas(partida, stock)).toEqual({
      ubicaciones: [],
      reemplazos: [],
    })
  })
})

function partidaMatch(overrides: Partial<PartidaParaMatch> = {}): PartidaParaMatch {
  return {
    id: 'partida-1',
    articuloId: 'articulo-1',
    colorId: 'color-1',
    ingresoId: 'ingreso-1',
    rollosSolicitados: 2,
    rollosAsignados: 0,
    ...overrides,
  }
}

const rollo = {
  articuloId: 'articulo-1',
  colorId: 'color-1',
  ingresoId: 'ingreso-1',
}

describe('matchPartidaParaRollo', () => {
  it('matchea la partida del mismo articulo/color con cupo', () => {
    const partidas = [partidaMatch()]

    expect(matchPartidaParaRollo(rollo, partidas)).toEqual({
      partidaId: 'partida-1',
      esSustitucionPartida: false,
    })
  })

  it('devuelve null si no hay partida con articulo/color que matchee', () => {
    const partidas = [partidaMatch({ articuloId: 'articulo-OTRO' })]

    expect(matchPartidaParaRollo(rollo, partidas)).toBeNull()
  })

  it('devuelve null si la partida ya esta completa', () => {
    const partidas = [partidaMatch({ rollosSolicitados: 1, rollosAsignados: 1 })]

    expect(matchPartidaParaRollo(rollo, partidas)).toBeNull()
  })

  it('descuenta el cupo ya usado por items del borrador', () => {
    const partidas = [partidaMatch({ rollosSolicitados: 1, rollosAsignados: 0 })]

    expect(
      matchPartidaParaRollo(rollo, partidas, { 'partida-1': 1 })
    ).toBeNull()
  })

  it('prefiere la partida con el mismo ingreso (sin sustitucion)', () => {
    const partidas = [
      partidaMatch({ id: 'partida-otro-lote', ingresoId: 'ingreso-OTRO' }),
      partidaMatch({ id: 'partida-mismo-lote', ingresoId: 'ingreso-1' }),
    ]

    expect(matchPartidaParaRollo(rollo, partidas)).toEqual({
      partidaId: 'partida-mismo-lote',
      esSustitucionPartida: false,
    })
  })

  it('si solo hay partidas de otro ingreso, marca sustitucion de partida', () => {
    const partidas = [partidaMatch({ ingresoId: 'ingreso-OTRO' })]

    expect(matchPartidaParaRollo(rollo, partidas)).toEqual({
      partidaId: 'partida-1',
      esSustitucionPartida: true,
    })
  })
})
