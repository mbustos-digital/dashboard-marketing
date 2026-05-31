-- =============================================================================
-- Migration 0001: Esquema inicial del Dashboard Marketing + Comercial
-- =============================================================================
-- Crea:
--   - Tabla marketing_metrics_daily (métricas de Meta Ads + YouTube, una fila/día)
--   - Tabla leads (funnel comercial, captura manual en Fase 4)
--   - Función + triggers de auto-update de updated_at
--   - Vistas v_cohortes_semanales y v_cohortes_mensuales (agregaciones por J1)
--   - Row Level Security activado (sin policies; service_role bypassa, anon bloqueado)
--
-- Seguro de re-ejecutar: usa IF NOT EXISTS y OR REPLACE.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- Tabla: marketing_metrics_daily
-- Una fila por día, por plataforma (meta/youtube), por adset (Meta) o video (YouTube).
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS marketing_metrics_daily (
  id                          BIGSERIAL PRIMARY KEY,
  fecha                       DATE NOT NULL,
  plataforma                  TEXT NOT NULL CHECK (plataforma IN ('meta', 'youtube')),

  -- Identificadores Meta
  ad_account_id               TEXT,
  campaign_id                 TEXT,
  campaign_name               TEXT,
  adset_id                    TEXT,
  adset_name                  TEXT,

  -- Métricas top funnel (Meta)
  impressions                 BIGINT,
  reach                       BIGINT,
  frequency                   NUMERIC(10, 4),
  clicks                      BIGINT,
  link_clicks                 BIGINT,
  ctr                         NUMERIC(10, 4),
  cpc                         NUMERIC(10, 4),
  cpm                         NUMERIC(10, 4),
  spend                       NUMERIC(12, 2),

  -- Métricas Pixel (Meta)
  landing_page_views          BIGINT,
  page_views                  BIGINT,
  cost_per_landing_page_view  NUMERIC(10, 4),

  -- Específicos YouTube
  youtube_video_id            TEXT,
  youtube_video_type          TEXT CHECK (youtube_video_type IN ('vsl', 'thanks') OR youtube_video_type IS NULL),
  youtube_views               BIGINT,
  youtube_minutes_watched     NUMERIC(12, 2),
  youtube_avg_view_duration   NUMERIC(10, 2),

  -- Debug: payload crudo de la API (para reconstruir si algo sale raro)
  raw_payload                 JSONB,

  -- Auditoría
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE marketing_metrics_daily IS
  'Métricas diarias agregadas de Meta Ads (a nivel adset) y YouTube Analytics (a nivel video). Ingestadas por crons en Vercel.';

-- UNIQUE evita duplicar la misma fila día/plataforma/adset/video al re-ingestar
-- COALESCE permite que NULL no rompa unique (Meta usa adset_id+NULL video; YouTube al revés)
CREATE UNIQUE INDEX IF NOT EXISTS idx_mmd_unique
  ON marketing_metrics_daily (
    fecha,
    plataforma,
    COALESCE(adset_id, ''),
    COALESCE(youtube_video_id, '')
  );

CREATE INDEX IF NOT EXISTS idx_mmd_fecha       ON marketing_metrics_daily (fecha);
CREATE INDEX IF NOT EXISTS idx_mmd_plataforma  ON marketing_metrics_daily (plataforma);
CREATE INDEX IF NOT EXISTS idx_mmd_adset       ON marketing_metrics_daily (adset_id) WHERE adset_id IS NOT NULL;

-- -----------------------------------------------------------------------------
-- Tabla: leads
-- Funnel comercial. Captura manual via UI en Fase 4. NO sincroniza con Calendly ni con tu pipeline en Sheets.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS leads (
  id                  BIGSERIAL PRIMARY KEY,
  nombre              TEXT NOT NULL,
  email               TEXT,
  telefono            TEXT,
  empresa             TEXT,

  -- Fechas del ciclo comercial
  fecha_agenda        DATE,
  fecha_junta_1       DATE,
  fecha_junta_2       DATE,

  -- Outcomes (booleanos para distinguir "aún no sé" (NULL) de "no" (false))
  asistio_j1          BOOLEAN,
  asistio_j2          BOOLEAN,
  calificado          BOOLEAN,
  cerro               BOOLEAN,

  -- Cierre
  monto_cierre_usd    NUMERIC(10, 2),
  fecha_cierre        DATE,

  -- Atribución (para enlazar con marketing_metrics_daily.adset_id cuando tengamos UTMs)
  adset_id_origen     TEXT,

  -- Auditoría
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE leads IS
  'Leads del funnel comercial. Captura manual via UI en Fase 4. No se conecta a Calendly ni al pipeline en Sheets de mi-crm.';
COMMENT ON COLUMN leads.fecha_agenda      IS 'Cuándo agendó la Junta 1 (típicamente via Calendly).';
COMMENT ON COLUMN leads.fecha_junta_1     IS 'Fecha real de Junta 1. Es el anchor de las cohortes comerciales.';
COMMENT ON COLUMN leads.asistio_j1        IS 'TRUE = se presentó a J1. FALSE = no show. NULL = aún no pasa o aún no marcado.';
COMMENT ON COLUMN leads.calificado        IS 'TRUE = en J1 confirmaste que es lead calificado (potencial real). NULL hasta que tengas J1.';
COMMENT ON COLUMN leads.cerro             IS 'TRUE solo si firmó/cerró cliente. FALSE = decidió que no. NULL = aún en proceso.';
COMMENT ON COLUMN leads.adset_id_origen   IS 'ID del adset de Meta de donde vino (para atribuir; requiere UTMs).';

CREATE INDEX IF NOT EXISTS idx_leads_fecha_j1     ON leads (fecha_junta_1) WHERE fecha_junta_1 IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_leads_fecha_cierre ON leads (fecha_cierre)  WHERE fecha_cierre  IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_leads_adset_origen ON leads (adset_id_origen) WHERE adset_id_origen IS NOT NULL;

-- -----------------------------------------------------------------------------
-- Función + triggers: auto-update de updated_at
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_mmd_updated_at   ON marketing_metrics_daily;
CREATE TRIGGER trg_mmd_updated_at
  BEFORE UPDATE ON marketing_metrics_daily
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_leads_updated_at ON leads;
CREATE TRIGGER trg_leads_updated_at
  BEFORE UPDATE ON leads
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- -----------------------------------------------------------------------------
-- Vista: v_cohortes_semanales
-- Agrupa leads por semana de fecha_junta_1. Estado de madurez = días desde el
-- último J1 de la cohorte:
--   madura     ≥14 días  (puedes confiar en la tasa de cierre)
--   madurando  5-13 días (parcial)
--   reciente   <5 días   (no juzgar todavía)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE VIEW v_cohortes_semanales AS
WITH base AS (
  SELECT
    DATE_TRUNC('week', fecha_junta_1)::DATE                                                  AS semana_inicio,
    COUNT(*)                                                                                 AS total_j1,
    COUNT(*) FILTER (WHERE asistio_j1 = TRUE)                                                AS asistencias,
    COUNT(*) FILTER (WHERE asistio_j1 = TRUE AND calificado = TRUE)                          AS limpias,
    COUNT(*) FILTER (WHERE cerro = TRUE)                                                     AS cierres,
    COALESCE(SUM(monto_cierre_usd) FILTER (WHERE cerro = TRUE), 0)                           AS ingreso_total_usd,
    MAX(fecha_junta_1)                                                                       AS ultima_j1_cohorte
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
  CASE
    WHEN (CURRENT_DATE - ultima_j1_cohorte) >= 14 THEN 'madura'
    WHEN (CURRENT_DATE - ultima_j1_cohorte) >= 5  THEN 'madurando'
    ELSE 'reciente'
  END                                                                                        AS estado_madurez
FROM base
ORDER BY semana_inicio DESC;

COMMENT ON VIEW v_cohortes_semanales IS
  'Cohortes comerciales por semana de Junta 1. Lee leads. Estado de madurez según días desde el último J1 de la cohorte.';

-- -----------------------------------------------------------------------------
-- Vista: v_cohortes_mensuales
-- Igual que la semanal, más dias_promedio_ciclo (promedio fecha_cierre - fecha_junta_1).
-- -----------------------------------------------------------------------------
CREATE OR REPLACE VIEW v_cohortes_mensuales AS
WITH base AS (
  SELECT
    DATE_TRUNC('month', fecha_junta_1)::DATE                                                 AS mes_inicio,
    COUNT(*)                                                                                 AS total_j1,
    COUNT(*) FILTER (WHERE asistio_j1 = TRUE)                                                AS asistencias,
    COUNT(*) FILTER (WHERE asistio_j1 = TRUE AND calificado = TRUE)                          AS limpias,
    COUNT(*) FILTER (WHERE cerro = TRUE)                                                     AS cierres,
    COALESCE(SUM(monto_cierre_usd) FILTER (WHERE cerro = TRUE), 0)                           AS ingreso_total_usd,
    MAX(fecha_junta_1)                                                                       AS ultima_j1_cohorte,
    AVG(fecha_cierre - fecha_junta_1) FILTER (WHERE cerro = TRUE AND fecha_cierre IS NOT NULL) AS dias_promedio_ciclo_raw
  FROM leads
  WHERE fecha_junta_1 IS NOT NULL
  GROUP BY DATE_TRUNC('month', fecha_junta_1)
)
SELECT
  mes_inicio,
  total_j1,
  asistencias,
  limpias,
  cierres,
  ingreso_total_usd,
  ultima_j1_cohorte,
  (CURRENT_DATE - ultima_j1_cohorte)                                                         AS dias_desde_ultima_j1,
  ROUND(dias_promedio_ciclo_raw::NUMERIC, 1)                                                 AS dias_promedio_ciclo,
  CASE
    WHEN (CURRENT_DATE - ultima_j1_cohorte) >= 14 THEN 'madura'
    WHEN (CURRENT_DATE - ultima_j1_cohorte) >= 5  THEN 'madurando'
    ELSE 'reciente'
  END                                                                                        AS estado_madurez
FROM base
ORDER BY mes_inicio DESC;

COMMENT ON VIEW v_cohortes_mensuales IS
  'Cohortes comerciales por mes de Junta 1. Incluye días promedio de ciclo (J1 → cierre).';

-- -----------------------------------------------------------------------------
-- Row Level Security
-- Activamos RLS en ambas tablas SIN policies. El service_role (usado por el server
-- en Vercel) bypassa RLS por diseño, así que el dashboard sigue funcionando. La
-- anon key (pública) queda bloqueada → nadie de internet puede leer/escribir.
-- Cuando quieras exponer algo al cliente, agregaremos policies específicas.
-- -----------------------------------------------------------------------------
ALTER TABLE marketing_metrics_daily ENABLE ROW LEVEL SECURITY;
ALTER TABLE leads                    ENABLE ROW LEVEL SECURITY;

COMMIT;
