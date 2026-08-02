# StockApp — Contexto del proyecto

> **Cómo usar este documento**: pegá esto al inicio de un chat nuevo cuando quieras retomar el desarrollo desde otra sesión. Está pensado para que un asistente (Claude o quien sea) tenga todo el contexto necesario para seguir colaborando sin que tengas que re-explicar el proyecto.

---

## 1. Identidad y stakeholders

**Producto**: StockApp — sistema multi-tenant de gestión de stock de rollos textiles para PyMEs argentinas.

**Cliente principal de validación**: Muter Textil (fábrica textil con tintorería tercerizada).

**Naturaleza**: MVP de tesis (ITBA — Instituto Tecnológico de Buenos Aires), pensado para escalar y vender a múltiples empresas textiles.

**Equipo de desarrollo**: 4 estudiantes (Trinidad Silva Felgueras lidera el dev). Al menos 1-2 más necesitan acceso de super-admin para ayudar con onboarding de clientes.

**Repo**: https://github.com/tsilvafelgueras/stockapp-tesis (privado, GitHub).

**Path local**: `C:\dev\stockapp-tesis` (intencionalmente fuera de OneDrive, porque OneDrive sincroniza `node_modules` y eso rompe).

**URL en producción**: https://stockapp-tesis.vercel.app

---

## 2. Estilo de colaboración (importante)

- **Argentine Spanish** en todas las respuestas y en la UI.
- **Propose-then-act**: antes de tocar archivos o tomar decisiones técnicas no triviales, explicar qué se va a hacer y esperar OK explícito.
- **Etapas chicas y verificables**: cada etapa termina en algo que la usuaria puede correr y probar antes de avanzar.
- **Sin gold-plating**: priorizar el flujo end-to-end aunque sea simple sobre features perfectas a medias.
- **Cuestionar el pedido si no cierra**: si algo no tiene sentido o se puede simplificar, decirlo en vez de implementarlo igual.
- **Cost-conscious**: solo herramientas con free tier real. Hoy todo corre en $0/mes.

---

## 3. Stack técnico

| Capa | Tecnología | Notas |
|---|---|---|
| Frontend / Backend | Next.js 16 (App Router) + TypeScript | Un solo repo, Server Actions para la lógica del backend |
| UI | Tailwind CSS v4 + shadcn/ui | Tema custom: paleta navy + naranja |
| DB / Auth / Storage | Supabase (Postgres + Auth + Storage) | Tier gratis. Region: `sa-east-1` (São Paulo) |
| ORM | Ninguno — cliente Supabase JS directo | `@supabase/supabase-js` + `@supabase/ssr` |
| Hosting | Vercel | Region `gru1` (São Paulo) en `vercel.json` para reducir latencia |
| Scanner códigos | `@zxing/browser` (planeado, no instalado aún) | Etapa 4 |
| IA | Gemini 2.5 Flash via `@google/genai` (planeado) | Etapa 3. Único modelo con free tier sin tarjeta |

**Versiones de runtime**: Node.js 24 LTS, npm 11.

**Paleta de colores** (en `src/app/globals.css`, formato oklch):
- Primary (navy): `#1A2744`
- Warning (naranja): `#E8913A`
- Success (verde): `#2E7D32`
- Destructive (rojo): `#C62828`

---

## 4. Modelo de roles

4 roles, definidos en `profiles.role`:

| Rol | Quién | Dónde trabaja | Qué hace |
|---|---|---|---|
| `operario` | Personal de depósito | Mobile-first | Carga ingresos manualmente o con IA, escanea QR/código de barras para confirmar llegadas, asigna ubicaciones, hace picking de pedidos |
| `ventas` | Empleados de ventas (ej: Belén en Muter) | Desktop | Ve stock, crea pedidos seleccionando rollos específicos, asocia con número de remito externo |
| `admin` | Dueño/gerente de **una empresa-cliente** | Desktop / Mobile | Gestiona catálogos, equipo, ve reportes, hace bajas, libera reservas. **Filosofía PyMe**: el admin tiene acceso a TODO lo de operario y ventas (no son funciones principales pero está habilitado para tomar tareas de cualquier área cuando hace falta). El sidebar le muestra todos los links agrupados por sección. |
| `super` | Trinidad y compañeras (gestionan la plataforma StockApp en sí) | Desktop | Crea empresas-cliente, invita primeros admins, ve todas las empresas. NO pertenece a ninguna empresa-cliente |

**Reglas duras (enforced en DB con CHECK constraint)**:
- `role = 'super'` → `empresa_id IS NULL`
- `role IN ('admin', 'ventas', 'operario')` → `empresa_id IS NOT NULL`

---

## 5. Multi-tenant

Cada empresa-cliente tiene **datos completamente aislados**. Belén de Empresa A nunca puede ver un solo dato de Empresa B.

**Cómo se enforza**:
- Tabla `empresas` central
- Cada tabla tenant-specific (profiles, articulos, tintorerias, despachos, rollos, pedidos, pedido_rollos) tiene `empresa_id UUID REFERENCES empresas(id)` NOT NULL
- RLS policies en cada tabla filtran por `empresa_id = current_empresa_id() OR is_super_admin()`
- Trigger BEFORE INSERT en cada tabla auto-rellena `empresa_id` desde el perfil del usuario actual (la app no necesita setearlo explícitamente)
- Helper functions: `current_empresa_id()` y `is_super_admin()` (ambas SECURITY DEFINER, leen del perfil del `auth.uid()`)

---

## 6. Modelo de datos / schema

Tablas principales:

### `empresas`
- id, nombre, activo, created_at
- Lo gestiona super-admin desde `/super`

### `profiles` (extiende `auth.users`)
- id (FK a auth.users), nombre, role (`operario`|`ventas`|`admin`|`super`), empresa_id (nullable solo si super), created_at
- CHECK constraint enforza la regla super ↔ empresa_id NULL

### `articulos`
- id, empresa_id, nombre, descripcion, **stock_minimo_kg**, activo, created_at
- **Post-039** (2026-05-26): `color` ELIMINADO. El color del rollo deja de ser un atributo del artículo y pasa a la pivote `articulo_colores` (M:N). UNIQUE constraint pasa a `(empresa_id, nombre)` — un mismo artículo puede tener varios colores asociados.
- Lo gestionan solo admin (catálogo). Operario/ventas pueden **solicitar** colores nuevos vía workflow (`solicitudes_color`).

### `colores`
- id, empresa_id, nombre, activo, created_at (migración 028)
- Catálogo cerrado de colores normalizados (Title Case) por empresa. Lo gestiona admin desde `/admin/colores`.

### `articulo_colores` (pivote M:N, migración 039)
- (articulo_id, color_id) PK compuesta, created_at
- Define qué colores están disponibles para cada artículo. El form de artículo es un multi-select; el ingreso filtra el select de color al subset asociado al artículo.
- FK compuesta desde `rollos.(articulo_id, color_id)` enforza a nivel BD que la combinación esté autorizada.
- RLS: solo admin de la empresa puede insertar/borrar; lectura abierta a cualquier autenticado de la empresa.

### `solicitudes_color` (migración 039)
- id, empresa_id, nombre_solicitado, solicitado_por, motivo, estado (`pendiente`|`aprobada`|`rechazada`), motivo_rechazo, color_id (poblado al aprobar), resuelta_por, resuelta_at, created_at
- Workflow para que operario/ventas pidan colores nuevos sin tener permiso de crearlos. Admin resuelve desde `/admin/colores`.
- RPCs `aprobar_solicitud_color(id)` y `rechazar_solicitud_color(id, motivo)` SECURITY DEFINER validan `role='admin'`. Al aprobar, insertan en `colores` (con INITCAP) y guardan el FK.
- RLS: admin lee/modifica solicitudes de su empresa; cualquier autenticado inserta para su empresa.

### `tintorerias`
- id, nombre, extraction_prompt, reader_type, created_at
- **Registro maestro GLOBAL** (sin `empresa_id`). Refactor M:N en migración **034** (2026-05-25): una tintorería puede estar asociada a muchas empresas y una empresa a muchas tintorerías.
- `extraction_prompt TEXT NULL` (migración **033**): prompt custom que se inyecta a Gemini cuando se extrae una planilla de esa tintorería. Lo edita el superadmin desde `/super/tintorerias`. NULL = prompt default genérico. Reemplaza al sistema viejo de `extraction_config_key` + archivos `.ts` en `src/lib/extraccion/tintorerias/` (borrado en esta iteración).
- `reader_type TEXT NULL` (migración **033**): `'qr'` | `'barcode'` | NULL. Indica qué lector usar en `/confirmar` y `/picking`: librería específica de QR (`html5-qrcode`), específica de barcode 1D (`@zxing/browser`), o el unificado fallback (`@yudiel/react-qr-scanner`). Lo edita el superadmin.
- RLS: SELECT abierto a cualquier autenticado (el filtrado por empresa pasa por la pivote). INSERT/UPDATE/DELETE solo super.

### `empresa_tintorerias` (pivote, migración 034)
- (empresa_id, tintoreria_id) PK compuesta, contacto, email, telefono, activo, fecha_baja, created_at
- Atributos POR RELACIÓN con cada empresa-cliente: contacto comercial, datos de baja. Los gestiona el admin de la empresa desde `/admin/tintorerias` (que ahora "asocia" tintorerías existentes en vez de crearlas).
- RLS: SELECT por empresa propia + super. FOR ALL por admin de su empresa + super.

### `ingresos` (renombrada desde `despachos` en migración 008)
- id, empresa_id, tintoreria_id, articulo_id, fecha_despacho, numero_remito, total_rollos_declarado, total_kilos_declarado, estado, **origen** (`manual`|`planilla_ia`), imagen_url, created_by, created_at
- **Post-007** agrega: `color` (movido desde rollos), `ot`, `rem_tejeduria`, `referencia` (todos TEXT NULL)
- Estados: `borrador` → `auditado` → `confirmado`
- "Ingreso" = una llegada de mercadería con su remito (header). Los rollos son las "líneas". Se llamaba `despachos` pero "despacho" era ambiguo (también lo usábamos para "despacho a cliente" = pedido). Renombre en migración 008.

### `rollos`
- id, empresa_id, ingreso_id, articulo_id, **color_id**, numero_pieza (string), **ubicacion** (slot tipo "A42"), pantone, foto_url, kilos, metros, **rinde**, kilos_propios, metros_propios, ancho_propio, gramaje_propio, estado, confianza_ia, gramaje_planilla, auditado_at, auditado_por, **falla_categoria**, **falla_descripcion**, created_at
- **Post-007**: `codigo_externo` ELIMINADO. `color` (texto) ELIMINADO (se movió a `ingresos`). Se agrega `gramaje_planilla`.
- **Post-008**: la columna FK `despacho_id` se renombró a `ingreso_id`.
- **Post-029**: `falla_categoria` (TEXT libre) + `falla_descripcion`. Aplica cuando `estado='segunda'`. **Post-064**: la categoría ya no es un CHECK enum hardcodeado; los valores válidos viven en la tabla `tipos_falla` y se validan en la app. Histórico normalizado a Title Case (ej. `'mancha'` → `'Mancha'`).
- **Post-039** (2026-05-26): `ratio_rendimiento` RENOMBRADO a `rinde` (terminología de la industria textil). Agrega `color_id UUID NOT NULL REFERENCES colores(id)` + FK compuesta `(articulo_id, color_id) → articulo_colores`. El trigger viejo `sync_rollo_color_from_articulo` fue eliminado (ya no hay color en artículos).
- Estados: `pendiente` → `en_stock` → `reservado` → `entregado` | `baja` | `segunda`
- UNIQUE (numero_pieza) por empresa (post-018)

### `tipos_falla` (migración 064)
- id, empresa_id, nombre (Title Case, ej. "Mancha", "Aguja"), activo, orden, created_at
- UNIQUE (empresa_id, nombre). Catálogo configurable por empresa — reemplaza el CHECK enum de `rollos.falla_categoria`.
- RLS: SELECT abierto a cualquier autenticado de la empresa; INSERT/UPDATE/DELETE solo admin.
- Trigger `set_empresa_tipos_falla` auto-rellena `empresa_id`. 14 categorías seed por defecto: Mancha, Agujero, Color disparejo, Tono diferente, Rotura de tejido, Otro, Aguja, Corte de elastano, Teñido desparejo, Barrado intenso, Lycra invertida, Falta de elasticidad, Marca de aguja, Ancho fuera de medida.
- Admin lo gestiona desde `/admin/fallas` (toggle activo/inactivo, edición inline, nuevo).

### `pedidos`
- id, empresa_id, numero_pedido, cliente, cliente_id, **numero_remito_externo**, estado, confirmada_egreso_at, confirmada_egreso_por, created_by, created_at
- Estados: `pendiente` → `en_preparacion` → `lista` → **`confirmada_egreso`** → `entregada` (o `cancelada` desde cualquier estado pre-entrega).
- **Post-039** (2026-05-26): el estado `confirmada_venta` se renombró a `confirmada_egreso` (consistente con el lenguaje del depósito: el rollo "egresa" cuando sale del galpón, no cuando se factura). Las columnas de auditoría siguen el mismo rename. La RPC `confirmar_venta_pedido` se renombró a `confirmar_egreso_pedido`; `entregar_pedido` requiere ahora `confirmada_egreso`.

### `pedido_rollos` (m2m)
- id, empresa_id, pedido_id, rollo_id, created_at
- UNIQUE (rollo_id) — un rollo solo puede estar en un pedido a la vez

**No existen** las tablas `orden_items` ni `asignaciones` (estaban en una versión vieja del schema, fueron dropeadas en la migración 001).

---

## 7. Estructura del código

> Refleja el estado del repo post-refactor 2026-05-22 (rutas neutras — ver
> Sección 10.9). Carpetas y archivos enumerados son los que existen hoy; el
> resto del árbol (estilos, `package.json`, etc.) se omite por brevedad.
>
> **Patrón de rutas**: las pantallas compartidas entre roles (operario+admin
> o ventas+admin) viven al top-level **sin prefijo de rol** (`/picking`,
> `/ingresos`, `/pedidos`, etc.). Esto evita la confusión de que un admin
> entrando a `/operario/picking` "se siente" como operario. Lo único bajo
> un prefijo de rol son los **dashboards rol-específicos** y las pantallas
> **admin-only** (`/admin/articulos`, `/admin/equipo`, etc.).

```
src/
├── app/                          # Next.js App Router
│   ├── page.tsx                  # Root → redirige según rol
│   ├── layout.tsx                # Root layout (metadata, fonts, <Toaster /> de sonner)
│   ├── globals.css               # Tailwind + theme tokens (navy + naranja) + animaciones scan
│   ├── login/page.tsx            # Login email + password (rediseñado con BrandMark)
│   │
│   ├── auth/
│   │   ├── confirm/route.ts      # Route handler que verifica token de invitación
│   │   ├── recover/page.tsx      # Forgot password (resetPasswordForEmail)
│   │   └── setup/                # Pantalla para que invitado defina contraseña
│   │       ├── page.tsx
│   │       └── SetupForm.tsx
│   │
│   ├── super/                    # Solo role='super'
│   │   ├── layout.tsx
│   │   ├── page.tsx              # Lista empresas + form para crear nueva
│   │   ├── NuevaEmpresaForm.tsx
│   │   ├── EmpresaActions.tsx    # Botones Pausar / Reactivar empresa (toast + confirm inline)
│   │   └── actions.ts            # createEmpresaConAdmin(), setEmpresaActivo()
│   │
│   ├── admin/                    # Solo role='admin' (pantallas admin-only)
│   │   ├── layout.tsx
│   │   ├── dashboard/page.tsx    # Stats + widgets de stock bajo + demandas pendientes
│   │   ├── articulos/            # CRUD + edición inline + stock_minimo_kg
│   │   │   ├── page.tsx
│   │   │   ├── ArticuloForm.tsx
│   │   │   └── actions.ts
│   │   ├── fallas/               # Tipos de falla configurables (mig 064)
│   │   │   ├── page.tsx          # Server component — fetch tipos_falla
│   │   │   ├── FallasAdminClient.tsx  # Client — toggle activo, edición inline, nuevo
│   │   │   └── actions.ts        # crearTipoFalla, actualizarTipoFalla, toggleTipoFalla
│   │   ├── tintorerias/          # Solo listado + aviso "contactá soporte" (alta vía SQL)
│   │   │   ├── page.tsx
│   │   │   ├── TintoreriaForm.tsx   # ⚠ archivo huérfano (no se renderea desde page.tsx)
│   │   │   └── actions.ts
│   │   ├── equipo/               # Lista usuarios + invitar/editar rol/desactivar/eliminar
│   │   │   ├── page.tsx
│   │   │   ├── InviteForm.tsx
│   │   │   ├── UsuarioRow.tsx    # Acciones por fila (cambiar rol, desactivar, eliminar)
│   │   │   └── actions.ts        # inviteTeamMember(), updateRole(), disableUser(), deleteUser()
│   │   ├── reportes/             # Stock, movimientos, merma, diferencias, antigüedad, tintorerías
│   │   │   ├── page.tsx
│   │   │   ├── ReportesFilters.tsx     # Año/mes + tintorería + artículo + días antigüedad
│   │   │   ├── queries.ts              # reporteMovimientos, reporteTintorerias, etc.
│   │   │   └── csv/route.ts            # Export CSV con filtros activos
│   │   └── historial/            # Bitácora inborrable (Bloque F, mig 021)
│   │       ├── page.tsx
│   │       └── HistorialFilters.tsx
│   │
│   ├── notificaciones/           # Ruta neutra para admin+ventas (mig 024)
│   │   ├── layout.tsx                   # Guard: admin|ventas
│   │   ├── page.tsx                     # Activas + Resueltas (historial)
│   │   ├── MarcarTodasButton.tsx
│   │   └── actions.ts                   # marcarLeida, marcarTodasLeidas
│   │
│   ├── operario/                 # Solo dashboard del operario
│   │   ├── layout.tsx
│   │   └── dashboard/page.tsx
│   │
│   ├── ventas/                   # Solo dashboard de ventas
│   │   ├── layout.tsx
│   │   └── dashboard/page.tsx
│   │
│   │   ──────── Rutas neutras (operario+admin) ────────
│   ├── ingresos/                 # Llegadas + extracción IA + carga manual
│   │   ├── layout.tsx                   # Guard: operario|admin
│   │   ├── page.tsx                     # Tabs "Por ingreso" / "Por rollo" (Bloque C)
│   │   ├── RollosBulkView.tsx           # Vista tipo Excel con 8 filtros + edición masiva
│   │   ├── bulkActions.ts               # bulkEditRollos()
│   │   ├── nuevo/
│   │   │   ├── page.tsx
│   │   │   ├── NuevoIngresoForm.tsx     # Form con toggle "manual / planilla IA", mobile-first
│   │   │   └── actions.ts               # crearIngreso() + extracción IA
│   │   └── [id]/
│   │       ├── page.tsx
│   │       └── editar/{page,EditarIngresoForm}.tsx   # Edición header (mig 015)
│   ├── confirmar/                # Confirmación física (scanner QR, Etapa 4)
│   │   ├── layout.tsx                   # Guard: operario|admin
│   │   ├── page.tsx
│   │   └── [id]/{page,Scanner,actions}.{tsx,ts}
│   ├── devoluciones/             # Módulo de devoluciones de cliente (mig 065)
│   │   ├── layout.tsx                   # (hereda del root layout)
│   │   ├── page.tsx                     # Server component — guard operario|admin, fetch tipos_falla
│   │   ├── DevolucionesWizard.tsx       # Client — wizard multi-paso (tipo→scan/buscar→motivo→éxito)
│   │   └── actions.ts                   # getRolloEntregado, buscarPartidasConEntregados, devolverRollos
│   ├── picking/                  # Picking de pedidos (Etapa 6B)
│   │   ├── layout.tsx                   # Guard: operario|admin
│   │   ├── page.tsx
│   │   └── [id]/{page,PickingScanner,actions}.{tsx,ts}
│   ├── muestras/                 # Muestras (Etapa 7A, mig 011)
│   │   ├── layout.tsx                   # Guard: operario|admin
│   │   ├── page.tsx
│   │   ├── actions.ts
│   │   └── nuevo/{page,NuevaMuestraForm}.tsx
│   │
│   │   ──────── Rutas neutras (ventas+admin) ────────
│   ├── pedidos/                  # Pedidos (Etapa 6 + Bloque E confirmar venta)
│   │   ├── layout.tsx                   # Guard: ventas|admin
│   │   ├── page.tsx
│   │   ├── PedidosFilters.tsx           # Cliente / estado / rango fechas / búsqueda
│   │   ├── actions.ts                   # confirmarVentaPedido, cancelarPedido, entregarPedido
│   │   ├── nuevo/{page,NuevoPedidoForm}.tsx
│   │   └── [id]/{page,PedidoActions}.tsx
│   ├── pedidos-pendientes/       # Demandas sin stock asignado (mig 013)
│   │   ├── layout.tsx                   # Guard: ventas|admin
│   │   ├── page.tsx
│   │   ├── PedidoPendienteRow.tsx
│   │   ├── actions.ts
│   │   └── nuevo/{page,NuevaDemandaForm}.tsx
│   ├── clientes/                 # Catálogo de clientes (Bloque G, mig 022)
│   │   ├── layout.tsx                   # Guard: ventas|admin
│   │   ├── page.tsx
│   │   ├── ClientesList.tsx
│   │   ├── ClienteForm.tsx
│   │   ├── actions.ts
│   │   └── [id]/{page,ClienteActions}.tsx
│   │
│   │   ──────── Ruta neutra (operario+ventas+admin) ────────
│   └── stock/                    # Vista de stock unificada (Etapa 5)
│       ├── layout.tsx                   # Guard: operario|ventas|admin (no super)
│       ├── page.tsx
│       ├── StockList.tsx
│       ├── StockFilters.tsx
│       ├── RolloDetailDialog.tsx        # Modal con confirmación manual, auditoría, baja, segunda
│       └── actions.ts                   # confirmarRolloManual, auditarRollo, marcarSegunda, etc.
│
├── lib/
│   ├── supabase/
│   │   ├── client.ts             # createBrowserClient (para Client Components)
│   │   ├── server.ts             # createServerClient (para Server Components/Actions)
│   │   ├── middleware.ts         # Sesión + guards por rol + redirects legacy + bloqueo si empresa pausada
│   │   └── admin.ts              # Service-role client (bypassa RLS, super-admin actions)
│   ├── extraccion/               # Sistema de prompts IA por tintorería (Etapa 3)
│   │   ├── extraerPlanilla.ts
│   │   ├── gemini.ts
│   │   └── tintorerias/{_types,_default,_registry,muter-textil}.ts
│   ├── storage/planillas.ts      # Upload a Storage privado bucket "planillas"
│   ├── stockResumen.ts           # buildStockSummary: agrega rollos en en_stock+reservado por artículo+color. StockSummaryGroup incluye kilos_libre (solo en_stock) y kilos_reservado (solo reservado) para mostrar disponibilidad real.
│   ├── scanner.ts                # extraerCodigoRollo(raw, patrones, esperados) - mig 023
│   ├── ubicaciones.ts            # Constante con las 180 ubicaciones del depósito (A1..F30)
│   └── utils.ts                  # Helpers genéricos (cn, etc.)
│
├── components/
│   ├── ui/button.tsx             # Único componente shadcn instalado
│   ├── LogoutButton.tsx          # (en desuso post 10.10 — UserMenu lo absorbió, pero queda por si lo importa algo viejo)
│   ├── BackButton.tsx            # Botón "← Volver" reutilizable (con href explícito)
│   ├── DashboardBackButton.tsx   # "Volver al inicio" — Server Component que arma el href según el rol REAL del user logueado
│   ├── AppShell.tsx              # Server Component wrapper — carga notificaciones y delega a AppShellClient
│   ├── AppShellClient.tsx        # Client Component — topbar + sidebar colapsable + drawer mobile
│   ├── BrandMark.tsx             # Logo + texto "Nudo" (topbar + auth pages)
│   ├── NotificationBell.tsx      # Campanita en topbar con badge + dropdown (admin+ventas, mig 024)
│   ├── NotificationBanner.tsx    # Banner reusable de alertas activas para dashboards (Server, mig 024)
│   ├── UserMenu.tsx              # Avatar + nombre/rol en topbar con dropdown de logout
│   ├── CodeScanner.tsx           # Wrapper genérico de @zxing/browser (cámara + manual fallback)
│   └── ExcelFilter.tsx           # Chip con search + checkboxes (filtros tipo Excel)
│
└── middleware.ts                 # Wrapper que llama a updateSession()

public/
└── nudo-logo.svg                 # Logo del producto

supabase/
├── schema.sql                    # Canónico hasta migración 011 (post-Etapa 7D)
└── migrations/                   # Historial idempotente — ver Sección 8 para qué hace cada una
    └── 001..023_*.sql            # 23 migraciones, todas aplicadas en prod

vercel.json                       # regions: ["gru1"] (São Paulo)
.env.local                        # (gitignored) SUPABASE_* + GEMINI_API_KEY
```

