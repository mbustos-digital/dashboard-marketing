// =============================================================================
// Cron: ingesta diaria de métricas de Panda Video (VSL) — Fase 5 v2
// =============================================================================
// Una fila por video y por día con plataforma=panda. La etapa Landing→VSL del
// funnel lee video_plays (unificado youtube+panda), así que esto la "despega"
// del 0% que daba YouTube con los embeds autoplay.
//
// Auth: Bearer ${CRON_SECRET}. Schedule: 45 13 * * * (6:45 AM Tijuana).
// =============================================================================

import type { NextRequest } from 'next/server';
import { getSupabaseServer } from '@/lib/supabase';
import { fetchPandaDailyStat, getPandaVideoIds } from '@/lib/panda';
import { ayerEnTijuana } from '@/lib/date-utils';
import type { MarketingMetricRow } from '@/lib/types';

export const dynamic = 'force-dynamic';

function checkAuth(request: NextRequest): Response | null {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return Response.json({ ok: false, error: 'CRON_SECRET no configurado' }, { status: 500 });
  }
  if (request.headers.get('authorization') !== `Bearer ${cronSecret}`) {
    return Response.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }
  return null;
}

export async function GET(request: NextRequest) {
  const authFail = checkAuth(request);
  if (authFail) return authFail;

  const fecha = request.nextUrl.searchParams.get('fecha') ?? ayerEnTijuana();
  const videoIds = getPandaVideoIds();
  const tStart = Date.now();

  if (videoIds.length === 0) {
    return Response.json({ ok: false, error: 'PANDA_VSL_VIDEO_IDS vacío' }, { status: 500 });
  }

  const supabase = getSupabaseServer();
  const resultados: Array<{ video: string; plays: number; status: string }> = [];

  for (const extId of videoIds) {
    try {
      const stat = await fetchPandaDailyStat(extId, fecha);

      const row: MarketingMetricRow & {
        video_id?: string | null;
        video_variant?: string | null;
        video_plays?: number | null;
        video_unique_viewers?: number | null;
        video_retention_p50?: number | null;
      } = {
        fecha,
        plataforma: 'panda', // CHECK permite panda (mig 0010)
        video_id: extId,
        video_variant: extId, // separa variantes del A/B
        video_plays: stat.plays,
        video_unique_viewers: stat.unique_viewers,
        // engagement medio como aproximación de retención global (p50)
        video_retention_p50: stat.engagement_pct,
        video_avg_watch_seconds: stat.avg_watch_seconds,
        raw_payload: { source: 'panda', ...stat },
      };

      // delete+insert por fecha+plataforma+video_id (idempotente)
      await supabase
        .from('marketing_metrics_daily')
        .delete()
        .eq('fecha', fecha)
        .eq('plataforma', 'panda')
        .eq('video_id', extId);

      const { error } = await supabase.from('marketing_metrics_daily').insert(row);
      if (error) throw new Error(error.message);

      resultados.push({ video: extId, plays: stat.plays, status: 'ok' });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[cron:panda-daily] ${extId}: ${msg}`);
      resultados.push({ video: extId, plays: 0, status: `error: ${msg}` });
    }
  }

  const ms = Date.now() - tStart;
  console.log(`[cron:panda-daily] fecha=${fecha} videos=${videoIds.length} ms=${ms}`);
  return Response.json({ ok: true, fecha, resultados, ms });
}
