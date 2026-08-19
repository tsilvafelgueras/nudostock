import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { IngresoExtraido } from '@/lib/extraccion/extraerPlanilla'
import { MAX_PLANILLA_BYTES } from '@/lib/storage/planillaArchivo'

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  extraerPlanilla: vi.fn(),
  subirPlanilla: vi.fn(),
  validarUbicacionActiva: vi.fn(),
  redirect: vi.fn(),
}))

vi.mock('@/lib/supabase/server', () => ({ createClient: mocks.createClient }))
vi.mock('@/lib/extraccion/extraerPlanilla', () => ({
  extraerPlanilla: mocks.extraerPlanilla,
  UMBRAL_BAJA_CONFIANZA: 0.85,
}))
vi.mock('@/lib/storage/planillas', () => ({ subirPlanilla: mocks.subirPlanilla }))
vi.mock('@/lib/ubicacionesServer', () => ({
  validarUbicacionActiva: mocks.validarUbicacionActiva,
}))
vi.mock('next/navigation', () => ({ redirect: mocks.redirect }))

import {
  prepararSubidaPlanilla,
  procesarPlanillaConIA,
} from './actions'

const EMPRESA_ID = '11111111-1111-4111-8111-111111111111'
const OTRA_EMPRESA_ID = '22222222-2222-4222-8222-222222222222'
const TINTORERIA_ID = '33333333-3333-4333-8333-333333333333'
const ARCHIVO_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const PATH_VALIDO = `${EMPRESA_ID}/2026-08/${ARCHIVO_ID}.jpg`

const datosExtraidos: IngresoExtraido = {
  numero_remito: { value: 'R-1', confidence: 1 },
  fecha: { value: '2026-08-13', confidence: 1 },
  color: { value: 'Negro', confidence: 1 },
  ot: { value: 'OT-1', confidence: 1 },
  rem_tejeduria: { value: null, confidence: 0 },
  referencia: { value: 'ML70', confidence: 1 },
  total_rollos_declarado: { value: 1, confidence: 1 },
  total_kilos_declarado: { value: 20, confidence: 1 },
  rollos: [
    {
      numero_pieza: { value: '001', confidence: 1 },
      kilos: { value: 20, confidence: 1 },
      metros: { value: 45, confidence: 1 },
      ratio: { value: 2.25, confidence: 1 },
      gramaje_planilla: { value: null, confidence: 0 },
      articulo: { value: 'ML70', confidence: 1 },
      color: { value: null, confidence: 0 },
    },
  ],
}

function crearSupabaseFake(opciones?: {
  vinculada?: boolean
  prompt?: string | null
  role?: string
}) {
  const storageApi = {
    createSignedUploadUrl: vi.fn().mockResolvedValue({
      data: { token: 'signed-token', path: PATH_VALIDO },
      error: null,
    }),
    download: vi.fn().mockResolvedValue({
      data: new Blob([new Uint8Array([1, 2, 3])], { type: 'image/jpeg' }),
      error: null,
    }),
    remove: vi.fn().mockResolvedValue({ error: null }),
  }

  const from = vi.fn((tabla: string) => {
    const query = {
      select: vi.fn(() => query),
      eq: vi.fn(() => query),
      limit: vi.fn(() => query),
      single: vi.fn(async () => {
        if (tabla === 'profiles') {
          return {
            data: { empresa_id: EMPRESA_ID, role: opciones?.role ?? 'operario' },
            error: null,
          }
        }
        if (tabla === 'tintorerias') {
          return {
            data: { extraction_prompt: opciones?.prompt ?? 'PROMPT MUTER' },
            error: null,
          }
        }
        return { data: null, error: null }
      }),
      maybeSingle: vi.fn(async () => {
        if (tabla === 'empresa_tintorerias') {
          return {
            data:
              opciones?.vinculada === false
                ? null
                : { tintoreria_id: TINTORERIA_ID },
            error: null,
          }
        }
        return { data: null, error: null }
      }),
    }
    return query
  })

  return {
    supabase: {
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: 'usuario-1' } },
        }),
      },
      from,
      storage: { from: vi.fn(() => storageApi) },
    },
    from,
    storageApi,
  }
}

