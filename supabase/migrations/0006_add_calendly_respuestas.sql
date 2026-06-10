-- =============================================================================
-- Migration 0006: respuestas de calificación del formulario de Calendly
-- =============================================================================
-- El webhook de Calendly ya recibe el array questions_and_answers con todas
-- las respuestas del formulario. Hoy solo extraemos empresa y teléfono — el
-- resto se descarta. Guardarlas le da a Mauricio contexto antes de J1
-- (presupuesto, tamaño de equipo, objetivo, urgencia).
--
-- Los textos exactos de las preguntas en Calendly se matchean en el handler
-- con extractAnswer (substring case-insensitive). Si el form cambia, ajustar
-- los keywords ahí.
-- =============================================================================

BEGIN;

ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS respuesta_facturacion     TEXT,
  ADD COLUMN IF NOT EXISTS respuesta_colaboradores   TEXT,
  ADD COLUMN IF NOT EXISTS respuesta_objetivo        TEXT,
  ADD COLUMN IF NOT EXISTS respuesta_cuando_empezar  TEXT;

COMMENT ON COLUMN leads.respuesta_facturacion    IS 'Facturación / presupuesto declarado en el form de Calendly.';
COMMENT ON COLUMN leads.respuesta_colaboradores  IS 'Tamaño de equipo / # de colaboradores.';
COMMENT ON COLUMN leads.respuesta_objetivo       IS 'Qué quiere lograr el lead.';
COMMENT ON COLUMN leads.respuesta_cuando_empezar IS 'Cuándo quiere empezar (urgencia).';

COMMIT;
