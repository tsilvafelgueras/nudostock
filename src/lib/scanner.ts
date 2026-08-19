/**
 * Extrae el número de pieza del payload de un QR/código de barras
 * usando una lista de patrones regex configurados por tintorería.
 *
 * Cada patrón se prueba en orden de prioridad ascendente. El primer
 * patrón que extrae un candidato presente en `codigosEsperados`
 * gana. Si ningún patrón matchea, se devuelve { ok: false } — nunca
 * se cae a un fallback genérico que pueda levantar basura.
 */

export type PatronCodigo = {
  pattern: string
  capture_group: number
  prioridad: number
}

export type ResultadoExtraccion =
  | { ok: true; codigo: string; patronUsado: string }
  | { ok: false; razon: 'sin_match' | 'sin_patrones' }

export function extraerCodigoRollo(
  raw: string,
  patrones: PatronCodigo[],
  codigosEsperados: string[]
): ResultadoExtraccion {
  const texto = normalizarTexto(raw)
  if (!texto) return { ok: false, razon: 'sin_match' }
  if (patrones.length === 0) return { ok: false, razon: 'sin_patrones' }

  const esperadosNorm = new Set(
    codigosEsperados
      .map((c) => normalizarTexto(c).toUpperCase())
      .filter(Boolean)
  )

  const ordenados = [...patrones].sort((a, b) => a.prioridad - b.prioridad)

  for (const p of ordenados) {
    let regex: RegExp
    try {
      regex = new RegExp(p.pattern, 'i')
    } catch {
      continue
    }

    const match = regex.exec(texto)
    if (!match) continue

    const grupo = p.capture_group ?? 0
    const candidato = match[grupo]
    if (!candidato) continue

    const candidatoLimpio = candidato.trim()
    if (esperadosNorm.has(candidatoLimpio.toUpperCase())) {
      return { ok: true, codigo: candidatoLimpio, patronUsado: p.pattern }
    }
  }

  return { ok: false, razon: 'sin_match' }
}

/**
 * Extrae un código candidato aplicando los patrones SIN validar que
 * pertenezca a una lista esperada. Útil para enviar al backend y dejar
 * que la validación final ocurra ahí (ej. detectar si el rollo está en
 * otro pedido activo).
 */
export function extraerCodigoCandidato(
  raw: string,
  patrones: PatronCodigo[]
): string | null {
  return extraerCodigosCandidatos(raw, patrones)[0] ?? null
}

/**
 * Devuelve todos los candidatos distintos que extraen los patrones.
 *
 * Es útil cuando todavía no conocemos la tintorería del rollo (por ejemplo,
 * en devoluciones): el backend puede validar los candidatos contra los rollos
 * realmente egresados sin confiar ciegamente en el primer regex que matchee.
 */
export function extraerCodigosCandidatos(
  raw: string,
  patrones: PatronCodigo[]
): string[] {
  const texto = normalizarTexto(raw)
  if (!texto || patrones.length === 0) return []

  const ordenados = [...patrones].sort((a, b) => a.prioridad - b.prioridad)
  const candidatos: string[] = []
  const vistos = new Set<string>()

  for (const p of ordenados) {
    let regex: RegExp
    try {
      regex = new RegExp(p.pattern, 'i')
    } catch {
      continue
    }
    const match = regex.exec(texto)
    if (!match) continue
    const grupo = p.capture_group ?? 0
    const candidato = match[grupo]?.trim()
    if (!candidato) continue

    const clave = candidato.toUpperCase()
    if (!vistos.has(clave)) {
      vistos.add(clave)
      candidatos.push(candidato)
    }
  }

  return candidatos
}

function normalizarTexto(value: string): string {
  return value.trim().replace(/\s+/g, ' ')
}
