// =============================================================================
// Backfill histórico de Meta Insights (Implementación v2, Fase 2)
// =============================================================================
// Uso:
//   npx tsx scripts/backfill-meta.ts --desde=2025-12-08
//   npx tsx scripts/backfill-meta.ts --desde=2025-12-08 --hasta=2026-01-31
//
// - Reusa fetchMetaInsights / parseInsightsToMetrics / upsertMetrics (no
//   duplica lógica). Idempotente: upsertMetrics hace delete+insert por fecha.
// - Loop en orden cronológico, pausa de 2500 ms entre días (rate limit).
// - MetaRateLimitError → espera 60 s y reintenta el MISMO día (máx 3),
//   después aborta con resumen.
// - Días sin campañas activas devuelven 0 insights: loguear y seguir.
// - NO toca adset_budget_daily (Meta no expone histórico de presupuestos).
// =============================================================================

import { config } from 'dotenv';
import { resolve } from 'node:path';

// Carga .env.local ANTES de importar módulos que leen process.env.
config({ path: resolve(process.cwd(), '.env.local') });

import {
  fetchMetaInsights,
  parseInsightsToMetrics,
  upsertMetrics,
  MetaRateLimitError,
} from '../lib/meta-ads';
import { ayerEnTijuana, diasAntes, esFechaValida } from '../lib/date-utils';

const PAUSA_ENTRE_DIAS_MS = 2500;
const ESPERA_RATE_LIMIT_MS = 60_000;
const MAX_REINTENTOS_DIA = 3;

function sleep(ms: number): Promise<void> {
  return new Promise((res) => setTimeout(res, ms));
}

function parseFlag(name: string): string | null {
  const arg = process.argv.find((a) => a.startsWith(`--${name}=`));
  return arg ? arg.split('=')[1] : null;
}

async function procesarDia(fecha: string): Promise<number> {
  for (let intento = 1; intento <= MAX_REINTENTOS_DIA; intento++) {
    try {
      const insights = await fetchMetaInsights(fecha);
      if (insights.length === 0) {
        console.log(`  ${fecha}: sin campañas activas (0 insights)`);
        return 0;
      }
      const metrics = parseInsightsToMetrics(insights, fecha);
      return await upsertMetrics(metrics);
    } catch (err) {
      if (err instanceof MetaRateLimitError && intento < MAX_REINTENTOS_DIA) {
        console.warn(
          `  ${fecha}: rate limit (intento ${intento}/${MAX_REINTENTOS_DIA}), esperando 60 s...`,
        );
        await sleep(ESPERA_RATE_LIMIT_MS);
        continue;
      }
      throw err;
    }
  }
  return 0;
}

async function main() {
  const desde = parseFlag('desde');
  const hasta = parseFlag('hasta') ?? ayerEnTijuana();

  if (!desde || !esFechaValida(desde)) {
    console.error('Falta --desde=YYYY-MM-DD (válida)');
    process.exit(1);
  }
  if (!esFechaValida(hasta) || desde > hasta) {
    console.error(`Rango inválido: ${desde} → ${hasta}`);
    process.exit(1);
  }

  console.log(`▶ Backfill Meta Insights: ${desde} → ${hasta}`);
  console.log(`  Ad Account: ${process.env.META_AD_ACCOUNT_ID}`);
  console.log('');

  let fecha = desde;
  let dias = 0;
  let filas = 0;
  const errores: Array<{ fecha: string; error: string }> = [];

  while (fecha <= hasta) {
    const t0 = Date.now();
    try {
      const inserted = await procesarDia(fecha);
      filas += inserted;
      if (inserted > 0) {
        console.log(`  ${fecha}: ${inserted} filas (${Date.now() - t0} ms)`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`  ${fecha}: ERROR — ${msg}`);
      errores.push({ fecha, error: msg });
      if (err instanceof MetaRateLimitError) {
        console.error('Rate limit persistente — abortando con resumen.');
        break;
      }
    }
    dias++;
    fecha = diasAntes(fecha, -1); // avanza un día
    if (fecha <= hasta) await sleep(PAUSA_ENTRE_DIAS_MS);
  }

  console.log('\n──────── RESUMEN ────────');
  console.log(`Días procesados : ${dias}`);
  console.log(`Filas totales   : ${filas}`);
  console.log(`Días con error  : ${errores.length}`);
  for (const e of errores) console.log(`  - ${e.fecha}: ${e.error}`);
  process.exit(errores.length > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
