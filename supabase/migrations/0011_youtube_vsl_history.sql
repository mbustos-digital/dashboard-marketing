-- =============================================================================
-- Migration 0011: histórico diario del VSL en su etapa de YouTube
-- =============================================================================
-- (Implementación v2, Fase 6 — cubre #27)
--
-- El VSL estuvo en YouTube del 24-abr al 10-jun antes de migrar a Panda.
-- Sembramos las dos series diarias recuperadas (vistas + duración media) para
-- que la card del VSL y la etapa del funnel no arranquen de cero: la serie
-- es una sola (youtube historia → panda presente).
--
-- Idempotente: WHERE NOT EXISTS por fecha + plataforma=youtube + ese video_id,
-- así no pisa ni duplica días que el cron o un backfill previo ya cargaron.
-- Total YouTube esperado: 121 plays (pico de 14 el 20-may).
-- =============================================================================

BEGIN;

INSERT INTO marketing_metrics_daily (
  fecha, plataforma,
  youtube_video_id, youtube_video_type, youtube_views, youtube_avg_view_duration,
  video_id, video_plays, video_avg_watch_seconds,
  raw_payload
)
SELECT
  v.fecha::date, 'youtube',
  'bdhLgtC_Z0s', 'vsl', v.vistas, v.dur,
  'bdhLgtC_Z0s', v.vistas, v.dur,
  jsonb_build_object('source', 'youtube-history-seed')
FROM (VALUES
  ('2026-04-24', 0, 0),    ('2026-04-25', 3, 298),  ('2026-04-26', 0, 0),
  ('2026-04-27', 1, 1419), ('2026-04-28', 1, 167),  ('2026-04-29', 4, 45),
  ('2026-04-30', 0, 0),    ('2026-05-01', 0, 0),    ('2026-05-02', 0, 0),
  ('2026-05-03', 0, 0),    ('2026-05-04', 0, 0),    ('2026-05-05', 0, 0),
  ('2026-05-06', 0, 0),    ('2026-05-07', 0, 0),    ('2026-05-08', 0, 0),
  ('2026-05-09', 2, 10),   ('2026-05-10', 0, 0),    ('2026-05-11', 0, 0),
  ('2026-05-12', 2, 415),  ('2026-05-13', 2, 47),   ('2026-05-14', 1, 1005),
  ('2026-05-15', 3, 43),   ('2026-05-16', 5, 224),  ('2026-05-17', 1, 19),
  ('2026-05-18', 0, 0),    ('2026-05-19', 9, 227),  ('2026-05-20', 14, 465),
  ('2026-05-21', 2, 24),   ('2026-05-22', 2, 57),   ('2026-05-23', 3, 1011),
  ('2026-05-24', 11, 387), ('2026-05-25', 4, 841),  ('2026-05-26', 2, 807),
  ('2026-05-27', 2, 34),   ('2026-05-28', 7, 422),  ('2026-05-29', 0, 0),
  ('2026-05-30', 5, 464),  ('2026-05-31', 4, 299),  ('2026-06-01', 2, 102),
  ('2026-06-02', 3, 139),  ('2026-06-03', 5, 455),  ('2026-06-04', 1, 353),
  ('2026-06-05', 2, 204),  ('2026-06-06', 4, 400),  ('2026-06-07', 7, 51),
  ('2026-06-08', 3, 73),   ('2026-06-09', 3, 28),   ('2026-06-10', 1, 5)
) AS v(fecha, vistas, dur)
WHERE NOT EXISTS (
  SELECT 1 FROM marketing_metrics_daily m
  WHERE m.fecha = v.fecha::date
    AND m.plataforma = 'youtube'
    AND m.youtube_video_id = 'bdhLgtC_Z0s'
);

COMMIT;