---

## 8. Migraciones aplicadas (orden)

Todas idempotentes, todas pegadas en Supabase SQL Editor.

| # | Qué hace |
|---|---|
| 001 | Refactor inicial: 3 roles (operario/ventas/admin), drop orden_items+asignaciones, rename ordenes→pedidos, agrega numero_remito_externo, drop estados viejos |
| 002 | `despachos.origen` (`manual` \| `planilla_ia`) |
| 003 | RLS: operario también puede CRUD `articulos` y `tintorerias` |
| 004 | RLS: operario también puede INSERT en `despachos` y `rollos` (no solo UPDATE) |
| 005 | **Multi-tenant**. Tabla `empresas`, `empresa_id` en todas, RLS por empresa, trigger auto-set, helper functions |
| 006 | Super-admin como rol propio (`role='super'`), empresa_id NULLABLE solo para super, CHECK constraint |
| 007 | **Cleanup pre-IA** (Etapa 3): `color` movido de `rollos` a `despachos` (1 lote = 1 color), `codigo_externo` eliminado de `rollos` (redundante con `numero_pieza`), agrega `ot/rem_tejeduria/referencia` en `despachos` y `gramaje_planilla` en `rollos` para trazabilidad de planilla |
| 008 | **Rename + config por tintorería** (post-test E2E): `despachos` renombrada a `ingresos` (+ `rollos.despacho_id` → `ingreso_id`). Agrega `tintorerias.extraction_config_key` para sistema de prompts IA específicos por tintorería. |
| 009 | **RPC de pedidos** (Etapa 6A). Funciones `crear_pedido`, `cancelar_pedido`, `entregar_pedido` con `SECURITY DEFINER`, locks `FOR UPDATE`, advisory lock por empresa para `numero_pedido`. Agrega columna `pedido_rollos.pickeado_at`. |
| 010 | **RPC de picking** (Etapa 6B). Función `pickear_rollo` que valida match rollo↔pedido, transiciona pedido a `en_preparacion` al primer pickeo y a `lista` al último. |
| 011 | **Muestras** (Etapa 7A). Tabla `muestras` con RLS por empresa + RPC `registrar_muestra` que descuenta kilos del rollo atómicamente. |
| 012 | **Tintorerías solo admin** (iteración mayo 2026). Reemplaza la policy `FOR ALL` de operario+admin por una que solo permite admin gestionar tintorerías (operario las podía crear por accidente desde el form del ingreso). La lectura sigue abierta a todos los autenticados de la empresa. |
| 013 | **Pedidos pendientes** (iteración mayo 2026). Tabla `pedidos_pendientes` (id, empresa_id, cliente, articulo_id, color, metros_estimados, kilos_estimados, notas, estado `activo`/`resuelto`/`cancelado`, created_at, resolved_at, created_by). RLS por empresa. Insert/Update por ventas y admin. Registra demandas de clientes sin stock asignado todavía — distinto de `pedidos` (que reserva rollos concretos). |
| 014 | **Usuarios desactivables** (iteración mayo 2026). `profiles.disabled BOOLEAN NOT NULL DEFAULT FALSE`. Permite que el admin pause la cuenta de un usuario sin borrarla. La desactivación también banea la cuenta en Supabase Auth (vía server action `disableUser` en `/admin/equipo/actions.ts`). |
| 015 | **Auditoría de edición de ingresos** (iteración mayo 2026). `ingresos.editado_at TIMESTAMPTZ`, `ingresos.editado_por UUID REFERENCES auth.users(id)`. Solo última edición (sin historial completo). Habilita la pantalla nueva `/operario/ingresos/[id]/editar`. |
| 016 | **Estado `segunda` en rollos** (iteración mayo 2026). Reemplaza el CHECK constraint para incluir `'segunda'` (mercadería de calidad inferior). Estados ahora: `pendiente` \| `en_stock` \| `reservado` \| `entregado` \| `baja` \| `segunda`. Los rollos en `segunda` siguen en stock pero se muestran separados. |
| 017 | **Stock mínimo configurable** (iteración mayo 2026). `articulos.stock_minimo_kg NUMERIC NULL`. El admin lo fija por artículo desde `/admin/articulos`. Cuando los kg en stock caen por debajo, el dashboard muestra una alerta. |
| 018 | **Limpieza data prueba + unicidad** (iteración 2026-05-19). TRUNCATE de `rollos`/`ingresos`/`pedidos`/`pedido_rollos`/`muestras`/`pedidos_pendientes` (decidido explícitamente: era data de prueba). `empresas.nombre` pasa a UNIQUE (resuelve bug CU-02-02). `rollos.numero_pieza` ahora UNIQUE por **empresa** (reemplaza el viejo UNIQUE por `ingreso_id`). |
| 019 | **Auditoría de rollos** (iteración 2026-05-19). `rollos.auditado_at TIMESTAMPTZ` + `auditado_por UUID`. Habilita la acción "Auditar" desde stock — registra verificación física sin cambiar estado. |
| 020 | **Confirmación de venta post-picking** (iteración 2026-05-19). Nuevo estado `confirmada_venta` en pedidos (CHECK extendido) + columnas `confirmada_venta_at`/`confirmada_venta_por`. Nueva RPC `confirmar_venta_pedido`. `entregar_pedido` ahora requiere `confirmada_venta` en lugar de `lista`. `cancelar_pedido` acepta cancelar también desde `confirmada_venta`. |
| 021 | **Historial inborrable** (iteración 2026-05-19). Tabla `movimientos` (entidad, entidad_id, accion, usuario_id, detalle JSONB) con RLS lectura solo admin/super, sin policies de INSERT/UPDATE/DELETE expuestas. Helper `log_movimiento` SECURITY DEFINER. Triggers AFTER INSERT/UPDATE/DELETE en `rollos`/`pedidos`/`ingresos`/`pedido_rollos`/`muestras` capturan cambios (con viejo→nuevo en JSONB). |
| 022 | **Clientes** (iteración 2026-05-19). Tabla `clientes` (nombre UNIQUE por empresa, contacto, email, telefono, direccion, notas, activo). Agrega `pedidos.cliente_id` UUID FK nullable. Reescritura de RPC `crear_pedido`: ahora toma `p_cliente_id UUID` (en lugar de `p_cliente TEXT`) y autocompleta `pedidos.cliente` desde el catálogo. |
| 023 | **Patrones de extracción de código de pieza** (iteración 2026-05-22). Tabla `tintoreria_codigo_patrones`: regex con prioridad por tintorería (o `tintoreria_id NULL` = patrón "interno" de fábrica que aplica a toda la empresa). El scanner consulta esta tabla en cada lectura para extraer el `numero_pieza` del payload del QR. Si ningún patrón matchea → scan rechazado (cero fallback peligroso). Seed inicial por empresa con `\b(\d{9})\b`. RLS: read para autenticados de la empresa, write solo admin. Trigger `set_empresa_id` reutilizado. |
| 024 | **Notificaciones in-app** (iteración 2026-05-22). Tabla `notificaciones` (id, empresa_id, tipo TEXT CHECK IN ('stock_minimo'), titulo, mensaje, articulo_id, leida_at, resuelta_at, created_at). UNIQUE parcial sobre (empresa_id, tipo, articulo_id) WHERE resuelta_at IS NULL → dedupe sin spam. Triggers en `rollos` (INSERT/UPDATE de kilos/estado/articulo_id/DELETE) y `articulos` (UPDATE de stock_minimo_kg) que llaman al helper `procesar_notificacion_stock_minimo(p_articulo_id)`. Helper recalcula stock vs mínimo y: crea notificación si cruza hacia abajo, o marca `resuelta_at = NOW()` si vuelve sobre el mínimo (auto-resolve). RLS: read+update solo admin+ventas (operario no las ve). INSERT exclusivo de los triggers (SECURITY DEFINER). Seed: la propia migración recorre artículos con mínimo configurado y crea las notificaciones iniciales. |
| 025 | **Color en artículos** (iteración 2026-05-22). Agrega `articulos.color TEXT NULL`. Es un color "principal" del artículo (ej: "Lycra ML40 Negro"), opcional, no reemplaza a `ingresos.color`. La normalización a sentence case ("BLANCO"/"blanco"/" Blanco " → "Blanco") la hace la app en las server actions `createArticulo`/`updateArticulo` — la migración solo agrega la columna. El form del admin usa `<datalist>` con los colores ya existentes en la empresa para autocompletar y evitar duplicados visuales. |
| 026 | Pickear rollo a otro pedido (iteración previa 2026-05). |
| 027 | Numero de lote en ingresos. |
| 028 | Catálogo de colores. |
| 029 | Detalle de segunda calidad. |
| 030 | `tintorerias.fecha_baja` (después reemplazado por `empresa_tintorerias.fecha_baja` en 034). |
| 031 | Fix `numero_lote` SECURITY DEFINER. |
| 032 | Contacto/email/telefono en `tintorerias` (después movidos a `empresa_tintorerias` en 034). |
| 033 | **Prompt + tipo de lector por tintorería** (iteración 2026-05-25). Agrega `tintorerias.extraction_prompt TEXT` y `tintorerias.reader_type` (CHECK `'qr'`/`'barcode'`). Borra `extraction_config_key` (reemplaza al sistema viejo de archivos `.ts`). RLS de `tintorerias` permite a `super` cross-empresa. |
| 034 | **Tintorerías muchos-a-muchos** (iteración 2026-05-25). Refactor M:N: nueva pivote `empresa_tintorerias` con atributos por relación (contacto/email/telefono/activo/fecha_baja). DROP de `empresa_id`+`contacto`+`email`+`telefono`+`activo`+`fecha_baja` de `tintorerias` (que pasa a ser registro maestro global). Backfill: cada fila vieja queda como una tintorería pura linkeada a su empresa actual (no se unifica por nombre para no juntar negocios distintos por coincidencia). `tintoreria_codigo_patrones.empresa_id` pasa a NULLable → patrones globales por tintorería coexisten con patrones internos por empresa (caso "la empresa pega su QR propio"). |
| 039 | **Refactor M:N artículo-color, rinde, egreso, swap rollo en picking** (iteración 2026-05-26, feedback ingeniera textil). Migración grande, autorizada por el usuario para hacer **TRUNCATE** de datos de prueba (`rollos`/`ingresos`/`pedidos`/`pedido_rollos`/`muestras`/`pedidos_pendientes`/`articulos`/`colores`/`rollo_fotos`/`movimientos`) y rehacer la estructura limpia. Cambios: (a) `rollos.ratio_rendimiento` → `rinde`. (b) Estado `pedidos.confirmada_venta` → `confirmada_egreso` (CHECK + columnas de auditoría + RPC `confirmar_venta_pedido` → `confirmar_egreso_pedido`; `entregar_pedido` y `cancelar_pedido` actualizadas). (c) Refactor M:N artículo↔color: DROP `articulos.color`, nueva UNIQUE `(empresa_id, nombre)`, DROP `rollos.color` (texto) + DROP trigger `sync_rollo_color_from_articulo`, nueva `rollos.color_id NOT NULL REFERENCES colores(id)`, nueva pivote `articulo_colores(articulo_id, color_id)`, FK compuesta `rollos.(articulo_id, color_id) → articulo_colores` para enforce a nivel BD. (d) Nueva tabla `solicitudes_color` + RPCs `aprobar_solicitud_color`/`rechazar_solicitud_color` con SECURITY DEFINER (workflow: operario/ventas piden, admin resuelve). (e) Nueva RPC `reemplazar_rollo_en_pedido(pedido, viejo, nuevo, motivo_categoria, motivo_texto)` que valida match `(articulo_id, color_id)`, valida estado del par, DELETE+INSERT en `pedido_rollos`, marca el viejo como `segunda` con `falla_categoria`/`falla_descripcion`, e inserta movimiento con `accion='reemplazar_rollo'`. |
| 040 | **Feedback perfil ventas** (iteración 2026-05). `clientes`: `cuit_cuil`, `condicion_pago`, `categoria_precio`, `estado_cliente` (`activo`/`inactivo`/`potencial`), `vendedor_asignado`. `pedidos_pendientes`: `cliente_id`, `color_id`, `tipo_demanda` (`pedido_a_producir`/`demanda_sin_stock`), `prioridad`, `fecha_requerida`. `pedidos`: `fecha_entrega_comprometida`, `numero_remito_salida`, `salida_comentario`, `caida_motivo`/`caida_comentario`/`caida_at`/`caida_por`. `pedido_rollos`: `liberado_at`/`liberado_motivo` + UNIQUE parcial sobre asignaciones activas (permite reasignar rollos de pedidos cancelados). Reescribe RPCs: `crear_pedido` (+ `p_fecha_entrega_comprometida`), `confirmar_egreso_pedido` (+ comentario + remito de salida), `cancelar_pedido` (+ motivo de caída + libera rollos a una ubicación de reasignación). |
| 041 | **Prioridad profesional en demandas** (iteración 2026-05). Consolida `pedidos_pendientes.prioridad` (`critica`/`alta`/`programada`/`flexible`) + `fecha_requerida`, migrando los viejos `urgencia`/`fecha_limite` y dropeándolos. |
| 042 | **Stock mínimo por color + ajustes comerciales** (iteración 2026-05). `articulo_colores.stock_minimo_kg`: el stock mínimo pasa a ser por combinación **artículo+color** (migra el valor desde `articulos.stock_minimo_kg`, que queda legacy). `clientes.cuit_cuil` solo numérico (CHECK). `notificaciones.color_id` + UNIQUE parcial por `(empresa, tipo, articulo, color)`; el helper de stock mínimo recalcula por artículo+color. |
| 044 | **Revertir impersonation de super-admin** (iteración 2026-06). Revierte la suplantación de empresa por el super-admin y reescribe/consolida las RPCs `crear_pedido`, `confirmar_egreso_pedido`, `cancelar_pedido` y `entregar_pedido` (esta última deja los rollos en `entregado`). No existe migración 043. |
| 045 | **Confirmar partida por conteo** (iteración 2026-06-02, feedback visita cliente Muter). Soporta el nuevo flujo de confirmación de llegadas (ya no se escanea rollo por rollo, ver Sección 10.x). Agrega `rollos.comentario TEXT` (detalle puntual por rollo), `ingresos.conteo_fisico INT` (cuántos rollos contó el operario) y `ingresos.conteo_nota TEXT` (nota de discrepancia cuando el conteo no coincide con la planilla y se confirma igual). Idempotente, sin TRUNCATE. |
| 046 | **Kilos de crudo por partida (merma real)** (iteración 2026-06-03). `ingresos.kilos_crudo_enviado` (total de kg de crudo que salió a teñir, **un total por partida**, no por rollo) + `kilos_crudo_cargado_at`/`kilos_crudo_cargado_por`. Habilita el cálculo de la **merma real del proceso de teñido** (crudo enviado vs teñido recibido = suma de rollos), que el modelo viejo no podía calcular. Se carga en el detalle del ingreso (`/ingresos/[id]`). Idempotente, sin TRUNCATE. |
| 063 | **Fix: devolución parcial libera el índice único de picking** (iteración 2026-07-21). `devolver_rollos_pedido` y `devolver_rollo_por_rollo_id` ahora también setean `liberado_at = now()` y `liberado_motivo = 'devolucion_cliente'` al marcar la devolución. Sin esto, la fila de `pedido_rollos` seguía activa para el índice único `pedidos_rollos_rollo_id_activo_key` (`WHERE liberado_at IS NULL`) y bloqueaba el picking del mismo rollo en un pedido nuevo. Incluye backfill de filas ya devueltas con `liberado_at IS NULL`. |

