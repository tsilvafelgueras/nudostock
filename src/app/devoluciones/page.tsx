import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import DevolucionesWizard from './DevolucionesWizard'
import type { PatronCodigo } from '@/lib/scanner'

export const metadata = { title: 'Devoluciones' }

export default async function DevolucionesPage() {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('role, empresa_id')
    .eq('id', user.id)
    .single()

  const role = profile?.role as string | undefined
  const empresaId = profile?.empresa_id as string | null | undefined
  if ((role !== 'operario' && role !== 'admin') || !empresaId) {
    redirect('/')
  }

  const { data: tiposFallaRaw } = await supabase
    .from('tipos_falla')
    .select('id, nombre')
    .eq('activo', true)
    .order('orden', { ascending: true })
    .order('nombre', { ascending: true })

  const tiposFalla = (tiposFallaRaw ?? []) as { id: string; nombre: string }[]

  const { data: asociacionesRaw } = await supabase
    .from('empresa_tintorerias')
    .select('tintoreria_id')
    .eq('empresa_id', empresaId)
    .eq('activo', true)

  const tintoreriaIds = (asociacionesRaw ?? []).map((r) => r.tintoreria_id)
  let patronesQuery = supabase
    .from('tintoreria_codigo_patrones')
    .select('pattern, capture_group, prioridad')
    .eq('activo', true)
    .order('prioridad', { ascending: true })

  patronesQuery =
    tintoreriaIds.length > 0
      ? patronesQuery.or(
          `empresa_id.eq.${empresaId},tintoreria_id.in.(${tintoreriaIds.join(',')})`
        )
      : patronesQuery.eq('empresa_id', empresaId)

  const { data: patronesRaw } = await patronesQuery
  const patrones = (patronesRaw ?? []) as PatronCodigo[]

  return <DevolucionesWizard tiposFalla={tiposFalla} patrones={patrones} />
}
