import BackButton from '@/components/BackButton'
import { createClient } from '@/lib/supabase/server'
import FallasAdminClient, { type TipoFallaRow } from './FallasAdminClient'

export default async function AdminFallasPage() {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('tipos_falla')
    .select('id, nombre, activo, orden')
    .order('orden', { ascending: true })
    .order('nombre', { ascending: true })

  const tipos = (data ?? []) as TipoFallaRow[]

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-4 py-5 sm:px-6 md:py-8">
      <div>
        <BackButton href="/admin/dashboard" label="Volver al dashboard" />
        <h1 className="mt-1 text-2xl font-bold">Tipos de falla</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Configurá las categorías de falla que el depósito puede seleccionar al marcar un rollo
          como segunda calidad.
        </p>
      </div>

      {error ? (
        <div className="rounded-lg border border-warning/30 bg-warning/10 p-4 text-sm">
          No se pudo cargar los tipos de falla. Aplicá la migración 064 para habilitar esta
          sección.
        </div>
      ) : (
        <FallasAdminClient tipos={tipos} />
      )}
    </div>
  )
}
