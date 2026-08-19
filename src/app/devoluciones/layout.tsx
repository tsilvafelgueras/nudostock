import { redirect } from 'next/navigation'
import AppShell from '@/components/AppShell'
import { homePathForRole } from '@/lib/auth/home-path'
import { createClient } from '@/lib/supabase/server'

export default async function DevolucionesLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('role, nombre, empresas(nombre)')
    .eq('id', user.id)
    .single()

  if (profile?.role !== 'operario' && profile?.role !== 'admin') {
    redirect(`${homePathForRole(profile?.role)}?denegado=devoluciones`)
  }

  const empresaNombre =
    (profile.empresas as unknown as { nombre: string } | null)?.nombre ?? null

  return (
    <AppShell
      role={profile.role}
      userName={profile.nombre}
      empresaNombre={empresaNombre}
    >
      {children}
    </AppShell>
  )
}
