'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'

export type TipoFallaActionResult = { ok: true } | { ok: false; error: string }

export async function crearTipoFalla(nombre: string): Promise<TipoFallaActionResult> {
  const supabase = await createClient()
  const admin = await assertAdmin(supabase)
  if (!admin.ok) return admin

  const trimmed = nombre.trim()
  if (!trimmed) return { ok: false, error: 'El nombre es obligatorio.' }
  if (trimmed.length > 80) return { ok: false, error: 'El nombre no puede superar 80 caracteres.' }

  const { error } = await supabase.from('tipos_falla').insert({ nombre: trimmed })
  if (error) {
    if (error.code === '23505') return { ok: false, error: 'Ya existe una categoría con ese nombre.' }
    return { ok: false, error: error.message }
  }

  revalidatePath('/admin/fallas')
  return { ok: true }
}

export async function actualizarTipoFalla(
  id: string,
  nombre: string
): Promise<TipoFallaActionResult> {
  const supabase = await createClient()
  const admin = await assertAdmin(supabase)
  if (!admin.ok) return admin

  const trimmed = nombre.trim()
  if (!trimmed) return { ok: false, error: 'El nombre es obligatorio.' }
  if (trimmed.length > 80) return { ok: false, error: 'El nombre no puede superar 80 caracteres.' }

  const { error } = await supabase
    .from('tipos_falla')
    .update({ nombre: trimmed })
    .eq('id', id)

  if (error) {
    if (error.code === '23505') return { ok: false, error: 'Ya existe una categoría con ese nombre.' }
    return { ok: false, error: error.message }
  }

  revalidatePath('/admin/fallas')
  return { ok: true }
}

export async function toggleTipoFalla(
  id: string,
  activo: boolean
): Promise<TipoFallaActionResult> {
  const supabase = await createClient()
  const admin = await assertAdmin(supabase)
  if (!admin.ok) return admin

  const { error } = await supabase
    .from('tipos_falla')
    .update({ activo })
    .eq('id', id)

  if (error) return { ok: false, error: error.message }

  revalidatePath('/admin/fallas')
  return { ok: true }
}

export async function reordenarTipoFalla(
  id: string,
  orden: number
): Promise<TipoFallaActionResult> {
  const supabase = await createClient()
  const admin = await assertAdmin(supabase)
  if (!admin.ok) return admin

  const { error } = await supabase
    .from('tipos_falla')
    .update({ orden })
    .eq('id', id)

  if (error) return { ok: false, error: error.message }

  revalidatePath('/admin/fallas')
  return { ok: true }
}

async function assertAdmin(
  supabase: Awaited<ReturnType<typeof createClient>>
): Promise<{ ok: true } | { ok: false; error: string }> {
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'Sesión expirada.' }

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()

  if (profile?.role !== 'admin') {
    return { ok: false, error: 'Solo el admin puede gestionar tipos de falla.' }
  }

  return { ok: true }
}
