export type ColorCatalogo = { id: string; nombre: string }

function normalizarColor(valor: string): string {
  return valor
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ')
}

/**
 * Resuelve el texto leído en la planilla contra el catálogo existente.
 * Nunca crea colores ni elige entre dos coincidencias igual de plausibles.
 */
export function resolverColorCatalogo(
  raw: string | null | undefined,
  colores: ColorCatalogo[]
): string | null {
  const textoOriginal = normalizarColor(raw ?? '')
  if (!textoOriginal) return null

  const texto = textoOriginal
    .replace(/^(?:color|tono|partida en color)\s+/, '')
    .trim()
  const catalogo = colores
    .map((color) => ({ color, normalizado: normalizarColor(color.nombre) }))
    .filter(({ normalizado }) => normalizado)

  const exacto = catalogo.find(({ normalizado }) => normalizado === texto)
  if (exacto) return exacto.color.id

  // Tolera respuestas como "COLOR: BLANCO / INT. 9001". Si aparecen varios
  // nombres, el más largo es el más específico ("Azul Marino" antes que
  // "Azul").
  const conNombreCompleto = catalogo
    .filter(({ normalizado }) =>
      ` ${texto} `.includes(` ${normalizado} `)
    )
    .sort((a, b) => b.normalizado.length - a.normalizado.length)
  if (
    conNombreCompleto.length > 0 &&
    (conNombreCompleto.length === 1 ||
      conNombreCompleto[0].normalizado.length >
        conNombreCompleto[1].normalizado.length)
  ) {
    return conNombreCompleto[0].color.id
  }

  // Abreviaturas habituales de remitos: "BLA" → "Blanco". Sólo se acepta
  // una coincidencia única para evitar asignar un color incorrecto.
  if (/^[a-z0-9]{3,}$/.test(texto)) {
    const porPrefijo = catalogo.filter(({ normalizado }) =>
      normalizado.startsWith(texto)
    )
    if (porPrefijo.length === 1) return porPrefijo[0].color.id
  }

  return null
}
