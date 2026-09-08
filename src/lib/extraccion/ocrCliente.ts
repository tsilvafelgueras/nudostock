'use client'

import {
  normalizarTextoOcr,
  textoOcrEsUtil,
} from './ocr'

const MAX_PAGINAS_PDF_ESCANEADO = 8
const MAX_LADO_IMAGEN = 3_200
const LADO_OBJETIVO_IMAGEN_CHICA = 1_800
const MAX_PIXELES_CANVAS = 8_000_000

export type ProgresoOcr = {
  porcentaje: number
  detalle: string
}

export type ResultadoOcrLocal = {
  texto: string
  metodo: 'texto_pdf' | 'ocr_local'
  paginas: number
  confianza: number | null
}

type ProgresoCallback = (progreso: ProgresoOcr) => void

type PdfTextItem = {
  str: string
  transform: number[]
  hasEOL?: boolean
}

function esPdfTextItem(item: unknown): item is PdfTextItem {
  if (!item || typeof item !== 'object') return false
  const candidato = item as Partial<PdfTextItem>
  return (
    typeof candidato.str === 'string' &&
    Array.isArray(candidato.transform) &&
    candidato.transform.length >= 6
  )
}

/**
 * PDF.js entrega fragmentos con coordenadas. Agruparlos por altura conserva
 * mucho mejor las filas y columnas que concatenarlos en el orden interno del
 * archivo, que no siempre coincide con el orden visual.
 */
export function reconstruirTextoPdf(items: unknown[]): string {
  const lineas: Array<{ y: number; items: Array<{ x: number; texto: string }> }> = []

  for (const item of items) {
    if (!esPdfTextItem(item) || !item.str.trim()) continue
    const x = item.transform[4]
    const y = item.transform[5]
    let linea = lineas.find((actual) => Math.abs(actual.y - y) <= 2.5)
    if (!linea) {
      linea = { y, items: [] }
      lineas.push(linea)
    }
    linea.items.push({ x, texto: item.str.trim() })
  }

  return lineas
    .sort((a, b) => b.y - a.y)
    .map((linea) =>
      linea.items
        .sort((a, b) => a.x - b.x)
        .map(({ texto }) => texto)
        .join('    ')
    )
    .join('\n')
}

function escalaCanvas(ancho: number, alto: number): number {
  const ladoMayor = Math.max(ancho, alto)
  let escala = 1
  if (ladoMayor < LADO_OBJETIVO_IMAGEN_CHICA) {
    escala = LADO_OBJETIVO_IMAGEN_CHICA / ladoMayor
  } else if (ladoMayor > MAX_LADO_IMAGEN) {
    escala = MAX_LADO_IMAGEN / ladoMayor
  }

  const pixeles = ancho * alto * escala * escala
  if (pixeles > MAX_PIXELES_CANVAS) {
    escala *= Math.sqrt(MAX_PIXELES_CANVAS / pixeles)
  }
  return escala
}

async function imagenACanvas(file: File): Promise<HTMLCanvasElement> {
  const bitmap = await createImageBitmap(file)
  try {
    const escala = escalaCanvas(bitmap.width, bitmap.height)
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(bitmap.width * escala))
    canvas.height = Math.max(1, Math.round(bitmap.height * escala))
    const context = canvas.getContext('2d', { alpha: false })
    if (!context) throw new Error('El navegador no pudo preparar la imagen.')
    context.fillStyle = '#fff'
    context.fillRect(0, 0, canvas.width, canvas.height)
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    return canvas
  } finally {
    bitmap.close()
  }
}

async function crearReconocedor(onProgress: ProgresoCallback) {
  const { createWorker, OEM, PSM } = await import('tesseract.js')
  const worker = await createWorker('spa', OEM.LSTM_ONLY, {
    logger: ({ status, progress }) => {
      const base = status === 'recognizing text' ? progress : 0
      onProgress({
        porcentaje: Math.round(Math.max(0, Math.min(1, base)) * 100),
        detalle:
          status === 'recognizing text'
            ? 'Reconociendo texto'
            : 'Preparando el OCR gratuito',
      })
    },
  })
  await worker.setParameters({
    tessedit_pageseg_mode: PSM.AUTO,
    preserve_interword_spaces: '1',
    user_defined_dpi: '300',
  })
  return worker
}

async function extraerDeImagen(
  file: File,
  onProgress: ProgresoCallback
): Promise<ResultadoOcrLocal | null> {
  const canvas = await imagenACanvas(file)
  const worker = await crearReconocedor(onProgress)
  try {
    const { data } = await worker.recognize(
      canvas,
      { rotateAuto: true },
      { text: true }
    )
    const texto = normalizarTextoOcr(data.text)
    if (!textoOcrEsUtil(texto)) return null
    return {
      texto,
      metodo: 'ocr_local',
      paginas: 1,
      confianza: Number.isFinite(data.confidence) ? data.confidence / 100 : null,
    }
  } finally {
    await worker.terminate()
    canvas.remove()
  }
}

