import { describe, expect, it } from 'vitest'
import {
  agregarAccionNotificacion,
  type Notificacion,
} from './notificaciones'

function notificacion(
  overrides: Partial<Notificacion> = {}
): Notificacion {
  return {
    id: 'notificacion-1',
    tipo: 'rollo_liberado',
    titulo: 'Rollo liberado',
    mensaje: 'Asignale una ubicacion.',
    articulo_id: null,
    color_id: null,
    rollo_id: '11111111-1111-4111-8111-111111111111',
    leida_at: null,
    resuelta_at: null,
    created_at: '2026-08-26T12:00:00.000Z',
    ...overrides,
  }
}

describe('agregarAccionNotificacion', () => {
  it.each(['rollo_liberado', 'rollo_devuelto'] as const)(
    'abre directamente la asignacion del rollo para %s',
    (tipo) => {
      const resultado = agregarAccionNotificacion(notificacion({ tipo }))

      expect(resultado.href).toBe(
        '/stock?rollo=11111111-1111-4111-8111-111111111111&accion=ubicacion'
      )
      expect(resultado.actionLabel).toBe('Asignar ubicación')
      expect(resultado.dismissable).toBe(false)
    }
  )

  it('mantiene un destino compatible para avisos viejos sin rollo_id', () => {
    const resultado = agregarAccionNotificacion(
      notificacion({ rollo_id: null })
    )

    expect(resultado.href).toBe('/stock?ubicacion=Sin+ubicar')
  })

  it('filtra stock minimo por articulo y color', () => {
    const resultado = agregarAccionNotificacion(
      notificacion({
        tipo: 'stock_minimo',
        articulo_id: 'articulo-1',
        color_id: 'color-1',
        rollo_id: null,
      })
    )

    expect(resultado.href).toBe(
      '/stock?articulo=articulo-1&estado=en_stock&color=color-1'
    )
    expect(resultado.actionLabel).toBe('Revisar stock')
  })
})
