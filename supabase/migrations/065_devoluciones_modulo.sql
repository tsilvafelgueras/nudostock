-- ============================================================
-- Migración 065 — Módulo de devoluciones
--
-- Agrega dos funciones para el nuevo módulo /devoluciones:
--
--   1) devolver_rollos_deposito(p_items jsonb, p_motivo text)
--      Devuelve múltiples rollos entregados al mismo tiempo,
--      con soporte opcional para marcarlos como segunda calidad.
--      Cada ítem: {rollo_id uuid, segunda boolean, falla_categoria text}.
--      Diferencia con las RPCs existentes (062-063): acepta segunda=true
--      y falla_categoria, y agrega traza al comentario del rollo.
--
--   2) buscar_partidas_con_entregados(p_query text)
--      Busca ingresos que tengan rollos en estado 'entregado' para la
--      empresa del caller. p_query busca en ot y numero_remito (ILIKE).
--
-- Los RPCs existentes devolver_rollos_pedido y devolver_rollo_por_rollo_id
-- (migrations 062-063) no se modifican.
--
-- Idempotente.
-- ============================================================

-- 1) RPC principal del módulo devoluciones ----------------------------

CREATE OR REPLACE FUNCTION public.devolver_rollos_deposito(
  p_items  jsonb,
  p_motivo text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_role  text;
  v_empresa_id   uuid;
  v_item         jsonb;
  v_rollo_id     uuid;
  v_segunda      boolean;
  v_falla        text;
  v_pr_id        uuid;
  v_pedido_id    uuid;
  v_numero_ped   text;
  v_numero_pieza text;
  v_nuevo_estado text;
  v_comentario   text;
  v_devueltos    integer := 0;
  v_errores      jsonb   := '[]'::jsonb;
  v_motivo_norm  text;
BEGIN
  SELECT role, empresa_id INTO v_caller_role, v_empresa_id
    FROM profiles WHERE id = auth.uid();

  IF v_caller_role NOT IN ('operario', 'admin') THEN
    RAISE EXCEPTION 'Solo el operario o el admin pueden devolver rollos.';
  END IF;

  v_motivo_norm := NULLIF(trim(COALESCE(p_motivo, '')), '');

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items)
  LOOP
    v_rollo_id := (v_item->>'rollo_id')::uuid;
    v_segunda  := COALESCE((v_item->>'segunda')::boolean, false);
    v_falla    := NULLIF(trim(COALESCE(v_item->>'falla_categoria', '')), '');

    -- Buscar el pedido_rollo activo del rollo
    SELECT pr.id, pr.pedido_id, p.numero_pedido, r.numero_pieza
      INTO v_pr_id, v_pedido_id, v_numero_ped, v_numero_pieza
      FROM pedido_rollos pr
      JOIN pedidos  p ON p.id  = pr.pedido_id
      JOIN rollos   r ON r.id  = pr.rollo_id
     WHERE pr.rollo_id    = v_rollo_id
       AND pr.devuelto_at IS NULL
       AND pr.liberado_at IS NULL
       AND r.estado       = 'entregado'
       AND r.empresa_id   = v_empresa_id
       AND p.empresa_id   = v_empresa_id
     LIMIT 1
     FOR UPDATE OF pr, r;

    IF NOT FOUND THEN
      v_errores := v_errores || jsonb_build_object(
        'rollo_id', v_rollo_id,
        'error',    'Rollo no encontrado o no está en estado entregado'
      );
      CONTINUE;
    END IF;

    -- Determinar nuevo estado
    v_nuevo_estado := CASE WHEN v_segunda THEN 'segunda' ELSE 'en_stock' END;

    -- Actualizar pedido_rollos
    UPDATE pedido_rollos
       SET devuelto_at     = now(),
           devuelto_motivo = COALESCE(v_motivo_norm, 'devolucion_cliente'),
           liberado_at     = now(),
           liberado_motivo = 'devolucion_cliente'
     WHERE id = v_pr_id;

    -- Construir texto de trazabilidad para el comentario
    v_comentario := 'DEVUELTO ' || to_char(now(), 'DD/MM/YYYY')
      || CASE WHEN v_motivo_norm IS NOT NULL THEN ': ' || v_motivo_norm ELSE '' END;

    -- Actualizar rollo
    UPDATE rollos
       SET estado          = v_nuevo_estado,
           ubicacion       = 'Sin ubicar',
           falla_categoria = CASE WHEN v_segunda THEN v_falla ELSE falla_categoria END,
           comentario      = CASE
             WHEN comentario IS NULL OR comentario = ''
               THEN v_comentario
             ELSE comentario || E'\n' || v_comentario
           END
     WHERE id = v_rollo_id
       AND estado = 'entregado';

    -- Notificación para el operario
    PERFORM public.notificar_rollo_devuelto(
      v_empresa_id, v_numero_pieza, v_numero_ped
    );

    -- Log de movimiento
    PERFORM public.log_movimiento(
      v_empresa_id,
      'pedido_rollo',
      v_pr_id,
      'devolver_rollo',
      jsonb_build_object(
        'pedido_id',      v_pedido_id,
        'rollo_id',       v_rollo_id,
        'numero_pieza',   v_numero_pieza,
        'motivo',         v_motivo_norm,
        'segunda',        v_segunda,
        'falla_categoria', v_falla
      )
    );

    v_devueltos := v_devueltos + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'devueltos', v_devueltos,
    'errores',   v_errores
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.devolver_rollos_deposito(jsonb, text)
  TO authenticated;

-- 2) Búsqueda de partidas con rollos entregados -----------------------

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

-- 3) Función auxiliar para obtener rollos entregados de un ingreso ----

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
