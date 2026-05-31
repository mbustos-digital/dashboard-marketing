-- =============================================================================
-- Migration 0002: extender CHECK de youtube_video_type
-- =============================================================================
-- Razón: en la página de Thanks de Mauricio hay 2 videos:
--   - thanks_prep (40 seg, alcance de página)
--   - thanks (9 min, intent real, etapa 5 del funnel)
-- El esquema original solo permitía 'vsl' y 'thanks'. Agregamos 'thanks_prep'.
-- =============================================================================

BEGIN;

ALTER TABLE marketing_metrics_daily
  DROP CONSTRAINT IF EXISTS marketing_metrics_daily_youtube_video_type_check;

ALTER TABLE marketing_metrics_daily
  ADD CONSTRAINT marketing_metrics_daily_youtube_video_type_check
  CHECK (youtube_video_type IN ('vsl', 'thanks', 'thanks_prep') OR youtube_video_type IS NULL);

COMMIT;
