// =============================================================================
// Webhook: Meta Lead Ads → leads
// =============================================================================
// Endpoint público que recibe webhooks de Meta cuando alguien envía un
// formulario instantáneo (instant form) en un anuncio.
//
// A diferencia de Calendly, el POST de Meta NO trae los datos del lead — solo
// un leadgen_id. Hay que llamar a la Graph API con ese ID para obtenerlos.
//
// Seguridad:
//   - GET de verificación: hub.verify_token vs META_LEADS_VERIFY_TOKEN
//   - POST firmado: X-Hub-Signature-256 = HMAC-SHA256(raw body, META_APP_SECRET)
//
// Env vars (Vercel production):
//   - META_LEADS_VERIFY_TOKEN  (string inventado, debe coincidir con Meta)
//   - META_APP_SECRET          (de la app "Leads - Dashboard MKT (Martin)")
//   - META_PAGE_ACCESS_TOKEN   (token de página — para leer el lead via Graph)
// =============================================================================

import crypto from 'node:crypto';
import type { NextRequest } from 'next/server';
import { upsertLeadFromMeta } from '@/lib/leads';
import { parseLeadFields, META_GRAPH_VERSION } from '@/lib/meta-leads';

export const dynamic = 'force-dynamic';

const GRAPH_VERSION = META_GRAPH_VERSION;

