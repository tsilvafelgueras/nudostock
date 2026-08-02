-- ============================================================
-- Migración 064 — Tipos de falla configurables por empresa
--
-- Hasta ahora falla_categoria era un CHECK hardcodeado con 6 valores.
-- El cliente necesita poder agregar sus propias categorías (AGUJA,
-- BARRADO INTENSO, etc.) desde el panel de admin, sin esperar un deploy.
--
-- Cambios:
--   1) Crear tabla tipos_falla (id, empresa_id, nombre, activo, orden)
--   2) Eliminar el CHECK constraint de rollos.falla_categoria
--      (la validación pasa a nivel app, contra la tabla dinámica)
--   3) Seed de las categorías existentes + las nuevas solicitadas
--      para todas las empresas actuales
--
-- Idempotente.
-- ============================================================

-- 1) Tabla tipos_falla -------------------------------------------------

CREATE TABLE IF NOT EXISTS public.tipos_falla (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id UUID        NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  nombre     TEXT        NOT NULL,
  activo     BOOLEAN     NOT NULL DEFAULT TRUE,
  orden      INT         NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (empresa_id, nombre)
);

CREATE INDEX IF NOT EXISTS tipos_falla_empresa_idx
  ON public.tipos_falla (empresa_id, activo, orden);

ALTER TABLE public.tipos_falla ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Autenticados leen tipos_falla de su empresa"
  ON public.tipos_falla;
CREATE POLICY "Autenticados leen tipos_falla de su empresa"
  ON public.tipos_falla FOR SELECT TO authenticated
  USING (
    empresa_id = public.current_empresa_id()
    OR public.is_super_admin()
  );

DROP POLICY IF EXISTS "Admin gestiona tipos_falla"
  ON public.tipos_falla;
CREATE POLICY "Admin gestiona tipos_falla"
  ON public.tipos_falla FOR ALL TO authenticated
  USING (
    empresa_id = public.current_empresa_id()
    AND (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'admin'
  )
  WITH CHECK (
    empresa_id = public.current_empresa_id()
    AND (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'admin'
  );

DROP TRIGGER IF EXISTS set_empresa_tipos_falla ON public.tipos_falla;
CREATE TRIGGER set_empresa_tipos_falla
  BEFORE INSERT ON public.tipos_falla
  FOR EACH ROW EXECUTE FUNCTION public.set_empresa_id();

-- 2) Eliminar CHECK constraint hardcodeado de rollos ------------------

ALTER TABLE public.rollos
  DROP CONSTRAINT IF EXISTS rollos_falla_categoria_check;

-- 3) Normalizar datos históricos en rollos (snake_case → Title Case) --------
--    Los valores viejos eran internos; ahora falla_categoria guarda el nombre
--    visible directamente, que es la misma cadena que está en tipos_falla.nombre.

UPDATE public.rollos SET falla_categoria = 'Mancha'           WHERE falla_categoria = 'mancha';
UPDATE public.rollos SET falla_categoria = 'Agujero'          WHERE falla_categoria = 'agujero';
UPDATE public.rollos SET falla_categoria = 'Color disparejo'  WHERE falla_categoria = 'color_disparejo';
UPDATE public.rollos SET falla_categoria = 'Tono diferente'   WHERE falla_categoria = 'tono_diferente';
UPDATE public.rollos SET falla_categoria = 'Rotura de tejido' WHERE falla_categoria = 'rotura_tejido';
UPDATE public.rollos SET falla_categoria = 'Otro'             WHERE falla_categoria = 'otro';

-- 4) Seed: categorías históricas + nuevas para empresas existentes -----

INSERT INTO public.tipos_falla (empresa_id, nombre, orden)
SELECT e.id, v.nombre, v.orden
FROM public.empresas e
CROSS JOIN (VALUES
  ('Mancha',               1),
  ('Agujero',              2),
  ('Color disparejo',      3),
  ('Tono diferente',       4),
  ('Rotura de tejido',     5),
  ('Otro',                 6),
  ('Aguja',                7),
  ('Corte de elastano',    8),
  ('Teñido desparejo',     9),
  ('Barrado intenso',     10),
  ('Lycra invertida',     11),
  ('Falta de elasticidad',12),
  ('Marca de aguja',      13),
  ('Ancho fuera de medida',14)
) AS v(nombre, orden)
ON CONFLICT (empresa_id, nombre) DO NOTHING;
