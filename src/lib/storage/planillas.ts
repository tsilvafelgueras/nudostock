/**
 * Helpers para subir y leer planillas del bucket "planillas" de Supabase Storage.
 *
 * Estructura de path: `{empresa_id}/{yyyy-mm}/{uuid}.{ext}`
 *   - El primer folder es el `empresa_id`. Las RLS del bucket usan ese
 *     primer folder para aislar tenants (ver migración 005 + policies del bucket).
 *   - El segundo folder es el mes (yyyy-mm) para que la lista en Supabase
 *     Dashboard sea navegable.
 *   - El nombre final es un UUID + extensión derivada del MIME type.
 *
 * En la tabla `ingresos.imagen_url` guardamos el PATH (no la URL firmada),
 * porque las URLs firmadas expiran. Cuando la UI necesite mostrar la imagen,
 * llama a `getSignedUrl(path)` y obtiene una URL temporal.
 */

import { createClient } from '@/lib/supabase/server'
import {
  construirPathPlanilla,
  EXTENSION_POR_MIME,
  PLANILLAS_BUCKET,
  type MimePlanilla,
} from './planillaArchivo'

export { MIME_TYPES_ACEPTADOS } from './planillaArchivo'

const SIGNED_URL_TTL_SECONDS = 60 * 60 // 1 hora

export type SubirPlanillaResult =
  | { ok: true; path: string }
  | { ok: false; error: string }

export type SignedUrlResult =
  | { ok: true; url: string }
  | { ok: false; error: string }

/**
 * Sube una planilla al bucket. Espera que el usuario esté logueado y que
 * la RLS del bucket valide que el primer folder del path coincide con su
 * `current_empresa_id()`.
 */
export async function subirPlanilla(
  fileBuffer: Buffer,
  mimeType: string,
  empresaId: string
): Promise<SubirPlanillaResult> {
  const ext = EXTENSION_POR_MIME[mimeType as MimePlanilla]
  if (!ext) {
    return {
      ok: false,
      error: `Tipo de archivo no soportado: ${mimeType}. Aceptamos JPG, PNG, WebP, HEIC y PDF.`,
    }
  }

  const path = construirPathPlanilla(empresaId, mimeType as MimePlanilla)

  const supabase = await createClient()
  const { error } = await supabase.storage
    .from(PLANILLAS_BUCKET)
    .upload(path, fileBuffer, {
      contentType: mimeType,
      upsert: false,
    })

  if (error) {
    return { ok: false, error: `Error al subir planilla: ${error.message}` }
  }

  return { ok: true, path }
}

/**
 * Genera una URL firmada temporal para leer una planilla guardada.
 * La URL expira en 1 hora; si la UI la necesita más tiempo, regenerar.
 */
export async function getSignedUrl(path: string): Promise<SignedUrlResult> {
  const supabase = await createClient()
  const { data, error } = await supabase.storage
    .from(PLANILLAS_BUCKET)
    .createSignedUrl(path, SIGNED_URL_TTL_SECONDS)

  if (error || !data?.signedUrl) {
    return {
      ok: false,
      error: `No se pudo generar URL firmada: ${error?.message ?? 'desconocido'}`,
    }
  }

  return { ok: true, url: data.signedUrl }
}
