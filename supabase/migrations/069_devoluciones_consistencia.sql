-- ============================================================
-- Migración 069 — Consistencia integral del módulo devoluciones
--
-- - Unifica la definición de "rollo devolvible": estado entregado y una
--   asignación activa en pedido_rollos.
-- - Hace que búsqueda de partidas y detalle usen exactamente ese criterio.
-- - Devuelve toda la información del rollo desde SQL, evitando embeds de
--   PostgREST ambiguos con colores.
-- - Agrega búsqueda por varios candidatos y tolerancia a ceros iniciales.
-- - Restringe las tres RPC a operario/admin de la empresa autenticada.
--
-- Idempotente: DROP + CREATE.
-- ============================================================

DROP FUNCTION IF EXISTS public.buscar_rollo_entregado_por_codigos(text[]);
DROP FUNCTION IF EXISTS public.buscar_partidas_con_entregados(text);
DROP FUNCTION IF EXISTS public.rollos_entregados_por_ingreso(uuid);

-- 1) Buscar un rollo egresado por uno o más candidatos -----------------

CREATE FUNCTION public.buscar_rollo_entregado_por_codigos(
  p_codigos text[]
)
RETURNS TABLE (
  rollo_id      uuid,
  numero_pieza  text,
  kilos         numeric,
  metros        numeric,
  articulo      text,
  color         text,
  ingreso_id    uuid,
  numero_lote   text,
  tintoreria    text,
  pedido_numero text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  WITH caller AS (
    SELECT empresa_id
      FROM profiles
     WHERE id = auth.uid()
       AND role IN ('operario', 'admin')
  ),
  codigos AS (
    SELECT DISTINCT
      btrim(c.codigo) AS codigo,
      CASE
        WHEN btrim(c.codigo) ~ '^[0-9]+$'
          THEN COALESCE(NULLIF(ltrim(btrim(c.codigo), '0'), ''), '0')
        ELSE NULL
      END AS codigo_numerico
    FROM unnest(COALESCE(p_codigos, ARRAY[]::text[])) AS c(codigo)
    WHERE length(btrim(c.codigo)) BETWEEN 1 AND 128
  )
  SELECT
    r.id,
    r.numero_pieza,
    r.kilos,
    r.metros,
    COALESCE(a.nombre, '—'),
    COALESCE(co.nombre, '—'),
    r.ingreso_id,
    i.numero_lote,
    COALESCE(t.nombre, '—'),
    p.numero_pedido
  FROM caller
  JOIN rollos r
    ON r.empresa_id = caller.empresa_id
   AND r.estado = 'entregado'
  JOIN pedido_rollos pr
    ON pr.rollo_id = r.id
   AND pr.devuelto_at IS NULL
   AND pr.liberado_at IS NULL
  JOIN pedidos p
    ON p.id = pr.pedido_id
   AND p.empresa_id = caller.empresa_id
  LEFT JOIN ingresos i ON i.id = r.ingreso_id
  LEFT JOIN articulos a ON a.id = r.articulo_id
  LEFT JOIN colores co ON co.id = r.color_id
  LEFT JOIN tintorerias t ON t.id = i.tintoreria_id
  WHERE EXISTS (
    SELECT 1
      FROM codigos c
     WHERE btrim(r.numero_pieza) = c.codigo
        OR (
          btrim(r.numero_pieza) ~ '^[0-9]+$'
          AND COALESCE(NULLIF(ltrim(btrim(r.numero_pieza), '0'), ''), '0')
              = c.codigo_numerico
        )
  )
  ORDER BY
    EXISTS (
      SELECT 1 FROM codigos c WHERE btrim(r.numero_pieza) = c.codigo
    ) DESC,
    r.numero_pieza
  LIMIT 2;
$$;

GRANT EXECUTE ON FUNCTION public.buscar_rollo_entregado_por_codigos(text[])
  TO authenticated;

-- 2) Buscar partidas que realmente tienen rollos devolvibles -----------

CREATE FUNCTION public.buscar_partidas_con_entregados(
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
  WITH caller AS (
    SELECT empresa_id
      FROM profiles
     WHERE id = auth.uid()
       AND role IN ('operario', 'admin')
  )
  SELECT
    i.id,
    i.ot,
    i.numero_remito,
    i.fecha_despacho,
    COALESCE(t.nombre, '—'),
    COALESCE(a.nombre, '—'),
    i.numero_lote,
    COUNT(DISTINCT r.id)::bigint
  FROM caller
  JOIN ingresos i ON i.empresa_id = caller.empresa_id
  JOIN rollos r
    ON r.ingreso_id = i.id
   AND r.empresa_id = caller.empresa_id
   AND r.estado = 'entregado'
  JOIN pedido_rollos pr
    ON pr.rollo_id = r.id
   AND pr.devuelto_at IS NULL
   AND pr.liberado_at IS NULL
  JOIN pedidos p
    ON p.id = pr.pedido_id
   AND p.empresa_id = caller.empresa_id
  LEFT JOIN tintorerias t ON t.id = i.tintoreria_id
  LEFT JOIN articulos a ON a.id = i.articulo_id
  WHERE
    btrim(COALESCE(p_query, '')) = ''
    OR i.ot ILIKE '%' || btrim(p_query) || '%'
    OR i.numero_lote ILIKE '%' || btrim(p_query) || '%'
    OR p.numero_pedido ILIKE '%' || btrim(p_query) || '%'
  GROUP BY
    i.id,
    i.ot,
    i.numero_remito,
    i.fecha_despacho,
    t.nombre,
    a.nombre,
    i.numero_lote
  ORDER BY i.fecha_despacho DESC NULLS LAST
  LIMIT 50;
$$;

GRANT EXECUTE ON FUNCTION public.buscar_partidas_con_entregados(text)
  TO authenticated;

-- 3) Detalle de partida con el mismo universo de rollos ----------------

CREATE FUNCTION public.rollos_entregados_por_ingreso(
  p_ingreso_id uuid
)
RETURNS TABLE (
  rollo_id      uuid,
  numero_pieza  text,
  kilos         numeric,
  metros        numeric,
  articulo      text,
  color         text,
  ingreso_id    uuid,
  numero_lote   text,
  tintoreria    text,
  pedido_numero text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  WITH caller AS (
    SELECT empresa_id
      FROM profiles
     WHERE id = auth.uid()
       AND role IN ('operario', 'admin')
  )
  SELECT
    r.id,
    r.numero_pieza,
    r.kilos,
    r.metros,
    COALESCE(a.nombre, '—'),
    COALESCE(co.nombre, '—'),
    r.ingreso_id,
    i.numero_lote,
    COALESCE(t.nombre, '—'),
    p.numero_pedido
  FROM caller
  JOIN rollos r
    ON r.empresa_id = caller.empresa_id
   AND r.ingreso_id = p_ingreso_id
   AND r.estado = 'entregado'
  JOIN pedido_rollos pr
    ON pr.rollo_id = r.id
   AND pr.devuelto_at IS NULL
   AND pr.liberado_at IS NULL
  JOIN pedidos p
    ON p.id = pr.pedido_id
   AND p.empresa_id = caller.empresa_id
  LEFT JOIN ingresos i ON i.id = r.ingreso_id
  LEFT JOIN articulos a ON a.id = r.articulo_id
  LEFT JOIN colores co ON co.id = r.color_id
  LEFT JOIN tintorerias t ON t.id = i.tintoreria_id
  ORDER BY r.numero_pieza;
$$;

GRANT EXECUTE ON FUNCTION public.rollos_entregados_por_ingreso(uuid)
  TO authenticated;

NOTIFY pgrst, 'reload schema';
