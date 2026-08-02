// Constantes y tipos compartidos entre server actions (actions.ts) y
// componentes cliente (StockList, RolloDetailDialog). NO va en actions.ts
// porque ese archivo tiene 'use server' y Next solo permite exports de
// funciones async desde ahí — cualquier constante exportada queda como
// `undefined` en el bundle del cliente y rompe en runtime con
// "x.includes is not a function" / similar.

// Los tipos de falla son ahora dinámicos (tabla tipos_falla).
// Se pasan como prop desde el server component en lugar de estar hardcodeados.
export type TipoFallaOption = { id: string; nombre: string }

// Estados que se pueden setear desde el form de edición. "reservado" /
// "entregado" no se exponen porque dependen de pedidos/picking. "baja" sí
// se permite — algunos usuarios prefieren dar de baja desde el form en
// lugar de usar el botón dedicado.
export const ESTADOS_EDITABLES = [
  'pendiente',
  'en_stock',
  'segunda',
  'baja',
] as const
export type EstadoEditable = (typeof ESTADOS_EDITABLES)[number]
