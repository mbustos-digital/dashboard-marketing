-- =============================================================================
-- 0013 — Estado del lead, motivo de pérdida (Fase 8)
-- =============================================================================
-- Hasta hoy el desenlace de un lead vivía en el booleano `cerro` (Sí/No/—),
-- que mezclaba "perdido" (lo trabajamos y no compró) con "descalificado" (no
-- era buen fit) y NO guardaba el motivo. Esta migración introduce un estado
-- explícito de 4 valores + el motivo libre, y backfillea desde `cerro`.
--
-- `cerro` se MANTIENE (las queries de Revenue lo siguen leyendo). lib/leads.ts
-- mantiene ambos coherentes al guardar (ver updateLead): la migración a
-- estado_lead puede ser gradual.
--
-- Además: agrega dias_promedio_ciclo a v_cohortes_semanales para que el KPI de
-- no-show de Comercial pueda tener UNA sola fuente de verdad a nivel semanal
-- (ver FIX no-show, Fase 8).
--
-- Seguro de re-ejecutar: IF NOT EXISTS / OR REPLACE / guards de columna.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1) estado_lead + motivo_perdida
-- -----------------------------------------------------------------------------
ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS estado_lead    TEXT NOT NULL DEFAULT 'abierto',
  ADD COLUMN IF NOT EXISTS motivo_perdida TEXT;

-- CHECK de dominio (lo agregamos aparte para poder usar IF NOT EXISTS lógico)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'leads_estado_lead_check'
  ) THEN
    ALTER TABLE leads
      ADD CONSTRAINT leads_estado_lead_check
      CHECK (estado_lead IN ('abierto', 'ganado', 'perdido', 'descalificado'));
  END IF;
END$$;

-- Backfill desde el booleano actual:
--   cerro = TRUE  -> ganado
--   cerro = FALSE -> perdido
--   cerro = NULL  -> abierto (ya es el default, no hace falta tocar)
UPDATE leads SET estado_lead = 'ganado'  WHERE cerro = TRUE  AND estado_lead = 'abierto';
UPDATE leads SET estado_lead = 'perdido' WHERE cerro = FALSE AND estado_lead = 'abierto';

CREATE INDEX IF NOT EXISTS idx_leads_estado_lead ON leads (estado_lead);

COMMENT ON COLUMN leads.estado_lead IS
  'Desenlace del lead: abierto (en proceso) / ganado (cerró) / perdido (lo trabajamos y no compró) / descalificado (no era fit). Coherente con cerro vía updateLead.';
COMMENT ON COLUMN leads.motivo_perdida IS
  'Por qué se perdió o descalificó (texto libre). Solo aplica a perdido/descalificado.';

-- -----------------------------------------------------------------------------
-- 2) dias_promedio_ciclo en v_cohortes_semanales
-- -----------------------------------------------------------------------------
-- Idéntica a la original + la columna de ciclo (AVG fecha_cierre - fecha_junta_1
-- sobre los cerrados). Permite que getResumenComercialMaduras agregue TODO a
-- nivel semanal — una sola fuente de verdad para el KPI y las tablas.
CREATE OR REPLACE VIEW v_cohortes_semanales AS
WITH base AS (
  SELECT
    DATE_TRUNC('week', fecha_junta_1)::DATE                                                  AS semana_inicio,
    COUNT(*)                                                                                 AS total_j1,
    COUNT(*) FILTER (WHERE asistio_j1 = TRUE)                                                AS asistencias,
    COUNT(*) FILTER (WHERE asistio_j1 = TRUE AND calificado = TRUE)                          AS limpias,
    COUNT(*) FILTER (WHERE cerro = TRUE)                                                     AS cierres,
    COALESCE(SUM(monto_cierre_usd) FILTER (WHERE cerro = TRUE), 0)                           AS ingreso_total_usd,
    MAX(fecha_junta_1)                                                                       AS ultima_j1_cohorte,
    AVG(fecha_cierre - fecha_junta_1) FILTER (WHERE cerro = TRUE AND fecha_cierre IS NOT NULL) AS dias_promedio_ciclo_raw
  FROM leads
  WHERE fecha_junta_1 IS NOT NULL
  GROUP BY DATE_TRUNC('week', fecha_junta_1)
)
SELECT
  semana_inicio,
  total_j1,
  asistencias,
  limpias,
  cierres,
  ingreso_total_usd,
  ultima_j1_cohorte,
  (CURRENT_DATE - ultima_j1_cohorte)                                                         AS dias_desde_ultima_j1,
  -- estado_madurez antes que dias_promedio_ciclo: CREATE OR REPLACE VIEW exige
  -- conservar las columnas previas en su orden y agregar las nuevas al final.
  CASE
    WHEN (CURRENT_DATE - ultima_j1_cohorte) >= 14 THEN 'madura'
    WHEN (CURRENT_DATE - ultima_j1_cohorte) >= 5  THEN 'madurando'
    ELSE 'reciente'
  END                                                                                        AS estado_madurez,
  ROUND(dias_promedio_ciclo_raw::NUMERIC, 1)                                                 AS dias_promedio_ciclo
FROM base
ORDER BY semana_inicio DESC;

COMMENT ON VIEW v_cohortes_semanales IS
  'Cohortes comerciales por semana de Junta 1. Lee leads. Estado de madurez según días desde el último J1 de la cohorte. Incluye días promedio de ciclo (J1 → cierre).';

COMMIT;
