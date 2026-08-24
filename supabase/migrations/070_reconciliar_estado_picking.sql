-- ============================================================
-- Migracion 070 - Reconciliar estado de picking completo
--
-- Corrige pedidos que tienen todos sus rollos pickeados pero conservan
-- estado pendiente/en_preparacion. La inconsistencia podia aparecer al
-- quitar una linea de pedido_partidas: el total solicitado disminuia,
-- pero la RPC solo contemplaba regresar de lista a en_preparacion.
-- ============================================================

-- Mantiene el estado consistente cuando cambia la composicion solicitada
-- del pedido (alta, edicion o baja de una pedido_partida).
CREATE OR REPLACE FUNCTION public.sincronizar_estado_picking_por_partidas()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pedido_id uuid;
  v_estado text;
  v_total integer;
  v_pickeados integer;
  v_pendientes integer;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_pedido_id := OLD.pedido_id;
  ELSE
    v_pedido_id := NEW.pedido_id;
  END IF;

  SELECT estado
    INTO v_estado
    FROM pedidos
   WHERE id = v_pedido_id
   FOR UPDATE;

  IF NOT FOUND OR v_estado NOT IN ('pendiente', 'en_preparacion', 'lista') THEN
    RETURN NULL;
  END IF;

  SELECT
    COALESCE(SUM(pp.rollos_solicitados), 0)::integer,
    COALESCE(
      SUM(LEAST(pp.rollos_solicitados, COALESCE(asignados.cantidad, 0))),
      0
    )::integer
    INTO v_total, v_pickeados
    FROM pedido_partidas pp
    LEFT JOIN LATERAL (
      SELECT COUNT(*)::integer AS cantidad
        FROM pedido_rollos pr
       WHERE pr.pedido_partida_id = pp.id
         AND pr.rollo_id IS NOT NULL
         AND pr.pickeado_at IS NOT NULL
         AND pr.liberado_at IS NULL
    ) asignados ON TRUE
   WHERE pp.pedido_id = v_pedido_id;

  v_pendientes := GREATEST(v_total - v_pickeados, 0);

  IF v_total > 0
     AND v_pendientes = 0
     AND v_estado IN ('pendiente', 'en_preparacion')
  THEN
    UPDATE pedidos SET estado = 'lista' WHERE id = v_pedido_id;
  ELSIF v_pendientes > 0 AND v_estado = 'lista' THEN
    UPDATE pedidos SET estado = 'en_preparacion' WHERE id = v_pedido_id;
  END IF;

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS sincronizar_estado_picking_por_partidas
  ON public.pedido_partidas;
CREATE TRIGGER sincronizar_estado_picking_por_partidas
  AFTER INSERT OR UPDATE OR DELETE ON public.pedido_partidas
  FOR EACH ROW
  EXECUTE FUNCTION public.sincronizar_estado_picking_por_partidas();

REVOKE ALL ON FUNCTION public.sincronizar_estado_picking_por_partidas()
  FROM PUBLIC;


-- Recuperacion explicita para pedidos que ya quedaron desincronizados.
-- Solo permite finalizar cuando cada linea solicitada esta realmente
-- cubierta por rollos activos y con pickeado_at.
CREATE OR REPLACE FUNCTION public.finalizar_picking_pedido(
  p_pedido_id uuid
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_role text;
  v_empresa_id uuid;
  v_pedido_empresa uuid;
  v_estado text;
  v_total integer;
  v_pickeados integer;
  v_pendientes integer;
BEGIN
  SELECT role, empresa_id
    INTO v_caller_role, v_empresa_id
    FROM profiles
   WHERE id = auth.uid();

  IF v_caller_role IS NULL
     OR v_empresa_id IS NULL
     OR v_caller_role NOT IN ('operario', 'admin')
  THEN
    RAISE EXCEPTION 'Solo deposito o admin pueden aceptar el picking.';
  END IF;

  SELECT estado, empresa_id
    INTO v_estado, v_pedido_empresa
    FROM pedidos
   WHERE id = p_pedido_id
   FOR UPDATE;

  IF NOT FOUND OR v_pedido_empresa IS DISTINCT FROM v_empresa_id THEN
    RAISE EXCEPTION 'Pedido no encontrado.';
  END IF;

  IF v_estado NOT IN ('pendiente', 'en_preparacion', 'lista') THEN
    RAISE EXCEPTION 'Este pedido ya no se puede finalizar (estado: %).', v_estado;
  END IF;

  SELECT
    COALESCE(SUM(pp.rollos_solicitados), 0)::integer,
    COALESCE(
      SUM(LEAST(pp.rollos_solicitados, COALESCE(asignados.cantidad, 0))),
      0
    )::integer
    INTO v_total, v_pickeados
    FROM pedido_partidas pp
    LEFT JOIN LATERAL (
      SELECT COUNT(*)::integer AS cantidad
        FROM pedido_rollos pr
       WHERE pr.pedido_partida_id = pp.id
         AND pr.rollo_id IS NOT NULL
         AND pr.pickeado_at IS NOT NULL
         AND pr.liberado_at IS NULL
    ) asignados ON TRUE
   WHERE pp.pedido_id = p_pedido_id;

  IF v_total <= 0 THEN
    RAISE EXCEPTION 'El pedido no tiene rollos solicitados.';
  END IF;

  v_pendientes := GREATEST(v_total - v_pickeados, 0);

  IF v_pendientes > 0 THEN
    RAISE EXCEPTION 'Todavia faltan % rollos por pickear.', v_pendientes;
  END IF;

  IF v_estado <> 'lista' THEN
    UPDATE pedidos SET estado = 'lista' WHERE id = p_pedido_id;

    PERFORM public.log_movimiento(
      v_empresa_id,
      'pedido',
      p_pedido_id,
      'finalizar_picking_pedido',
      jsonb_build_object(
        'estado_anterior', v_estado,
        'total', v_total,
        'pickeados', v_pickeados
      )
    );
  END IF;

  RETURN json_build_object(
    'total', v_total,
    'pickeados', v_pickeados,
    'pendientes', v_pendientes,
    'pedido_completo', TRUE
  );
END;
$$;

REVOKE ALL ON FUNCTION public.finalizar_picking_pedido(uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.finalizar_picking_pedido(uuid)
  TO authenticated;

-- Repara los pedidos que ya estaban completos al aplicar la migracion.
WITH completitud AS (
  SELECT
    p.id AS pedido_id,
    COALESCE(SUM(pp.rollos_solicitados), 0)::integer AS total,
    COALESCE(
      SUM(LEAST(pp.rollos_solicitados, COALESCE(asignados.cantidad, 0))),
      0
    )::integer AS pickeados
  FROM pedidos p
  JOIN pedido_partidas pp ON pp.pedido_id = p.id
  LEFT JOIN LATERAL (
    SELECT COUNT(*)::integer AS cantidad
      FROM pedido_rollos pr
     WHERE pr.pedido_partida_id = pp.id
       AND pr.rollo_id IS NOT NULL
       AND pr.pickeado_at IS NOT NULL
       AND pr.liberado_at IS NULL
  ) asignados ON TRUE
  WHERE p.estado IN ('pendiente', 'en_preparacion')
  GROUP BY p.id
)
UPDATE pedidos p
   SET estado = 'lista'
  FROM completitud c
 WHERE p.id = c.pedido_id
   AND c.total > 0
   AND c.pickeados >= c.total;

NOTIFY pgrst, 'reload schema';
