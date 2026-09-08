import { describe, expect, it } from 'vitest'
import { normalizarTextoOcr, textoOcrEsUtil } from './ocr'
import { reconstruirTextoPdf } from './ocrCliente'

describe('texto OCR local', () => {
  it('limpia controles y conserva filas y columnas', () => {
    expect(normalizarTextoOcr('REMITO\u0000 123  \r\nPIEZA   KILOS\r\n001   20,5')).toBe(
      'REMITO 123\nPIEZA   KILOS\n001   20,5'
    )
  })

  it('descarta resultados demasiado breves o ruidosos', () => {
    expect(textoOcrEsUtil('... --- ...')).toBe(false)
    expect(
      textoOcrEsUtil(
        'REMITO 12345 FECHA 08/09/2026\nPIEZA 001 KILOS 20,5 METROS 48 COLOR NEGRO'
      )
    ).toBe(true)
  })

  it('reconstruye el orden visual de un PDF por filas y columnas', () => {
    const texto = reconstruirTextoPdf([
      { str: '20,5', transform: [1, 0, 0, 1, 200, 500] },
      { str: 'PIEZA', transform: [1, 0, 0, 1, 10, 520] },
      { str: '001', transform: [1, 0, 0, 1, 10, 500] },
      { str: 'KILOS', transform: [1, 0, 0, 1, 200, 520] },
    ])

    expect(texto).toBe('PIEZA    KILOS\n001    20,5')
  })
})
