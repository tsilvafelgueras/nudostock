import {
  extraerCodigosCandidatos,
  type PatronCodigo,
} from '@/lib/scanner'

export type DevolucionesStep =
  | 'tipo'
  | 'scan_rollos'
  | 'buscar_partida'
  | 'seleccionar_rollos'
  | 'motivo_segunda'
  | 'exito'

const MAX_CANDIDATOS = 20
const MAX_LARGO_CODIGO = 128

/**
 * Construye candidatos seguros para la búsqueda del rollo.
 *
 * En una lectura de cámara se prueban todos los patrones aplicables porque
 * todavía no conocemos la tintorería. El texto crudo queda como último
 * fallback para etiquetas que contienen solamente el número de pieza.
 */
export function construirCandidatosDevolucion(
  raw: string,
  manual: boolean,
  patrones: PatronCodigo[]
): string[] {
  const texto = raw.trim().replace(/\s+/g, ' ')
  if (!texto) return []

  const extraidos = manual ? [] : extraerCodigosCandidatos(texto, patrones)
  const candidatos = [...extraidos, texto]
  const vistos = new Set<string>()

  return candidatos
    .filter((codigo) => codigo.length > 0 && codigo.length <= MAX_LARGO_CODIGO)
    .filter((codigo) => {
      const clave = codigo.toUpperCase()
      if (vistos.has(clave)) return false
      vistos.add(clave)
      return true
    })
    .slice(0, MAX_CANDIDATOS)
}

export function pasoAnteriorDevoluciones(
  step: DevolucionesStep,
  viaPartida: boolean
): DevolucionesStep | null {
  switch (step) {
    case 'scan_rollos':
    case 'buscar_partida':
      return 'tipo'
    case 'seleccionar_rollos':
      return 'buscar_partida'
    case 'motivo_segunda':
      return viaPartida ? 'seleccionar_rollos' : 'scan_rollos'
    default:
      return null
  }
}
