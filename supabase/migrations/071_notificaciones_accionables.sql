-- ============================================================
-- Migracion 071 - Notificaciones accionables
--
-- Vincula los avisos de rollos liberados/devueltos con el rollo concreto
-- para abrir directamente la asignacion de ubicacion. La notificacion se
-- resuelve automaticamente cuando el rollo deja de estar "Sin ubicar".
-- ============================================================

ALTER TABLE public.notificaciones
  ADD COLUMN IF NOT EXISTS rollo_id uuid
  REFERENCES public.rollos(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_notificaciones_rollo_activas
  ON public.notificaciones (rollo_id)
  WHERE rollo_id IS NOT NULL AND resuelta_at IS NULL;

-- Recupera la referencia de las notificaciones existentes. numero_pieza es
-- unico por empresa, por lo que identifica al rollo sin ambiguedad.
UPDATE public.notificaciones n
   SET rollo_id = r.id
  FROM public.rollos r
 WHERE n.rollo_id IS NULL
   AND n.empresa_id = r.empresa_id
   AND (
     (
       n.tipo = 'rollo_liberado'
       AND starts_with(n.mensaje, 'El rollo ' || r.numero_pieza || ' fue quitado')
     )
     OR
     (
       n.tipo = 'rollo_devuelto'
       AND starts_with(n.mensaje, 'El rollo ' || r.numero_pieza || ' del pedido')
     )
   );

-- Conserva las firmas existentes para no modificar las RPC que llaman a los
-- helpers. La referencia se obtiene con empresa + numero de pieza.
CREATE OR REPLACE FUNCTION public.notificar_rollo_liberado(
  p_empresa_id uuid,
  p_numero_pieza text,
  p_numero_pedido text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rollo_id uuid;
BEGIN
  SELECT r.id
    INTO v_rollo_id
    FROM public.rollos r
   WHERE r.empresa_id = p_empresa_id
     AND r.numero_pieza = p_numero_pieza
   LIMIT 1;

  INSERT INTO public.notificaciones (
    empresa_id, tipo, titulo, mensaje, rollo_id
  )
  VALUES (
    p_empresa_id,
    'rollo_liberado',
    'Rollo liberado de pedido',
    'El rollo ' || COALESCE(p_numero_pieza, '?')
      || ' fue quitado del pedido ' || COALESCE(p_numero_pedido, '-')
      || ' y volvio a stock como "Sin ubicar". Asignale una ubicacion.',
    v_rollo_id
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.notificar_rollo_devuelto(
  p_empresa_id uuid,
  p_numero_pieza text,
  p_numero_pedido text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rollo_id uuid;
BEGIN
  SELECT r.id
    INTO v_rollo_id
    FROM public.rollos r
   WHERE r.empresa_id = p_empresa_id
     AND r.numero_pieza = p_numero_pieza
   LIMIT 1;

  INSERT INTO public.notificaciones (
    empresa_id, tipo, titulo, mensaje, rollo_id
  )
  VALUES (
    p_empresa_id,
    'rollo_devuelto',
    'Rollo devuelto al stock',
    'El rollo ' || COALESCE(p_numero_pieza, '?')
      || ' del pedido ' || COALESCE(p_numero_pedido, '-')
      || ' fue devuelto por el cliente y volvio a stock como "Sin ubicar". Asignale una ubicacion.',
    v_rollo_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.notificar_rollo_liberado(uuid, text, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.notificar_rollo_liberado(uuid, text, text)
  TO authenticated;

REVOKE ALL ON FUNCTION public.notificar_rollo_devuelto(uuid, text, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.notificar_rollo_devuelto(uuid, text, text)
  TO authenticated;

-- Cierra el aviso por la causa real, sin depender de marcarlo manualmente
-- como leido desde la campanita.
CREATE OR REPLACE FUNCTION public.resolver_notificaciones_reubicacion_rollo()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF OLD.ubicacion IS DISTINCT FROM NEW.ubicacion
     AND NULLIF(trim(COALESCE(NEW.ubicacion, '')), '') IS NOT NULL
     AND lower(trim(NEW.ubicacion)) <> 'sin ubicar'
  THEN
    UPDATE public.notificaciones
       SET leida_at = COALESCE(leida_at, now()),
           resuelta_at = now()
     WHERE rollo_id = NEW.id
       AND tipo IN ('rollo_liberado', 'rollo_devuelto')
       AND resuelta_at IS NULL;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS resolver_notificaciones_reubicacion_rollo
  ON public.rollos;
CREATE TRIGGER resolver_notificaciones_reubicacion_rollo
  AFTER UPDATE OF ubicacion ON public.rollos
  FOR EACH ROW
  EXECUTE FUNCTION public.resolver_notificaciones_reubicacion_rollo();

REVOKE ALL ON FUNCTION public.resolver_notificaciones_reubicacion_rollo()
  FROM PUBLIC;

-- Si un aviso viejo ya fue atendido antes de aplicar esta migracion, lo deja
-- correctamente cerrado en el historial.
UPDATE public.notificaciones n
   SET leida_at = COALESCE(n.leida_at, now()),
       resuelta_at = now()
  FROM public.rollos r
 WHERE n.rollo_id = r.id
   AND n.tipo IN ('rollo_liberado', 'rollo_devuelto')
   AND n.resuelta_at IS NULL
   AND NULLIF(trim(COALESCE(r.ubicacion, '')), '') IS NOT NULL
   AND lower(trim(r.ubicacion)) <> 'sin ubicar';

NOTIFY pgrst, 'reload schema';