async function cargarPdfJs() {
  const pdfjs = await import('pdfjs-dist')
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    'pdfjs-dist/build/pdf.worker.min.mjs',
    import.meta.url
  ).toString()
  return pdfjs
}

async function extraerDePdf(
  file: File,
  onProgress: ProgresoCallback
): Promise<ResultadoOcrLocal | null> {
  onProgress({ porcentaje: 0, detalle: 'Leyendo el PDF' })
  const pdfjs = await cargarPdfJs()
  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(await file.arrayBuffer()),
  })
  const pdf = await loadingTask.promise

  try {
    const textosDigitales: string[] = []
    const paginasEscaneadas: number[] = []

    for (let numero = 1; numero <= pdf.numPages; numero++) {
      const pagina = await pdf.getPage(numero)
      const contenido = await pagina.getTextContent()
      const texto = normalizarTextoOcr(reconstruirTextoPdf(contenido.items))
      textosDigitales.push(texto)
      if (!textoOcrEsUtil(texto)) paginasEscaneadas.push(numero)
      pagina.cleanup()
      onProgress({
        porcentaje: Math.round((numero / pdf.numPages) * 20),
        detalle: `Leyendo página ${numero} de ${pdf.numPages}`,
      })
    }

    if (paginasEscaneadas.length === 0) {
      const texto = normalizarTextoOcr(
        textosDigitales
          .map((pagina, index) => `--- PÁGINA ${index + 1} ---\n${pagina}`)
          .join('\n\n')
      )
      return textoOcrEsUtil(texto)
        ? {
            texto,
            metodo: 'texto_pdf',
            paginas: pdf.numPages,
            confianza: null,
          }
        : null
    }

    if (paginasEscaneadas.length > MAX_PAGINAS_PDF_ESCANEADO) {
      throw new Error(
        `El PDF tiene ${paginasEscaneadas.length} páginas escaneadas; el OCR local admite hasta ${MAX_PAGINAS_PDF_ESCANEADO}.`
      )
    }

    const worker = await crearReconocedor(onProgress)
    const confianzas: number[] = []
    try {
      for (let indice = 0; indice < paginasEscaneadas.length; indice++) {
        const numero = paginasEscaneadas[indice]
        const pagina = await pdf.getPage(numero)
        const viewportBase = pagina.getViewport({ scale: 1 })
        const escala = escalaCanvas(viewportBase.width, viewportBase.height)
        const viewport = pagina.getViewport({ scale: escala })
        const canvas = document.createElement('canvas')
        try {
          canvas.width = Math.ceil(viewport.width)
          canvas.height = Math.ceil(viewport.height)
          const context = canvas.getContext('2d', { alpha: false })
          if (!context) throw new Error('El navegador no pudo renderizar el PDF.')
          context.fillStyle = '#fff'
          context.fillRect(0, 0, canvas.width, canvas.height)
          await pagina.render({ canvas, canvasContext: context, viewport }).promise

          const { data } = await worker.recognize(
            canvas,
            { rotateAuto: true },
            { text: true }
          )
          textosDigitales[numero - 1] = normalizarTextoOcr(data.text)
          if (Number.isFinite(data.confidence)) confianzas.push(data.confidence)
        } finally {
          canvas.remove()
          pagina.cleanup()
        }
        onProgress({
          porcentaje: 20 + Math.round(((indice + 1) / paginasEscaneadas.length) * 80),
          detalle: `Aplicando OCR a página ${numero} de ${pdf.numPages}`,
        })
      }
    } finally {
      await worker.terminate()
    }

    const texto = normalizarTextoOcr(
      textosDigitales
        .map((pagina, index) => `--- PÁGINA ${index + 1} ---\n${pagina}`)
        .join('\n\n')
    )
    if (!textoOcrEsUtil(texto)) return null

    return {
      texto,
      metodo: 'ocr_local',
      paginas: pdf.numPages,
      confianza:
        confianzas.length > 0
          ? confianzas.reduce((total, valor) => total + valor, 0) /
            confianzas.length /
            100
          : null,
    }
  } finally {
    await pdf.destroy()
  }
}

/**
 * Prelectura gratuita y local. Devuelve null para que la app conserve el flujo
 * visual anterior cuando el navegador o el OCR no logran obtener texto útil.
 */
export async function extraerTextoPlanillaLocal(
  file: File,
  onProgress: ProgresoCallback = () => undefined
): Promise<ResultadoOcrLocal | null> {
  if (file.type === 'application/pdf') {
    return extraerDePdf(file, onProgress)
  }
  if (file.type.startsWith('image/')) {
    return extraerDeImagen(file, onProgress)
  }
  return null
}
