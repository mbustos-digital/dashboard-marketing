-- =============================================================================
-- Validación de la migración 0001 — VERSIÓN CONSOLIDADA
-- =============================================================================
-- Devuelve UNA tabla con todos los checks. Si todos los "estado" son ✅, todo OK.
-- Si alguno es ❌, ese pedazo no se creó: mándame la tabla completa y vemos.
-- =============================================================================

SELECT check_name, esperado, obtenido, estado FROM (
  SELECT
    '1. Tablas creadas (marketing_metrics_daily, leads)' AS check_name,
    '2'::TEXT AS esperado,
    (SELECT COUNT(*) FROM information_schema.tables
       WHERE table_schema='public'
         AND table_name IN ('marketing_metrics_daily','leads'))::TEXT AS obtenido,
    CASE WHEN (SELECT COUNT(*) FROM information_schema.tables
                  WHERE table_schema='public'
                    AND table_name IN ('marketing_metrics_daily','leads')) = 2
         THEN '✅' ELSE '❌' END AS estado,
    1 AS ord

  UNION ALL SELECT
    '2. Vistas creadas (v_cohortes_semanales, v_cohortes_mensuales)',
    '2',
    (SELECT COUNT(*) FROM information_schema.views
       WHERE table_schema='public'
         AND table_name IN ('v_cohortes_semanales','v_cohortes_mensuales'))::TEXT,
    CASE WHEN (SELECT COUNT(*) FROM information_schema.views
                  WHERE table_schema='public'
                    AND table_name IN ('v_cohortes_semanales','v_cohortes_mensuales')) = 2
         THEN '✅' ELSE '❌' END,
    2

  UNION ALL SELECT
    '3. Triggers de updated_at (trg_mmd_updated_at, trg_leads_updated_at)',
    '2',
    (SELECT COUNT(*) FROM information_schema.triggers
       WHERE trigger_schema='public'
         AND trigger_name IN ('trg_mmd_updated_at','trg_leads_updated_at'))::TEXT,
    CASE WHEN (SELECT COUNT(*) FROM information_schema.triggers
                  WHERE trigger_schema='public'
                    AND trigger_name IN ('trg_mmd_updated_at','trg_leads_updated_at')) = 2
         THEN '✅' ELSE '❌' END,
    3

  UNION ALL SELECT
    '4. Row Level Security activado en ambas tablas',
    '2',
    (SELECT COUNT(*) FROM pg_tables
       WHERE schemaname='public'
         AND tablename IN ('marketing_metrics_daily','leads')
         AND rowsecurity=TRUE)::TEXT,
    CASE WHEN (SELECT COUNT(*) FROM pg_tables
                  WHERE schemaname='public'
                    AND tablename IN ('marketing_metrics_daily','leads')
                    AND rowsecurity=TRUE) = 2
         THEN '✅' ELSE '❌' END,
    4

  UNION ALL SELECT
    '5. Índices en marketing_metrics_daily',
    '≥4',
    (SELECT COUNT(*) FROM pg_indexes
       WHERE schemaname='public' AND tablename='marketing_metrics_daily')::TEXT,
    CASE WHEN (SELECT COUNT(*) FROM pg_indexes
                  WHERE schemaname='public' AND tablename='marketing_metrics_daily') >= 4
         THEN '✅' ELSE '❌' END,
    5

  UNION ALL SELECT
    '6. Índices en leads',
    '≥4',
    (SELECT COUNT(*) FROM pg_indexes
       WHERE schemaname='public' AND tablename='leads')::TEXT,
    CASE WHEN (SELECT COUNT(*) FROM pg_indexes
                  WHERE schemaname='public' AND tablename='leads') >= 4
         THEN '✅' ELSE '❌' END,
    6
) checks
ORDER BY ord;

-- =============================================================================
-- Opcional: smoke test (probar que las vistas funcionan con datos reales)
-- Si quieres verificarlo, BORRA los comentarios "--" del bloque de abajo y córrelo.
-- Crea un lead de prueba, lo muestra en la vista mensual, y lo borra.
-- =============================================================================
--
-- INSERT INTO leads (nombre, email, fecha_junta_1, asistio_j1, calificado, cerro, monto_cierre_usd, fecha_cierre)
-- VALUES ('TEST_BORRAR_MB', 'test@borrar.com', CURRENT_DATE - 20, TRUE, TRUE, TRUE, 1500.00, CURRENT_DATE - 5);
--
-- SELECT mes_inicio, total_j1, limpias, cierres, ingreso_total_usd, dias_promedio_ciclo, estado_madurez
-- FROM v_cohortes_mensuales LIMIT 5;
--
-- DELETE FROM leads WHERE nombre = 'TEST_BORRAR_MB';
