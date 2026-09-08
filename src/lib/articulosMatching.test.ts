import { describe, expect, it } from 'vitest'
import { resolverArticuloCatalogo } from './articulosMatching'

const articulos = [
  { id: 'ml70', nombre: 'ML70 Frisada' },
  { id: 'morley', nombre: 'Morley Poliéster con Lycra' },
]

describe('resolverArticuloCatalogo', () => {
  it('resuelve nombres exactos ignorando acentos y casing', () => {
    expect(
      resolverArticuloCatalogo('MORLEY POLIESTER CON LYCRA', articulos)
    ).toBe('morley')
  })

  it('tolera texto adicional y una variante corta del código', () => {
    expect(
      resolverArticuloCatalogo('TELA ML70C FRISADA TERMINADA', articulos)
    ).toBe('ml70')
  })

  it('acepta un código corto cuando identifica un solo artículo', () => {
    expect(resolverArticuloCatalogo('ML70', articulos)).toBe('ml70')
  })

  it('no asigna texto desconocido', () => {
    expect(resolverArticuloCatalogo('Artículo inexistente', articulos)).toBeNull()
  })
})
