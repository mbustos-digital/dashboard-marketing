-- =============================================================================
-- 0014 — Plan de pagos y cuotas (Fase 8-bis)
-- =============================================================================
-- El cash collected real de un mes incluye cuotas que entran de clientes
-- cerrados en meses anteriores. Hasta hoy el modelo guardaba un único
-- total_cobrado + fecha_primer_pago sueltos, así que esas cuotas no se
-- contaban en el mes en que realmente entran.
--
-- Esta migración estructura la cobranza por cuotas:
--   - leads gana las columnas del PLAN (cobro inicial, monto de cuota, número
--     de cuotas, día de pago comprometido).
--   - tabla `pagos`: una fila por movimiento esperado (numero=0 cobro inicial,
--     1..6 cuotas), con su fecha esperada y si ya entró.
--
-- A partir de acá:
--   - cash de un período = Σ monto_usd de pagos pagado=true con fecha_pago en
--     el período (lib/queries.getRevenuePeriod).
--   - total_cobrado_usd del lead se DERIVA de sus pagos pagados (se mantiene
--     sincronizado desde lib/pagos.ts).
--   - outstanding = Σ pagos no pagados.
--
-- Seguro de re-ejecutar.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1) Columnas del plan en leads
-- -----------------------------------------------------------------------------
ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS cobro_inicial_usd NUMERIC(12, 2),
  ADD COLUMN IF NOT EXISTS monto_cuota_usd   NUMERIC(12, 2),
  ADD COLUMN IF NOT EXISTS total_cuotas      SMALLINT,
  ADD COLUMN IF NOT EXISTS dia_de_pago       SMALLINT;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'leads_total_cuotas_check') THEN
    ALTER TABLE leads ADD CONSTRAINT leads_total_cuotas_check
      CHECK (total_cuotas IS NULL OR total_cuotas BETWEEN 1 AND 6);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'leads_dia_de_pago_check') THEN
    -- Tope 28: garantiza que el día comprometido exista en TODOS los meses
    -- (incluido febrero). Si el cliente paga "fin de mes", usar 28.
    ALTER TABLE leads ADD CONSTRAINT leads_dia_de_pago_check
      CHECK (dia_de_pago IS NULL OR dia_de_pago BETWEEN 1 AND 28);
  END IF;
END$$;

COMMENT ON COLUMN leads.cobro_inicial_usd IS 'Plan de pagos: monto del cobro inicial (pago numero=0).';
COMMENT ON COLUMN leads.monto_cuota_usd   IS 'Plan de pagos: monto de cada cuota mensual.';
COMMENT ON COLUMN leads.total_cuotas      IS 'Plan de pagos: cantidad de cuotas (1 a 6), aparte del inicial.';
COMMENT ON COLUMN leads.dia_de_pago       IS 'Plan de pagos: día del mes (1-28) en que vence cada cuota.';

-- -----------------------------------------------------------------------------
-- 2) Tabla pagos
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS pagos (
  id             BIGSERIAL PRIMARY KEY,
  lead_id        BIGINT NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  numero         SMALLINT NOT NULL,           -- 0 = cobro inicial, 1..6 = cuota
  monto_usd      NUMERIC(12, 2) NOT NULL,
  fecha_esperada DATE,
  pagado         BOOLEAN NOT NULL DEFAULT FALSE,
  fecha_pago     DATE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pagos_lead       ON pagos (lead_id);
CREATE INDEX IF NOT EXISTS idx_pagos_pendientes ON pagos (pagado, fecha_esperada);
-- Un solo registro por (lead, numero) — permite regenerar el plan con upsert.
CREATE UNIQUE INDEX IF NOT EXISTS idx_pagos_lead_numero ON pagos (lead_id, numero);

COMMENT ON TABLE pagos IS
  'Movimientos esperados de cobranza por lead. numero=0 es el cobro inicial; 1..6 las cuotas. Fuente de verdad del cash collected (sumando los pagado=true por fecha_pago).';

ALTER TABLE pagos ENABLE ROW LEVEL SECURITY;

-- -----------------------------------------------------------------------------
-- 3) Backfill: cobro inicial de los clientes ganados que ya cobraron algo
-- -----------------------------------------------------------------------------
-- Creamos un pago numero=0 pagado por cada lead ganado con total_cobrado>0.
-- Los planes de cuotas reales los carga Mauricio desde la ficha.
INSERT INTO pagos (lead_id, numero, monto_usd, fecha_esperada, pagado, fecha_pago)
SELECT
  id,
  0,
  total_cobrado_usd,
  COALESCE(fecha_primer_pago, fecha_cierre),
  TRUE,
  COALESCE(fecha_primer_pago, fecha_cierre)
FROM leads
WHERE estado_lead = 'ganado'
  AND total_cobrado_usd IS NOT NULL
  AND total_cobrado_usd > 0
ON CONFLICT (lead_id, numero) DO NOTHING;

COMMIT;
