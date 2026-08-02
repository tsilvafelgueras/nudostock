import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import DevolucionesWizard from './DevolucionesWizard'

export const metadata = { title: 'Devoluciones' }

export default async function DevolucionesPage() {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()

  const role = profile?.role as string | undefined
  if (role !== 'operario' && role !== 'admin') {
    redirect('/')
  }

  const { data: tiposFallaRaw } = await supabase
    .from('tipos_falla')
    .select('id, nombre')
    .eq('activo', true)
    .order('orden', { ascending: true })
    .order('nombre', { ascending: true })

  const tiposFalla = (tiposFallaRaw ?? []) as { id: string; nombre: string }[]

  return <DevolucionesWizard tiposFalla={tiposFalla} />
}
