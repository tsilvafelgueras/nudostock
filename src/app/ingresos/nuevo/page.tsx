import { createClient } from '@/lib/supabase/server'
import Link from 'next/link'
import BackButton from '@/components/BackButton'
import { getUbicacionesActivas } from '@/lib/ubicacionesServer'
import NuevoIngresoForm from './NuevoIngresoForm'

type ArticuloRow = {
  id: string
  nombre: string
  articulo_colores: Array<{
    fijado: boolean | null
    colores: { id: string; nombre: string } | { id: string; nombre: string }[] | null
  }> | null
}

export default async function NuevoIngresoPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const [
    { data: empresaTints },
    { data: articulosRaw },
    { data: colores },
    { data: profile },
    ubicaciones,
    { data: patronesRaw },
    { data: tiposFallaRaw },
  ] = await Promise.all([
    supabase
      .from('empresa_tintorerias')
      .select('tintoreria_id, tintorerias ( id, nombre )')
      .eq('activo', true),
    supabase
      .from('articulos')
      .select(
        `id, nombre,
         articulo_colores(fijado, colores(id, nombre))`
      )
      .eq('activo', true)
      .order('nombre'),
    supabase
      .from('colores')
      .select('id, nombre')
      .eq('activo', true)
      .order('nombre'),
    supabase
      .from('profiles')
      .select('role')
      .eq('id', user!.id)
      .single(),
    getUbicacionesActivas(supabase),
    supabase
      .from('tintoreria_codigo_patrones')
      .select('tintoreria_id, pattern, capture_group, prioridad')
      .eq('activo', true)
      .order('prioridad'),
    supabase
      .from('tipos_falla')
      .select('id, nombre')
      .eq('activo', true)
      .order('orden', { ascending: true })
      .order('nombre', { ascending: true }),
  ])

  type EmpresaTintRow = {
    tintoreria_id: string
    tintorerias: { id: string; nombre: string } | null
  }
  const tintorerias = (empresaTints ?? ([] as unknown as EmpresaTintRow[]))
    .map((r) => (r as unknown as EmpresaTintRow).tintorerias)
    .filter((t): t is { id: string; nombre: string } => t != null)
    .sort((a, b) => a.nombre.localeCompare(b.nombre))

  // Aplastar M:N: cada artículo lleva su lista de colores asociados.
  const articulos = (articulosRaw ?? []).map((a: ArticuloRow) => {
    const cols = (a.articulo_colores ?? [])
      .map((ac) => {
        const color = Array.isArray(ac.colores) ? ac.colores[0] : ac.colores
        return color ? { ...color, fijado: ac.fijado ?? false } : null
      })
      .filter((c): c is { id: string; nombre: string; fijado: boolean } => !!c)
      // Fijados primero (alfabético), luego el resto. Así el dropdown de color
      // por rollo muestra arriba los colores fijados del artículo.
      .sort((x, y) => {
        if (x.fijado !== y.fijado) return x.fijado ? -1 : 1
        return x.nombre.localeCompare(y.nombre, 'es')
      })
      .map(({ id, nombre }) => ({ id, nombre }))
    return { id: a.id, nombre: a.nombre, colores: cols }
  })

  const role = (profile?.role ?? 'operario') as 'operario' | 'ventas' | 'admin' | 'super'

  const sinCatalogos = !tintorerias.length || !articulos.length

  return (
    <div className="p-4 sm:p-6 max-w-6xl mx-auto space-y-6">
      <div>
        <BackButton href="/ingresos" label="Volver a ingresos" />
        <h1 className="text-xl sm:text-2xl font-bold mt-1">Nuevo ingreso</h1>
        <p className="text-sm text-muted-foreground">
          Carga manual o automática (con IA) de la planilla de tintorería
        </p>
      </div>

      {sinCatalogos ? (
        <div className="rounded-lg border bg-warning/10 border-warning/30 p-5">
          <p className="text-sm font-medium text-foreground">
            Antes de crear un ingreso necesitás tener al menos un artículo y
            una tintorería cargados.
          </p>
          <div className="flex gap-3 mt-3 text-sm">
            {!articulos.length && (
              <Link
                href="/admin/articulos"
                className="underline hover:no-underline"
              >
                Crear artículo
              </Link>
            )}
            {!tintorerias.length && (
              <Link
                href="/admin/tintorerias"
                className="underline hover:no-underline"
              >
                Asociar tintorería
              </Link>
            )}
          </div>
        </div>
      ) : (
        <NuevoIngresoForm
          tintorerias={tintorerias}
          articulos={articulos}
          colores={colores ?? []}
          ubicaciones={ubicaciones}
          role={role}
          patrones={(patronesRaw ?? []) as { tintoreria_id: string | null; pattern: string; capture_group: number; prioridad: number }[]}
          tiposFalla={(tiposFallaRaw ?? []) as { id: string; nombre: string }[]}
        />
      )}
    </div>
  )
}
