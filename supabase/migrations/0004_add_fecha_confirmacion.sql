-- =============================================================================
-- Migration 0004: agregar fecha_confirmacion a leads
-- =============================================================================
-- Razón: el ciclo de venta real tiene una fecha de "confirmación verbal" del
-- cliente, que ocurre entre la Junta 2 y el primer pago. Es la fecha en que
-- el cliente dice "sí, voy", aunque todavía no haya transferido dinero.
--
-- Útil para:
--   - Medir el SCL (Sales Cycle Length) real con más precisión
--   - Separar "vendido pero no cobrado" del "vendido y cobrado"
--   - Ver cuánto tarda un cliente confirmado en hacer el primer pago
-- =============================================================================

BEGIN;

ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS fecha_confirmacion DATE;

COMMENT ON COLUMN leads.fecha_confirmacion IS
  'Fecha en que el cliente confirmó verbalmente el cierre (entre J2 y primer pago). Opcional.';

COMMIT;
