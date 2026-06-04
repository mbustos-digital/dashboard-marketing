-- =============================================================================
-- Migration 0005: agregar campos de cobranza a leads
-- =============================================================================
-- Razón: el campo existente monto_cierre_usd representa lo VENDIDO, no lo
-- COBRADO. En el modelo de Mauricio el cliente firma un cierre por un monto
-- total, pero el dinero entra escalonado (primer pago + planes a plazos).
-- Estos campos permiten separar revenue vendido de cash collected y montar
-- el tab Revenue (Prompt 4).
--
-- Convención: todos los montos en USD (igual que monto_cierre_usd existente).
--
-- NO se toca monto_cierre_usd ni la lógica de cierre — estos campos son
-- nuevos y ortogonales.
-- =============================================================================

BEGIN;

ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS fecha_primer_pago     DATE,
  ADD COLUMN IF NOT EXISTS monto_primer_pago     NUMERIC,
  ADD COLUMN IF NOT EXISTS total_cobrado_usd     NUMERIC,
  ADD COLUMN IF NOT EXISTS fecha_inicio_servicio DATE;

COMMENT ON COLUMN leads.fecha_primer_pago     IS 'Fecha real en que entró el primer pago (transferencia, depósito, etc).';
COMMENT ON COLUMN leads.monto_primer_pago     IS 'Monto del primer pago en USD. Suele ser menor al monto_cierre_usd cuando hay plan.';
COMMENT ON COLUMN leads.total_cobrado_usd     IS 'Acumulado cobrado HASTA HOY en USD. Se actualiza manualmente conforme entran pagos.';
COMMENT ON COLUMN leads.fecha_inicio_servicio IS 'Cuándo arrancó efectivamente el programa con el cliente.';

CREATE INDEX IF NOT EXISTS idx_leads_fecha_primer_pago
  ON leads (fecha_primer_pago) WHERE fecha_primer_pago IS NOT NULL;

COMMIT;