| 064 | **Tipos de falla configurables** (iteración 2026-07-22). Nueva tabla `tipos_falla` (id, empresa_id, nombre, activo, orden). DROP de `rollos_falla_categoria_check` (CHECK enum hardcodeado). Normalización de datos históricos: `'mancha'` → `'Mancha'`, `'agujero'` → `'Agujero'`, etc. (Title Case). Seed de 14 categorías para todas las empresas existentes. Admin gestiona desde `/admin/fallas`. Los dropdowns de ingreso y stock se alimentan dinámicamente desde esta tabla. |
| 065 | **Módulo de devoluciones** (iteración 2026-07-22). RPC `devolver_rollos_deposito(p_items jsonb, p_motivo text)`: acepta array de `{rollo_id, segunda, falla_categoria}`, valida `estado='entregado'`, transiciona a `en_stock`/`segunda`, setea `liberado_at` en `pedido_rollos`, appenda traza al `rollos.comentario`, crea notificación y log de movimiento. RPC `buscar_partidas_con_entregados(p_query text)`: busca ingresos con rollos entregados por OT/remito/lote. RPC auxiliar `rollos_entregados_por_ingreso(p_ingreso_id uuid)`. |

**Schema canónico**: ✅ `supabase/schema.sql` refleja el modelo actual (post-039). Para DB nueva: correr `schema.sql` y después las migraciones `040`..`065` en orden.

---

## 9. Flujo de autenticación / invitaciones

**Login**: email + password en `/login`. Una vez logueado, middleware redirige según rol.

**Cómo se crea un usuario nuevo** (ningún sign-up público):

### Caso 1 — Super-admin crea empresa-cliente nueva

1. Trinidad entra a `/super`.
2. Click "+ Nueva empresa", llena nombre + datos del primer admin (nombre + mail real).
3. El server action `createEmpresaConAdmin`:
   - Inserta empresa con admin client (bypassa RLS)
   - Llama `admin.auth.admin.inviteUserByEmail(email, { data: { nombre, role: 'admin', empresa_id }, redirectTo: <site>/auth/confirm?next=/auth/setup })`
4. Supabase manda email al admin invitado.
5. Admin invitado clickea link → `/auth/confirm` → verifica token con `verifyOtp` → redirige a `/auth/setup`.
6. En `/auth/setup` define su contraseña. Ya queda logueado.
7. Lo redirige al dashboard de SU empresa.

### Caso 2 — Admin de una empresa invita a su equipo

Mismo flow pero desde `/admin/equipo`. El rol va en el form (operario|ventas|admin), `empresa_id` se hereda automáticamente del admin que invita.

### ⚠ Email template configurado en Supabase

Por default Supabase usa el flow **legacy** que no funciona con SSR. Hay que customizar el template en:
**Supabase → Authentication → Email Templates → "Invite user"**

```html
<h2>Te invitaron a StockApp</h2>
<p>Hacé click acá para configurar tu contraseña:</p>
<p>
  <a href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=invite&next=/auth/setup">
    Configurar contraseña y entrar
  </a>
</p>
```

**Site URL** y **Redirect URLs** en Supabase Auth tienen que tener `https://stockapp-tesis.vercel.app` y `/auth/confirm`.

---

## 10. Plan de etapas detallado

### Estado actual

| # | Etapa | Estado |
|---|---|---|
| 0 | Bootstrap (Next + Tailwind + shadcn + deploy) | ✅ |
| 1 | Modelo de datos + auth con roles | ✅ |
| 2 | Ingreso manual de despacho con sus rollos | ✅ |
| Multi-tenant | (no era etapa, se metió entre 2 y 3) | ✅ |
| 3 | Extracción IA con configs por tintorería + sidebar/nav + mobile-first | ✅ |
| 4 | Confirmación física en mobile (scanner QR) | ✅ |
| 5 | Vista de stock con filtros | ✅ |
| 6A | Pedidos: creación por ventas | ✅ |
| 6B | Pedidos: picking por operario (scanner QR) | ✅ |
| 6C | Pedidos: cancelación + entrega por admin | ✅ |
| 7A | Muestras (descuentan kilos del rollo) | ✅ |
| 7B | Reportes admin (stock, movimientos, diferencias, antigüedad) + CSV | ✅ |
| 7C | UI/UX: toasts globales con sonner | ✅ pragmático |
| 7D | Polish: forgot password, pausar empresas, editar equipo, schema.sql | ✅ código |
| 7D-launch | Resend SMTP setup | ⏳ requiere acción manual del user (ver `docs/RESEND_SETUP.md`) |

### Polish acordado

En cada etapa que se cierre, dedicar 20-30 min a que las pantallas nuevas no queden crudas (espaciado, copy, estados de carga básicos). En **Etapa 7** se hace el rediseño grande con sidebar, drawer mobile, toasts, dialogs, etc.

---

### Etapa 3 — Extracción IA de planilla + auditoría relajada

**Objetivo**: el admin u operario sube foto o PDF de la planilla de tintorería. Una IA (Gemini 2.5 Flash) extrae los rollos en formato tabla, usando un prompt **específico de la tintorería elegida** (cada tintorería tiene su propio config). El usuario audita rápido (umbral de confianza visual, sin validación celda-por-celda) y guarda. Los rollos quedan en estado `pendiente` hasta que en Etapa 4 el operario los confirme físicamente con scanner. Es el feature **diferenciador del MVP**.

#### Decisiones acordadas en grilling (mayo 2026)

1. **Modelo B confirmado**: planilla IA crea rollos `pendiente` → scanner físico (Etapa 4) los pasa a `en_stock`.
2. **Admin Y operario pueden subir planilla** en Etapa 3. Ventas NO (su rol es crear pedidos, no cargar ingresos). La pantalla `/operario/ingresos/nuevo` (existente desde Etapa 2) se extiende con un toggle "Cargar a mano" / "Subir planilla con IA" — admin accede al mismo path porque es superset de operario. Cero duplicación de código.
3. **Diseño desktop-first** (admin típicamente está en oficina con PC). Mobile-first sigue aplicando para Etapa 4 (operario en depósito con celu).
4. **Side-by-side cancelado**: el admin tiene la planilla física en la mano (o la imagen en otra ventana), no necesita comparar contra una imagen embebida. Layout simple: tabla editable a pantalla completa. Imagen guardada en Storage queda accesible vía thumbnail/modal por si hace falta.
5. **Multi-formato planilla**: solo **foto (JPG/PNG) y PDF** en MVP. Excel queda postergado (la mayoría de tintorerías mandan foto/PDF; Excel es <10% según user).
6. **`codigo_externo` se elimina del schema**: en la realidad textil, el QR/barcode del rollo físico codifica el mismo `numero_pieza` que figura en la planilla. No hay un código separado. Migración 007 lo dropea.
7. **Color va de `rollos` a `despachos`**: cada despacho de entrada (tintorería → depósito) es **monocromo** (la tintorería tiñe lotes de un color). Los pedidos a cliente (depósito → cliente) sí pueden mezclar colores y eso funciona vía la m2m `pedido_rollos` ya existente. Migración 007 mueve el campo.
8. **Campos extra de trazabilidad guardados**: la planilla trae OT (orden de trabajo), REM.TEJ. (remito de tejeduría), REFERENCIA y Pm2 (gramaje). Los 4 se guardan ahora en migración 007 (nullables) por si se necesita trazabilidad futura. Costo cero.
9. **Auditoría relajada**: celdas con confianza <0.85 aparecen con borde amarillo + tooltip, pero NO bloquean el guardado. El admin tiene la planilla al lado, escanea visualmente, corrige lo que ve mal, guarda. Sin flow paso-a-paso obligatorio.
10. **Fallback 3-tier blando**:
    - **Falla técnica de la IA** (timeout, JSON inválido) → mensaje + botón "Reintentar IA" + botón "Cargar a mano" (cae al modo Etapa 2 con la imagen ya guardada visible en thumbnail).
    - **Extracción incompleta** (header dice 24 rollos, IA extrajo 18) → banner amarillo "Faltan 6 rollos, agregalos a mano". No bloquea.
    - **Calidad pobre** (>30% de celdas <0.85 confianza) → banner gris con recomendación. No bloquea.
    La filosofía: avisar fuerte, NUNCA bloquear el guardado en Etapa 3. El bloqueo duro es de Etapa 4 (scanner).
11. **Caso "rollos llegan sin planilla" postergado a Etapa 7**. Ocurre "a veces" (~10-25% según user). Se va a medir en uso real con Muter; si confirma frecuencia alta, se construye flow de cross-check entonces.

#### Correcciones post-test E2E (mayo 2026)

Después del primer test de la Etapa 3 base, el user identificó 6 cosas a corregir. Se implementaron en una iteración inmediata antes de declarar Etapa 3 cerrada.

1. **Mobile-first del form completo**. La tabla densa solo se ve en desktop (≥640px). En mobile, cada rollo es un card con grid 2-col de inputs, labels chicos arriba, `inputMode="decimal/numeric"` para teclados móviles correctos. El header del ingreso pasa de 3 columnas a 1 en mobile.
2. **Sidebar + drawer mobile + botón Home**. Componente único `src/components/AppShell.tsx` consumido por los 4 layouts (operario/admin/ventas/super). En desktop sidebar fijo a la izquierda; en mobile drawer hamburger desde la izquierda. Botón Home explícito en el header mobile (ícono de casa).
3. **Permisos cruzados PyMe**: el admin tiene en su sidebar TODOS los links — no solo los de admin sino también los de operario (Ingresos, Confirmar, Picking) y ventas (Stock, Pedidos). Filosofía: "es una PyMe, todos hacen de todo cuando hace falta". Los items disabled muestran badge "Etapa X" de la sección que los habilita.
4. **Rename `despachos` → `ingresos`** en toda la app (tabla, columna FK, paths URL, tipos TS, textos UI). Migración 008 hace el rename SQL idempotente. La palabra "despacho" creaba ambigüedad con "despacho a cliente" (que en el schema es `pedidos`).
5. **Sistema de prompts por tintorería** (cambio arquitectural): cada tintorería con formato específico tiene su propio archivo en `src/lib/extraccion/tintorerias/{key}.ts`. El usuario selecciona tintorería **antes** de subir la planilla (paso 1 explícito en la UI). El server action busca el `extraction_config_key` de esa tintorería y le pasa el prompt específico a Gemini. Si la tintorería tiene config `null`, se usa el prompt default genérico. **Workflow de alta**: cliente nos avisa nueva tintorería → recibimos planillas de muestra → creamos archivo `.ts` con la config → commit + deploy → SQL: `UPDATE tintorerias SET extraction_config_key = '{key}' WHERE id = '...'`. El admin de la empresa-cliente NO ve ni edita esto.
6. **Ventas en Etapa 6**: confirmado que ventas hoy solo tiene dashboard placeholder. Se desarrolla entero en Etapa 6 (pedidos + picking). Mientras tanto, el admin puede cubrir las funciones de ventas si hace falta.

#### Plan de sub-etapas

**3.0 — Migración 007: cleanup de schema**
- Mover `color` de `rollos` a `despachos`
- Eliminar `codigo_externo` de `rollos`
- Agregar `ot`, `rem_tejeduria`, `referencia` a `despachos` (TEXT NULL)
- Agregar `gramaje_planilla` a `rollos` (NUMERIC(5,2) NULL)
- Idempotente como las anteriores
- Aplicar en Supabase SQL Editor antes de tocar código

**3.1 — Setup infra (~30 min, requiere acción manual del user)**
- Cuenta gratis en https://aistudio.google.com, generar API key Gemini 2.5 Flash
- `GEMINI_API_KEY` en `.env.local` y Vercel (Production + Preview, sensitive)
- Bucket privado `planillas` en Supabase Storage + RLS por `current_empresa_id()`
- `npm install @google/genai`

**3.2 — Función pura de extracción**
- `src/lib/extraccion/extraerPlanilla.ts`: tipos `IngresoExtraido`, `RolloExtraido` con `confianza` por campo. Función `extraerPlanilla(buffer, mimeType, configKey)`.
- `src/lib/extraccion/gemini.ts`: implementación con `responseSchema` estructurado. Construye el prompt mergeando `PROMPT_BASE` + las instrucciones específicas de la config de la tintorería elegida.

**3.3 — Storage helpers**
- `src/lib/storage/planillas.ts`: upload con path `{empresa_id}/{yyyy-mm}/{uuid}.{ext}`, devuelve URL firmada para mostrar imagen guardada.

**3.4 — UI extendida en `/operario/ingresos/nuevo`**
- Toggle al inicio: "Cargar a mano" (default) / "Planilla con IA"
- En modo IA: paso 1 obligatorio = elegir tintorería; paso 2 = drag-drop (foto/PDF) → spinner → auto-fill de tabla editable.
- Una vez subida la planilla, el dropdown de tintorería queda **bloqueado** (cambiarla = cambiar config = empezar de cero).
- Tabla con celdas de baja confianza marcadas con borde naranja (color "warning" del tema, paleta navy+naranja).
- Banners de fallback 3-tier (falla técnica / extracción incompleta / calidad pobre).
- Mobile-first: cards apilados en mobile (≤640px), tabla densa en desktop.

**3.5 — Sistema de configs por tintorería** (post-test correction)
- ⚠️ **OBSOLETO desde iteración 2026-05-25 (sección 10.11)**. El registry de archivos `.ts` fue borrado; los prompts ahora viven en `tintorerias.extraction_prompt` (BD) y los edita el superadmin desde `/super/tintorerias`. Se deja la descripción histórica para entender la evolución.
- `src/lib/extraccion/tintorerias/_types.ts`: tipo `TintoreriaConfig`.
- `src/lib/extraccion/tintorerias/_default.ts`: config genérica (cuando `extraction_config_key = null`).
- `src/lib/extraccion/tintorerias/_registry.ts`: mapa `key → config`. Función `getConfig(key | null)` que devuelve el default si no encuentra.
- `src/lib/extraccion/tintorerias/muter-textil.ts`: config para Muter (24 rollos en 3 bloques paralelos, header lateral).
- Para agregar tintorería nueva: crear archivo `.ts` + agregarlo al registry + commit + `UPDATE tintorerias SET extraction_config_key = '{key}'` por SQL.

**3.6 — Persistencia y verificación E2E**
- Server action `crearIngreso`: crea ingreso con `origen='planilla_ia'`, `estado='auditado'` y rollos en `pendiente`. Si origen='manual', el estado deriva de los rollos.
- Verificable: el usuario sube la planilla de Muter, selecciona tintorería "Muter Textil" (que tiene `extraction_config_key='muter-textil'`), ve la tabla extraída con confianza visual, corrige lo que la IA leyó mal, guarda, ve el ingreso cargado en estado `auditado` con N rollos en `pendiente`.

**Archivos nuevos**:
- `supabase/migrations/007_cleanup_schema_pre_ia.sql`, `008_rename_despachos_a_ingresos.sql`
- `src/lib/extraccion/extraerPlanilla.ts`, `src/lib/extraccion/gemini.ts`
- `src/lib/extraccion/tintorerias/{_types,_default,_registry,muter-textil}.ts`
- `src/lib/storage/planillas.ts`
- `src/components/AppShell.tsx` (sidebar + drawer + botón Home, usado por los 4 layouts)

**Archivos modificados**:
- `src/app/operario/ingresos/nuevo/NuevoIngresoForm.tsx` (renombrado desde NuevoDespachoForm)
- `src/app/operario/ingresos/nuevo/actions.ts`
- `src/app/operario/ingresos/page.tsx` y `[id]/page.tsx` (mobile-first)
- `src/app/{operario,admin,ventas,super}/layout.tsx` (todos usan AppShell)
- `src/app/{operario,admin}/dashboard/page.tsx` (links actualizados a `/ingresos`)

**Variables de entorno nuevas**: `GEMINI_API_KEY`.

**Tiempo estimado**: 6-8 horas guiadas (incluye correcciones post-test E2E).

---

### Etapa 4 — Confirmación física por scanner ✅

**Objetivo**: el operario va al depósito con su celular, escanea cada rollo físico, asigna ubicación, y el rollo pasa de `pendiente` a `en_stock`. Es la "aduana" del sistema.

**Pasos**:
1. **Instalar scanner library**: `npm install @zxing/browser @zxing/library`.
2. **Pantalla `/operario/confirmar`** (lista):
   - Lista de despachos con al menos 1 rollo en estado `pendiente`.
   - Cada despacho muestra: tintorería, fecha, "X de Y rollos pendientes".
   - Click → entra al modo scanner del despacho.
3. **Pantalla `/operario/confirmar/[despacho_id]`** (modo scanner):
   - Cámara fullscreen mobile (con permission request).
   - Detector zxing corriendo en loop, intenta cada frame.
   - Soporta QR, Code128, EAN-13, EAN-8, ITF.
4. **Lógica de match** al escanear un código:
   - Buscar `rollo` donde `numero_pieza = X AND despacho_id = id AND estado = 'pendiente'` (post-007 `codigo_externo` ya no existe; el QR físico codifica el `numero_pieza`).
   - Si **match único**: dialog "Rollo X" → input "Ubicación (ej: A42)" → guardar → rollo pasa a `en_stock`.
   - Si **no match**: error rojo "Este código no pertenece a este despacho" + botón "Ingresar manualmente".
   - Si **ya escaneado**: error "Ya confirmado".
   - **Pendiente confirmar (en grilling de Etapa 4)**: si los rollos físicos vienen con QR/Code128 escaneable o solo número impreso. Si es solo número impreso, el flow cambia (necesita OCR de cámara o tipeo manual).
5. **Progreso visible** arriba:
   - Banner: "12 de 24 rollos confirmados".
   - Lista colapsable de pendientes (números de pieza).
6. **Fallback manual**: botón "Ingresar a mano" → busca rollo por número de pieza → asigna ubicación.
7. **Cierre del despacho**:
   - Cuando todos los rollos pasan a `en_stock`, el despacho pasa a `confirmado` automáticamente.
   - Mensaje de éxito + redirect al listado.

**Archivos nuevos**:
- `src/app/operario/confirmar/page.tsx`
- `src/app/operario/confirmar/[id]/page.tsx`
- `src/app/operario/confirmar/[id]/Scanner.tsx` (Client component con zxing)
- `src/app/operario/confirmar/[id]/actions.ts` (`confirmarRollo()`)

**Verificable**: con un ingreso cargado por IA en estado `auditado` (rollos en `pendiente`), ir a `/operario/confirmar`, escanear los códigos físicos uno por uno, ver progreso en tiempo real, intentar escanear un código equivocado y ver el bloqueo, terminar con ingreso en `confirmado`.

**Tiempo estimado**: 3-4 horas.

#### Implementación real (mayo 2026)

