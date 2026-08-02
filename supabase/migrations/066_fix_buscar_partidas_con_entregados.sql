-- ============================================================
-- Migración 066 — Fix buscar_partidas_con_entregados
--
-- Corrección de la función del módulo /devoluciones:
--   1) La versión 065 falló al crearse (columna i.color_id inexistente).
--   2) Agrega búsqueda por número de pedido (número de OT del pedido,
--      no del ingreso) usando EXISTS subquery.
--
-- También recrea rollos_entregados_por_ingreso por si tampoco se aplicó.
-- Idempotente — se puede correr múltiples veces sin riesgo.
-- ============================================================

-- 1) Búsqueda de partidas con rollos entregados (versión corregida) -----

CREATE OR REPLACE FUNCTION public.buscar_partidas_con_entregados(
  p_query text DEFAULT ''
)
RETURNS TABLE (
  ingreso_id        uuid,
  ot                text,
  numero_remito     text,
  fecha_despacho    date,
  tintoreria_nombre text,
  articulo_nombre   text,
  numero_lote       text,
  rollos_entregados bigint
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT
    i.id                                AS ingreso_id,
    i.ot,
    i.numero_remito,
    i.fecha_despacho,
    t.nombre                            AS tintoreria_nombre,
    a.nombre                            AS articulo_nombre,
    i.numero_lote,
    COUNT(r.id)                         AS rollos_entregados
  FROM ingresos i
  JOIN tintorerias t  ON t.id  = i.tintoreria_id
  JOIN articulos   a  ON a.id  = i.articulo_id
  JOIN rollos      r  ON r.ingreso_id = i.id AND r.estado = 'entregado'
  WHERE i.empresa_id = public.current_empresa_id()
    AND r.empresa_id = public.current_empresa_id()
    AND (
      p_query = ''
      OR i.ot            ILIKE '%' || p_query || '%'
      OR i.numero_remito ILIKE '%' || p_query || '%'
      OR i.numero_lote   ILIKE '%' || p_query || '%'
      OR EXISTS (
        SELECT 1
          FROM rollos      r2
          JOIN pedido_rollos pr2 ON pr2.rollo_id = r2.id
          JOIN pedidos       p2  ON p2.id = pr2.pedido_id
         WHERE r2.ingreso_id = i.id
           AND r2.estado     = 'entregado'
           AND p2.numero_pedido ILIKE '%' || p_query || '%'
           AND p2.empresa_id    = i.empresa_id
      )
    )
  GROUP BY i.id, i.ot, i.numero_remito, i.fecha_despacho,
           t.nombre, a.nombre, i.numero_lote
  HAVING COUNT(r.id) > 0
  ORDER BY i.fecha_despacho DESC
  LIMIT 50;
$$;

GRANT EXECUTE ON FUNCTION public.buscar_partidas_con_entregados(text)
  TO authenticated;

-- 2) Rollos entregados de un ingreso (por si tampoco se creó en 065) ----

CREATE OR REPLACE FUNCTION public.rollos_entregados_por_ingreso(
  p_ingreso_id uuid
)
RETURNS TABLE (
  rollo_id      uuid,
  numero_pieza  text,
  kilos         numeric,
  metros        numeric,
  pedido_numero text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT
    r.id               AS rollo_id,
    r.numero_pieza,
    r.kilos,
    r.metros,
    p.numero_pedido    AS pedido_numero
  FROM rollos r
  JOIN pedido_rollos pr ON pr.rollo_id    = r.id
                       AND pr.devuelto_at IS NULL
                       AND pr.liberado_at IS NULL
  JOIN pedidos p        ON p.id           = pr.pedido_id
  WHERE r.ingreso_id  = p_ingreso_id
    AND r.estado      = 'entregado'
    AND r.empresa_id  = public.current_empresa_id()
  ORDER BY r.numero_pieza;
$$;

GRANT EXECUTE ON FUNCTION public.rollos_entregados_por_ingreso(uuid)
  TO authenticated;
