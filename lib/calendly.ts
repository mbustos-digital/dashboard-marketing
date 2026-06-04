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
