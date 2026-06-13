-- =============================================================================
-- Migration 0010: Panda Video como fuente del VSL + columnas de video genéricas
-- =============================================================================
-- (Implementación v2, Fase 5 — cubre #28 y #29)
--
-- YouTube no contaba como vista la mayoría de los embeds con autoplay, por eso
-- la etapa Landing→VSL daba 0%. Con el VSL migrado a Panda, traemos las
-- métricas del player real. La serie del VSL se unifica vía columnas genéricas
-- (video_*) para que sea una sola sin importar el proveedor:
--   youtube (24-abr a 10-jun, historia) + panda (presente).
-- =============================================================================

BEGIN;

-- a) Extender el CHECK de plataforma para admitir 'panda'
ALTER TABLE marketing_metrics_daily
  DROP CONSTRAINT IF EXISTS marketing_metrics_daily_plataforma_check;
ALTER TABLE marketing_metrics_daily
  ADD CONSTRAINT marketing_metrics_daily_plataforma_check
  CHECK (plataforma IN ('meta', 'youtube', 'panda'));

-- b) Columnas genéricas de video (nullable) — sirven a youtube y panda
ALTER TABLE marketing_metrics_daily
  ADD COLUMN IF NOT EXISTS video_variant         TEXT,
  ADD COLUMN IF NOT EXISTS video_plays           BIGINT,
  ADD COLUMN IF NOT EXISTS video_unique_viewers  BIGINT,
  ADD COLUMN IF NOT EXISTS video_retention_p25   NUMERIC(6,2),
  ADD COLUMN IF NOT EXISTS video_retention_p50   NUMERIC(6,2),
  ADD COLUMN IF NOT EXISTS video_retention_p75   NUMERIC(6,2),
  ADD COLUMN IF NOT EXISTS video_retention_p95   NUMERIC(6,2);
-- video_id y video_avg_watch_seconds ya existen (0009). Si no, agregarlas:
ALTER TABLE marketing_metrics_daily
  ADD COLUMN IF NOT EXISTS video_id              TEXT;

COMMENT ON COLUMN marketing_metrics_daily.video_id      IS 'ID del video (genérico, cruza proveedores). En youtube = youtube_video_id; en panda = video_external_id.';
COMMENT ON COLUMN marketing_metrics_daily.video_variant IS 'Variante A/B (el id del video). Separa variantes cuando hay test.';
COMMENT ON COLUMN marketing_metrics_daily.video_plays   IS 'Plays del día (serie unificada youtube+panda).';

-- c) Backfill suave de las filas youtube existentes → serie unificada
UPDATE marketing_metrics_daily
SET video_id = youtube_video_id,
    video_plays = youtube_views
WHERE plataforma = 'youtube'
  AND video_id IS NULL
  AND youtube_video_id IS NOT NULL;

-- d) El UNIQUE INDEX debe contemplar video_id para que panda no choque con
-- youtube del mismo día/video. Lo extendemos con COALESCE(video_id, '').
DROP INDEX IF EXISTS idx_mmd_unique;
CREATE UNIQUE INDEX idx_mmd_unique
  ON marketing_metrics_daily (
    fecha,
    plataforma,
    COALESCE(adset_id, ''),
    COALESCE(ad_id, ''),
    COALESCE(youtube_video_id, ''),
    COALESCE(video_id, '')
  );

COMMIT;
