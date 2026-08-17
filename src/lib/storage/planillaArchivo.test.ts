import { describe, expect, it } from 'vitest'
import {
  construirPathPlanilla,
  esPathPlanillaDeEmpresa,
  MAX_PLANILLA_BYTES,
  validarArchivoPlanilla,
} from './planillaArchivo'

const EMPRESA_ID = '11111111-1111-4111-8111-111111111111'
const OTRA_EMPRESA_ID = '22222222-2222-4222-8222-222222222222'
const ARCHIVO_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'

describe('archivo de planilla', () => {
  it('acepta los formatos soportados dentro del límite', () => {
    expect(validarArchivoPlanilla('image/jpeg', 5 * 1024 * 1024)).toEqual({
      ok: true,
      mimeType: 'image/jpeg',
    })
    expect(validarArchivoPlanilla('application/pdf', MAX_PLANILLA_BYTES)).toEqual({
      ok: true,
      mimeType: 'application/pdf',
    })
  })

  it('rechaza archivos vacíos, demasiado grandes y formatos desconocidos', () => {
    expect(validarArchivoPlanilla('image/png', 0)).toMatchObject({
      ok: false,
      codigo: 'ARCHIVO_VACIO',
    })
    expect(
      validarArchivoPlanilla('image/png', MAX_PLANILLA_BYTES + 1)
    ).toMatchObject({ ok: false, codigo: 'ARCHIVO_MUY_GRANDE' })
    expect(validarArchivoPlanilla('image/tiff', 100)).toMatchObject({
      ok: false,
      codigo: 'TIPO_INVALIDO',
    })
  })

  it('genera un path aislado por empresa, mes, UUID y extensión', () => {
    expect(
      construirPathPlanilla(EMPRESA_ID, 'application/pdf', {
        fecha: new Date('2026-08-13T12:00:00.000Z'),
        uuid: ARCHIVO_ID,
      })
    ).toBe(`${EMPRESA_ID}/2026-08/${ARCHIVO_ID}.pdf`)
  })

  it('solo acepta el path exacto de la empresa y el MIME declarados', () => {
    const path = `${EMPRESA_ID}/2026-08/${ARCHIVO_ID}.jpg`

    expect(esPathPlanillaDeEmpresa(path, EMPRESA_ID, 'image/jpeg')).toBe(true)
    expect(esPathPlanillaDeEmpresa(path, OTRA_EMPRESA_ID, 'image/jpeg')).toBe(false)
    expect(esPathPlanillaDeEmpresa(path, EMPRESA_ID, 'application/pdf')).toBe(false)
    expect(
      esPathPlanillaDeEmpresa(
        `${EMPRESA_ID}/2026-08/../secreto.jpg`,
        EMPRESA_ID,
        'image/jpeg'
      )
    ).toBe(false)
  })
})