**Archivos creados**:
- `src/app/operario/confirmar/page.tsx`: lista de ingresos con rollos pendientes, mini barra de progreso por ingreso
- `src/app/operario/confirmar/[id]/page.tsx`: header del ingreso + renderiza Scanner
- `src/app/operario/confirmar/[id]/Scanner.tsx`: Client component — cámara con `@zxing/browser`, visor de escaneo con esquinas, modal de ubicación al detectar código, barra de progreso, lista colapsable de pendientes, toggle "Ingresar a mano" como fallback
- `src/app/operario/confirmar/[id]/actions.ts`: `confirmarRollo(ingresoId, numeroPieza, ubicacion)` — valida que el rollo pertenezca al ingreso, rechaza si ya está confirmado, cierra ingreso automáticamente cuando todos pasan a `en_stock`

**Dependencias instaladas**: `@zxing/browser@0.2.0`, `@zxing/library@0.22.0`

**Confirmado con el cliente**: los rollos físicos de Muter tienen QR/barcode escaneable (no es solo número impreso). El flujo principal es scanner; el modo manual es fallback.

> ⚠️ **Cambio de flujo (iteración 2026-06-02, visita cliente Muter)** — ver Sección 10.x.
> La confirmación rollo-por-rollo con scanner fue **reemplazada** por confirmación de
> partida **por conteo**: el operario cuenta físicamente los rollos e ingresa el número;
> el sistema valida contra la planilla y confirma toda la partida de una. El `Scanner.tsx`
> de confirmar y la action `confirmarRollo` quedaron **sin uso pero NO se borraron** (el
> stack de scanner compartido sigue vivo para el picking y un futuro escaneo de muestras).

**Fixes previos aplicados en la misma sesión** (antes de arrancar Etapa 4):
- Tintorerías: removido form de creación del admin (solo devs las crean vía SQL)
- Timeout Gemini: 45s con `Promise.race`, error `FORMATO_INVALIDO` si imagen no es planilla (0 rollos extraídos)
- Edición de artículos: `updateArticulo()` + `EditArticuloRow` con inline editing
- Ventas dashboard: cards con badge "Etapa 5/6" y opacidad, aviso de próximamente, botón volver para admin
- `BackButton` global: componente `src/components/BackButton.tsx` reemplaza todos los "← Volver" hardcodeados

---

### Etapa 5 — Vista de stock con filtros

**Objetivo**: cualquier rol logueado puede browsear el stock disponible, filtrar por artículo/color/ubicación, ver fotos.

**Pasos**:
1. **Decisión de ruta**: idealmente `/stock` accesible para los 3 roles, layout adaptado por rol. O 3 rutas idénticas en contenido (`/operario/stock`, `/ventas/stock`, `/admin/stock`). **Recomendación**: ruta única `/stock` con guard que la permite a operario+ventas+admin (no super).
2. **Filtros laterales (sidebar) o arriba**:
   - Artículo (dropdown con los artículos de la empresa).
   - Color (texto libre).
   - Tintorería/partida (dropdown).
   - Ubicación (texto).
   - Estado (default: solo `en_stock`; filtros opcionales para `reservado`, `entregado`, `baja`).
   - Búsqueda por número de pieza (input arriba).
3. **Vista responsive**:
   - Desktop: tabla con columnas: foto thumbnail, número de pieza, artículo, color, kilos, metros, ubicación, estado.
   - Mobile: cards apilados con la info importante.
4. **Resumen agregado** arriba de la tabla:
   - Total kilos en stock.
   - Top 5 combinaciones artículo+color por kilos.
5. **Click en un rollo** → modal de detalle:
   - Foto grande (si tiene).
   - Toda la metadata (kilos propios vs proveedor, ubicación, despacho de origen, etc.).
   - Acciones según rol:
     - Operario/admin: "Mover" (cambiar ubicación).
     - Admin: "Dar de baja".
6. **Fotos de los rollos**: si en Etapa 3/4 implementamos upload de fotos, mostrarlas. Si no, placeholder con iniciales del color.

**Archivos nuevos**:
- `src/app/stock/page.tsx` (server component, fetcha rollos con filtros)
- `src/app/stock/StockFilters.tsx` (Client component)
- `src/app/stock/RolloDetail.tsx` (modal Client component)
- `src/app/stock/layout.tsx` (guard de acceso)

**Verificable**: con 20+ rollos cargados y confirmados, filtrar por color "Negro" y ver solo los negros, click en uno, abrir el detalle, mover de ubicación.

**Tiempo estimado**: 2-3 horas.

---

### Etapa 6 — Pedidos y picking

**Objetivo**: ventas crea pedidos seleccionando rollos específicos del stock; operario hace el picking en mobile.

**Pasos**:

**A) Creación del pedido (ventas)**:
1. **Pantalla `/ventas/pedidos/nuevo`**:
   - Header: cliente (texto o autocomplete), número de remito externo (Softland u otro), fecha.
   - Tabla "carrito" de rollos seleccionados: pieza, artículo, color, kilos, X para sacar.
   - Búsqueda de rollos disponibles abajo (mismos filtros que la vista de stock).
   - Click en un rollo del listado lo agrega al carrito.
   - Suma de kilos del carrito en vivo.
   - Submit → `createPedido()`.
2. **Server action `createPedido`**:
   - Validaciones: cliente requerido, al menos 1 rollo.
   - INSERT en `pedidos` (estado=`pendiente`).
   - INSERT batch en `pedido_rollos`.
   - UPDATE batch: `rollos.estado = 'reservado'` para los rollos seleccionados.
   - Idealmente todo atómico (Postgres function/RPC) o sequential con cleanup en caso de error.
3. **Pantalla `/ventas/pedidos`** (lista):
   - Filtros por estado, cliente.
   - Tabla con cliente, kilos totales, estado, fecha.
4. **Pantalla `/ventas/pedidos/[id]`** (detalle):
   - Datos del pedido + lista de rollos asignados.
   - Acciones según estado:
     - `pendiente` o `en_preparacion`: editar (agregar/sacar rollos), cancelar.
     - `lista`: solo ver, esperando que admin marque como entregada.
     - `entregada` / `cancelada`: solo lectura.
5. **Cancelar pedido**: cambia estado a `cancelada` + libera rollos a `en_stock`.

**B) Picking (operario)**:
6. **Pantalla `/operario/picking`** (lista):
   - Pedidos en estado `pendiente` o `en_preparacion` (solo los que necesitan trabajo).
7. **Pantalla `/operario/picking/[pedido_id]`**:
   - Lista de rollos a juntar, con su ubicación.
   - Modo scanner para confirmar cada rollo (similar a Etapa 4).
   - Validación dura: si escaneás un rollo que NO pertenece al pedido → error "Este rollo no es del pedido".
   - Si escaneás uno repetido → error.
   - No se puede cerrar si faltan rollos por escanear.
8. **Cuando todos confirmados**: pedido pasa a `lista`. Notif al admin/ventas (en Etapa 7 los toasts globales se ocupan).

**C) Despachar (admin)**:
9. **Acción "Marcar como despachada"** desde el detalle (solo admin):
   - Pedido pasa a `entregada`.
   - Rollos pasan a `entregado`.
10. **Acción "Cancelar"** (admin o ventas):
    - Si pedido en `pendiente`/`en_preparacion`/`lista`, libera rollos a `en_stock`.

**Archivos nuevos**:
- `src/app/ventas/pedidos/page.tsx` (lista)
- `src/app/ventas/pedidos/nuevo/page.tsx`, `NuevoPedidoForm.tsx`, `actions.ts`
- `src/app/ventas/pedidos/[id]/page.tsx`
- `src/app/operario/picking/page.tsx` (lista)
- `src/app/operario/picking/[id]/page.tsx`, `PickingScanner.tsx`, `actions.ts`

**Verificable**: ventas crea un pedido con 3 rollos para "Cliente Test", queda en `pendiente`. Operario va a picking, intenta escanear un rollo equivocado y la app bloquea, escanea los 3 correctos, queda `lista`. Admin entra al detalle y marca como `entregada`. Stock disponible disminuye.

**Tiempo estimado**: 4-5 horas.

---

### Etapa 7 — Muestras, reportes, rediseño completo

Es la más larga. Se divide en 4 sub-bloques.

#### 7A — Módulo muestras

1. **Migración 007**: crear tabla `muestras`:
   ```
   id, empresa_id, rollo_id, cliente, kilos_descontados, motivo, vinculado_a_pedido_id (nullable), created_by, created_at
   ```
2. **Pantalla `/operario/muestras/nuevo`**: form para registrar muestra.
3. **Server action**: registra la muestra Y descuenta kilos del rollo (`UPDATE rollos SET kilos = kilos - X`).
4. **Pantalla `/operario/muestras`** (listado).
5. **Reporte muestras**: muestras del mes, qué clientes, kilos totales regalados, cuántas se vincularon a pedidos.

#### 7B — Reportes (admin/dueño)

6. **Pantalla `/admin/reportes`**.
7. Reportes:
   - Stock total por artículo+color (cantidad de rollos + kilos).
   - Movimientos del mes: ingresos (rollos nuevos en `en_stock`) vs egresos (rollos a `entregado`).
   - Diferencias proveedor vs propio (cuando hay datos en `kilos_propios`, `metros_propios`).
   - Antigüedad del stock: rollos con más de N días sin moverse (configurable).
8. Cada reporte: filtros de fecha + botón "Exportar a CSV".

#### 7C — Rediseño UI/UX completo

9. **Sidebar de navegación** lateral en desktop, drawer hamburger en mobile. Todas las secciones del rol agrupadas.
10. **Sistema de toasts**: instalar `sonner`, reemplazar banners verdes/rojos puntuales con toasts globales consistentes.
11. **Confirmation dialogs** para acciones destructivas (eliminar empresa, dar de baja rollo, cancelar pedido). Usar shadcn `Dialog`.
12. **Loading skeletons** en pantallas que tardan (lista de stock con muchos items, reportes).
13. **Empty states**: ilustración + CTA cuando una lista está vacía (en vez de solo texto "Sin items").
14. **Iconos `lucide-react`**: en sidebar, botones, headers.
15. **Mobile responsive**: convertir todas las tablas (despachos, stock, pedidos) en cards apilados en mobile (vista compacta).
16. **Componentes shadcn extra**: instalar `Card`, `Dialog`, `Sheet` (drawer), `Tabs`, `Tooltip`, `Avatar`, `Skeleton`, `Badge`.
17. **Animaciones**: micro-transitions en hover, fade-in en pantallas.
18. **Visual hierarchy**: revisar tipografía, spacing, colores en TODA la app — pase de consistencia general.

#### 7D — Polish data (rápidos)

19. **Editar/borrar artículos y tintorerías** (botones en `/admin/articulos`, `/admin/tintorerias`).
20. **Editar/borrar/pausar empresas** (botones en `/super` con confirmación dura para borrar).
21. **Middleware bloquea login si empresa.activo = false**.
22. **Editar usuarios y cambiar rol** (en `/admin/equipo`).
23. **Eliminar usuario** (admin de la empresa puede dar de baja a su equipo; super-admin puede a cualquiera).
24. **Forgot password flow**: pantalla `/auth/recover` que pide mail, llama `supabase.auth.resetPasswordForEmail()`. Supabase manda mail, link va a `/auth/setup` para nueva contraseña.
25. **🚨 Setup SMTP custom con Resend (BLOQUEANTE PARA LAUNCH)**: el built-in email de Supabase tiene un cap duro de **2 emails/hora por proyecto**, no escala con plan paid (ni Pro $25/mes ni Team $599/mes lo aumentan — está deprecado para producción). Ya nos chocamos con esto en testing: una empresa-cliente onboardeando + invitando 2-3 usuarios pega el límite. Plan: cuenta gratis en Resend (resend.com, 3.000 emails/mes free, 100/día), verificar dominio propio (idealmente comprar `stockapp.com.ar` o `stockapp.app`), cargar credenciales SMTP en Supabase → Authentication → SMTP Settings, subir rate limit en Authentication → Rate Limits a 60-100/h. Setup ~20 min. Sin esto el día del launch los emails de invitación van a fallar después de los primeros 2.
26b. **Actualizar `supabase/schema.sql` al estado canónico post-007**: hoy el archivo solo refleja Etapa 2 base. Hay que regenerar el archivo completo incluyendo migraciones 005 (multi-tenant + RLS por empresa + triggers), 006 (super-admin + CHECK constraint), 007 (color en despachos, drop codigo_externo, campos de trazabilidad). Útil para fresh installs en otras instancias o para que un colaborador nuevo arme la DB local sin tener que correr 7 migraciones en orden. **Bajo blocker** porque el desarrollo cotidiano usa la DB ya migrada.

26. **🔐 Login con username + creación manual de usuarios sin email (BLOQUEANTE PARA LAUNCH)**: cambio de modelo de auth pensado para que operarios/ventas (gente del depósito, baja afinidad técnica, sin email corporativo) entren con un username corto en vez de email completo. Además, el admin de empresa puede **crear cuentas directamente sin invitación** poniéndoles una contraseña default que el usuario cambia en el primer login.
    - **Flow nuevo de creación**: en `/admin/equipo` el form tiene dos modos: (a) "Invitar por email" (lo actual, queda para casos donde sí querés mandar mail), (b) "Agregar manualmente" → admin completa nombre + username + password default + rol → al usuario le sale flag `password_change_required = true`. Primer login lo manda a `/auth/cambiar-password` antes de seguir.
    - **Implementación de username con Supabase**: Supabase Auth está casado con email, así que se usa el patrón estándar de **email fake interno**: el username se guarda como `<username>@<empresa-slug>.stockapp.local` en `auth.users.email`, pero la UI nunca lo muestra. Login pide "Usuario" + password, el front le agrega el sufijo basado en el slug de empresa (que se elige al hacer login, dropdown o subdominio).
    - **Schema**: agregar `profiles.username` (UNIQUE composite con `empresa_id`) y `empresas.slug` (UNIQUE global, ej: "muter"). Migración 008.
    - **Decisión pendiente**: ¿admin/super también logean con username, o solo operario/ventas? Recomendación: admin/super con email (uso esporádico, gente técnica, recibe mails reales); operario/ventas con username. Pero quizás todo username queda más uniforme — definir cuando se implemente.
    - **Forgot password sin email para operario/ventas**: el admin de la empresa lo resetea desde `/admin/equipo` (botón "Resetear contraseña" → genera password temporal nuevo + flag `password_change_required`). Para admin/super sí se usa el flow de email (Resend ya estará conectado).
    - **Tiempo estimado**: 3-4 horas (incluye migración 008, refactor de login, nuevo form de creación manual, pantalla de cambio de password obligatorio, botón de reset desde admin).

**Verificable al final de Etapa 7**: app navegable, prolija, responsive en celular y desktop, lista para mostrar en defensa de tesis.

**Tiempo estimado**: 6-8 horas (es la más larga porque el rediseño UI toca todas las pantallas).

---

---

## 10.5. Estado post-MVP (mayo 2026)

El MVP de tesis está cerrado. Etapas 5, 6 y 7 completas. Lo que sigue son
los puntos identificados durante el desarrollo que **no entraron** y que
quedan listos para retomar cuando haga falta.

### Acciones manuales pendientes (no requieren código)

1. **Aplicar migraciones 010 y 011 en Supabase** (si no se hicieron):
   - `supabase/migrations/010_rpc_picking.sql` — RPC del picking
   - `supabase/migrations/011_muestras.sql` — tabla muestras + RPC
   - La 009 ya está aplicada (RPCs de pedidos).
2. **Setup Resend SMTP** — bloqueante para launch real. Guía paso a paso en
   [`docs/RESEND_SETUP.md`](RESEND_SETUP.md). ~20 min, $15-30 USD/año por
   dominio.

### Decisiones operativas tomadas en Etapa 7D

- **Eliminación de empresas**: NO implementada en `/super` por riesgo de
  borrado en cascada de datos cliente. Lo único expuesto es **pausar/activar**.
  Para hard-delete: dashboard de Supabase manualmente.
- **Empresa pausada → bloqueo de login**: middleware redirige a
  `/login?empresa_pausada=1`, el cliente hace `signOut()` automático y muestra
  banner. El super-admin puede reactivar desde `/super`.
- **Equipo (`/admin/equipo`)**: editar rol y eliminar usuario funcionan, con
  validación de "no dejar la empresa sin ningún admin" y "no podés eliminarte
  a vos mismo".
- **Forgot password**: `/auth/recover` usa el flow estándar de Supabase
  (`resetPasswordForEmail`). Funciona contra el SMTP built-in pero pega contra
  el rate limit de 2/h hasta que se haga el setup de Resend.

### Reportes (Etapa 7B) — limitaciones reconocidas

El reporte de "movimientos del mes" usa `rollos.created_at` para ingresos y
`pedidos.created_at` (con estado `entregada`) para egresos. Esto es **proxy**,
no la métrica exacta — sin un campo `updated_at` o tabla de eventos no
podemos saber el momento real en que un rollo cambió de estado.

Si en uso real esa métrica resulta engañosa, hay dos caminos para fixearlo:
- Agregar `rollos.last_state_change_at` actualizado por trigger.
- O crear tabla `rollo_eventos` (audit log de cambios de estado).

Ambas son post-MVP.

### Etapa 7C UI/UX — qué quedó pragmático

Lo que SÍ se hizo:
- Instalación de `sonner`, `<Toaster />` global en root layout.
- Reemplazo de banners inline de error/success por toasts en todos los
  componentes nuevos de las Etapas 5/6/7A.

Lo que NO se hizo (queda como deuda técnica para post-MVP):
- **Migración a shadcn Card / Dialog / Sheet / Tabs / Tooltip / Avatar /
  Skeleton / Badge**. Requiere reescribir todos los componentes existentes
  ya en producción. Costo alto, valor estético marginal para defensa de
  tesis. Si en algún momento se quiere subir el bar visual, se hace como
  pase aparte.
- **Sidebar con `lucide-react` icons en vez de emojis**. La lib está
  instalada (en `package.json`) pero no se usa todavía. Cambio cosmético.
- **Skeletons de carga**. Las pantallas se cargan rápido en uso real;
  agregamos cuando un cliente reporte tiempos de carga molestos.
- **Empty states ilustrados**. Hoy son texto. Suficiente para MVP.

### Login con username + alta sin email (postergado fuera de Etapa 7)

El **punto 26 del plan original** (login por username con email fake interno
para operario/ventas, alta manual con password default por el admin) quedó
**fuera** del MVP por decisión explícita: el flow actual de invitación por
email funciona para Muter (los operarios sí tienen email), y meterlo agrega
3-4 horas de refactor de auth + migración de schema (`profiles.username`,
`empresas.slug`). Si una empresa-cliente futura no puede dar emails a
operarios, se prioriza ahí. Tiempo estimado original: 3-4 horas.

### Lo que NO está en el MVP (cosas mencionadas pero pospuestas)

- **Valorización del stock**: costo por rollo (hilado + licra + tintorería + merma), dashboard valorizado solo para dueño. Subsistema entero, post-MVP.
- **Control de calidad en recepción avanzado**: gramaje calculado, listado de fallas con origen (tejeduría/tintorería/materia prima), clasificación A/B/C automática. Hay campos `kilos_propios`/`metros_propios`/`ancho_propio`/`gramaje_propio` ya en el schema, pero falta el form para cargarlos y los reportes que los usen.
- **Alertas automáticas**: reserva vencida, stock viejo en crudo (>30 días para poliéster). Necesita cron job (Supabase Edge Functions o pg_cron).
- **Módulo chofer**: chofer escanea remito al entregar al cliente final. Otro rol más, fuera del flujo principal.
- **Sign-up público**: hoy solo invitation-only. Si en algún momento se quiere abrir, agregar página `/signup` + validación de email + cobro.
- **Multi-idioma**: hoy solo español. i18n con next-intl si se quiere expandir.
- **Auditoría / log de cambios**: tabla `audit_log` que registre quién hizo qué (útil para clientes con compliance).