// ─────────────────────────────────────────────────────────────────────────────
// GET — verificación del webhook (handshake de Meta) + healthcheck
// ─────────────────────────────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const mode = params.get('hub.mode');
  const verifyToken = params.get('hub.verify_token');
  const challenge = params.get('hub.challenge');

  // Handshake de Meta: responder el challenge en texto plano
  if (mode === 'subscribe' && verifyToken !== null && challenge !== null) {
    const expected = process.env.META_LEADS_VERIFY_TOKEN;
    if (!expected) {
      console.error('[webhook:meta-leads] META_LEADS_VERIFY_TOKEN no configurado');
      return new Response('server not configured', { status: 500 });
    }
    if (verifyToken === expected) {
      console.log('[webhook:meta-leads] verificación OK — challenge devuelto');
      return new Response(challenge, {
        status: 200,
        headers: { 'Content-Type': 'text/plain' },
      });
    }
    console.warn('[webhook:meta-leads] verify_token NO coincide');
    return new Response('forbidden', { status: 403 });
  }

  // Healthcheck simple (sin params de Meta)
  return Response.json({
    ok: true,
    endpoint: 'meta lead ads webhook',
    usage: 'GET con hub.* para verificación; POST firmado con X-Hub-Signature-256',
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Firma del POST
// ─────────────────────────────────────────────────────────────────────────────

function verifyMetaSignature(rawBody: string, signatureHeader: string | null): boolean {
  const appSecret = process.env.META_APP_SECRET;
  if (!appSecret) {
    console.error('[webhook:meta-leads] META_APP_SECRET no configurado');
    return false;
  }
  if (!signatureHeader || !signatureHeader.startsWith('sha256=')) {
    return false;
  }
  const received = signatureHeader.slice('sha256='.length);
  const expected = crypto
    .createHmac('sha256', appSecret)
    .update(rawBody, 'utf8')
    .digest('hex');
  if (received.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(received), Buffer.from(expected));
}

// ─────────────────────────────────────────────────────────────────────────────
// Graph API — obtener los datos del lead por leadgen_id
// ─────────────────────────────────────────────────────────────────────────────

type GraphLeadResponse = {
  id?: string;
  field_data?: Array<{ name?: string; values?: string[] }>;
  campaign_name?: string;
  adset_name?: string;
  ad_name?: string;
  ad_id?: string;
  error?: { code?: number; message?: string };
};

async function fetchLeadFromGraph(leadgenId: string): Promise<GraphLeadResponse> {
  const token = process.env.META_PAGE_ACCESS_TOKEN;
  if (!token || token.startsWith('PENDING')) {
    throw new Error('META_PAGE_ACCESS_TOKEN no configurado (o placeholder)');
  }
  const url = new URL(`https://graph.facebook.com/${GRAPH_VERSION}/${leadgenId}`);
  url.searchParams.set('access_token', token);
  url.searchParams.set('fields', 'field_data,campaign_name,adset_name,ad_name,ad_id');

  const res = await fetch(url.toString());
  const body = (await res.json()) as GraphLeadResponse;
  if (body.error) {
    throw new Error(`Graph API error (${body.error.code}): ${body.error.message}`);
  }
  return body;
}

// ─────────────────────────────────────────────────────────────────────────────
// POST — lead nuevo del instant form
// ─────────────────────────────────────────────────────────────────────────────

type MetaWebhookBody = {
  object?: string;
  entry?: Array<{
    id?: string;
    time?: number;
    changes?: Array<{
      field?: string;
      value?: {
        leadgen_id?: string;
        form_id?: string;
        page_id?: string;
        ad_id?: string;
        created_time?: number;
      };
    }>;
  }>;
};

export async function POST(request: NextRequest) {
  const tStart = Date.now();

  // 1) Raw body para verificar firma
  const rawBody = await request.text();
  const signature = request.headers.get('x-hub-signature-256');

  if (!verifyMetaSignature(rawBody, signature)) {
    console.warn('[webhook:meta-leads] firma rechazada');
    return Response.json({ ok: false, error: 'signature' }, { status: 401 });
  }

  // 2) Parse
  let body: MetaWebhookBody;
  try {
    body = JSON.parse(rawBody) as MetaWebhookBody;
  } catch {
    return Response.json({ ok: false, error: 'bad_json' }, { status: 400 });
  }

  // 3) Juntar todos los leadgen_id del payload (puede venir más de uno)
  const leadgenIds: string[] = [];
  for (const entry of body.entry ?? []) {
    for (const change of entry.changes ?? []) {
      if (change.field === 'leadgen' && change.value?.leadgen_id) {
        leadgenIds.push(change.value.leadgen_id);
      }
    }
  }

  if (leadgenIds.length === 0) {
    console.log('[webhook:meta-leads] POST sin leadgen_id — ignorado');
    return Response.json({ ok: true, ignored: true });
  }

  // 4) Procesar cada lead — un error individual NO bloquea a los demás.
  //    Devolvemos 200 siempre que el request fue legítimo: si devolvemos
  //    error, Meta reintenta TODO el batch (duplicaría el trabajo).
  const results: Array<{ leadgen_id: string; status: string; lead_id?: number }> = [];

  for (const leadgenId of leadgenIds) {
    try {
      const graphLead = await fetchLeadFromGraph(leadgenId);
      const { email, nombre, telefono, empresa } = parseLeadFields(graphLead.field_data);

      const { created, lead } = await upsertLeadFromMeta({
        email,
        nombre,
        telefono,
        empresa,
        meta_lead_id: leadgenId,
        meta_ad_id: graphLead.ad_id ?? null,
        meta_ad_name: graphLead.ad_name ?? null,
        meta_campaign_name: graphLead.campaign_name ?? null,
        meta_adset_name: graphLead.adset_name ?? null,
      });

      console.log(
        `[webhook:meta-leads] ${created ? 'INSERT' : 'UPDATE'} lead id=${lead.id} leadgen=${leadgenId} ad=${graphLead.ad_name ?? '—'} ms=${Date.now() - tStart}`,
      );
      results.push({ leadgen_id: leadgenId, status: created ? 'created' : 'updated', lead_id: lead.id });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[webhook:meta-leads] error procesando leadgen=${leadgenId}: ${message}`);
      results.push({ leadgen_id: leadgenId, status: `error: ${message}` });
    }
  }

  return Response.json({ ok: true, processed: results.length, results });
}
