'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useSyncExternalStore, useState, type CSSProperties } from 'react'
import {
  AlertTriangle,
  BarChart3,
  Boxes,
  Building2,
  ChevronLeft,
  ClipboardCheck,
  Clock3,
  Factory,
  History,
  Home,
  MapPinned,
  Menu,
  PackagePlus,
  Palette,
  RotateCcw,
  ScanLine,
  Scissors,
  Search,
  ShoppingCart,
  Tag,
  Users,
  X,
  type LucideIcon,
} from 'lucide-react'
import BrandMark from './BrandMark'
import NotificationBell from './NotificationBell'
import UserMenu from './UserMenu'
import type { Notificacion } from '@/lib/notificaciones'

export type NavItem = {
  href: string
  label: string
  icon: LucideIcon
  disabled?: boolean
  comingSoon?: string
}

export type NavSection = {
  title?: string
  items: NavItem[]
}

type Role = 'operario' | 'ventas' | 'admin' | 'super'

function homeHref(role: Role): string {
  switch (role) {
    case 'operario':
      return '/operario/dashboard'
    case 'ventas':
      return '/ventas/dashboard'
    case 'admin':
      return '/admin/dashboard'
    case 'super':
      return '/super'
  }
}

function navForRole(role: Role): NavSection[] {
  if (role === 'super') {
    return [
      {
        items: [
          { href: '/super', label: 'Empresas', icon: Building2 },
          { href: '/super/tintorerias', label: 'Tintorerías', icon: Factory },
        ],
      },
    ]
  }

  if (role === 'operario') {
    return [
      {
        items: [
          { href: '/operario/dashboard', label: 'Inicio', icon: Home },
          { href: '/ingresos', label: 'Ingresos', icon: PackagePlus },
          { href: '/confirmar', label: 'Confirmar llegadas', icon: ScanLine },
          { href: '/stock', label: 'Stock', icon: Search },
          { href: '/picking', label: 'Picking', icon: ClipboardCheck },
          { href: '/devoluciones', label: 'Devoluciones', icon: RotateCcw },
          { href: '/muestras', label: 'Muestras', icon: Scissors },
          { href: '/rollos-sin-etiqueta', label: 'Etiquetado manual', icon: Tag },
        ],
      },
    ]
  }

  if (role === 'ventas') {
    return [
      {
        items: [
          { href: '/ventas/dashboard', label: 'Inicio', icon: Home },
          { href: '/stock', label: 'Stock', icon: Search },
          { href: '/pedidos', label: 'Pedidos', icon: ShoppingCart },
          { href: '/pedidos-pendientes', label: 'Demandas', icon: Clock3 },
          { href: '/clientes', label: 'Clientes', icon: Users },
        ],
      },
    ]
  }

  return [
    {
      items: [{ href: '/admin/dashboard', label: 'Inicio', icon: Home }],
    },
    {
      title: 'Operación',
      items: [
        { href: '/ingresos', label: 'Ingresos', icon: PackagePlus },
        { href: '/devoluciones', label: 'Devoluciones', icon: RotateCcw },
        { href: '/rollos-sin-etiqueta', label: 'Etiquetado manual', icon: Tag },
      ],
    },
    {
      title: 'Ventas',
      items: [
        { href: '/stock', label: 'Stock', icon: Search },
        { href: '/pedidos', label: 'Pedidos', icon: ShoppingCart },
        { href: '/pedidos-pendientes', label: 'Demandas', icon: Clock3 },
        { href: '/clientes', label: 'Clientes', icon: Users },
      ],
    },
    {
      title: 'Administración',
      items: [
        { href: '/admin/articulos', label: 'Artículos', icon: Boxes },
        { href: '/admin/colores', label: 'Colores', icon: Palette },
        { href: '/admin/ubicaciones', label: 'Ubicaciones', icon: MapPinned },
        { href: '/admin/tintorerias', label: 'Tintorerías', icon: Factory },
        { href: '/admin/fallas', label: 'Tipos de falla', icon: AlertTriangle },
        { href: '/admin/equipo', label: 'Equipo', icon: Users },
        { href: '/admin/reportes', label: 'Reportes', icon: BarChart3 },
        { href: '/admin/historial', label: 'Historial', icon: History },
      ],
    },
  ]
}

const SIDEBAR_WIDTH_EXPANDED = '17rem'
const SIDEBAR_WIDTH_COLLAPSED = '4.5rem'
const TOPBAR_HEIGHT = '4rem'
const STORAGE_KEY = 'nudo:sidebar-collapsed'

