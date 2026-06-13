-- =============================================================================
-- Migration 0009: Meta a nivel anuncio + presupuestos diarios de adsets
-- =============================================================================
-- (Implementación v2, Fase 1 — cubre #4 y #7)
--
-- El cron pasa de level=adset a level=ad: una fila por ANUNCIO por día.
-- Los anuncios particionan el adset, así que las queries que SUMAN filas
-- siguen dando los mismos totales. Las filas viejas quedan con ad_id NULL.
--
-- Las métricas de video (3s, thruplay, cuartiles) habilitan el diagnóstico
-- de consumo del panel Recon (Fase 17). leads_count habilita la señal de
-- INTENCIÓN. adset_budget_daily habilita la señal de RITMO (gasto vs techo).
-- =============================================================================

BEGIN;

-- a) Columnas nuevas a nivel anuncio + video
ALTER TABLE marketing_metrics_daily
  ADD COLUMN IF NOT EXISTS ad_id                   TEXT,
  ADD COLUMN IF NOT EXISTS ad_name                 TEXT,
  ADD COLUMN IF NOT EXISTS leads_count             BIGINT,
  ADD COLUMN IF NOT EXISTS video_3s_views          BIGINT,
  ADD COLUMN IF NOT EXISTS video_thruplay          BIGINT,
  ADD COLUMN IF NOT EXISTS video_p25               BIGINT,
  ADD COLUMN IF NOT EXISTS video_p50               BIGINT,
  ADD COLUMN IF NOT EXISTS video_p75               BIGINT,
  ADD COLUMN IF NOT EXISTS video_p100              BIGINT,
  ADD COLUMN IF NOT EXISTS video_avg_watch_seconds NUMERIC(10,2);

COMMENT ON COLUMN marketing_metrics_daily.ad_id        IS 'ID del anuncio (level=ad desde Fase 1 v2). NULL en filas históricas a nivel adset.';
COMMENT ON COLUMN marketing_metrics_daily.ad_name      IS 'Nombre del anuncio.';
COMMENT ON COLUMN marketing_metrics_daily.leads_count  IS 'Leads del instant form según Insights (action_type lead u onsite_conversion.lead_grouped — nunca ambos sumados).';
COMMENT ON COLUMN marketing_metrics_daily.video_3s_views IS 'Vistas de 3 segundos (action_type video_view).';
COMMENT ON COLUMN marketing_metrics_daily.video_thruplay IS 'ThruPlays (15s o video completo).';

-- b) Extender el UNIQUE para que dos ads del mismo adset no choquen
DROP INDEX IF EXISTS idx_mmd_unique;
CREATE UNIQUE INDEX idx_mmd_unique
  ON marketing_metrics_daily (
    fecha,
    plataforma,
    COALESCE(adset_id, ''),
    COALESCE(ad_id, ''),
    COALESCE(youtube_video_id, '')
  );

-- c) Presupuestos diarios de adsets (señal de RITMO de la metodología Recon)
-- El budget queda en MXN crudo A PROPÓSITO: el pacing compara gasto MXN
-- contra techo MXN — convertir ambos a USD solo agregaría ruido de redondeo.
CREATE TABLE IF NOT EXISTS adset_budget_daily (
  fecha            DATE NOT NULL,
  adset_id         TEXT NOT NULL,
  adset_name       TEXT,
  daily_budget_mxn NUMERIC(12,2),
  status           TEXT,
  PRIMARY KEY (fecha, adset_id)
);

COMMENT ON TABLE adset_budget_daily IS
  'Techo de presupuesto diario por adset, capturado por el cron (Meta solo expone el valor ACTUAL — no hay histórico hacia atrás).';

ALTER TABLE adset_budget_daily ENABLE ROW LEVEL SECURITY;

COMMIT;
