-- =============================================================================
-- Migration 0007: atribución de Meta Lead Ads + teléfono normalizado
-- =============================================================================
-- Soporta el webhook de Meta Lead Ads (formularios instantáneos). Captura el
-- lead con su anuncio de origen — cierra la atribución del modo híbrido:
--   instant form (Meta) → lead con anuncio/campaña
--   Calendly            → mismo lead, agrega fecha de J1
-- El match entre ambos es por teléfono O email (el teléfono del instant
-- form está verificado por SMS, es la llave más confiable).
-- =============================================================================

BEGIN;

ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS meta_lead_id         TEXT,
  ADD COLUMN IF NOT EXISTS meta_ad_id           TEXT,
  ADD COLUMN IF NOT EXISTS meta_ad_name         TEXT,
  ADD COLUMN IF NOT EXISTS meta_campaign_name   TEXT,
  ADD COLUMN IF NOT EXISTS meta_adset_name      TEXT,
  ADD COLUMN IF NOT EXISTS origen_lead          TEXT,
  ADD COLUMN IF NOT EXISTS telefono_normalizado TEXT;

COMMENT ON COLUMN leads.meta_lead_id         IS 'leadgen_id del instant form de Meta. Único — un reintento del webhook no duplica.';
COMMENT ON COLUMN leads.meta_ad_id           IS 'ID del anuncio de Meta de donde vino el lead.';
COMMENT ON COLUMN leads.meta_ad_name         IS 'Nombre del anuncio (para tabla de anuncios ganadores).';
COMMENT ON COLUMN leads.meta_campaign_name   IS 'Nombre de la campaña de Meta.';
COMMENT ON COLUMN leads.meta_adset_name      IS 'Nombre del adset de Meta.';
COMMENT ON COLUMN leads.origen_lead          IS 'Por dónde entró el lead: instant_form | calendly | NULL (manual/desconocido).';
COMMENT ON COLUMN leads.telefono_normalizado IS 'Teléfono solo dígitos (sin +, espacios, guiones). Llave de match instant form ↔ Calendly.';

-- Único parcial: un leadgen_id solo puede existir una vez (reintentos de
-- Meta no duplican), pero múltiples NULL están permitidos.
CREATE UNIQUE INDEX IF NOT EXISTS idx_leads_meta_lead_id
  ON leads (meta_lead_id) WHERE meta_lead_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_leads_telefono_normalizado
  ON leads (telefono_normalizado) WHERE telefono_normalizado IS NOT NULL;

COMMIT;
