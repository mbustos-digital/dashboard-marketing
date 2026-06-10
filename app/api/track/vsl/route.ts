// =============================================================================
// Tracking del VSL — recibe eventos de la landing (Lovable)
// =============================================================================
// La landing (multiplicatusresultados.com) manda un POST cuando alguien
// reproduce el VSL:
//   { visitor_id, event: 'vsl_play', timestamp, play_count }
//
// El visitor_id es un UUID anónimo de la cookie nqe_visitor_id. El mismo
// UUID llega como utm_term cuando la persona agenda en Calendly — el
// webhook lo guarda en leads.visitor_id y así cruzamos comportamiento.
//
// Diseño: errores SIEMPRE silenciosos hacia el cliente (200 con ok:false a
// lo sumo). Un fallo de tracking jamás debe romper la experiencia de la
// landing ni filtrar detalles internos.
// =============================================================================

import type { NextRequest } from 'next/server';
import { getSupabaseServer } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

// La landing vive en otro dominio — CORS abierto. Endpoint de tracking
// anónimo sin credenciales ni datos sensibles, '*' es aceptable y evita
// romper si el dominio de la landing cambia (lovable.app ↔ dominio propio).
const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400',
};

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

export async function POST(request: NextRequest) {
  let payload: {
    visitor_id?: unknown;
    event?: unknown;
    play_count?: unknown;
  };

  try {
    payload = await request.json();
  } catch {
    return Response.json({ ok: false }, { status: 200, headers: CORS_HEADERS });
  }

  const visitorId =
    typeof payload.visitor_id === 'string' ? payload.visitor_id.trim() : '';
  if (!visitorId || visitorId.length > 128) {
    return Response.json({ ok: false }, { status: 200, headers: CORS_HEADERS });
  }

  const event =
    typeof payload.event === 'string' && payload.event.trim()
      ? payload.event.trim().slice(0, 64)
      : 'vsl_play';

  const playCount =
    typeof payload.play_count === 'number' && Number.isFinite(payload.play_count)
      ? Math.max(0, Math.floor(payload.play_count))
      : null;

  try {
    const supabase = getSupabaseServer();
    const { error } = await supabase.from('vsl_events').insert({
      visitor_id: visitorId,
      event,
      play_count: playCount,
    });
    if (error) {
      console.error(`[track:vsl] insert falló: ${error.message}`);
      return Response.json({ ok: false }, { status: 200, headers: CORS_HEADERS });
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[track:vsl] error: ${msg}`);
    return Response.json({ ok: false }, { status: 200, headers: CORS_HEADERS });
  }

  return Response.json({ ok: true }, { status: 200, headers: CORS_HEADERS });
}

// Healthcheck
export async function GET() {
  return Response.json(
    {
      ok: true,
      endpoint: 'vsl tracking',
      usage: "POST { visitor_id, event: 'vsl_play', play_count }",
    },
    { headers: CORS_HEADERS },
  );
}
