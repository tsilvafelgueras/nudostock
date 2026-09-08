export const MAX_TEXTO_OCR_CHARS = 80_000

/**
 * El texto OCR cruza una Server Action y luego forma parte del prompt. Lo
 * acotamos y limpiamos tanto en cliente como en servidor: el cliente mejora la
 * UX, pero el servidor sigue siendo la frontera de confianza.
 */
export function normalizarTextoOcr(texto: string): string {
  return texto
    .normalize('NFKC')
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{4,}/g, '\n\n\n')
    .trim()
    .slice(0, MAX_TEXTO_OCR_CHARS)
}

/** Evita usar como fuente un OCR vacío o compuesto solamente por ruido. */
export function textoOcrEsUtil(texto: string): boolean {
  const normalizado = normalizarTextoOcr(texto)
  const caracteresInformativos = normalizado.match(/[\p{L}\p{N}]/gu)?.length ?? 0
  const lineasConContenido = normalizado
    .split('\n')
    .filter((linea) => /[\p{L}\p{N}]/u.test(linea)).length

  return caracteresInformativos >= 40 && lineasConContenido >= 2
}
