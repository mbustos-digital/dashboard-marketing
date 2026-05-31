// =============================================================================
// Backfill de Meta Ads: carga N días históricos
// =============================================================================
// Uso (default 90 días):
//   npx tsx scripts/backfill-meta.ts
//
// Días custom:
//   npx tsx scripts/backfill-meta.ts 30
//
// Lee .env.local automáticamente (sin necesidad de exportar variables).
// Itera de "ayer en TJ" hacia atrás N días, llama Meta por cada día y upsertea.
// Si un día falla, loggea el error y sigue con el siguiente — no aborta.
// =============================================================================

import { config } from 'dotenv';
import { resolve } from 'node:path';

// Carga .env.local ANTES de importar módulos que leen process.env.
config({ path: resolve(process.cwd(), '.env.local') });

import {
  fetchMetaInsights,
  parseInsightsToMetrics,
  upsertMetrics,
} from '../lib/meta-ads';
import { ayerEnTijuana, diasAntes } from '../lib/date-utils';

const DAYS = Math.max(1, Number(process.argv[2] ?? 90));
const PAUSE_MS = 250; // pausa pequeña entre días para no martillar Meta

async function main() {
  const fechaFinal = ayerEnTijuana();
  console.log(`▶ Backfill Meta Ads: ${DAYS} días terminando en ${fechaFinal}`);
  console.log(`  Ad Account: ${process.env.META_AD_ACCOUNT_ID}`);
  console.log(`  API: ${process.env.META_API_VERSION}`);
  console.log('');

  let okCount = 0;
  let failCount = 0;
  const tStart = Date.now();

  for (let i = 0; i < DAYS; i++) {
    const fecha = diasAntes(fechaFinal, i);
    try {
      const insights = await fetchMetaInsights(fecha);
      const metrics = parseInsightsToMetrics(insights, fecha);
      const inserted = await upsertMetrics(metrics);
      console.log(`  ✅ ${fecha}: ${insights.length} insights → ${inserted} filas`);
      okCount++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`  ❌ ${fecha}: ${msg}`);
      failCount++;
    }
    if (i < DAYS - 1) await new Promise((r) => setTimeout(r, PAUSE_MS));
  }

  const ms = Date.now() - tStart;
  console.log('');
  console.log(`Resumen: ${okCount} OK · ${failCount} fail · ${(ms / 1000).toFixed(1)}s`);
  if (failCount > 0) process.exit(1);
}

main().catch((err) => {
  console.error('Error fatal:', err);
  process.exit(1);
});
