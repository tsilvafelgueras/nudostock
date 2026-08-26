import { describe, expect, it } from 'vitest'
import { canAccessNotifications } from './permissions'

describe('canAccessNotifications', () => {
  it.each(['operario', 'ventas', 'admin'])(
    'permite acceder a notificaciones al rol %s',
    (role) => {
      expect(canAccessNotifications(role)).toBe(true)
    }
  )

  it.each(['super', null, undefined, 'desconocido'])(
    'rechaza el acceso para %s',
    (role) => {
      expect(canAccessNotifications(role)).toBe(false)
    }
  )
})
