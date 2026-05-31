// =============================================================================
// TEMPORARY DEBUG ENDPOINT — borrar después de diagnosticar firma Calendly
// =============================================================================
// Devuelve metadata segura del signing_key en Vercel sin exponer el valor.
// =============================================================================

import type { NextRequest } from 'next/server';
import crypto from 'node:crypto';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || request.headers.get('authorization') !== `Bearer ${cronSecret}`) {
    return Response.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  const sk = process.env.CALENDLY_WEBHOOK_SIGNING_KEY ?? '';
  return Response.json({
    ok: true,
    length: sk.length,
    first4: sk.slice(0, 4),
    last4: sk.slice(-4),
    sha256: crypto.createHash('sha256').update(sk).digest('hex'),
    hasLeadingWhitespace: sk !== sk.trimStart(),
    hasTrailingWhitespace: sk !== sk.trimEnd(),
    rawLength: sk.length,
    trimmedLength: sk.trim().length,
  });
}