// --- sidebar-collapsed external store (useSyncExternalStore) ---
// Dispatching 'sidebar-toggle' notifies same-tab subscribers because the
// native 'storage' event only fires for *other* tabs.
function subscribeSidebar(cb: () => void) {
  window.addEventListener('storage', cb)
  window.addEventListener('sidebar-toggle', cb)
  return () => {
    window.removeEventListener('storage', cb)
    window.removeEventListener('sidebar-toggle', cb)
  }
}
function getSidebarSnapshot() {
  try { return localStorage.getItem(STORAGE_KEY) === '1' } catch { return false }
}
function writeSidebar(next: boolean) {
  try { localStorage.setItem(STORAGE_KEY, next ? '1' : '0') } catch { /* ignore */ }
  window.dispatchEvent(new Event('sidebar-toggle'))
}

export default function AppShellClient({
  role,
  userName,
  empresaNombre,
  notificaciones,
  children,
}: {
  role: Role
  userName: string
  empresaNombre: string | null
  notificaciones: Notificacion[]
  children: React.ReactNode
}) {
  const [drawerOpen, setDrawerOpen] = useState(false)

  // useSyncExternalStore handles SSR correctly: getServerSnapshot returns false
  // on the server, getSnapshot reads localStorage on the client.  No effect or
  // setState needed — no lint violations, no hydration mismatches.
  const collapsed = useSyncExternalStore(subscribeSidebar, getSidebarSnapshot, () => false)

  // Detect client-side hydration without setState: noop subscribe + true/false
  // snapshots is the documented pattern for "is this rendering on the client?".
  const hydrated = useSyncExternalStore(() => () => {}, () => true, () => false)

  function toggleCollapsed() {
    writeSidebar(!collapsed)
  }

  const sections = navForRole(role)
  const home = homeHref(role)
  const sidebarWidth = collapsed ? SIDEBAR_WIDTH_COLLAPSED : SIDEBAR_WIDTH_EXPANDED
  // Admin/ventas ven la campanita (notificaciones de stock/colores) y el
  // operario también (avisos de ingresos por confirmar y pedidos). El super no.
  const muestraCampanita =
    role === 'admin' || role === 'ventas' || role === 'operario'

  return (
    <div
      className="min-h-screen bg-background"
      style={
        {
          '--topbar-height': TOPBAR_HEIGHT,
          '--sidebar-width': sidebarWidth,
        } as CSSProperties
      }
    >
      {/* TOPBAR — visible en desktop y mobile */}
      <header
        className="print:hidden fixed inset-x-0 top-0 z-40 flex items-center gap-3 border-b border-white/10 bg-sidebar px-3 text-sidebar-foreground shadow-sm sm:px-4"
        style={{ height: TOPBAR_HEIGHT }}
      >
        <button
          type="button"
          onClick={() => setDrawerOpen(true)}
          className="flex size-10 items-center justify-center rounded-md text-white/85 transition-colors hover:bg-white/10 hover:text-white md:hidden"
          aria-label="Abrir menu"
        >
          <Menu className="size-5" />
        </button>

        <Link href={home} className="flex min-w-0 items-center">
          <BrandLockup empresaNombre={empresaNombre} />
        </Link>

        <div className="ml-auto flex items-center gap-1 sm:gap-2">
          {muestraCampanita && (
            <NotificationBell notificaciones={notificaciones} />
          )}
          <UserMenu
            userName={userName}
            role={role}
            empresaNombre={empresaNombre}
          />
        </div>
      </header>

      {/* SIDEBAR DESKTOP — colapsable */}
      <aside
        className="print:hidden fixed bottom-0 left-0 z-30 hidden flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground transition-[width] duration-200 ease-out md:flex"
        style={{
          top: TOPBAR_HEIGHT,
          width: sidebarWidth,
          // Sin animación hasta hidratar para evitar flash desde el default
          transitionDuration: hydrated ? '200ms' : '0ms',
        }}
        data-collapsed={collapsed ? 'true' : 'false'}
      >
        <SidebarNav
          sections={sections}
          home={home}
          collapsed={collapsed}
          onItemClick={undefined}
        />
        <div
          className={`border-t border-sidebar-border p-2 ${
            collapsed ? 'flex justify-center' : 'flex justify-end'
          }`}
        >
          <button
            type="button"
            onClick={toggleCollapsed}
            className="flex size-8 items-center justify-center rounded-md text-white/55 transition-colors hover:bg-white/10 hover:text-white"
            aria-label={collapsed ? 'Expandir menú' : 'Colapsar menú'}
            title={collapsed ? 'Expandir menú' : 'Colapsar menú'}
          >
            <ChevronLeft
              className={`size-4 transition-transform duration-200 ${
                collapsed ? 'rotate-180' : ''
              }`}
            />
          </button>
        </div>
      </aside>

      {/* DRAWER MOBILE */}
      {drawerOpen && (
        <div
          className="fixed inset-0 z-50 bg-black/55 md:hidden"
          onClick={() => setDrawerOpen(false)}
        >
          <div
            className="absolute inset-y-0 left-0 flex w-[18rem] max-w-[88vw] flex-col bg-sidebar text-sidebar-foreground shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-sidebar-border px-4 py-4">
              <BrandLockup empresaNombre={empresaNombre} />
              <button
                type="button"
                onClick={() => setDrawerOpen(false)}
                className="flex size-10 items-center justify-center rounded-md bg-white/10 active:bg-white/20"
                aria-label="Cerrar menu"
              >
                <X className="size-5" />
              </button>
            </div>
            <SidebarNav
              sections={sections}
              home={home}
              collapsed={false}
              onItemClick={() => setDrawerOpen(false)}
            />
          </div>
        </div>
      )}

      {/* CONTENIDO */}
      <main
        className="print:mt-0 print:h-auto min-w-0 overflow-y-auto bg-background"
        style={{
          marginTop: TOPBAR_HEIGHT,
          height: `calc(100dvh - ${TOPBAR_HEIGHT})`,
        }}
      >
        <div
          className="app-shell-main"
          style={{ transition: hydrated ? undefined : 'none' }}
        >
          {children}
        </div>
      </main>
    </div>
  )
}