describe('Server Actions de extracción directa', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.extraerPlanilla.mockResolvedValue({ ok: true, data: datosExtraidos })
  })

  it('prepara una subida firmada sin recibir los bytes del archivo', async () => {
    const fake = crearSupabaseFake()
    mocks.createClient.mockResolvedValue(fake.supabase)

    const result = await prepararSubidaPlanilla({
      mime_type: 'image/jpeg',
      size: 5 * 1024 * 1024,
    })

    expect(result).toMatchObject({ ok: true, token: 'signed-token' })
    expect(result.ok && result.path.startsWith(`${EMPRESA_ID}/`)).toBe(true)
    expect(fake.storageApi.createSignedUploadUrl).toHaveBeenCalledTimes(1)
  })

  it('rechaza por tamaño antes de consultar sesión o Storage', async () => {
    const result = await prepararSubidaPlanilla({
      mime_type: 'application/pdf',
      size: MAX_PLANILLA_BYTES + 1,
    })

    expect(result).toMatchObject({ ok: false, codigo: 'ARCHIVO_MUY_GRANDE' })
    expect(mocks.createClient).not.toHaveBeenCalled()
  })

  it('no firma subidas para roles que no cargan ingresos', async () => {
    const fake = crearSupabaseFake({ role: 'ventas' })
    mocks.createClient.mockResolvedValue(fake.supabase)

    const result = await prepararSubidaPlanilla({
      mime_type: 'image/jpeg',
      size: 1024,
    })

    expect(result).toMatchObject({ ok: false, codigo: 'ROL_NO_AUTORIZADO' })
    expect(fake.storageApi.createSignedUploadUrl).not.toHaveBeenCalled()
  })

  it('descarga el archivo propio y conserva el prompt de la tintorería', async () => {
    const fake = crearSupabaseFake({ prompt: 'PROMPT INTERNO GALFIONE' })
    mocks.createClient.mockResolvedValue(fake.supabase)

    const result = await procesarPlanillaConIA({
      imagen_path: PATH_VALIDO,
      mime_type: 'image/jpeg',
      tintoreria_id: TINTORERIA_ID,
    })

    expect(result).toMatchObject({ ok: true, imagen_path: PATH_VALIDO })
    expect(fake.storageApi.download).toHaveBeenCalledWith(PATH_VALIDO)
    expect(mocks.extraerPlanilla).toHaveBeenCalledWith(
      expect.any(Buffer),
      'image/jpeg',
      'PROMPT INTERNO GALFIONE'
    )
  })

  it('rechaza un path perteneciente a otra empresa antes de descargarlo', async () => {
    const fake = crearSupabaseFake()
    mocks.createClient.mockResolvedValue(fake.supabase)

    const result = await procesarPlanillaConIA({
      imagen_path: `${OTRA_EMPRESA_ID}/2026-08/${ARCHIVO_ID}.jpg`,
      mime_type: 'image/jpeg',
      tintoreria_id: TINTORERIA_ID,
    })

    expect(result).toMatchObject({ ok: false, codigo: 'NO_PATH' })
    expect(fake.storageApi.download).not.toHaveBeenCalled()
    expect(mocks.extraerPlanilla).not.toHaveBeenCalled()
  })

  it('rechaza una tintorería que no está asociada a la empresa', async () => {
    const fake = crearSupabaseFake({ vinculada: false })
    mocks.createClient.mockResolvedValue(fake.supabase)

    const result = await procesarPlanillaConIA({
      imagen_path: PATH_VALIDO,
      mime_type: 'image/jpeg',
      tintoreria_id: TINTORERIA_ID,
    })

    expect(result).toMatchObject({
      ok: false,
      codigo: 'TINTORERIA_NO_AUTORIZADA',
    })
    expect(fake.storageApi.download).not.toHaveBeenCalled()
    expect(mocks.extraerPlanilla).not.toHaveBeenCalled()
  })
})
