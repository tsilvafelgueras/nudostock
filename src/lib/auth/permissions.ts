import type { Role } from './home-path'

export type TenantRole = Exclude<Role, 'super'>

/** El centro de notificaciones pertenece a todos los roles de una empresa. */
export function canAccessNotifications(
  role: Role | string | null | undefined
): role is TenantRole {
  return role === 'operario' || role === 'ventas' || role === 'admin'
}
