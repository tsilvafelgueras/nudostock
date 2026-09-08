// Contrato compartido por todos los proveedores. Las instrucciones específicas
// de cada tintorería son únicamente pistas adicionales de layout y alias.

const PROMPT_BASE = `
Sos un asistente experto en procesar planillas de remitos de tintorerías textiles argentinas.

Te paso una imagen o PDF de una planilla. Extraé TODOS los datos en formato JSON estructurado, según el schema dado.

REGLA CRÍTICA — FECHA:
El campo \`fecha\` SIEMPRE debe devolverse como ISO "YYYY-MM-DD" (año-mes-día con guiones, año de 4 dígitos).
NUNCA usar barras "/" ni puntos. NUNCA copiar el formato original de la planilla.
En Argentina la planilla viene en DD/MM/YYYY → SIEMPRE convertir antes de devolver.
Ejemplos obligatorios:
  · "03/05/2026" → "2026-05-03"
  · "3/5/26"     → "2026-05-03"
  · "03-05-26"   → "2026-05-03"

Devolvé el JSON directamente. No agregues explicaciones ni texto adicional fuera del JSON.
`.trim()

const UNIVERSAL_INSTRUCTIONS = `
# CONTRATO UNIVERSAL DE EXTRACCIÓN

La app necesita recibir todos los datos visibles del remito en el JSON definido por el schema.

# INTEGRIDAD DE LOS ROLLOS — REGLA CRÍTICA

- Recorré la planilla completa antes de responder: de arriba abajo y de izquierda a derecha.
- Extraé UN objeto dentro de \`rollos\` por cada rollo o pieza física de la planilla. No devuelvas ejemplos, muestras, resúmenes ni solamente la primera fila.
- Una planilla puede distribuir los rollos en varios bloques de columnas paralelos, varias tablas, secciones repetidas o páginas. Todos esos bloques son continuación del mismo listado y deben incluirse.
- Si \`total_rollos_declarado\` indica N, verificá antes de responder que \`rollos\` tenga N elementos. Si faltan, volvé a recorrer todos los bloques y páginas para incorporarlos.
- No inventes filas para completar N: si una fila es parcialmente ilegible, incluí igualmente el rollo con los campos visibles y usá \`null\` más confianza 0 para lo que no pueda leerse.

# HEADER (datos del lote/despacho, uno solo)

- numero_remito: número de la planilla. Aparece como "DESPACHO N°", "REMITO N°", "N° DE REMITO" o similar. Suele estar en una esquina, a veces con código de barras al lado.
- fecha: OBLIGATORIO formato ISO "YYYY-MM-DD" (año-mes-día, con guiones, 4 dígitos de año). NUNCA devolver con barras "/" ni en otro orden. En Argentina la planilla viene como DD/MM/YYYY (día primero, mes segundo) — SIEMPRE convertir. Año de 2 dígitos = 20YY. Ejemplos: "03/05/26" → "2026-05-03"; "3/5/2026" → "2026-05-03"; "03-05-2026" → "2026-05-03".
- color: color del lote a nivel header. Si la planilla declara un único color para TODA la planilla (caso típico: aparece en el header como "COLOR" o "PARTIDA EN COLOR"), ponelo acá. Si la planilla NO declara un color global y cada rollo tiene su propio color en una columna, dejá value: null acá y poné el color en cada rollo.
- ot: número de orden de trabajo de la tintorería ("OT", "O.T.", "ORDEN").
- rem_tejeduria: remito de tejeduría ("REM. TEJ.", "REM TEJEDURIA"), del proveedor de tela cruda.
- referencia: código interno (ej "SBI"), suele ser 2-5 letras.
- total_rollos_declarado: número total de rollos.
- total_kilos_declarado: kilos despachados (NO ingresados).

# POR CADA ROLLO

- numero_pieza: identificador del rollo. String, conservar ceros a la izquierda.
- kilos: peso en kg (decimal, punto NO coma).
- metros: largo en metros (decimal).
- ratio: rendimiento m/kg (decimal). A veces "Ratio", "Rdto", "Rto".
- gramaje_planilla: g/m² (peso por m²). Suele aparecer como "Pm2", "Gramaje", "g/m²".
- articulo: nombre del artículo/tela del rollo (ej "Algodón Pima", "Modal", "Lino"). Algunas planillas traen un único artículo en el header (en ese caso, copialo en todos los rollos). Otras traen una columna "Artículo" o "Tela" por rollo. Si no aparece en ninguna parte, devolvé value: null y confidence: 0.
- color: color del rollo (ej "BLANCO", "NEGRO", "AZUL FRANCIA"). Solo poné value si la planilla tiene una columna "Color" por rollo Y el color de este rollo difiere del color global del header. Si la planilla declara un único color global en el header (y los rollos no tienen columna propia), dejá value: null acá — el color global del header ya cubre el caso. Si no aparece en ninguna parte, devolvé value: null y confidence: 0.

# CONFIANZA

Cada campo tiene un campo "confidence" (0.0-1.0):
- 1.0 = clarísimo, sin ambigüedad
- 0.85-0.95 = legible con riesgo bajo (0/O, 5/S, 1/I confundibles)
- 0.5-0.85 = legible con dudas (mancha, decimal poco claro)
- 0.0-0.5 = casi ilegible, adiviné por contexto

Si un campo NO aparece, devolvé value: null y confidence: 0.

Devolvé solo el JSON. No agregues texto adicional.
`.trim()

export function buildPrompt(customPrompt: string | null): string {
  const pistasTintoreria = customPrompt?.trim()
  const pistas = pistasTintoreria
    ? `\n\n# PISTAS DE LAYOUT Y ALIAS DE ESTA TINTORERÍA\n\nEstas pistas complementan el contrato universal anterior y nunca lo reemplazan:\n\n${pistasTintoreria}`
    : ''

  return `${PROMPT_BASE}\n\n${UNIVERSAL_INSTRUCTIONS}${pistas}`
}
