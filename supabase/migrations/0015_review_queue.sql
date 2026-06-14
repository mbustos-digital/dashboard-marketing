-- =============================================================================
-- 0015 — review_queue: agendamientos de J2 sin lead que matchee (Fase 10)
-- =============================================================================
-- Cuando alguien agenda la Junta 2 en Calendly pero no encontramos su lead
-- (ni por teléfono ni por email), NO creamos un lead desde la J2 — lo dejamos
-- en esta cola para resolver a mano desde el tab Hoy (Fase 11).
--
-- Seguro de re-ejecutar.
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS review_queue (
  id              BIGSERIAL PRIMARY KEY,
  tipo            TEXT NOT NULL,          -- 'j2_sin_match' (extensible)
  email           TEXT,
  nombre          TEXT,
  fecha_evento    DATE,
  payload_resumen JSONB,
  resuelto        BOOLEAN NOT NULL DEFAULT FALSE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_review_queue_pendientes
  ON review_queue (resuelto, created_at);

COMMENT ON TABLE review_queue IS
  'Cola de revisión manual. Hoy: J2 agendadas en Calendly sin lead que matchee (tipo j2_sin_match). Se resuelven desde el tab Hoy (Fase 11).';

ALTER TABLE review_queue ENABLE ROW LEVEL SECURITY;

COMMIT;
