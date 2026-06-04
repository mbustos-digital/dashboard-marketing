-- =============================================================================
-- Migration 0003: agregar columnas UTM a leads
-- =============================================================================
-- Razón: Calendly ya manda los UTMs en el webhook (lo verificamos con la cita
-- de prueba). El handler en app/api/webhooks/calendly/route.ts ahora los
-- extrae y los guarda. Estos 4 campos permiten atribuir cada lead al
-- adset/campaña/contenido específico desde donde llegó.
--
-- Comportamiento:
--   - Lead que llega vía Calendly con UTMs → se guardan los 4
--   - Lead orgánico (sin UTMs) → los 4 quedan en NULL, sin romper nada
--   - Lead que ya existía con UTMs y vuelve a updatearse sin ellos →
--     los UTMs existentes NO se sobrescriben con null
-- =============================================================================

BEGIN;

ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS utm_source   TEXT,
  ADD COLUMN IF NOT EXISTS utm_medium   TEXT,
  ADD COLUMN IF NOT EXISTS utm_campaign TEXT,
  ADD COLUMN IF NOT EXISTS utm_content  TEXT;

COMMENT ON COLUMN leads.utm_source   IS 'Origen del tráfico (ej: facebook, google, instagram). Viene del webhook de Calendly.';
COMMENT ON COLUMN leads.utm_medium   IS 'Medio (ej: paid_social, organic, email). Viene del webhook de Calendly.';
COMMENT ON COLUMN leads.utm_campaign IS 'Campaña específica (ej: vsl-coaching-may2026). Viene del webhook de Calendly.';
COMMENT ON COLUMN leads.utm_content  IS 'Variante de creativo o ad específico. Viene del webhook de Calendly.';

CREATE INDEX IF NOT EXISTS idx_leads_utm_campaign
  ON leads (utm_campaign) WHERE utm_campaign IS NOT NULL;

COMMIT;
