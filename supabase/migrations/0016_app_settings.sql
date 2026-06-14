-- =============================================================================
-- 0016 — app_settings: configuración editable desde la UI (Fase 14)
-- =============================================================================
-- Objetivo GLOBAL del negocio (no mensual): cerrar N leads y juntar USD de
-- cash collected, acumulado desde una fecha de arranque. Editable desde Vista
-- General sin deploy.
--
-- Seguro de re-ejecutar.
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS app_settings (
  key        TEXT PRIMARY KEY,
  value      TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE app_settings IS
  'Pares clave/valor editables desde la UI. Hoy: objetivo global (cierres, cash, fecha de arranque). Fase 14.';

INSERT INTO app_settings (key, value) VALUES
  ('objetivo_cierres',  '14'),
  ('objetivo_cash_usd', '20000'),
  ('objetivo_desde',    '2025-12-08')
ON CONFLICT (key) DO NOTHING;

ALTER TABLE app_settings ENABLE ROW LEVEL SECURITY;

COMMIT;
