-- =============================================================================
-- Migration 0008: tracking de visualización del VSL
-- =============================================================================
-- La landing (Lovable, multiplicatusresultados.com) manda un POST a
-- /api/track/vsl cuando alguien reproduce el VSL, con un UUID anónimo que
-- vive en la cookie nqe_visitor_id.
--
-- Ese mismo UUID viaja como utm_term cuando la persona agenda en Calendly —
-- así cruzamos el visitante anónimo con el lead: leads.visitor_id.
--
-- Uso (Fase 7): en la ficha del lead mostramos cuántas veces vio el VSL, y
-- marcamos a los que agendaron sin verlo (se saltaron el filtro).
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS vsl_events (
  id          BIGSERIAL PRIMARY KEY,
  visitor_id  TEXT NOT NULL,
  event       TEXT NOT NULL DEFAULT 'vsl_play',
  play_count  INT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE vsl_events IS
  'Eventos de visualización del VSL desde la landing (Lovable). visitor_id = UUID anónimo de la cookie nqe_visitor_id.';
COMMENT ON COLUMN vsl_events.visitor_id IS 'UUID anónimo del visitante (cookie nqe_visitor_id en la landing).';
COMMENT ON COLUMN vsl_events.event      IS 'Tipo de evento. Por ahora solo vsl_play.';
COMMENT ON COLUMN vsl_events.play_count IS 'Número de play de esa sesión según la landing (1 = primera vez).';

CREATE INDEX IF NOT EXISTS idx_vsl_events_visitor_id ON vsl_events (visitor_id);

-- RLS igual que el resto de tablas: solo service_role escribe/lee
ALTER TABLE vsl_events ENABLE ROW LEVEL SECURITY;

-- Campo de cruce en leads
ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS visitor_id TEXT;

COMMENT ON COLUMN leads.visitor_id IS
  'UUID anónimo de la landing (llega como utm_term al agendar en Calendly). Cruza con vsl_events.';

CREATE INDEX IF NOT EXISTS idx_leads_visitor_id
  ON leads (visitor_id) WHERE visitor_id IS NOT NULL;

COMMIT;
