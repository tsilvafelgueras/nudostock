import 'server-only'

export const REPORTES_SCHEMA = `
TABLAS DISPONIBLES PARA REPORTES

empresas
- id uuid PK
- nombre text
- activo boolean
- created_at timestamptz

profiles
- id uuid PK, referencia a auth.users
- nombre text
- role text: operario | ventas | admin | super
- empresa_id uuid
- created_at timestamptz

articulos
- id uuid PK
- empresa_id uuid
- nombre text
- descripcion text
- activo boolean
- stock_minimo_kg numeric, legado; el minimo vigente por color vive en articulo_colores.stock_minimo_kg
- created_at timestamptz

colores
- id uuid PK
- empresa_id uuid
- nombre text
- activo boolean
- created_at timestamptz

articulo_colores
- empresa_id uuid
- articulo_id uuid -> articulos.id
- color_id uuid -> colores.id
- stock_minimo_kg numeric
- created_at timestamptz
- PK compuesta: articulo_id, color_id

tintorerias
- id uuid PK
- nombre text
- reader_type text: qr | barcode | null
- created_at timestamptz

empresa_tintorerias
- empresa_id uuid -> empresas.id
- tintoreria_id uuid -> tintorerias.id
- activo boolean
- fecha_baja timestamptz
- created_at timestamptz
- PK compuesta: empresa_id, tintoreria_id

ingresos
- id uuid PK
- empresa_id uuid
- tintoreria_id uuid -> tintorerias.id
- articulo_id uuid -> articulos.id
- fecha_despacho date
- numero_remito text
- numero_lote text; en UI se muestra como partida
- total_rollos_declarado integer
- total_kilos_declarado numeric
- estado text: borrador | auditado | confirmado
- origen text: manual | planilla_ia
- ot text
- rem_tejeduria text
- referencia text
- conteo_fisico integer
- conteo_nota text
- kilos_crudo_enviado numeric
- kilos_crudo_cargado_at timestamptz
- kilos_crudo_cargado_por uuid
- created_by uuid -> profiles.id
- created_at timestamptz

rollos
- id uuid PK
- empresa_id uuid
- ingreso_id uuid -> ingresos.id
- articulo_id uuid -> articulos.id
- color_id uuid -> colores.id
- numero_pieza text
- ubicacion text
- pantone text
- kilos numeric
- metros numeric
- rinde numeric
- kilos_propios numeric
- metros_propios numeric
- ancho_propio numeric
- gramaje_propio numeric
- gramaje_planilla numeric
- estado text: pendiente | en_stock | reservado | entregado | baja | segunda
- falla_categoria text: valor libre configurado por la empresa en tabla tipos_falla (ej. Mancha, Agujero, Aguja, Barrado intenso, etc.) | null
- falla_descripcion text
- confianza_ia numeric
- comentario text
- auditado_at timestamptz
- auditado_por uuid
- created_at timestamptz

clientes
- id uuid PK
- empresa_id uuid
- nombre text
- activo boolean
- estado_cliente text: activo | inactivo | potencial
- condicion_pago text: contado | cuenta_corriente | 30_dias | 60_dias | 90_dias | null
- categoria_precio text: minorista | mayorista | precio_especial | null
- vendedor_asignado text
- created_by uuid -> profiles.id
- created_at timestamptz

pedidos
- id uuid PK
- empresa_id uuid
- numero_pedido text
- cliente text, nombre denormalizado
- cliente_id uuid -> clientes.id
- numero_remito_externo text
- numero_remito_salida text
- fecha_entrega_comprometida date
- estado text: pendiente | en_preparacion | lista | confirmada_egreso | entregada legacy | cancelada
- nota: lista significa pedido listo; confirmada_egreso es el cierre operativo de la venta
- confirmada_egreso_at timestamptz
- confirmada_egreso_por uuid
- salida_comentario text
- caida_motivo text: cliente_cancelo | precio | otro_proveedor | sin_respuesta | otro | null
- caida_comentario text
- caida_at timestamptz
- caida_por uuid
- created_by uuid -> profiles.id
- created_at timestamptz

pedido_rollos
- id uuid PK
- empresa_id uuid
- pedido_id uuid -> pedidos.id
- pedido_partida_id uuid -> pedido_partidas.id
- rollo_id uuid -> rollos.id, rollo real asignado por deposito
- pickeado_at timestamptz
- liberado_at timestamptz
- liberado_motivo text
- created_at timestamptz

pedido_partidas
- id uuid PK
- empresa_id uuid
- pedido_id uuid -> pedidos.id
- ingreso_id uuid -> ingresos.id, partida solicitada
- articulo_id uuid -> articulos.id
- color_id uuid -> colores.id
- rollos_solicitados integer
- kilos_estimados numeric, proyeccion interna; no lo presentes como kilos reales de venta
- created_at timestamptz

pedidos_pendientes
- id uuid PK
- empresa_id uuid
- cliente text
- cliente_id uuid -> clientes.id
- articulo_id uuid -> articulos.id
- color text, legado
- color_id uuid -> colores.id
- metros_estimados numeric
- kilos_estimados numeric
- tipo_demanda text: pedido_a_producir | demanda_sin_stock
- prioridad text: critica | alta | programada | flexible
- fecha_requerida date
- notas text
- estado text: activo | resuelto | cancelado
- created_by uuid
- created_at timestamptz
- resolved_at timestamptz

muestras
- id uuid PK
- empresa_id uuid
- rollo_id uuid -> rollos.id
- cliente text
- kilos_descontados numeric
- motivo text
- vinculado_a_pedido_id uuid -> pedidos.id
- created_by uuid -> profiles.id
- created_at timestamptz

movimientos
- id uuid PK
- empresa_id uuid
- entidad text
- entidad_id uuid
- accion text
- usuario_id uuid
- detalle jsonb
- created_at timestamptz

notificaciones
- id uuid PK
- empresa_id uuid
- tipo text
- titulo text
- mensaje text
- articulo_id uuid -> articulos.id
- color_id uuid -> colores.id
- leida_at timestamptz
- resuelta_at timestamptz
- created_at timestamptz

RELACIONES FRECUENTES
- stock disponible: rollos.estado = 'en_stock'
- articulo y color de un rollo: rollos.articulo_id -> articulos.id, rollos.color_id -> colores.id
- origen/tintoreria de un rollo: rollos.ingreso_id -> ingresos.id -> tintorerias.id
- partidas solicitadas de un pedido: pedidos.id -> pedido_partidas.pedido_id
- rollos reales de un pedido: pedidos.id -> pedido_rollos.pedido_id -> rollos.id, ignorar pedido_rollos liberados cuando liberado_at no es null
- kilos reales de un pedido/venta: sumar rollos.kilos desde pedido_rollos activos. Para pedidos sin picking, responder en rollos solicitados y decir que los kilos reales quedan pendientes.
- demandas sin stock: pedidos_pendientes.estado = 'activo'
- partida/lote: ingresos.numero_lote; usar la palabra "partida" al responder
- merma real de tintoreria por partida: ingresos.kilos_crudo_enviado vs SUM(rollos.kilos) de ese ingreso
- stock minimo vigente: articulo_colores.stock_minimo_kg comparado contra SUM(rollos.kilos) en_stock por articulo_id + color_id

REGLAS
- No uses extraction_prompt, imagen_url, foto_url ni datos de contacto detallados.
- No filtres por empresa_id manualmente salvo que sea una relacion necesaria; RLS ya aisla la empresa del usuario.
- Cuando agregues por articulo/color, mostra nombres usando articulos.nombre y colores.nombre.
- Para periodos, created_at suele medir cuando se cargo el registro; fecha_despacho mide fecha del remito/partida.
`.trim()