---

## 10.6. Iteración mayo 2026 — extensiones post-MVP (sin commit aún)

Cambios traídos por un colaborador del equipo (zip externo, mayo 2026 — aplicados localmente 2026-05-18 antes de commitear).
Foco: cerrar gaps detectados después del MVP base y agregar features pedidos por Muter durante el uso real.

### Features nuevos (DB + UI)

1. **Demandas pendientes (`/ventas/pedidos-pendientes`)** — ventas registra "Cliente X pidió Y metros de tela Z color W" sin que haya stock asignado. Cuando entra mercadería que matchea, el equipo puede revisar la lista y marcar la demanda como `resuelto` o `cancelado`. Coloreado por antigüedad (verde <3 días, naranja 3-7, rojo >7). Backed by migración 013 (tabla `pedidos_pendientes`).
2. **Editar header de ingreso (`/operario/ingresos/[id]/editar`)** — permite corregir tintorería/artículo/fecha/remito/totales declarados/OT/rem.tejeduría/referencia/color de un ingreso ya cargado. Guarda `editado_at` y `editado_por` para auditoría (migración 015).
3. **Estado `segunda` para rollos** — botón nuevo en el detalle de rollo (`RolloDetailDialog.tsx`) para marcarlo como segunda calidad. Sigue en stock pero se filtra/muestra distinto. Backed por migración 016.
4. **Stock mínimo por artículo** — el admin setea `stock_minimo_kg` por artículo desde `/admin/articulos`. El dashboard de admin muestra alerta cuando un artículo cae bajo su mínimo. Migración 017.
5. **Desactivar usuarios sin borrarlos** — `/admin/equipo` ahora tiene botón "Desactivar" además de "Eliminar". El usuario desactivado no puede loguear (Auth banned + flag `profiles.disabled=true`). Migración 014.
6. **Tintorerías solo admin** — operario perdió permiso de crear/editar tintorerías (RLS). Se ajustó el form de ingreso para que el dropdown sea read-only para operario. Migración 012.

### Helpers y polish

- `src/lib/ubicaciones.ts` — constante exportada con las 180 ubicaciones del depósito (`A1..F30`). La usa el form de confirmación de rollos y el editor de rollos para popular dropdowns.
- Sidebar (`AppShell.tsx`) y `BackButton.tsx` con ajustes menores de navegación.
- `/operario/ingresos/nuevo/NuevoIngresoForm.tsx`, `actions.ts` y `[id]/page.tsx` retocados para soportar edición + ubicaciones.
- `/admin/dashboard/page.tsx` extendido con widgets de stock bajo + demandas pendientes.
- `/admin/reportes/queries.ts` + `page.tsx` con ajustes de queries (probable: incluir `segunda` y excluir `disabled`).
- Stock (`StockList.tsx`, `StockFilters.tsx`, `RolloDetailDialog.tsx`, `actions.ts`) — filtros y acciones nuevas para los estados `segunda` + `baja`.

### Pendiente para que esto funcione en producción

1. **Aplicar migraciones 012..017 en Supabase** (SQL Editor, en orden). Todas son idempotentes.
2. **Regenerar `supabase/schema.sql`** para incluir 012..017 (sigue siendo deuda técnica de baja prioridad — la DB de prod ya tiene aplicadas las migraciones).
3. **Commit + push a `main`** — Vercel redeploya automático.

### Archivos tocados en esta iteración

**Modificados** (24): admin/articulos/{actions,ArticuloForm,page}, admin/dashboard/page, admin/equipo/{actions,page,UsuarioRow}, admin/reportes/{page,queries}, operario/confirmar/page, operario/ingresos/[id]/page, operario/ingresos/nuevo/{actions,NuevoIngresoForm,page}, operario/{ingresos,muestras,picking}/page, stock/{actions,RolloDetailDialog,StockFilters,StockList}, ventas/pedidos/page, components/{AppShell,BackButton}.

**Nuevos** (14): operario/ingresos/[id]/editar/{page,EditarIngresoForm}, ventas/pedidos-pendientes/{page,PedidoPendienteRow,actions,nuevo/page,nuevo/NuevaDemandaForm}, lib/ubicaciones.ts, supabase/migrations/{012..017}_*.sql.

---

## 10.7. Iteración 2026-05-19 — Extensiones de negocio (Bloques A–H)

Segunda ronda mayor de cambios post-MVP, pedidos por el cliente después
del primer uso real. Foco: trazabilidad fuerte (historial inborrable),
flujo de venta más estricto (confirmación explícita post-picking),
catálogo de clientes propio, y filtros + edición masiva tipo Excel
donde más hacía falta.

### Bloque A — DB + bugs base
- **Migración 018**: `empresas.nombre` UNIQUE (resuelve bug duplicado).
  `rollos.numero_pieza` UNIQUE por empresa (reemplaza el viejo UNIQUE
  por ingreso). TRUNCATE de todas las tablas transaccionales (la data
  era de prueba, confirmado explícito con el cliente).
- `crearIngreso` y `createEmpresaConAdmin` mapean PG 23505 a mensaje
  amigable con el valor duplicado.
