export const PLANILLAS_BUCKET = 'planillas'

/**
 * Gemini recibe el archivo inline (base64). Un archivo de 14 MB ocupa cerca
 * de 18,7 MB al codificarse, dejando margen para el prompt y el schema dentro
 * del límite total de la API.
 */
export const MAX_PLANILLA_BYTES = 14 * 1024 * 1024

export const EXTENSION_POR_MIME = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/heic': 'heic',
  'image/heif': 'heif',
  'application/pdf': 'pdf',
} as const

export type MimePlanilla = keyof typeof EXTENSION_POR_MIME

export const MIME_PLANILLAS_ACEPTADOS = Object.keys(
  EXTENSION_POR_MIME
) as MimePlanilla[]

export const MIME_TYPES_ACEPTADOS = MIME_PLANILLAS_ACEPTADOS.join(',')

export type ValidacionArchivoPlanilla =
  | { ok: true; mimeType: MimePlanilla }
  | {
      ok: false
      codigo: 'TIPO_INVALIDO' | 'ARCHIVO_VACIO' | 'ARCHIVO_MUY_GRANDE'
      error: string
    }

export function validarArchivoPlanilla(
  mimeType: string,
  size: number
): ValidacionArchivoPlanilla {
  if (!MIME_PLANILLAS_ACEPTADOS.includes(mimeType as MimePlanilla)) {
    return {
      ok: false,
      codigo: 'TIPO_INVALIDO',
      error: `Tipo de archivo no soportado: ${mimeType || 'desconocido'}. Aceptamos JPG, PNG, WebP, HEIC y PDF.`,
    }
  }

  if (!Number.isFinite(size) || size <= 0) {
    return {
      ok: false,
      codigo: 'ARCHIVO_VACIO',
      error: 'El archivo está vacío o no se pudo leer.',
    }
  }

  if (size > MAX_PLANILLA_BYTES) {
    return {
      ok: false,
      codigo: 'ARCHIVO_MUY_GRANDE',
      error: `El archivo supera el máximo de ${formatBytes(MAX_PLANILLA_BYTES)}. Elegí una foto o PDF más liviano.`,
    }
  }

  return { ok: true, mimeType: mimeType as MimePlanilla }
}

export function construirPathPlanilla(
  empresaId: string,
  mimeType: MimePlanilla,
  opciones?: { fecha?: Date; uuid?: string }
): string {
  const fecha = opciones?.fecha ?? new Date()
  const uuid = opciones?.uuid ?? crypto.randomUUID()
  const yyyyMm = fecha.toISOString().slice(0, 7)
  return `${empresaId}/${yyyyMm}/${uuid}.${EXTENSION_POR_MIME[mimeType]}`
}

/**
 * Acepta exclusivamente paths con el formato que genera la app. Además de
 * aislar por empresa, esto evita traversal y que la acción procese otro objeto
 * del bucket aunque el cliente manipule manualmente sus argumentos.
 */
export function esPathPlanillaDeEmpresa(
  path: string,
  empresaId: string,
  mimeType: MimePlanilla
): boolean {
  const partes = path.split('/')
  if (partes.length !== 3 || partes[0] !== empresaId) return false
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(partes[1])) return false

  const extension = EXTENSION_POR_MIME[mimeType]
  const nombreEsperado = new RegExp(
    `^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\\.${extension}$`,
    'i'
  )
  return nombreEsperado.test(partes[2])
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
