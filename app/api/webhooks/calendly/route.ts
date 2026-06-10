// =============================================================================
// Webhook: Calendly → leads
// =============================================================================
// Endpoint público (no requiere CRON_SECRET) que recibe webhooks de Calendly.
// Seguridad: verifica firma HMAC-SHA256 con CALENDLY_WEBHOOK_SIGNING_KEY.
//
// Eventos manejados:
//   - invitee.created   → upsert lead (decisión 2026-05-31)
//   - invitee.canceled  → ignorado por ahora (MVP: marca manual)
//   - cualquier otro    → 200 OK con `ignored: true`
// =============================================================================

import type { NextRequest } from 'next/server';
import {
  verifyCalendlySignature,
  isoToFechaTijuana,
  extractAnswer,
  CalendlySignatureError,
  type CalendlyWebhookPayload,
} from '@/lib/calendly';
import { upsertLeadFromCalendly } from '@/lib/leads';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const tStart = Date.now();

  // 1) Read raw body (necesario para verificar firma)
  const rawBody = await request.text();
  const signatureHeader = request.headers.get('calendly-webhook-signature');
  const signingKey = process.env.CALENDLY_WEBHOOK_SIGNING_KEY;

  // 2) Verify signature
  try {
    verifyCalendlySignature(rawBody, signatureHeader, signingKey ?? '');
  } catch (err) {
    if (err instanceof CalendlySignatureError) {
      console.warn(`[webhook:calendly] firma rechazada: ${err.message}`);
      return Response.json(
        { ok: false, error: 'signature', message: err.message },
        { status: 401 },
      );
    }
    throw err;
  }

  // 3) Parse JSON
  let body: CalendlyWebhookPayload;
  try {
    body = JSON.parse(rawBody) as CalendlyWebhookPayload;
  } catch {
    return Response.json(
      { ok: false, error: 'bad_json', message: 'Body no es JSON válido' },
      { status: 400 },
    );
  }

  const ms = Date.now() - tStart;

  // 4) Dispatch por tipo de evento
  switch (body.event) {
    case 'invitee.created': {
      const payload = body.payload;
      if (!payload) {
        return Response.json(
          { ok: false, error: 'no_payload', event: body.event },
          { status: 400 },
        );
      }

      const email = payload.email?.trim();
      const nombre = (payload.name || `${payload.first_name ?? ''} ${payload.last_name ?? ''}`.trim()).trim();
      const createdAtIso = payload.created_at;
      const startTimeIso = payload.scheduled_event?.start_time;

      if (!email || !nombre || !createdAtIso || !startTimeIso) {
        return Response.json(
          {
            ok: false,
            error: 'incomplete_payload',
            missing: {
              email: !email,
              nombre: !nombre,
              created_at: !createdAtIso,
              start_time: !startTimeIso,
            },
          },
          { status: 400 },
        );
      }

      try {
        const fechaAgenda = isoToFechaTijuana(createdAtIso);
        const fechaJ1 = isoToFechaTijuana(startTimeIso);
        const empresa = extractAnswer(payload.questions_and_answers, ['empresa', 'company', 'organiz']);
        const telefono = extractAnswer(payload.questions_and_answers, ['tel', 'phone', 'celular', 'móvil', 'movil']);

        // Respuestas de calificación — Fase 2 del segundo plan del mentor.
        // Keywords flexibles porque el texto exacto del form puede variar.
        // extractAnswer hace substring match case-insensitive.
        const respuesta_facturacion = extractAnswer(payload.questions_and_answers, [
          'facturación', 'facturacion', 'presupuesto', 'budget', 'ingreso anual', 'ingresos',
        ]);
        const respuesta_colaboradores = extractAnswer(payload.questions_and_answers, [
          'colaborador', 'equipo', 'empleado', 'tamaño', 'tamano', 'cuántas personas', 'cuantas personas',
        ]);
        const respuesta_objetivo = extractAnswer(payload.questions_and_answers, [
          'objetivo', 'lograr', 'meta', 'qué quieres', 'que quieres', 'qué querés', 'que queres',
        ]);
        const respuesta_cuando_empezar = extractAnswer(payload.questions_and_answers, [
          'cuándo empezar', 'cuando empezar', 'cuándo iniciar', 'cuando iniciar', 'cuándo te gustaría', 'cuando te gustaria', 'urgencia', 'cuándo comenzar', 'cuando comenzar',
        ]);

        // UTMs — vienen de la landing (Lovable) que los pasa al booking de
        // Calendly. Calendly los re-emite en payload.tracking. Si el lead es
        // orgánico, tracking puede no venir o venir vacío — todos NULL.
        const tracking = payload.tracking;
        const utm_source = tracking?.utm_source?.trim() || null;
        const utm_medium = tracking?.utm_medium?.trim() || null;
        const utm_campaign = tracking?.utm_campaign?.trim() || null;
        const utm_content = tracking?.utm_content?.trim() || null;

        const { created, lead } = await upsertLeadFromCalendly({
          email,
          nombre,
          fecha_agenda: fechaAgenda,
          fecha_junta_1: fechaJ1,
          empresa,
          telefono,
          utm_source,
          utm_medium,
          utm_campaign,
          utm_content,
          respuesta_facturacion,
          respuesta_colaboradores,
          respuesta_objetivo,
          respuesta_cuando_empezar,
        });

        console.log(
          `[webhook:calendly] ${created ? 'INSERT' : 'UPDATE'} lead id=${lead.id} email=${email} fecha_j1=${fechaJ1} utm_campaign=${utm_campaign ?? '—'} ms=${ms}`,
        );

        return Response.json({
          ok: true,
          event: body.event,
          action: created ? 'created' : 'updated',
          lead_id: lead.id,
          ms,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`[webhook:calendly] error procesando invitee.created: ${message}`);
        return Response.json(
          { ok: false, error: 'processing', message, event: body.event },
          { status: 500 },
        );
      }
    }

    case 'invitee.canceled':
      console.log(`[webhook:calendly] cancelación recibida (ignorada por config MVP)`);
      return Response.json({
        ok: true,
        event: body.event,
        ignored: true,
        reason: 'Cancelaciones se manejan manualmente en /leads/[id]',
      });

    default:
      console.log(`[webhook:calendly] evento no manejado: ${body.event}`);
      return Response.json({ ok: true, event: body.event, ignored: true });
  }
}

// Healthcheck simple por GET (útil para probar que el endpoint existe)
export async function GET() {
  return Response.json({
    ok: true,
    endpoint: 'calendly webhook',
    usage: 'POST con header Calendly-Webhook-Signature',
  });
}
