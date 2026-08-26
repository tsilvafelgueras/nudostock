import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import { canAccessNotifications } from '@/lib/auth/permissions'
import type { Role } from '@/lib/auth/home-path'

function dashboardForRole(role: Role | null | undefined): string {
  if (role === 'super') return '/super'
  if (role === 'operario') return '/operario/dashboard'
  if (role === 'ventas') return '/ventas/dashboard'
  return '/admin/dashboard'
}

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          )
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  const {
    data: { user },
  } = await supabase.auth.getUser()

  const { pathname } = request.nextUrl

  // Backward-compat: rutas que se renombraron al sacarles el prefijo de rol.
  // Mantiene viejos bookmarks y links externos funcionando con un redirect 308.
  const LEGACY_PATH_PREFIXES: Array<[string, string]> = [
    ['/operario/ingresos', '/ingresos'],
    ['/operario/confirmar', '/confirmar'],
    ['/operario/picking', '/picking'],
    ['/operario/muestras', '/muestras'],
    ['/ventas/pedidos-pendientes', '/pedidos-pendientes'],
    ['/ventas/pedidos', '/pedidos'],
    ['/ventas/clientes', '/clientes'],
  ]
  for (const [oldPrefix, newPrefix] of LEGACY_PATH_PREFIXES) {
    if (pathname === oldPrefix || pathname.startsWith(oldPrefix + '/')) {
      const target = new URL(
        newPrefix + pathname.slice(oldPrefix.length) + request.nextUrl.search,
        request.url
      )
      return NextResponse.redirect(target, 308)
    }
  }

  // Rutas públicas o de verificación de auth no requieren sesión
  const isPublic =
    pathname === '/' ||
    pathname === '/login' ||
    pathname.startsWith('/auth/confirm') ||
    pathname === '/auth/recover'

  if (!user && !isPublic) {
    return NextResponse.redirect(new URL('/login', request.url))
  }

  if (user) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('role, empresas(activo)')
      .eq('id', user.id)
      .single()

    const role = profile?.role as Role | undefined
    const dest = dashboardForRole(role)

    // Bloqueo por empresa pausada (excepto super, que no tiene empresa)
    const empresaActiva =
      role === 'super' ||
      (
        profile?.empresas as unknown as { activo: boolean } | null
      )?.activo !== false

    if (!empresaActiva) {
      // Permitir solo /login (con flag) para que el cliente haga signOut.
      if (pathname !== '/login') {
        return NextResponse.redirect(
          new URL('/login?empresa_pausada=1', request.url)
        )
      }
      return supabaseResponse
    }

    // /auth/setup requiere sesión pero no debe rebotar al dashboard
    if (pathname === '/auth/setup') {
      return supabaseResponse
    }

    // En login o raíz → al dashboard del rol
    if (pathname === '/' || pathname === '/login') {
      return NextResponse.redirect(new URL(dest, request.url))
    }

    // /super solo para role='super'
    if (pathname.startsWith('/super') && role !== 'super') {
      return NextResponse.redirect(new URL(dest, request.url))
    }

    // Rutas neutras (sin prefijo de rol) que pueden tocar varios roles.
    // Operación: operario+admin. Comercial: ventas+admin. Stock: todos los tenant.
    const isOperacion =
      pathname.startsWith('/ingresos') ||
      pathname.startsWith('/confirmar') ||
      pathname.startsWith('/picking') ||
      pathname.startsWith('/muestras') ||
      pathname.startsWith('/rollos-sin-etiqueta')
    const isComercial =
      pathname.startsWith('/pedidos') ||
      pathname.startsWith('/pedidos-pendientes') ||
      pathname.startsWith('/clientes')
    const isStock = pathname.startsWith('/stock')
    const isNotificaciones = pathname.startsWith('/notificaciones')
    const isTenantArea =
      pathname.startsWith('/admin') ||
      pathname.startsWith('/ventas') ||
      pathname.startsWith('/operario') ||
      isOperacion ||
      isComercial ||
      isStock ||
      isNotificaciones

    // Super-admin no puede entrar a rutas de empresa-cliente
    // (no tiene empresa_id, vería datos cruzados/raros)
    if (role === 'super' && isTenantArea) {
      return NextResponse.redirect(new URL('/super', request.url))
    }

    // Guards por sección de rol
    if (pathname.startsWith('/admin') && role !== 'admin') {
      return NextResponse.redirect(new URL(dest, request.url))
    }
    if (
      pathname.startsWith('/ventas') &&
      role !== 'ventas' &&
      role !== 'admin'
    ) {
      return NextResponse.redirect(new URL(dest, request.url))
    }
    if (
      pathname.startsWith('/operario') &&
      role !== 'operario' &&
      role !== 'admin'
    ) {
      return NextResponse.redirect(new URL(dest, request.url))
    }
    if (isOperacion && role !== 'operario' && role !== 'admin') {
      return NextResponse.redirect(new URL(dest, request.url))
    }
    if (isComercial && role !== 'ventas' && role !== 'admin') {
      return NextResponse.redirect(new URL(dest, request.url))
    }
    if (isNotificaciones && !canAccessNotifications(role)) {
      return NextResponse.redirect(new URL(dest, request.url))
    }
  }

  return supabaseResponse
}
