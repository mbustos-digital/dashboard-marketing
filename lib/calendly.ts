// =============================================================================
// Calendly — verificación de firma + parseo de payload
// =============================================================================
// Calendly v2 firma cada webhook con HMAC-SHA256. Header:
//   Calendly-Webhook-Signature: t=1234567890,v1=hex_signature
// Computamos HMAC-SHA256(secret, `${t}.${rawBody}`) y comparamos contra v1.
// También validamos que el timestamp sea reciente (anti-replay).
// =============================================================================

import crypto from 'node:crypto';

const REPLAY_TOLERANCE_SECONDS = 300; // 5 minutos

export class CalendlySignatureError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CalendlySignatureError';
  }
}

/**
 * Verifica la firma de un webhook de Calendly.
 * @throws CalendlySignatureError si la firma es inválida o el timestamp es viejo.
 */
export function verifyCalendlySignature(
  rawBody: string,
  signatureHeader: string | null,
  signingKey: string,
): void {
  if (!signatureHeader) {
    throw new CalendlySignatureError('Falta header Calendly-Webhook-Signature');
  }
  if (!signingKey) {
    throw new CalendlySignatureError('CALENDLY_WEBHOOK_SIGNING_KEY no configurada');
  }

  // Parse "t=...,v1=..."
  const parts = Object.fromEntries(
    signatureHeader.split(',').map((s) => {
      const [k, ...rest] = s.split('=');
      return [k.trim(), rest.join('=').trim()];
    }),
  ) as { t?: string; v1?: string };

  if (!parts.t || !parts.v1) {
    throw new CalendlySignatureError('Header con formato inválido (falta t o v1)');
  }

  // Anti-replay: timestamp no debe estar muy viejo
  const ts = Number(parts.t);
  if (!Number.isFinite(ts)) {
    throw new CalendlySignatureError('Timestamp t no es número');
  }
  const ageSeconds = Math.abs(Math.floor(Date.now() / 1000) - ts);
  if (ageSeconds > REPLAY_TOLERANCE_SECONDS) {
    throw new CalendlySignatureError(`Webhook viejo (${ageSeconds}s, max ${REPLAY_TOLERANCE_SECONDS}s)`);
  }

  // Compute expected signature
  const data = `${parts.t}.${rawBody}`;
  const expected = crypto.createHmac('sha256', signingKey).update(data).digest('hex');

  // timingSafeEqual requiere mismo length
  if (expected.length !== parts.v1.length) {
    throw new CalendlySignatureError('Firma con length distinto a la esperada');
  }
  const ok = crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(parts.v1));
  if (!ok) {
    throw new CalendlySignatureError('Firma no coincide');
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Tipos del payload (lo que nos importa)
// ─────────────────────────────────────────────────────────────────────────────

export type CalendlyWebhookPayload = {
  event: string;
  created_at?: string;
  payload?: CalendlyInviteePayload;
};

export type CalendlyInviteePayload = {
  email?: string;
  name?: string;
  first_name?: string;
  last_name?: string;
  created_at?: string;
  scheduled_event?: {
    start_time?: string;
    end_time?: string;
    uri?: string;
    // event_type: URI del tipo de evento (api.calendly.com/event_types/…)
    // name: nombre visible del tipo de evento. Se usan para distinguir J1/J2.
    event_type?: string;
    name?: string;
  };
  questions_and_answers?: Array<{
    question?: string;
    answer?: string;
  }>;
  cancellation?: {
    reason?: string;
    canceled_by?: string;
  } | null;
  // UTMs pasados por la landing (Lovable) al booking widget de Calendly.
  // Calendly los reenvía dentro de `tracking` en el payload del webhook.
  tracking?: {
    utm_source?: string | null;
    utm_medium?: string | null;
    utm_campaign?: string | null;
    utm_content?: string | null;
    utm_term?: string | null;
    salesforce_uuid?: string | null;
  };
};

/**
 * Clasifica un evento de Calendly como J1, J2 o desconocido (Fase 10).
 *
 * El matcheo es tolerante: compara los valores configurados (env J1/J2, que
 * pueden ser una URI o el nombre del evento) contra los campos del payload
 * (event_type URI, name, uri) por igualdad exacta normalizada O por "slug"
 * (último segmento de la URL). Si no matchea ninguno → 'desconocido', y el
 * caller lo trata como J1 por compatibilidad.
 */
export type TipoJunta = 'j1' | 'j2' | 'desconocido';

function normalizar(s: string): string {
  return s.trim().toLowerCase();
}

function slug(s: string): string {
  // último segmento no vacío de una URL/URI
  const partes = normalizar(s).split('/').filter(Boolean);
  return partes[partes.length - 1] ?? '';
}

function coincide(candidato: string, configurado: string): boolean {
  const a = normalizar(candidato);
  const b = normalizar(configurado);
  if (!a || !b) return false;
  if (a === b) return true;
  // slug vs slug (cubre URL de agenda vs URI de API vs nombre)
  const sa = slug(candidato);
  const sb = slug(configurado);
  return sa !== '' && sa === sb;
}

export function clasificarJunta(
  scheduled: { event_type?: string; name?: string; uri?: string } | undefined,
  cfg: { j1?: string | null; j2?: string | null },
): TipoJunta {
  const candidatos = [scheduled?.event_type, scheduled?.name, scheduled?.uri].filter(
    (c): c is string => !!c && c.trim() !== '',
  );
  if (candidatos.length === 0) return 'desconocido';
  if (cfg.j2 && candidatos.some((c) => coincide(c, cfg.j2!))) return 'j2';
  if (cfg.j1 && candidatos.some((c) => coincide(c, cfg.j1!))) return 'j1';
  return 'desconocido';
}

/**
 * Convierte un ISO timestamp UTC a fecha YYYY-MM-DD en zona Tijuana.
 * Las cohortes están ancladas a "fecha en TJ", consistente con el resto.
 */
export function isoToFechaTijuana(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    throw new Error(`ISO timestamp inválido: ${iso}`);
  }
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Tijuana',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

/**
 * Extrae el primer Q&A cuyo question matche alguno de los keywords.
 * Útil para "Empresa", "Teléfono", etc. — sin asumir labels exactos.
 */
export function extractAnswer(
  qa: CalendlyInviteePayload['questions_and_answers'] | undefined,
  keywords: string[],
): string | null {
  if (!qa) return null;
  const lowered = keywords.map((k) => k.toLowerCase());
  const found = qa.find((item) =>
    item.question && lowered.some((kw) => item.question!.toLowerCase().includes(kw)),
  );
  return found?.answer?.trim() || null;
}
