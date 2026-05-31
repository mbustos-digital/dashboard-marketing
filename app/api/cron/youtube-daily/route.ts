// =============================================================================
// Cron: ingesta diaria de YouTube
// =============================================================================
// Vercel cron lo invoca a las 13:15 UTC (≈6:15 AM Tijuana) cada día,
// 15 minutos después del de Meta para no chocar.
// Procesa los videos configurados (VSL + Thanks si está) y los upsertea
// en marketing_metrics_daily con plataforma='youtube'.
// =============================================================================

import type { NextRequest } from 'next/server';
import {
  processAllVideos,
  YouTubeAuthError,
  YouTubeApiError,
  YouTubeNotFoundError,
} from '@/lib/youtube';
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

  const override = request.nextUrl.searchParams.get('fecha');
  const fecha = override ?? ayerEnTijuana();

  const tStart = Date.now();
  try {
    const results = await processAllVideos(fecha);
    const ms = Date.now() - tStart;

    const summary = {
      ok: results.every((r) => r.status !== 'error'),
      fecha,
      total: results.length,
      processed: results.filter((r) => r.status === 'ok').length,
      skipped: results.filter((r) => r.status === 'skipped').length,
      errors: results.filter((r) => r.status === 'error').length,
      results,
      ms,
    };

    console.log(`[cron:youtube-daily] fecha=${fecha} ok=${summary.processed} skip=${summary.skipped} err=${summary.errors} ms=${ms}`);

    return Response.json(summary);
  } catch (err) {
    const ms = Date.now() - tStart;
    if (err instanceof YouTubeAuthError) {
      return Response.json(
        { ok: false, error: 'auth', message: err.message, fecha, ms },
        { status: 401 },
      );
    }
    if (err instanceof YouTubeNotFoundError) {
      return Response.json(
        { ok: false, error: 'not_found', message: err.message, fecha, ms },
        { status: 404 },
      );
    }
    if (err instanceof YouTubeApiError) {
      return Response.json(
        { ok: false, error: 'youtube_api', message: err.message, code: err.code, fecha, ms },
        { status: 502 },
      );
    }
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[cron:youtube-daily] unknown error: ${message}`);
    return Response.json(
      { ok: false, error: 'unknown', message, fecha, ms },
      { status: 500 },
    );
  }
}
