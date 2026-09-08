import { describe, expect, it } from 'vitest'
import { resolverColorCatalogo } from './coloresMatching'

const colores = [
  { id: 'blanco', nombre: 'Blanco' },
  { id: 'azul', nombre: 'Azul' },
  { id: 'azul-marino', nombre: 'Azul Marino' },
  { id: 'crudo', nombre: 'Crúdo Natural' },
]

describe('resolverColorCatalogo', () => {
  it('ignora casing, espacios y acentos', () => {
    expect(resolverColorCatalogo('  CRUDO natural ', colores)).toBe('crudo')
  })

  it('encuentra el color dentro de texto adicional', () => {
    expect(resolverColorCatalogo('COLOR: AZUL MARINO / INT. 9001', colores)).toBe(
      'azul-marino'
    )
  })

  it('acepta una abreviatura cuando identifica un único color', () => {
    expect(resolverColorCatalogo('BLA', colores)).toBe('blanco')
  })

  it('no adivina cuando una abreviatura es ambigua', () => {
    expect(resolverColorCatalogo('AZU', colores)).toBeNull()
  })

  it('devuelve null para texto vacío o desconocido', () => {
    expect(resolverColorCatalogo(null, colores)).toBeNull()
    expect(resolverColorCatalogo('Rojo', colores)).toBeNull()
  })
})