- `NuevoIngresoForm` y `EditarIngresoForm` ahora **bloquean el submit**
  si la suma de kilos o cantidad de rollos no coincide con lo declarado.
  Reemplaza la política previa de Etapa 3 ("avisar fuerte, nunca
  bloquear"). El editor del header trae la suma real de los rollos del
  ingreso desde el server para validar contra ella.

### Bloque B — Stock: confirmación / auditoría manual
- **Migración 019**: `rollos.auditado_at` + `auditado_por`.
- Server actions nuevas en `stock/actions.ts`:
  - `confirmarRolloManual(rolloId, ubicacion)`: rollo `pendiente` →
    `en_stock` sin pasar por el scanner. Si todos los hermanos del
    ingreso quedan en_stock, cierra el ingreso a `confirmado`. Operario
    y admin.
  - `auditarRollo(rolloId)`: setea `auditado_at = NOW()` sin cambiar
    estado. Operario y admin. Disponible en estados `en_stock` /
    `reservado` / `segunda`.
- Botones nuevos en `RolloDetailDialog`. La metadata muestra la fecha
  de "Última auditoría" si existe.

### Bloque C — Ingresos: filtros tipo Excel + edición masiva
- Componente reusable `src/components/ExcelFilter.tsx`: chip con
  search-bar arriba + checkboxes multi-selección. Convención
  `selected = []` → "todos".
- `/operario/ingresos` ahora tiene **tabs**: "Por ingreso" (vista
  histórica existente) / "Por rollo" (nueva). La vista por rollo es un
  client component (`RollosBulkView.tsx`) que carga hasta 2000 rollos y
  los filtra client-side con 8 filtros tipo Excel: tintorería, artículo,
  color, lote (OT), rem. tejeduría, referencia, estado, ubicación. Más
  búsqueda libre por nº de pieza.
- Selección por checkbox + "Seleccionar visibles" + "Limpiar selección".
  Acciones masivas: **Ubicación** / **Estado** / **Artículo**.
- Server action `bulkEditRollos` en `bulkActions.ts`. Rechaza modificar
  rollos en `reservado` / `entregado` (están en flow de pedidos). Solo
  admin puede dar `baja` en bulk.

### Bloque D — Pedidos y reportes con filtros
- `/ventas/pedidos`: componente `PedidosFilters` reemplaza la barra de
  chips por filtros completos (cliente, estado, rango de fechas,
  búsqueda libre por nº pedido o nº remito externo). URL-based.
- `/admin/reportes`: componente `ReportesFilters` agrega filtro por
  **año** + **mes** (aplican a Movimientos), **tintorería** y
  **artículo** (aplican a stock/merma/diferencias/antigüedad/pedidos
  por tintorería). El selector de "días de antigüedad" se movió al
  mismo bloque (antes era un form suelto).
- `reporteMovimientos` ahora acepta período arbitrario (año o año+mes)
  además del default "mes actual". El CSV respeta filtros activos.

### Bloque E — Confirmación de venta post-picking
- **Migración 020**: nuevo estado `confirmada_venta` en el CHECK de
  `pedidos.estado` + columnas `confirmada_venta_at`/`confirmada_venta_por`.
- Nueva RPC `confirmar_venta_pedido(p_pedido_id)` (solo ventas/admin,
  estado debe ser `lista`). Reescritura de `entregar_pedido` para
  exigir `confirmada_venta` en lugar de `lista`. `cancelar_pedido`
  acepta cancelar desde `pendiente`/`en_preparacion`/`lista`/`confirmada_venta`.
- Flujo nuevo: `pendiente → en_preparacion → lista → confirmada_venta → entregada`.
- `PedidoActions` agrega: "Confirmar venta" y "Caer venta" cuando
  estado=lista (ventas/admin). "Marcar como entregada" ahora aparece
  solo si estado=`confirmada_venta` (admin). Caer venta = `cancelar_pedido`
  (libera rollos a `en_stock`).

### Bloque F — Historial inborrable
- **Migración 021**: tabla `movimientos` (entidad, entidad_id, accion,
  usuario_id, detalle JSONB) con RLS lectura solo admin/super y **sin
  policies** de INSERT/UPDATE/DELETE expuestas a `authenticated`.
  Helper `log_movimiento` SECURITY DEFINER que los triggers usan para
  escribir bypasseando RLS.
- Triggers AFTER INSERT/UPDATE/DELETE en `rollos`, `pedidos`,
  `ingresos`, `pedido_rollos`, `muestras`. UPDATE solo dispara log si
  cambió un campo relevante (estado, ubicacion, kilos, articulo,
  cliente, etc.); el detalle guarda `{cambios: { campo: [viejo, nuevo] }}`.
- Pantalla `/admin/historial` con filtros (entidad, acción, usuario,
  rango de fechas). Formatea cada movimiento en texto amigable
  ("cambió estado del rollo Nº 123 de en_stock → reservado"). Link en
  sidebar de admin.
- ⚠ El historial empieza desde el momento en que se aplica la 021.
  Cambios anteriores no quedan registrados.

### Bloque G — Clientes
- **Migración 022**: tabla `clientes` (id, empresa_id, nombre,
  contacto, email, telefono, direccion, notas, activo). Nombre UNIQUE
  por empresa. RLS por empresa, gestión por ventas+admin, lectura por
  todos los autenticados de la empresa. `pedidos.cliente_id UUID FK NULL`
  agregada — los pedidos viejos (que solo tenían texto en `cliente`) ya
  fueron borrados en la 018, así que los nuevos exigen cliente_id desde
  la UI.
- **Reescritura de RPC `crear_pedido`**: cambia firma de
  `(TEXT, TEXT, UUID[])` a `(UUID, TEXT, UUID[])`. Toma `cliente_id` y
  autocompleta `pedidos.cliente` (denormalizado) desde el catálogo.
  ⚠ Breaking: cualquier llamada con la firma vieja falla.
- `/ventas/clientes`: lista con búsqueda + ver inactivos + alta inline.
- `/ventas/clientes/[id]`: detalle con stats (antigüedad, total
  pedidos, entregados, en curso, kilos totales) + historial de pedidos
  + edición de datos + botón activar/desactivar.
- `NuevoPedidoForm` reemplaza el input texto de cliente por un
  `<select>` del catálogo + botón "+ Nuevo cliente" que abre un
  mini-form inline (sin salir de la pantalla, autoselecciona el
  cliente creado).
- `PedidosFilters` cambia el filtro de cliente de texto libre a
  dropdown con `cliente_id`.
- Link "Clientes" en sidebar de ventas y admin.

### Bloque H — Reporte de pedidos por tintorería
- Nueva query `reporteTintorerias` en `admin/reportes/queries.ts`:
  cruza `pedido_rollos → rollos → ingresos → tintorerias`. Por
  tintorería: pedidos únicos (con desglose entregados / en curso /
  cancelados), rollos totales, kilos. Respeta los filtros globales
  de la pantalla.
- Sección nueva "Pedidos por tintorería" en `/admin/reportes` entre
  Movimientos y Merma. Export CSV (`?tipo=tintorerias`).

### Bugs verificados (punto 10 del pedido)
- **a** — empresa duplicada (CU-02-02): bug real → fix con UNIQUE en
  migración 018.
- **b** — kilos/rollos no coinciden con declarado (CU-04-09/10): era
  intencional según decisión de Etapa 3 (avisar no bloquear); por
  pedido explícito en esta iteración se cambió a **bloquear submit**.
- **c** — muestra con kilos > kilos del rollo (CU-11-02): falso
  positivo, la RPC `registrar_muestra` ya valida `v_rollo_kilos -
  p_kilos < 0`.
- **d** — picking auto a "lista" cuando se pickean todos (CU-10-05):
  falso positivo, la RPC `pickear_rollo` ya transiciona automáticamente.

### Pendiente para que esto funcione en producción

1. **Aplicar migraciones 018..022 en Supabase SQL Editor en orden**.
   - **018 hace TRUNCATE** de todas las tablas transaccionales —
     confirmado explícitamente con el cliente que era data de prueba.
2. **Regenerar `supabase/schema.sql`** para incluir 012..022 (sigue
   siendo deuda técnica de baja prioridad).
3. **Commit + push a `main`** — Vercel redeploya automático.

### Notas operativas post-iteración

- **Pedido nuevo ahora requiere cliente del catálogo** (no texto
  libre). El form ofrece "+ Nuevo cliente" inline, pero la primera vez
  alguien tiene que dar de alta al menos uno.
- **"Confirmar venta" es paso obligatorio** entre picking y entrega.
  Admin no puede entregar un pedido directamente desde `lista`.
- **El historial** (`/admin/historial`) registra solo desde que se
  aplica la 021. Cambios previos no aparecen.
- **N° de pieza único por empresa**: si se intenta crear un rollo
  con un número ya existente en la empresa, el form devuelve el
  mensaje específico con el número conflictivo.

### Archivos tocados en esta iteración

**Nuevos** (~15):
- `supabase/migrations/{018..022}_*.sql` (5)
- `src/components/ExcelFilter.tsx`
- `src/app/operario/ingresos/{RollosBulkView,bulkActions}.tsx`
- `src/app/admin/historial/{page,HistorialFilters}.tsx`
- `src/app/admin/reportes/ReportesFilters.tsx`
- `src/app/ventas/pedidos/PedidosFilters.tsx`
- `src/app/ventas/clientes/{page,actions,ClientesList,ClienteForm}.tsx`
- `src/app/ventas/clientes/[id]/{page,ClienteActions}.tsx`

**Modificados** (~15):
- `src/app/operario/ingresos/{page,nuevo/{actions,NuevoIngresoForm},[id]/editar/{page,EditarIngresoForm}}.tsx`
- `src/app/stock/{actions,RolloDetailDialog,StockList,page}.tsx`
- `src/app/ventas/pedidos/{page,actions,[id]/{page,PedidoActions},nuevo/{page,NuevoPedidoForm}}.tsx`
- `src/app/admin/reportes/{page,queries,csv/route}.{ts,tsx}`
- `src/app/super/{actions,NuevaEmpresaForm}.tsx`
- `src/components/AppShell.tsx` (links Historial + Clientes en sidebar)

---

## 10.8. Iteración 2026-05-22 — Scanner robusto + polish UI

Tercera ronda post-MVP. Dos focos: (a) **certeza dura del scanner**
QR/barcode (el cliente no tolera que se levante un código erróneo o se
muestre el payload completo en el modal de "Código detectado"), y (b)
**polish UI acumulado** de varios sprints previos (logo, sidebar sticky,
rediseño de dashboards, filtros de reportes).

### Bloque A — Refactor del scanner a componente compartido

Antes: `Scanner.tsx` (confirmar) y `PickingScanner.tsx` (picking)
duplicaban ~250 líneas cada uno con la lógica de ZXing (cámara, formats,
debounce, beep, vibrate, linterna, permission errors, fallback manual).

- **Nuevo `src/components/CodeScanner.tsx`** — Client Component genérico
  que envuelve `@zxing/browser`. Maneja:
  - Cámara con `getUserMedia` (constraints `facingMode: 'environment'`,
    1280×720 ideal).
  - Formats soportados: `QR_CODE`, `CODE_128`, `EAN_13`, `EAN_8`, `UPC_A`
    + `TRY_HARDER`.
  - Debounce de 2s para evitar relecturas del mismo código.
  - Beep (Web Audio API a 1200 Hz) + `navigator.vibrate(100)` en cada
    lectura.
  - Toggle linterna (`ImageCapture` API, best-effort).
  - Visor con esquinas blancas + animación `scan-success` (verde).
  - Estados `unsupported` / `permission-denied` / `error` con overlays
    distintos.
  - Fallback manual: input + botón "Usar código".
  - Solo expone `onRead({ texto, formato })` — no conoce nada de rollos.
- **`Scanner.tsx` y `PickingScanner.tsx` quedan thin wrappers** que solo
  manejan la lista de rollos esperados, el modal de confirmación con
  ubicación y la llamada al server action.
- **Nuevo helper `src/lib/scanner.ts`** con `extraerCodigoRollo` que
  centraliza la lógica de extracción (antes vivía dispersa en ambos
  wrappers).

### Bloque B — Patrones regex por tintorería (migración 023)

**Problema concreto**: el QR de la tintorería Musa trae el payload
`204023686 MIC LY 40 TER FR MARINO 640014 21.75`. El fallback previo de
`extraerCodigoRollo` (`texto.split(/\s+/)[0]`) "por suerte" agarraba el
primer token correcto, pero **el modal mostraba el string completo** en
"Código detectado", lo que se veía como un bug visual gigante.
Peor: si otra tintorería pone número de OT (también 9 dígitos) antes
del nro de pieza, el fallback levantaría la OT. El cliente exigió
certeza absoluta.

- **Migración 023** crea `tintoreria_codigo_patrones`:
  - `empresa_id NOT NULL`, `tintoreria_id` nullable (NULL = patrón
    "interno" de fábrica, aplica a toda la empresa sin importar la
    tintorería original del rollo).
  - `pattern TEXT` (regex JS-compatible), `capture_group INT DEFAULT 1`,
    `prioridad INT DEFAULT 100` (menor primero), `activo BOOLEAN`,
    `descripcion TEXT`.
  - Index `(empresa_id, tintoreria_id, activo, prioridad)`.
  - RLS estándar: read para autenticados de la empresa, write solo
    admin. Trigger `set_empresa_id` reutilizado.
- **Seed por empresa** (idempotente): un patrón `\b(\d{9})\b`
  con prioridad 100, `tintoreria_id NULL`, descripción "9 dígitos
  consecutivos".
- **`extraerCodigoRollo` reescrito** con nueva firma:
  `(raw, patrones, codigosEsperados) → { ok: true, codigo, patronUsado } | { ok: false, razon }`.
  Itera por prioridad, ejecuta el regex case-insensitive, extrae
  `match[capture_group]`, y solo devuelve `ok: true` si el candidato está
  en `codigosEsperados`. **El fallback peligroso (`split(/\s+/)[0]`)
  está eliminado**: si nada matchea, retorna `{ ok: false }` y los
  wrappers muestran error sin abrir el modal.
- **Page de `/operario/confirmar/[id]`** ahora selecta `tintoreria_id` del
  ingreso y carga patrones con `tintoreria_id = X OR tintoreria_id IS NULL`.
- **Page de `/operario/picking/[id]`** deriva el set de `tintoreria_id`
  haciendo join `pedido_rollos → rollos → ingresos`. Carga patrones de
  esas tintorerías + los internos (en picking pueden convivir etiquetas
  originales del proveedor y etiquetas internas que pega la fábrica al
  ingresar al depósito — decidido con el cliente).
- **Server actions simplificadas**: el cliente manda el código limpio
  (los 9 dígitos), el server solo hace `rollos.find(r => r.numero_pieza === codigo)`.
  La responsabilidad de extraer queda 100% en cliente.

#### Cómo agregar un patrón específico para una tintorería

Cuando aparezca un formato que el regex global no cubra (ej. la
tintorería pone una OT de 9 dígitos antes del nro de pieza, lo que haría
que el global agarre la OT), se carga un patrón específico con prioridad
menor (más alta):

```sql
INSERT INTO tintoreria_codigo_patrones
  (empresa_id, tintoreria_id, pattern, capture_group, prioridad, descripcion)
VALUES
  ('<empresa_uuid>', '<tintoreria_uuid>',
   'PIEZA\s+(\d{9})', 1, 50,
   'Tintorería XYZ: nro de pieza después del literal PIEZA');
```

No hay admin UI todavía — los patrones se cargan por SQL. Si crece la
demanda, en una iteración futura se construye `/admin/patrones`.

### Bloque C — Polish UI acumulado (varios sprints previos)

Cambios menores acumulados en commits previos al refactor del scanner
(`c6664d8 front done?`, `51fd090 cambios con logo`, `3f59b00 cambios
front chicos`, `5aa10c2 navbar/sidebar fija`, `be7f926 corrección
tildes`, `64cd6e5 cambios2`, `db6e8ab cambio operario ingreso`,
`ca4263e hovers`):

- **Logo + BrandMark**: nuevo `public/nudo-logo.svg` + componente
  `src/components/BrandMark.tsx`. Usado en header del sidebar y en las
  pantallas de auth (login, recover, setup).
- **Sidebar fija** (`AppShell.tsx`): en desktop queda sticky en la
  izquierda, no scrollea con el contenido. Mejora UX en pantallas
  largas (stock, historial, reportes).
- **Dashboards rediseñados**: `/admin/dashboard`, `/operario/dashboard`,
  `/ventas/dashboard` con cards visuales mejores, stats con iconos,
  mejor jerarquía visual. El de admin sumó widgets de stock bajo y
  demandas pendientes.
- **Filtros de reportes ampliados** (`/admin/reportes`): `ReportesFilters`
  acepta más combinaciones (año/mes + tintorería + artículo).
- **Login + auth pages**: rediseño con paleta consistente, BrandMark,
  espaciado más limpio.
- **Correcciones ortográficas** en toda la app: tildes que faltaban en
  varios componentes (`stock`, `pedidos`, `dashboards`, etc.).

### Pendiente para que esto funcione en producción

1. **Aplicar migración 023 en Supabase SQL Editor**. Idempotente.
2. **Verificar el seed**: `SELECT * FROM tintoreria_codigo_patrones;`
   debe tener al menos 1 fila por empresa con `pattern = '\b(\d{9})\b'`.
3. **Smoke test E2E** en `/operario/confirmar/<id>`:
   - Manual `204023686` → modal con `204023686`.
   - Manual `204023686 MIC LY 40 TER FR MARINO 640014 21.75` → modal
     con **solo** `204023686` (no el string completo).
   - Manual `hola mundo` → mensaje de error, sin modal.
4. Repetir en `/operario/picking/<id>` con un pedido multi-tintorería.
5. **Commit + push a `main`** — Vercel redeploya automático.

### Archivos tocados en esta iteración

**Nuevos**:
- `supabase/migrations/023_codigo_patrones.sql`
- `src/components/CodeScanner.tsx` (refactor de scanner compartido)
- `src/components/BrandMark.tsx` + `public/nudo-logo.svg` (de sprints
  previos no documentados)

**Modificados**:
- `src/lib/scanner.ts` (reescritura completa, nueva firma de
  `extraerCodigoRollo`)
- `src/app/operario/confirmar/[id]/{page,Scanner,actions}.{tsx,ts}`
- `src/app/operario/picking/[id]/{page,PickingScanner,actions}.{tsx,ts}`
- `src/components/AppShell.tsx` (sidebar sticky)
- Dashboards de `/admin`, `/operario`, `/ventas` (rediseño)
- `src/app/admin/reportes/{page,ReportesFilters,queries,csv/route}.{ts,tsx}`
- `src/app/login/page.tsx`, `src/app/auth/{recover,setup}/page.tsx`
  (rediseño + BrandMark)
- Múltiples archivos con correcciones de tildes

---

## 10.9. Iteración 2026-05-22 — Refactor de rutas neutras

Cuarta iteración del día. El cliente reportó un bug crítico de UX: al
entrar como admin a `/operario/picking`, sentía que **cambiaba de rol**.

### Causa raíz

El problema NO era de auth ni de roles. Los layouts ya pasaban
`role={profile.role}` al sidebar (correctamente) y el guard en el
middleware/layout permitía el acceso. El bug era visual: los **BackButton**
en las pantallas compartidas estaban hardcodeados a `/operario/dashboard`,
y las **URLs** tenían prefijo `/operario/...` o `/ventas/...` aunque las
pantallas fueran compartidas con admin. Resultado: un admin viendo
`/operario/picking` clickeaba "← Volver" y caía en el dashboard del
operario (cards distintas, header "Depósito"), lo que se sentía
exactamente como cambiar de rol.

### Solución: rutas neutras

Se sacó el prefijo de rol de TODAS las pantallas compartidas entre roles.
Hoy el patrón es:

- **Rutas neutras** (sin prefijo): `/picking`, `/ingresos`, `/confirmar`,
  `/muestras`, `/pedidos`, `/pedidos-pendientes`, `/clientes`, `/stock`.
  Cada una tiene su propio `layout.tsx` con el guard de rol correspondiente
  (operario+admin, ventas+admin, etc.) y monta `AppShell` con el rol REAL
  del user logueado.
- **Rutas por rol** (con prefijo, quedaron solo donde tiene sentido):
  - `/admin/{dashboard,articulos,tintorerias,equipo,reportes,historial}` — admin-only
  - `/operario/dashboard` — solo operario (admin tiene su propio dashboard)
  - `/ventas/dashboard` — solo ventas
  - `/super` — solo super-admin

### Cambios técnicos

1. **`git mv` de 7 carpetas a top-level** (preservó el history):
   `operario/{ingresos,confirmar,picking,muestras}` y
   `ventas/{pedidos,pedidos-pendientes,clientes}`.
2. **7 `layout.tsx` nuevos** (uno por ruta neutra) con guards y `AppShell`.
3. **Reemplazos masivos** de hrefs internos (Link, redirect,
   revalidatePath, router.push, imports `@/app/...`) en ~36 archivos.
4. **Middleware ampliado**:
   - Nuevo bloque de `LEGACY_PATH_PREFIXES` que hace **redirect 308** de
     paths viejos (`/operario/picking` → `/picking`, etc.) para preservar
     bookmarks y links externos.
   - Guards nuevos para las rutas neutras (`isOperacion` → operario+admin,
     `isComercial` → ventas+admin).
5. **`AppShell.tsx`** — sidebar actualizado con los nuevos hrefs neutrales
   en los tres `navForRole`.
6. **Nuevo `DashboardBackButton.tsx`** — Server Component async que consulta
   el rol del user logueado y arma el href del dashboard correcto. Usado en
   las 10 pantallas donde antes había `<BackButton href="/{rol}/dashboard" />`
   hardcodeado.

### Backward-compat

El middleware redirige cualquier URL vieja (`/operario/picking/123`,
`/ventas/clientes`, etc.) a su nueva forma neutra con un **308 Permanent
Redirect**, así que:
- Bookmarks viejos siguen funcionando.
- Links en chats/emails siguen funcionando.
- El SEO (si lo hubiera) se preserva.

### Verificado

`npm run build` pasa limpio. Las 33 rutas quedan registradas correctamente.

### Pendiente para que esto funcione en producción

1. **Commit + push a `main`** — Vercel redeploya automático.
2. Smoke test post-deploy:
   - Login como admin → click "Picking" en sidebar → URL `/picking` →
     click "← Volver al inicio" → URL `/admin/dashboard`.
   - Login como operario → mismo flujo → vuelve a `/operario/dashboard`.
   - Visitar URL vieja (`/operario/picking`) → redirige a `/picking`.

### Archivos tocados en esta iteración

**Nuevos** (8):
- `src/app/{ingresos,confirmar,picking,muestras,pedidos,pedidos-pendientes,clientes}/layout.tsx` (7)
- `src/components/DashboardBackButton.tsx`

**Movidos** (~39 archivos vía `git mv`):
- `src/app/operario/{ingresos,confirmar,picking,muestras}/*` → `src/app/{ingresos,confirmar,picking,muestras}/*`
- `src/app/ventas/{pedidos,pedidos-pendientes,clientes}/*` → `src/app/{pedidos,pedidos-pendientes,clientes}/*`

**Modificados** (~38 archivos):
- `src/components/AppShell.tsx` (sidebar hrefs)
- `src/lib/supabase/middleware.ts` (legacy redirects + nuevos guards)
- 10 pantallas con reemplazo de `BackButton` → `DashboardBackButton`
- ~26 archivos con hrefs/redirects/revalidatePath actualizados
- `docs/CONTEXTO.md` (esta sección + Sección 7)

---

## 10.10. Iteración 2026-05-22 — Notificaciones, topbar y sidebar colapsable

Tres mejoras pedidas por el cliente en la misma vuelta:

1. **Sistema de notificaciones in-app** con campanita en el topbar.
2. **Topbar** con perfil + logout (movidos desde el footer del sidebar).
3. **Sidebar colapsable** (icon-only) para liberar espacio en pantalla.

### Bloque A — Notificaciones (migración 024)

**Modelo**: tabla `notificaciones` genérica con `tipo` extensible. En la
primera iteración hay un solo tipo (`stock_minimo`) que se dispara
automáticamente vía triggers Postgres.

**Cómo funciona**:
- Helper `procesar_notificacion_stock_minimo(p_articulo_id)` (SECURITY DEFINER)
  recalcula el stock del artículo sumando rollos en `en_stock` y compara
  contra `articulos.stock_minimo_kg`.
- Si **cruza hacia abajo**: INSERT (con UNIQUE parcial sobre `(empresa_id,
  tipo, articulo_id) WHERE resuelta_at IS NULL` → dedupe automático, cero
  spam).
- Si **vuelve sobre el mínimo**: UPDATE `resuelta_at = NOW()` → la
  notificación desaparece del badge sin acción manual.
- Triggers en `rollos` (INSERT/UPDATE de kilos/estado/articulo_id, DELETE)
  y `articulos` (UPDATE de stock_minimo_kg) llaman al helper.
- Seed inicial en la propia migración: recorre artículos con mínimo
  configurado y crea las notificaciones del estado actual.

**RLS**: visible solo para `admin` + `ventas` de la empresa. Operario no
las ve (no es su problema). INSERT exclusivo de los triggers
(SECURITY DEFINER) — no hay policy de INSERT expuesta.

**Campos clave**:
- `leida_at` — lo setea el usuario al marcar la notificación leída desde
  la campanita. Reduce el contador del badge.
- `resuelta_at` — lo setea el trigger automáticamente. Quita la notificación
  de `getNotificacionesActivas()` (banner del dashboard).
- Las dos columnas son **independientes**: una alerta puede ser leída pero
  seguir activa (sigue en el banner), o ser resuelta sin haber sido leída
  (desaparece de los dos).

### Bloque B — UI: NotificationBell + NotificationBanner

- **`src/lib/notificaciones.ts`** — queries:
  `getNotificacionesNoLeidas()`, `getNotificacionesActivas()`,
  `getNotificacionesHistorial()`.
- **`src/app/notificaciones/actions.ts`** — server actions:
  `marcarLeida(id)`, `marcarTodasLeidas()`.
- **`src/components/NotificationBell.tsx`** — Client. Botón con badge
  contador (1..9, "9+" si más). Click → dropdown con la lista, cada item
  tiene botón "marcar leída" (check) y hay "marcar todas" arriba. Link al
  pie hacia `/notificaciones` para el historial completo. Cierra con click
  afuera o Escape.
- **`src/components/NotificationBanner.tsx`** — Server. Banner que va al
  tope de los dashboards (admin + ventas) con las primeras 3 alertas
  activas + link "Ver todas". Si no hay alertas, no renderea nada
  (auto-hide). Reemplaza el banner ad-hoc viejo del dashboard de admin
  que listaba stock bajo el mínimo.
- **`/notificaciones`** — vista de historial completo, dividida en
  "Activas" (no resueltas, requieren atención) y "Resueltas" (ya no
  vigentes, solo histórico). Botón "Marcar todas leídas" arriba si hay
  no leídas pendientes. Guard `admin|ventas` en layout + middleware.

### Bloque C — Refactor del shell: Topbar + sidebar colapsable

**Antes**: el `AppShell` era un único Client Component. Brand + usuario +
logout vivían al pie del sidebar. En mobile había un header con
hamburger, en desktop solo el sidebar fijo.

**Ahora**: el shell se partió en dos archivos:

- **`src/components/AppShell.tsx`** — Server Component thin. Si el rol es
  admin/ventas, carga las notificaciones no leídas y se las pasa al
  client. Si es operario/super, pasa array vacío (no muestran campanita).
- **`src/components/AppShellClient.tsx`** — Client Component con todo el
  JSX y el state interno.

**Topbar** (`<header>` fijo arriba, ancho completo, altura 4rem):
- Brand a la izquierda (logo Nudo + nombre de empresa).
- En mobile: hamburger antes del brand para abrir el drawer.
- A la derecha: `<NotificationBell />` (solo admin+ventas) +
  `<UserMenu />` (todos los roles).
- El bloque de usuario que estaba al pie del sidebar desapareció.

**`UserMenu.tsx`** — avatar circular con iniciales (calculadas del
nombre), label con nombre + rol al lado (oculto en mobile chico). Click →
dropdown con nombre completo + rol + empresa + botón "Cerrar sesión".

**Sidebar colapsable** (desktop, debajo del topbar):
- Estado `collapsed` persistido en `localStorage` (`nudo:sidebar-collapsed`).
- Ancho: 17rem expandido, 4.5rem colapsado.
- Cuando colapsado: solo iconos centrados (los labels desaparecen, los
  títulos de sección se reemplazan por separadores horizontales).
- Botón "Colapsar" / chevron al pie del sidebar.
- Transición de 200ms sobre el width.
- El primer render usa transition: 0 hasta hidratar (`hydrated` state)
  para evitar el flash inicial.
- Mobile: el drawer sigue funcionando igual, no es colapsable (siempre
  expandido cuando abierto, oculto cuando cerrado).

### Pendiente para que esto funcione en producción

1. **Aplicar migración 024 en Supabase SQL Editor**. Idempotente.
   - La migración corre el seed inicial: recorre todos los artículos con
     `stock_minimo_kg` configurado y crea las notificaciones que
     correspondan al stock actual. Es seguro re-correrla.
2. **Smoke test** post-deploy:
   - Login como admin → ver campanita en topbar.
   - Si hay artículos bajo mínimo: badge con número + banner en
     `/admin/dashboard`.
   - Click campanita → dropdown con lista → marcar una leída → desaparece
     del dropdown pero sigue en el banner (porque sigue activa).
   - Click "Ver historial completo" → `/notificaciones` con secciones
     "Activas" / "Resueltas".
   - Toggle del sidebar (botón "Colapsar" al pie) → queda colapsado +
     persiste tras reload (localStorage).
   - Operario logueado → no ve campanita, no ve banner en su dashboard.
3. **Commit + push a `main`** — Vercel redeploya automático.

### Archivos tocados en esta iteración

**Nuevos** (9):
- `supabase/migrations/024_notificaciones.sql`
- `src/lib/notificaciones.ts`
- `src/app/notificaciones/{layout,page,actions,MarcarTodasButton}.tsx`
- `src/components/{NotificationBell,NotificationBanner,UserMenu,AppShellClient}.tsx`

**Modificados** (~5):
- `src/components/AppShell.tsx` (ahora Server, delega al client)
- `src/lib/supabase/middleware.ts` (guard `/notificaciones`)
- `src/app/admin/dashboard/page.tsx` (reemplaza banner ad-hoc por NotificationBanner)
- `src/app/ventas/dashboard/page.tsx` (suma NotificationBanner)
- `docs/CONTEXTO.md` (esta sección + Sección 7 + migración 024)

---

## 10.11. Iteración 2026-05-25 — Prompts en BD + lectores especializados + tintorerías M:N

Tres cambios entrelazados arrastrados por la misma pregunta del cliente ("¿cómo configuro el lector y el prompt cuando una tintorería trabaja con varias empresas?"):

### Bloque A — Prompts de extracción IA editables por superadmin (migración 033)

- `tintorerias.extraction_prompt TEXT` reemplaza al sistema viejo de `extraction_config_key` + archivos `.ts` en `src/lib/extraccion/tintorerias/` (todo el directorio borrado, incluyendo `_registry.ts`/`_default.ts`/`_types.ts`/`muter-textil.ts`).
- `src/lib/extraccion/gemini.ts` ahora recibe el prompt como string directo (vía `extraerPlanilla(buffer, mime, customPrompt)`). Si llega null, usa un `DEFAULT_INSTRUCTIONS` inline.
- UI nueva en `/super/tintorerias/[id]`: textarea grande con el prompt, dropdown `qr`/`barcode`/sin-configurar. **Solo super lo edita**; el admin de empresa no ve estos campos. El comentario del registry viejo (*"el admin NO ve esto, lo manejamos los devs"*) sigue siendo el principio, pero ahora la edición es por UI en vez de por archivo `.ts` + deploy.

### Bloque B — Lectores QR / Barcode especializados (migración 033)

- `tintorerias.reader_type` (`'qr'`/`'barcode'`/NULL) elige qué librería usar en `/confirmar` y `/picking`:
  - `'qr'` → `src/components/QRScanner.tsx` (usa `html5-qrcode`, solo lee QR).
  - `'barcode'` → `src/components/BarcodeScanner.tsx` (usa `@zxing/browser`, solo lee barcodes 1D — code_128, ean_13/8, upc_a/e, code_39, itf).
  - NULL → `src/components/CodeScanner.tsx` (el unificado actual con `@yudiel/react-qr-scanner`, fallback histórico).
- `src/components/ScannerByReaderType.tsx` es el wrapper que decide en runtime. Las pantallas que escaneaban (`/confirmar/[id]/Scanner.tsx`, `/picking/[id]/PickingScanner.tsx`) ahora reciben `readerType` como prop y delegan a este wrapper.
- En picking, donde el pedido puede mezclar rollos de varias tintorerías, se calcula el `readerType` server-side mirando todas las tintorerías de los rollos: si todas comparten el mismo reader_type, se usa; si hay mezcla, cae al unificado.
- Razón del split: aumentar precisión vs. el escáner unificado que detecta ambos formatos y a veces se confunde. Cuando el cliente sabe que una tintorería SIEMPRE pega QR (o SIEMPRE barcode), el lector específico es notablemente más rápido y certero.

### Bloque C — Refactor M:N empresas ↔ tintorerías (migración 034)

Motivación: una misma tintorería real (ej. Galfione) puede trabajar con varias empresas-cliente. El modelo viejo (`tintorerias.empresa_id NOT NULL`) obligaba a duplicar la fila + duplicar prompt + duplicar reader_type por cada empresa. Insostenible.

**Schema nuevo**:
- `tintorerias` queda como **registro maestro global**: id, nombre, extraction_prompt, reader_type, created_at. Solo super la edita.
- Nueva pivote `empresa_tintorerias`: (empresa_id, tintoreria_id) PK + contacto/email/telefono/activo/fecha_baja/created_at. Los gestiona el admin de la empresa.

**Migración de datos** (no-unificar):
- Cada fila existente en `tintorerias` queda como una tintorería pura, asociada a su empresa actual via la pivote. **No se mergean por nombre** — riesgo de juntar negocios distintos con coincidencia de nombre. Si "Galfione" aparece en dos empresas, el super después puede mergear manualmente (o dejar dos rows).
- Las columnas que se mudaron (`empresa_id`, `contacto`, `email`, `telefono`, `activo`, `fecha_baja`) se DROPean de `tintorerias`. Los datos siguen vivos en la pivote.
- `tintoreria_codigo_patrones.empresa_id` pasa a NULLable. Nueva semántica:
  - `tintoreria_id NOT NULL + empresa_id NULL` → patrón global de esa tintorería (compartido entre todas las empresas que la usan).
  - `tintoreria_id NULL + empresa_id NOT NULL` → patrón interno de la empresa (cubre el caso "la empresa pega su propio QR a los rollos al recibirlos", no respeta el formato de la tintorería).
  - Ambas combinaciones pueden coexistir; el scanner las prueba por `prioridad` ascendente.
  - Trigger `set_empresa_id_patron()` reemplaza al genérico — respeta `NULL` cuando el inserter es super.

**Cambios de RLS**:
- `tintorerias`: SELECT abierto a cualquier autenticado (necesario porque las pantallas filtran por empresa via la pivote). FOR ALL solo super.
- `empresa_tintorerias`: SELECT por empresa propia + super. FOR ALL admin de su empresa + super.
- `tintoreria_codigo_patrones`: SELECT permite `empresa_id IS NULL OR empresa_id matches`. FOR ALL admin de su empresa para internos + super para globales.

**Gotcha al aplicar la migración 034**: las policies viejas tenían el nombre con tilde ("tintorerías"), no sin tilde como esperaba inicialmente. Se reescribió el bloque de DROP POLICY como un loop sobre `pg_policies` que elimina **todas** las policies de la tabla antes del DROP COLUMN, sin depender del nombre exacto. Ese cambio quedó documentado en la migración misma.

### Bloque D — UI superadmin y admin reescritas

- **`/super/tintorerias`** (nuevo):
  - Listado cross-empresa con badges de lector y count de empresas asociadas activas.
  - Crear tintorería pura (solo nombre + prompt + reader_type, sin empresa).
  - Detalle con form de prompt + sección "Empresas asociadas" con dropdown para asociar/desasociar.
  - Componente nuevo `src/app/super/tintorerias/EmpresasAsociadas.tsx`.
- **`/admin/tintorerias`** (refactor):
  - Antes: formulario "Nueva tintorería" (crea fila).
  - Ahora: "Asociar tintorería" con dropdown de tintorerías existentes en el registro global que no estén ya asociadas. Si la tintorería deseada no aparece, el admin se la pide al super.
  - El nombre lo gestiona el super; el admin solo edita contacto/email/teléfono y da de baja/reactiva/desasocia el link.
- Se borró `createTintoreriaInline` de `src/app/ingresos/nuevo/actions.ts` y sus dos puntos de uso en `NuevoIngresoForm.tsx` (el admin ya no puede crear tintorerías "al vuelo" desde el form de ingreso — usa `/admin/tintorerias`).

### Bloque E — Adaptación de queries existentes

Todas las pantallas que listaban "tintorerías de mi empresa" pasaron a hacer `from('empresa_tintorerias').select('tintorerias ( id, nombre )').eq('activo', true)`:
- `src/app/ingresos/nuevo/page.tsx`
- `src/app/ingresos/[id]/editar/page.tsx`
- `src/app/stock/page.tsx`
- `src/app/admin/reportes/page.tsx`
- `src/app/pedidos/nuevo/page.tsx`

Los JOINs que ya tenían `tintorerias ( nombre )` para mostrar el nombre asociado a un ingreso siguen funcionando sin cambios (la tabla `tintorerias` mantiene `id` y `nombre`).

### Pendiente para que esto funcione en producción

1. **Aplicar migraciones 033 y 034 en orden** desde Supabase SQL Editor. Idempotentes.
2. `npm install` (ya commiteado en `package.json`/`package-lock.json`): suma `html5-qrcode`, `@zxing/browser`, `@zxing/library`. La `@yudiel/react-qr-scanner` se conserva como fallback.
3. Cargar la primera tintorería real ("Tintorería Galfione") desde `/super/tintorerias` con reader_type=`qr` y el prompt específico de su formato de planilla (bloques `ART...`, rollos con `N°`, columna `Cantidad`). El texto del prompt está en el plan de trabajo de esta iteración.
4. Asociar Galfione a cada empresa-cliente que la use desde `/super/tintorerias/{id}` → sección "Empresas asociadas".

### Archivos tocados en esta iteración

**Nuevos (10)**:
- `supabase/migrations/033_tintoreria_prompt_y_reader.sql`
- `supabase/migrations/034_tintorerias_muchos_a_muchos.sql`
- `src/components/{QRScanner,BarcodeScanner,ScannerByReaderType}.tsx`
- `src/app/super/tintorerias/{page,actions,NuevaTintoreriaSuperForm,EditTintoreriaForm,EmpresasAsociadas}.tsx`
- `src/app/super/tintorerias/[id]/page.tsx`

**Modificados (~12)**:
- `supabase/schema.sql` (registro maestro + pivote)
- `src/lib/extraccion/{gemini,extraerPlanilla}.ts` (firma con `customPrompt`)
- `src/app/ingresos/nuevo/{actions,page,NuevoIngresoForm}.tsx` (sin createTintoreriaInline; query por pivote)
- `src/app/admin/tintorerias/{page,actions,TintoreriaForm,TintoreriaRow}.tsx` (asociar en vez de crear)
- `src/app/confirmar/[id]/{page,Scanner}.tsx` (pasa `readerType`)
- `src/app/picking/[id]/{page,PickingScanner}.tsx` (resuelve `readerType` agregando rollos)
- `src/app/ingresos/[id]/editar/page.tsx`, `src/app/stock/page.tsx`, `src/app/admin/reportes/page.tsx`, `src/app/pedidos/nuevo/page.tsx` (query por pivote)
- `src/components/AppShellClient.tsx` (link "Tintorerías" en sidebar de super)
- `docs/CONTEXTO.md` (esta sección + sección 6 + tabla migraciones + gotcha 11)

**Borrados**:
- `src/lib/extraccion/tintorerias/` (todo el directorio: `_registry.ts`, `_default.ts`, `_types.ts`, `muter-textil.ts`)

---

## 10.12. Iteración 2026-06-02 — "Partida" + confirmación por conteo

Feedback de la visita al cliente Muter. Dos cambios:

### Bloque A — Terminología "lote" → "partida" (solo UI)

El cliente no entiende "lote"; en su día a día llaman **partida** al batch de rollos que
entra de la tintorería. Se reemplazó **solo el texto visible** en pantalla
(ingresos, stock, pedidos): encabezados de tabla, filtros, banners y títulos de grupo.

**Importante**: NO se tocó la columna BD `numero_lote`, ni `lote_secuencias`, ni los
triggers, ni el prefijo de formato `L-AAAA-NNN`, ni las variables/tipos internos
(`lote`, `lotes`, `agruparRollosPorLote`, etc.). Razón: StockApp es multi-tenant y todavía
no se validó con otros clientes que sí podrían usar "lote". El nombre de columna es
invisible para el usuario. Si en el futuro hace falta terminología distinta por empresa,
se hace configurable por tenant (feature aparte), sin hardcodear la jerga de un cliente
en el schema.

### Bloque B — Confirmación de llegada por conteo (migración 045)

Antes el operario confirmaba la llegada **escaneando el QR de cada rollo** uno por uno. En
días de alta carga (ej. 6 partidas × 24 rollos = 144 escaneos) era demasiado trabajo. El
nuevo flujo en `/confirmar/[id]`:

1. La planilla se sube **igual que antes** (manual o IA): crea los rollos en `pendiente`.
2. El operario **cuenta físicamente** cuántos rollos llegaron e ingresa el número.
3. El sistema valida que el conteo coincida con la planilla — **ambos**: la cantidad de
   rollos extraídos (filas) Y `total_rollos_declarado`.
   - **Coincide** → asigna ubicación a toda la partida (más override de ubicación y
     comentario por rollo puntual) y confirma. Todos los rollos pasan a `en_stock`, el
     ingreso a `confirmado`.
   - **No coincide** → alerta con los números (contado / filas / declarado) y pide una
     **nota obligatoria**. Con la nota se puede confirmar igual (no bloquea); la diferencia
     queda en `ingresos.conteo_nota` para reclamar a la tintorería. Como no se escanea, no
     se identifica *cuál* rollo falta: se confirman igual los registros de la planilla y la
     discrepancia queda documentada.

**Archivos**:
- Nuevos: `supabase/migrations/045_confirmar_partida_por_conteo.sql`
  (`rollos.comentario`, `ingresos.conteo_fisico`, `ingresos.conteo_nota`),
  `src/app/confirmar/[id]/ConfirmarPartidaForm.tsx`.
- Modificados: `src/app/confirmar/[id]/{page.tsx,actions.ts}` (nueva action
  `confirmarPartida`), `src/app/confirmar/page.tsx` (copy).
- Sin uso pero conservados (no borrados): `src/app/confirmar/[id]/Scanner.tsx` y la action
  `confirmarRollo`. El stack de scanner compartido
  (`CodeScanner`/`ScannerByReaderType`/`QRScanner`/`BarcodeScanner`/`lib/scanner.ts`) sigue
  vivo para el **picking** y un futuro escaneo al **sacar muestras**.

### Bloque C — Color nuevo desde el ingreso: admin crea directo + aviso de solicitudes

Dos fixes al workflow de colores (el flujo BD ya estaba bien: trigger `set_empresa_id` +
RLS en `solicitudes_color`):

1. **Admin crea el color directo desde el ingreso**. Antes el botón "+ Pedir color nuevo"
   del form de ingreso llamaba a `solicitarColor` para *todos* los roles — el admin
   terminaba generando una solicitud para sí mismo en vez de crear el color. Ahora el botón
   (`SolicitarColorButton` en `NuevoIngresoForm.tsx`) ramifica por rol: **admin → `createColor`**
   (crea y selecciona al toque, label "+ Crear color nuevo"); operario/ventas →
   `solicitarColor` (label "+ Solicitar color al admin"). `createColor` ahora devuelve el
   color creado (`{ id, nombre }`) y, si ya existía, lo devuelve igual con `alreadyExists`
   para seleccionarlo sin fricción.
2. **La solicitud "llega a algún lado"**. Dos lugares:
   - En la pestaña **Colores** (`/admin/colores`): el `SolicitudesColorPanel` (banner ámbar
     arriba de todo) lista las `solicitudes_color` en estado `pendiente` con botones
     Aprobar/Rechazar. Header: "N colores pendientes de verificación".
   - **Notificación "Verificar colores"** en la campanita del admin (`NotificationBell`).
     Es **sintética** (no vive en la tabla `notificaciones`, no necesitó migración): se
     inyecta en `AppShell` solo para admin mientras haya solicitudes `pendiente`, linkea a
     `/admin/colores` y es **no descartable** (`dismissable: false`) — se autoresuelve sola
     cuando ya no quedan pendientes. El tipo `Notificacion` ganó campos opcionales `href` y
     `dismissable`. NO se agregó al dashboard principal (decisión del usuario: no es tan
     crucial).

### Bloque D — Reintento automático ante Gemini sobrecargado (503)

Gemini (free tier) devuelve errores transitorios —503 `UNAVAILABLE` "high demand", 429
rate-limit, 500 `INTERNAL`— que se resuelven reintentando. Antes el operario veía el error
crudo. Ahora `extraerConGemini` (`src/lib/extraccion/gemini.ts`) reintenta hasta 3 veces con
backoff exponencial (1s, 2s) ante errores transitorios (helper `esErrorTransitorio`); errores
no transitorios (ej. API key inválida, JSON malformado) cortan de una. Si tras los reintentos
sigue sobrecargado, muestra un mensaje claro sugiriendo esperar o cargar a mano.

### Bloque E — Dashboards: stock en ventas + resumen del día por rollos

1. **Helper compartido** `src/lib/resumenDiario.ts` → `getResumenDiaPedidos(supabase)`:
   *rollos pedidos* = rollos de `pedidos` creados hoy (excluye `cancelada`); *rollos
   enviados* = rollos de `pedidos` con `confirmada_egreso_at` dentro del día (cubre salida
   confirmada/entregada hoy). Devuelve cantidades + kilos.
2. **Inicio de ventas** (`/ventas/dashboard`, antes placeholder) ahora muestra: tiles
   "Rollos pedidos/enviados hoy" y un **resumen de stock disponible agregado por
   artículo+color** (cantidad + kg), reusando `reporteStock` de
   `admin/reportes/queries.ts`.
3. **Dashboard admin**: se **sacó la métrica "Pendientes de verificar"** (con el ingreso por
   conteo ya no representa trabajo real) y se agregaron al "Resumen de hoy" los tiles
   "Rollos pedidos" y "Rollos enviados" (mismo helper).
4. **Cancelar pedidos por admin**: se verificó que ya funcionaba (guard + UI + RPC
   `cancelar_pedido` permiten admin; en estado "Lista" el botón es "Caer pedido"). No
   requirió cambios.

---

## 11. Decisiones de dominio importantes

Surgidas de leer el documento de tesis con entrevistas a Mariela (experta WMS), visita a Muter, charlas con Texcom, Dakuba e ingeniera SIGE.

### Concepto clave: "aduana"

El escaneo del operario es el punto **obligatorio** de entrada y salida. Si escanea un rollo equivocado → BLOQUEAR. Si esperás 15 piezas y solo escaneó 14 → no puede cerrar. Sin esa fricción, el sistema no sirve.

### Quién es dueño del dato

El **operario** es el dueño del dato del stock. Hay que hacerle la app **muy fácil** para que la use. El depósito en Muter rota mucho (4 personas distintas en visitas) — la UX tiene que aprenderse en un día.

### Códigos de rollo

Vienen de la tintorería (no los generamos). Formatos varían (QR + Code128 + EAN). Scanner debe ser adaptable. Fallback: re-OCR de PDF → carga manual.

### Planilla de tintorería (input para Etapa 3)

Llega en papel, foto o PDF. Layout raro: **bloques paralelos de columnas** (no una tabla vertical clásica). Para la IA hay que pedirle "rollos en bloques" explícitamente, no "tabla".

### Modelo de pedidos

Ventas selecciona **rollos específicos** para cubrir un pedido. NO hay "kilos pedidos" como cantidad abstracta. El cliente pide "X kg de tal color", Belén busca y reserva los rollos puntuales. Por eso `pedido_rollos` es m2m simple, no hay tabla de "ítems".

### Estado del despacho derivado

Cuando operario carga manualmente con el toggle "ya están en el depósito", el estado del despacho se calcula desde los rollos: si todos `en_stock` → despacho `confirmado`, si alguno `pendiente` → despacho `borrador`.

---

## 12. Deploy y configuración

### Supabase
- Project URL: `https://cxspdcilrjnjblorbgzy.supabase.co`
- Region: South America (São Paulo)

### Vercel
- Region: `gru1` (São Paulo) — configurado en `vercel.json`
- Framework auto-detected (Next.js)
- Build command: default

### Variables de entorno

| Variable | Dónde | Notas |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Vercel + .env.local | URL pública del proyecto Supabase |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Vercel + .env.local | "Publishable key" (sb_publishable_...) |
| `SUPABASE_SERVICE_ROLE_KEY` | Vercel (Production+Preview, marcado sensitive) + .env.local | service_role key. **NUNCA con prefijo NEXT_PUBLIC_**, **NUNCA commiteada** |

### GitHub
- Repo privado.
- Para que compañeros contribuyan: Settings → Collaborators → invitar por username.
- Cada compañero clona, pone su `.env.local` con las credenciales (compartidas por canal seguro), `npm install`, `npm run dev`.
- Push a `main` redeploya Vercel automático (incluso si el push lo hace un compañero — Vercel está conectado a GitHub).

### Costo
$0 actualmente. Free tiers de GitHub + Vercel + Supabase + Google AI Studio (cuando arranque Etapa 3) cubren un MVP de tesis con margen.

---

## 13. Cosas a recordar (gotchas)

1. **Todas las migraciones son idempotentes** — se pueden re-correr sin romper nada. Pero seguilas en orden.
2. **El path del proyecto es `C:\dev\stockapp-tesis`, no OneDrive**. Si el shell muestra cwd en OneDrive, está bien — solo no edites archivos del proyecto desde ahí.
3. **Cada Bash que abro resetea el PATH**. Para usar Node en bash MSYS hay que `export PATH="/c/Program Files/nodejs:$PATH"` (ya está en `~/.bashrc` pero a veces no se source-a en non-interactive).
4. **Supabase SSR + invite emails**: el template default no funciona, hay que customizarlo (ver Sección 9).
5. **TypeScript con joins de Supabase**: cuando haces `select('rollos(kilos)')`, TS lo tipa como array de un solo objeto a veces. Usar `as unknown as { ... } | null` para casts.
6. **Redirect server-side > client-side**: `router.push(?creado=1)` + `router.refresh()` perdía la query string en Next 16. Usar `redirect()` de `next/navigation` en el Server Action.
7. **Trigger `set_empresa_id`**: si un super-admin intenta INSERT en una tabla tenant-specific, el trigger setea `empresa_id = NULL` y la tabla rechaza con NOT NULL. Esto es **deliberado**: super-admin no debería contaminar datos de cliente. Si quiere actuar sobre una empresa, se loguea como admin de esa empresa.
8. **`is_super_admin()` SQL function** sigue existiendo (la usan muchas RLS), pero internamente ahora chequea `role = 'super'`.
9. **Cuentas de prueba que están dando vueltas**:
   - `admin@probando.com` (admin de Muter Textil — fake email, no recibe mails, password seteado a mano)
   - `tsilvafelgueras@itba.edu.ar` (super-admin de la plataforma — Trinidad)
10. **Email rate limit 2/h en Supabase built-in**: durante todo el desarrollo del MVP nos vamos a chocar con esto si invitamos varios usuarios seguidos. Workarounds en dev: esperar 1 hora entre tandas, usar cuentas ya creadas con password seteado a mano desde Supabase Dashboard → Authentication → Users (no requiere mail), o resetear password manualmente. El fix definitivo (Resend) está agendado en Etapa 7D punto 25 — **antes del launch sí o sí**.
11. **Activar config de tintorería en producción** (post iteración 2026-05-25): los prompts ya no viven en archivos `.ts` — viven en la columna `tintorerias.extraction_prompt` y los edita el superadmin desde `/super/tintorerias` (sección 10.11). Workflow nuevo:
    1. Loguearte como `super` → `/super/tintorerias` → "+ Nueva tintorería" → cargar nombre + reader_type + extraction_prompt.
    2. En el detalle de la tintorería, sección "Empresas asociadas", asociarla a la(s) empresa(s) que la usan.
    3. El admin de empresa también puede asociar tintorerías existentes desde `/admin/tintorerias`, pero no puede editar el prompt ni el reader_type.

---

## 14. Cómo seguir

### Para retomar el desarrollo en otro chat

1. Pegá este documento al inicio del chat nuevo.
2. Decile al asistente la próxima etapa que querés encarar.
3. Mencioná tu working style si no está claro: "vamos por etapas chicas, propose-then-act, español argentino, sin gold-plating".

### Onboarding de un colaborador nuevo (handoff)

Cuando otra persona del equipo (compañero, futuro contributor) toma una tarea:

**Para solo testear la app deployada** (sin tocar código):
1. Acceso al deploy: https://stockapp-tesis.vercel.app
2. Cuenta de prueba: `admin@probando.com` (Trinidad pasa la pass por canal seguro)
3. Hacer hard refresh del browser después de cualquier deploy reciente (Ctrl+Shift+R en Win, Cmd+Shift+R en Mac).

**Para desarrollar localmente**:
1. Ser invitado al repo en GitHub Settings → Collaborators
2. `git clone https://github.com/tsilvafelgueras/stockapp-tesis`
3. Path local fuera de OneDrive (idealmente `C:\dev\` o equivalente Mac/Linux). Ver Sección 1 y 13 punto 2.
4. Pedirle a Trinidad el `.env.local` (canal seguro) — contiene `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `GEMINI_API_KEY`. Cada dev puede generar SU propia `GEMINI_API_KEY` gratis en https://aistudio.google.com (es preferible para tracking de quotas).
5. `npm install` (Node 24 LTS, npm 11)
6. `npm run dev` → http://localhost:3000
7. Para cambios en DB schema: las migraciones en `supabase/migrations/` se aplican manualmente en Supabase SQL Editor (ya están aplicadas las 001-062 en el proyecto compartido — solo aplicar nuevas que se agreguen).

**Para retomar contexto en chat con asistente**:
1. Pegá este documento (`docs/CONTEXTO.md`) entero al inicio del chat.
2. Mencioná qué etapa o feature querés encarar.

### Lo que viene

El MVP de tesis está cerrado (Etapas 0..7 completas — ver Sección 10).
Las últimas iteraciones (Secciones 10.6, 10.7 y 10.8) son extensiones
post-MVP pedidas por el cliente durante el uso real: demandas
pendientes, edición masiva tipo Excel, confirmación de venta
post-picking, historial inborrable, clientes, refactor del scanner +
patrones regex por tintorería.

**Próximos candidatos** (cuando el cliente los pida o se decida agregarlos):
- Admin UI para gestionar `tintoreria_codigo_patrones` (hoy solo SQL).
- Login con username + alta sin email para operario/ventas (ver
  Sección 10.5, "Login con username").
- Setup Resend SMTP (bloqueante para onboarding masivo de empresas).
- `supabase/schema.sql` cubre solo mig 001-011 (deuda técnica). Para una DB nueva correr todas las migraciones 001-063 en orden; para una DB existente solo aplicar las que falten.
- Valorización del stock, control de calidad avanzado, módulo chofer,
  multi-idioma (ver Sección 10.5, "Lo que NO está en el MVP").

---

## Iteración 2026-06 — Rediseño de reportes + merma real + mejoras de extracción IA

### Rediseño de `/admin/reportes` (tablero de gestión)

La pestaña de reportes pasó de un listado de tablas a un **tablero por
decisión de negocio**, con **tabs full-width** (`?tab=` en la URL, el server
solo corre las queries del tab activo), **filtros globales** (año, meses,
tintorerías y artículos como chips multi-select `ExcelFilter` + **rango de
fechas**) y **gráficos con Recharts** usando los tokens de tema `--chart-1..5`.

Estructura (`src/app/admin/reportes/`): `queries/` dividido por bloque
(`_shared`, `stock`, `demanda`, `tintorerias`, `calidad`, `eficiencia`),
`components/` (tabs + Tab\* por bloque + KpiCard + ChartCard + accordion),
`charts/` (client components Recharts), y `csv/route.ts` con un tipo de export
por reporte. `queries.ts` quedó como barrel.

Los 5 bloques:
- **A — Stock y rotación**: KPIs, stock x artículo+color (resalta bajo
  `stock_minimo_kg`, que **post-042 es por artículo+color**), días de cobertura
  (semáforo), rotación ABC (Pareto), top rollos más viejos, dona por estado.
- **B — Demanda comercial**: demanda no satisfecha por art+color, demanda por
  antigüedad + prioridad, funnel de pedidos, tiempo por etapa (reconstruido de
  `movimientos`), ranking de clientes, **pedidos caídos** (accordion jerárquico
  por `caida_motivo` → detalle de cada pedido).
- **C — Tintorerías**: scorecard (rinde ponderado por kilos, tasa de fallas,
  diferencia declarado vs propio, tiempo de ciclo), rinde por tintorería,
  fallas apiladas por categoría (teñido vs tejeduría), volumen.
- **D — Calidad y mermas**: **merma de teñido por partida** (ver abajo),
  distribución de fallas, kg degradados (baja+segunda) mensual, diferencia
  declarado vs propio, diferencia de gramaje, muestras por cliente.
- **E — Eficiencia operativa**: health check (% ingresos con planilla, %
  rollos con ubicación, % ingresos por IA), IA vs manual, tendencia mensual de
  kilos, actividad por usuario (detrás de un toggle, leyendo `movimientos`).

Restricciones respetadas: **sin valorización en pesos** (no hay costo en el
modelo), NULLs tratados como "sin dato" (no 0), proxies de fecha comentados en
el código, multi-tenant/RLS intacto. Dependencia nueva: `recharts`.

### Merma real de partida (migración 046)

Antes la merma real (crudo enviado → teñido recibido) era imposible porque no
se registraba el crudo que salía a teñir. Ahora el operario/admin carga en el
detalle del ingreso (`/ingresos/[id]`, tarjeta "Merma de la partida") los
**kg de crudo enviados** (`ingresos.kilos_crudo_enviado`, un total por partida).
El reporte "Merma de teñido por partida" (Bloque D) compara ese crudo contra la
suma de kilos teñidos recibidos. El "peso propio" por rollo (`kilos_propios`,
`gramaje_propio`) sigue siendo otra cosa (control fino, opcional, se carga en el
detalle del rollo en `/stock`).

### Mejoras de extracción IA de planillas

- **Matcheo de artículo/color contra el catálogo** (en `NuevoIngresoForm`): el
  texto extraído por la IA (verboso, ej. "ART1253FTR - ...TELA ML70C FRISADA
  TERMINADA") se matchea al artículo del catálogo por **tokens con prefijo y
  tolerancia de 1 letra** ("ml70"↔"ml70c", "frisado"↔"frisada"). El color se
  aplica a todos los rollos aunque el artículo no matchee. Si la IA deja el
  artículo en `referencia`, se usa como fallback.
- **Confianza de campos ausentes**: los campos vacíos (NULL) ya no se resaltan
  en naranja ni inflan el banner de "baja confianza" (afecta planillas que no
  traen OT/rinde/gramaje, ej. Galfione).
- **Prompts por tintorería** (`tintorerias.extraction_prompt`, editados por el
  super en `/super/tintorerias`): afinados para Muter (grilla con dos columnas
  "DESP" — KILOS vs METROS) y Galfione (PDF por bloques, sin metros/rinde). Se
  le instruye que **no haga aritmética** (los totales los calcula la app).
- **Confirmar partida por conteo**: la validación compara el conteo contra los
  **rollos pendientes** (no contra el total declarado), para soportar partidas
  confirmadas a medias con el scanner viejo. Hay tolerancia en la suma de kilos
  y un **cross-check Kilos vs Metros/Rdto** que marca rollos con posible error
  de lectura.

---

## 10.13. Iteración 2026-06 — Refactor de pedidos por partida + ubicaciones + picking flexible

Ronda mayor post-reportes. Reemplaza el modelo de pedidos "selección directa de rollos" por un modelo de **demanda por partida** donde ventas declara cuántos rollos quiere de cada partida/artículo/color y depósito pickea luego los rollos físicos.

### Bloque A — Pedidos por partida (migración 048)

**Motivación**: ventas no sabe qué rollo físico es cada uno — solo sabe "quiero 5 rollos de ML70 negro de la partida de Galfione del 15/05". El picking lo resuelve depósito.

- **Nueva tabla `pedido_partidas`**: (pedido_id, ingreso_id, articulo_id, color_id, rollos_solicitados, kilos_estimados). UNIQUE (pedido_id, ingreso_id, articulo_id, color_id).
- **Nueva RPC `crear_pedido_por_partidas(cliente_id, remito_externo, items_jsonb, fecha_entrega)`**: valida disponibilidad considerando reservas de otros pedidos activos, crea el pedido y las líneas `pedido_partidas`. Reemplaza a `crear_pedido`.
- **`pedido_rollos.rollo_id` pasa a NULLable** + nueva columna `pedido_partida_id` FK. Un `pedido_rollo` sin `rollo_id` es una intención pendiente de picking.
- **`pickear_rollo` reescrita**: busca la `pedido_partida` con matching articulo+color pendiente. Si hay varias partidas posibles prioriza la que coincide con el `ingreso_id` del rollo.
- Flujo: `pendiente → en_preparacion → lista → confirmada_egreso`.

### Bloque B — Ubicaciones administrables (migración 049)

- **Nueva tabla `ubicaciones`**: (empresa_id, codigo, descripcion, tipo, capacidad_rollos, capacidad_kg, orden, activa). UNIQUE (empresa_id, codigo). Tipos: `general`, `rack`, `piso`, `preparacion`, `devolucion`, `otro`.
- Seed automático: crea racks A1-A30 ... F1-F30, "A ordenar", "Sin ubicar" para todas las empresas. Migra ubicaciones existentes de `rollos` al catálogo.
- RLS: admin gestiona, todos los autenticados de la empresa leen.
- Front: `/admin/ubicaciones` para gestionar el catálogo. Formularios de ingreso y etiquetado manual usan el catálogo como `<select>`.

### Bloque C — Edición de pedidos + reemplazo en picking (migración 050)

- **`actualizar_pedido_remito`**: editar remito externo de pedido abierto (ventas/admin).
- **`agregar_partidas_a_pedido`**: agregar líneas a un pedido ya existente. Si la combinación partida/art/color ya existe, suma la cantidad. Si el pedido estaba `lista`, lo regresa a `en_preparacion`.
- **`reemplazar_rollo_picking`**: sustituir un rollo ya pickeado por otro (mismo articulo+color). Logea en `movimientos`.

### Bloque D — Picking en borrador + "Aceptar pedido" (migración 058)

- El operario construye el picking localmente (state del componente) y lo confirma todo de una vez.
- `pedidos.picking_session_por` / `picking_session_at`: heartbeat de sesión activa para aviso liviano de multi-sesión.
- **`aplicar_picking_borrador(pedido_id, items_jsonb)`**: aplica la lista completa de (pedido_partida_id, numero_pieza) atómicamente. Valida disponibilidad y cierra a `lista` si completo.

### Bloque E — Ventas quita rollos + notif al operario (migración 059)

- Ventas/admin pueden quitar rollos del picking de un pedido activo. El rollo vuelve a `en_stock` marcado "Sin ubicar".
- **Tipo `'rollo_liberado'`** en notificaciones: notificación persistida para el operario cada vez que ventas libera un rollo. Nueva policy RLS para que el operario vea solo `rollo_liberado` (y luego `rollo_devuelto`).

### Bloque F — Mejoras de catálogo (migraciones 051, 053, 054)

- **051** — Auto-propagación bidireccional colores ↔ artículos: un color nuevo se asocia a todos los artículos activos de la empresa (y viceversa). Backfill de combinaciones faltantes.
- **053** — Colores "fijados" (pin) por artículo: aparecen primero en los dropdowns, ordenados alfabéticamente antes que el resto.
- **054** — Comentario libre por ingreso: campo `ingresos.comentario` editable desde el detalle.

### Bloque G — Fixes menores (migraciones 052, 055, 056/057)

- **052** — Galfione: `reader_type` pasa de `'qr'` a `'barcode'`.
- **055** — Patrón regex para Lecotex (primer número de 9 dígitos del payload).
- **056/057** — Unicidad de `numero_pedido`: de UNIQUE global a UNIQUE `(empresa_id, numero_pedido)`.

---

## 10.14. Iteración 2026-06 — Etiquetado manual (módulo rollos-sin-etiqueta)

Módulo completamente nuevo para generar e imprimir etiquetas de rollos que llegan sin etiqueta o cuya etiqueta está dañada.

### Flujo general

1. El operario accede a `/rollos-sin-etiqueta/nuevo` (link en sidebar operario/admin).
2. Elige entre **Partida existente** (selecciona una OT) o **Nueva partida** (carga tintorería + fecha, la OT es opcional).
3. Selecciona artículo y color (colores ordenados alfabéticamente con `localeCompare`).
4. Carga la lista de rollos: número auto (asignado por el sistema), kilos, ubicación. En mobile se muestran labels encima de cada input (`sm:hidden`).
5. Guarda → `createRollosSinEtiqueta` (Server Action) crea los rollos → redirige a `/rollos-sin-etiqueta/etiqueta?ids=...`.
6. La página de etiquetas carga datos y renderiza `<EtiquetaLabel />`.
7. El operario imprime o exporta PDF. En mobile, botones muestran solo ícono (`hidden sm:inline` en los textos).

### Re-etiquetado de rollos existentes

`/stock` → `RolloDetailDialog` → botón **"Imprimir etiqueta"** → navega a `/rollos-sin-etiqueta/etiqueta?ids={rollo_id}`.
El peso del rollo ya refleja muestras extraídas (la RPC `registrar_muestra` decrementa `rollos.kilos` atómicamente).

### Configuración de medidas (migración 060)

- **Tabla `empresa_etiqueta_config`**: una fila por empresa con `ancho_mm`, `alto_mm`, `padding_mm`, `qr_mm`, `factor_escala`. RLS: operario+admin pueden editar.
- **`factor_escala`**: compensa reescalado del driver de impresora. Al imprimir: página CSS se dimensiona `ancho_mm × factor_escala` + `transform: scale(factor_escala)` en cada etiqueta.
- **`/rollos-sin-etiqueta/ajustes`**: formulario con inputs + preview en vivo.

### EtiquetaLabel — detalles técnicos

- Caja en mm con `containerType: 'size'`. Contenido en `cqmin` → escala proporcional a cualquier medida.
- **`padNumero(n)`**: ≥ 1000 → sin padding; < 1000 → 3 dígitos (`007`, `123`).
- **`numFontSize(padded)`**: ≤ 3 → `26cqmin`, 4 → `20cqmin`, 5+ → `15cqmin`. Soporta números de 4 y 5 dígitos sin overflow.
- El QR codifica `rollo.numero_pieza` — el operario puede escanear la etiqueta generada en confirmar/picking.
- Muestra: empresa/tintorería (header), QR + número grande (centro), OT, color, tela, kilos, ubicación, fecha (pie).

### Archivos del módulo

```
src/app/rollos-sin-etiqueta/
  nuevo/
    page.tsx                 — Server Component: carga ingresos, tintorías, artículos, ubicaciones
    actions.ts               — createRollosSinEtiqueta (Server Action)
    RollosSinEtiquetaForm.tsx — Client Component (formulario completo)
  etiqueta/
    page.tsx                 — Client Component: carga datos, renderiza etiquetas, botones print/PDF
  ajustes/
    page.tsx                 — Formulario de config de medidas (Client Component)
    actions.ts               — saveEtiquetaConfig (Server Action)
  EtiquetaLabel.tsx          — Componente de etiqueta (usa react-qr-code)
  etiqueta-config.ts         — Types + DEFAULT_ETIQUETA_CONFIG + loadEtiquetaConfig helper
  layout.tsx                 — Guard operario+admin
```

---

## 10.15. Iteración 2026-06 — Notificaciones nuevas + devolución parcial de pedidos

### Bloque A — Notificación al admin cuando se elimina un rollo (migración 061)

- Nuevo tipo `'rollo_eliminado'` en el CHECK constraint de `notificaciones.tipo`.
- **`notificar_rollo_eliminado(empresa_id, numero_pieza, articulo, color, usuario_nombre)`** (SECURITY DEFINER): la server action `eliminarRollo()` la llama vía RPC después del DELETE exitoso. Los admins la ven en la campanita.

### Bloque B — Devolución parcial de rollos de un pedido entregado (migración 062)

**Caso de uso**: el cliente devuelve físicamente rollos después del egreso (`confirmada_egreso`). El operario los registra en el sistema.

**Schema**:
- `pedido_rollos.devuelto_at timestamptz` y `pedido_rollos.devuelto_motivo text`.
- Nuevo tipo `'rollo_devuelto'` en notificaciones. Policy RLS para que el operario vea `rollo_liberado` y `rollo_devuelto`.

**RPCs**:
- **`devolver_rollos_pedido(pedido_id, pedido_rollo_ids[], motivo)`**: para ventas/admin desde la página del pedido. El pedido debe estar en `confirmada_egreso`. Por cada rollo: marca `devuelto_at`, pone en `en_stock` con ubicación "Sin ubicar", inserta notificación al operario, logea en `movimientos`.
- **`devolver_rollo_por_rollo_id(rollo_id, motivo)`**: para el operario desde `RolloDetailDialog`. Busca el pedido activo del rollo automáticamente.

**UI**:
- **`/pedidos/[id]`**: sección "Devolución parcial" visible cuando `estado = 'confirmada_egreso'`, lista rollos activos con checkboxes + campo motivo.
- **`RolloDetailDialog`**: botón "Devolver al stock" para rollos en estado `entregado`.

### Estado del branch (2026-06-29)

`development` fue mergeado a `main` con `--no-ff`. Main está al día. Vercel redesplegó automático. Migraciones 001-062 aplicadas en el proyecto Supabase compartido.

---

## 10.16. Iteración 2026-07-21 — Fix picking de rollos devueltos + mejoras al módulo de picking

### Bug fix: picking bloqueado después de devolución parcial (migración 063)

**Síntoma**: después de una devolución parcial de pedido, el rollo volvía al stock (`en_stock`) pero al intentar pickearlos para un nuevo pedido el sistema lanzaba `duplicate key value violates unique constraint "pedidos_rollos_rollo_id_activo_key"`.

**Causa**: las RPCs `devolver_rollos_pedido` y `devolver_rollo_por_rollo_id` (mig 062) seteaban `devuelto_at` pero no `liberado_at`. El índice único parcial `WHERE liberado_at IS NULL AND rollo_id IS NOT NULL` seguía viendo la fila vieja como activa, bloqueando el INSERT del nuevo pedido.

**Fix**: ambas RPCs ahora setean `liberado_at = now()` + `liberado_motivo = 'devolucion_cliente'` junto con `devuelto_at`. La migración incluye un backfill que corrige todas las filas afectadas existentes.

### Mejoras al módulo de picking (solo frontend, sin migración)

**Partidas solicitadas — kg pickeados por partida**: cada partida ahora muestra la suma de kg de los rollos confirmados + borrador asignados a ella, al lado del estado "Completa / Faltan N rollos". El total global de kg (encabezado) se mantiene.

**Listos para salida física — sort + buscador**: nuevo `PickingListaFilters.tsx` (Client Component). La sección "Listos para salida física" ahora tiene un input de búsqueda (por cliente o número de pedido) y un toggle de ordenamiento (más nuevos / más antiguos). El PedidoCard se extrajo al mismo archivo para compartirlo con el server component.

**Rollos confirmados — columna OT**: se agrega la columna OT entre "Partida" y "Ubic." en la tabla de rollos confirmados (tanto en la vista activa de picking como en el fallback estático). El dato se trae de `rollos.ingresos.ot` en la query de `pedido_rollos`.

**Historial — paginación y filtros completos**: `/picking/historial` reemplaza el límite fijo de 60 registros por paginación de 20 por página con botones Anterior/Siguiente (links de servidor que preservan filtros activos). Nuevo `HistorialFilters.tsx` (Client Component) con input de cliente y date pickers de desde/hasta. Los filtros se aplican en la query de Supabase (server-side). La URL es compartible: `?page=2&cliente=muter&desde=2026-07-01`.

**Archivos nuevos**:
- `src/app/picking/PickingListaFilters.tsx`
- `src/app/picking/historial/HistorialFilters.tsx`
- `supabase/migrations/063_fix_devolucion_liberar_rollo.sql`

**Archivos modificados**:
- `src/app/picking/page.tsx`
- `src/app/picking/[id]/page.tsx` (`ot` en query + tipo + ResumenPedidoPicking)
- `src/app/picking/[id]/PickingScanner.tsx` (`PickRollo.ot`, columna OT, kg por partida)
- `src/app/picking/historial/page.tsx`

### Estado del branch (2026-07-21)

`development` mergeado a `main` con `--no-ff`. Vercel redesplegó automático. **Migración 063 pendiente de aplicar en Supabase** (SQL Editor del proyecto).
