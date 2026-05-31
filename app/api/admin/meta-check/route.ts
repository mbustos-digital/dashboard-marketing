// =============================================================================
// Admin endpoint: meta-check
// =============================================================================
// Devuelve los insights crudos de Meta para una fecha (default: ayer en TJ)
// SIN escribir nada en la DB. Útil para debugging y validar que el token y la
// cuenta están bien configurados antes de habilitar el cron.
//
// Auth: mismo CRON_SECRET (admin-only, no público).
//
// Uso:
//   curl -H "Authorization: Bearer <CRON_SECRET>" \
//        http://localhost:3000/api/admin/meta-check
//   curl -H "Authorization: Bearer <CRON_SECRET>" \
//        "http://localhost:3000/api/admin/meta-check?fecha=2026-05-28"
// =============================================================================

import type { NextRequest } from 'next/server';
import { fetchMetaInsights, MetaTokenError, MetaApiError } from '@/lib/meta-ads';
import { ayerEnTijuana, esFechaValida } from '@/lib/date-utils';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return Response.json(
      { ok: false, error: 'CRON_SECRET no configurado' },
      { status: 500 },
    );
  }
  if (request.headers.get('authorization') !== `Bearer ${cronSecret}`) {
    return Response.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  const override = request.nextUrl.searchParams.get('fecha');
  if (override && !esFechaValida(override)) {
    return Response.json(
      { ok: false, error: 'fecha inválida, usa YYYY-MM-DD' },
      { status: 400 },
    );
  }
  const fecha = override ?? ayerEnTijuana();

  try {
    const insights = await fetchMetaInsights(fecha);
    return Response.json({
      ok: true,
      fecha,
      count: insights.length,
      sample: insights[0] ?? null,
      insights,
    });
  } catch (err) {
    if (err instanceof MetaTokenError) {
      return Response.json(
        { ok: false, error: 'token', message: err.message, fecha },
        { status: 401 },
      );
    }
    if (err instanceof MetaApiError) {
      return Response.json(
        {
          ok: false,
          error: 'meta_api',
          message: err.message,
          code: err.code,
          subcode: err.subcode,
          fecha,
        },
        { status: 502 },
      );
    }
    const message = err instanceof Error ? err.message : String(err);
    return Response.json(
      { ok: false, error: 'unknown', message, fecha },
      { status: 500 },
    );
  }
}