function BrandLockup({ empresaNombre }: { empresaNombre: string | null }) {
  return (
    <div className="flex min-w-0 items-center gap-2.5">
      <BrandMark className="size-9 shrink-0 shadow-sm" />
      <div className="min-w-0 leading-tight">
        <p className="font-heading text-lg font-bold tracking-normal">NUDO</p>
        <p className="hidden truncate text-[11px] text-white/65 sm:block">
          {empresaNombre ?? 'Gestión de inventario textil'}
        </p>
      </div>
    </div>
  )
}

function SidebarNav({
  sections,
  home,
  collapsed,
  onItemClick,
}: {
  sections: NavSection[]
  home: string
  collapsed: boolean
  onItemClick?: () => void
}) {
  const pathname = usePathname()
  return (
    <nav className="scrollbar-hidden min-h-0 flex-1 overflow-y-auto px-2 py-4">
      <div className="space-y-5">
        {sections.map((section, i) => (
          <div key={i} className="space-y-1">
            {section.title && !collapsed && (
              <p className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-white/48">
                {section.title}
              </p>
            )}
            {collapsed && section.title && i > 0 && (
              <div className="mx-2 my-2 border-t border-white/10" />
            )}
            {section.items.map((item) => {
              const Icon = item.icon
              const active =
                pathname === item.href ||
                (item.href !== home && pathname.startsWith(item.href + '/'))

              if (item.disabled) {
                return (
                  <div
                    key={item.href}
                    className={`flex min-h-11 items-center gap-3 rounded-md px-3 text-sm text-white/35 ${
                      collapsed ? 'justify-center px-2' : ''
                    }`}
                    title={item.comingSoon ?? item.label}
                  >
                    <Icon className="size-4 shrink-0" />
                    {!collapsed && (
                      <span className="flex-1 truncate">{item.label}</span>
                    )}
                  </div>
                )
              }

              return (
                <Link
                  key={item.href}
                  href={item.href}
                  data-ripple
                  onClick={onItemClick}
                  title={collapsed ? item.label : undefined}
                  className={`flex min-h-11 items-center gap-3 rounded-md text-sm font-medium transition-colors ${
                    collapsed ? 'justify-center px-2' : 'px-3'
                  } ${
                    active
                      ? 'bg-action text-action-foreground shadow-sm'
                      : 'text-white/78 hover:bg-white/10 hover:text-white'
                  }`}
                >
                  <Icon className="size-4 shrink-0" />
                  {!collapsed && (
                    <span className="truncate">{item.label}</span>
                  )}
                </Link>
              )
            })}
          </div>
        ))}
      </div>
    </nav>
  )
}
