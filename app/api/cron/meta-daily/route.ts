// =============================================================================
// Cron: ingesta diaria de Meta Ads
// =============================================================================
// Vercel cron lo invoca a las 13:00 UTC (≈6:00 AM Tijuana) cada día.
// Trae los insights del día anterior (en zona Tijuana) y los upsertea en
// marketing_metrics_daily.
//
// Auth: Vercel firma el request con `Authorization: Bearer ${CRON_SECRET}`
//       cuando CRON_SECRET está configurado como env var en el proyecto.
//
// Idempotente: ejecutarlo dos veces el mismo día reemplaza el batch.
// =============================================================================

import type { NextRequest } from 'next/server';
import {
  fetchMetaInsights,
  parseInsightsToMetrics,
  upsertMetrics,
  MetaTokenError,
  MetaRateLimitError,
  MetaApiError,
} from '@/lib/meta-ads';
import { ayerEnTijuana } from '@/lib/date-utils';

export const dynamic = 'force-dynamic';

function checkAuth(request: NextRequest): Response | null {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return Response.json(
      { ok: false, error: 'CRON_SECRET no configurado en env' },
      { status: 500 },
    );
  }
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${cronSecret}`) {
    return Response.json(
      { ok: false, error: 'Unauthorized' },
      { status: 401 },
    );
  }
  return null;
}

export async function GET(request: NextRequest) {
  const authFail = checkAuth(request);
  if (authFail) return authFail;

  // Permite forzar una fecha vía ?fecha=YYYY-MM-DD para re-procesar manualmente.
  const override = request.nextUrl.searchParams.get('fecha');
  const fecha = override ?? ayerEnTijuana();

  const tStart = Date.now();
  try {
    const insights = await fetchMetaInsights(fecha);
    const metrics = parseInsightsToMetrics(insights, fecha);
    const inserted = await upsertMetrics(metrics);

    const ms = Date.now() - tStart;
    console.log(
      `[cron:meta-daily] fecha=${fecha} insights=${insights.length} inserted=${inserted} ms=${ms}`,
    );

    return Response.json({
      ok: true,
      fecha,
      insights_received: insights.length,
      rows_inserted: inserted,
      ms,
    });
  } catch (err) {
    const ms = Date.now() - tStart;
    if (err instanceof MetaTokenError) {
      console.error(`[cron:meta-daily] token error: ${err.message}`);
      return Response.json(
        { ok: false, error: 'token', message: err.message, fecha, ms },
        { status: 401 },
      );
    }
    if (err instanceof MetaRateLimitError) {
      console.error(`[cron:meta-daily] rate limit: ${err.message}`);
      return Response.json(
        { ok: false, error: 'rate_limit', message: err.message, fecha, ms },
        { status: 429 },
      );
    }
    if (err instanceof MetaApiError) {
      console.error(`[cron:meta-daily] api error: ${err.message}`);
      return Response.json(
        {
          ok: false,
          error: 'meta_api',
          message: err.message,
          code: err.code,
          subcode: err.subcode,
          fecha,
          ms,
        },
        { status: 502 },
      );
    }
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[cron:meta-daily] unknown error: ${message}`);
    return Response.json(
      { ok: false, error: 'unknown', message, fecha, ms },
      { status: 500 },
    );
  }
}
