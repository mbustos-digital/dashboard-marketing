// =============================================================================
// Backfill YouTube Analytics (Camino B)
// =============================================================================
// Uso (default 1-may a ayer):
//   npx tsx scripts/backfill-youtube-analytics.ts
//
// Custom rango:
//   npx tsx scripts/backfill-youtube-analytics.ts 2026-05-01 2026-05-30
//
// Para cada video configurado (VSL, Thanks, Thanks Prep):
//   1. Llama YouTube Analytics API para vistas diarias en el rango
//   2. UPSERT por fila (fecha, plataforma=youtube, youtube_video_id) en
//      marketing_metrics_daily. Sobreescribe lo que haya (DELETE+INSERT).
//   3. Días sin actividad (API no devuelve fila) → insertan 0 vistas
//      para que las queries de window no rompan ni traten como NULL.
// =============================================================================

import { config } from 'dotenv';
import { resolve } from 'node:path';

config({ path: resolve(process.cwd(), '.env.local') });

import { getSupabaseServer } from '../lib/supabase';
import { fetchYouTubeAnalyticsDaily } from '../lib/youtube-analytics';
import { ayerEnTijuana, diasAntes } from '../lib/date-utils';
import type { MarketingMetricRow } from '../lib/types';

const START_DEFAULT = '2026-05-01';
const start = process.argv[2] || START_DEFAULT;
const end = process.argv[3] || ayerEnTijuana();

type VideoCfg = { id: string | undefined; type: 'vsl' | 'thanks' | 'thanks_prep' };
const VIDEOS: VideoCfg[] = [
  { id: process.env.YOUTUBE_VSL_VIDEO_ID, type: 'vsl' },
  { id: process.env.YOUTUBE_THANKS_VIDEO_ID, type: 'thanks' },
  { id: process.env.YOUTUBE_THANKS_PREP_VIDEO_ID, type: 'thanks_prep' },
];

function rangoDias(start: string, end: string): string[] {
  const out: string[] = [];
  let cur = start;
  // safety cap: 365 días
  for (let i = 0; i < 365 && cur <= end; i++) {
    out.push(cur);
    cur = diasAntes(cur, -1);
  }
  return out;
}

async function backfillVideo(cfg: VideoCfg) {
  if (!cfg.id || cfg.id.startsWith('PENDING')) {
    console.log(`  ⏭  ${cfg.type}: PENDING, skip`);
    return { type: cfg.type, status: 'skipped' as const, count: 0 };
  }
  console.log(`  ▶ ${cfg.type} (${cfg.id})...`);
  const daily = await fetchYouTubeAnalyticsDaily(cfg.id, start, end);
  const porFecha = new Map(daily.map((d) => [d.fecha, d]));

  const fechas = rangoDias(start, end);
  const rows: MarketingMetricRow[] = fechas.map((fecha) => {
    const stat = porFecha.get(fecha);
    return {
      fecha,
      plataforma: 'youtube',
      youtube_video_id: cfg.id!,
      youtube_video_type: cfg.type,
      youtube_views: stat?.views ?? 0,
      youtube_minutes_watched: stat?.estimated_minutes_watched ?? 0,
      youtube_avg_view_duration: stat?.average_view_duration ?? 0,
      // Marketing fields stay null para filas YouTube
      ad_account_id: null,
      campaign_id: null,
      campaign_name: null,
      adset_id: null,
      adset_name: null,
      impressions: null,
      reach: null,
      frequency: null,
      clicks: null,
      link_clicks: null,
      ctr: null,
      cpc: null,
      cpm: null,
      spend: null,
      landing_page_views: null,
      page_views: null,
      cost_per_landing_page_view: null,
      raw_payload: {
        source: 'youtube-analytics-api',
        backfill_at: '2026-05-31',
        had_data: !!stat,
      },
    };
  });

  const supabase = getSupabaseServer();

  // Borrar TODAS las filas YouTube existentes de ese video en el rango
  const { error: delErr } = await supabase
    .from('marketing_metrics_daily')
    .delete()
    .eq('plataforma', 'youtube')
    .eq('youtube_video_id', cfg.id)
    .gte('fecha', start)
    .lte('fecha', end);
  if (delErr) throw new Error(`DELETE falló: ${delErr.message}`);

  // Insert nuevo batch
  const { error: insErr } = await supabase
    .from('marketing_metrics_daily')
    .insert(rows);
  if (insErr) throw new Error(`INSERT falló: ${insErr.message}`);

  const totalViews = rows.reduce((s, r) => s + (r.youtube_views ?? 0), 0);
  const diasConData = daily.length;
  console.log(`    ✅ ${rows.length} filas | ${diasConData} días con vistas | total ${totalViews} vistas`);
  return { type: cfg.type, status: 'ok' as const, count: rows.length, totalViews };
}

async function main() {
  console.log('');
  console.log(`▶ Backfill YouTube Analytics: ${start} → ${end}`);
  console.log('');
  for (const cfg of VIDEOS) {
    try {
      await backfillVideo(cfg);
    } catch (err) {
      console.error(`  ❌ ${cfg.type}: ${err instanceof Error ? err.message : err}`);
    }
  }
  console.log('');
  console.log('Backfill completado.');
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
