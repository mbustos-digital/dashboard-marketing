// =============================================================================
// Meta Conversions API (CAPI) — Prompt 6 del plan del mentor
// =============================================================================
// Envía eventos server-side al Pixel de Meta con email/teléfono hasheados.
// Permite que Meta optimice las campañas hacia los perfiles que califican
// (no solo hacia el lead crudo), incluso si el usuario bloquea el pixel
// client-side.
//
// Variables de entorno requeridas:
//   - META_PIXEL_ID
//   - META_CAPI_TOKEN
//   - META_API_VERSION  (opcional, default 'v24.0' — matchea Marketing API)
//
// Regla de oro: CAPI NUNCA debe romper el flujo de negocio. Cualquier error
// se loguea (console.error) pero NO se propaga. updateLead debe seguir
// funcionando aunque Meta esté caído o el token expiró.
// =============================================================================

import 'server-only';
import crypto from 'node:crypto';

// ─────────────────────────────────────────────────────────────────────────────
// Tipos
// ─────────────────────────────────────────────────────────────────────────────

export type CAPIEventParams = {
  eventName: string;
  email: string | null;
  phone: string | null;
  customData?: Record<string, unknown>;
};

// Forma del payload que Meta espera dentro de "data: [...]"
type CAPIDataEntry = {
  event_name: string;
  event_time: number;
  action_source: 'system_generated' | 'website' | 'email' | 'app';
  user_data: {
    em?: string[];
    ph?: string[];
  };
  custom_data?: Record<string, unknown>;
};

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** SHA-256 hex, formato que Meta acepta para identidad del usuario. */
function sha256Hex(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

/**
 * Normaliza email (lowercase + trim) y devuelve su SHA-256.
 * Null si email vacío o inválido.
 */
function hashEmail(email: string | null): string | null {
  if (!email) return null;
  const norm = email.trim().toLowerCase();
  if (!norm || !norm.includes('@')) return null;
  return sha256Hex(norm);
}

/**
 * Normaliza teléfono (solo dígitos, sin espacios/guiones/paréntesis) y
 * devuelve su SHA-256. Null si phone vacío o sin dígitos.
 */
function hashPhone(phone: string | null): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, '');
  if (!digits) return null;
  return sha256Hex(digits);
}

// ─────────────────────────────────────────────────────────────────────────────
// Función principal
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Envía un evento server-side a Meta Conversions API.
 *
 * NUNCA lanza excepciones. Si algo falla (env vars faltantes, red, token
 * inválido, respuesta no-200), loguea por console.error y retorna. El caller
 * no necesita try/catch — pero envolverlo igual es buena práctica para que
 * un bug futuro en este código no rompa updateLead.
 */
export async function sendMetaCAPIEvent(params: CAPIEventParams): Promise<void> {
  const pixelId = process.env.META_PIXEL_ID;
  const accessToken = process.env.META_CAPI_TOKEN;
  const apiVersion = process.env.META_API_VERSION || 'v24.0';

  if (!pixelId || pixelId.startsWith('PENDING')) {
    console.error('[capi] skip: META_PIXEL_ID no configurado');
    return;
  }
  if (!accessToken || accessToken.startsWith('PENDING')) {
    console.error('[capi] skip: META_CAPI_TOKEN no configurado');
    return;
  }

  const emHash = hashEmail(params.email);
  const phHash = hashPhone(params.phone);

  // Meta requiere AL MENOS un identificador del usuario. Si no tenemos email
  // ni teléfono, el evento no será atribuible — mejor saltarlo.
  if (!emHash && !phHash) {
    console.error(`[capi] skip: ${params.eventName} sin email ni phone, no es atribuible`);
    return;
  }

  const user_data: CAPIDataEntry['user_data'] = {};
  if (emHash) user_data.em = [emHash];
  if (phHash) user_data.ph = [phHash];

  const entry: CAPIDataEntry = {
    event_name: params.eventName,
    event_time: Math.floor(Date.now() / 1000),
    action_source: 'system_generated',
    user_data,
    ...(params.customData ? { custom_data: params.customData } : {}),
  };

  const url = `https://graph.facebook.com/${apiVersion}/${pixelId}/events`;

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        data: [entry],
        access_token: accessToken,
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      console.error(
        `[capi] ${params.eventName} HTTP ${res.status} — ${body.slice(0, 300)}`,
      );
      return;
    }

    console.log(`[capi] event sent: ${params.eventName}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[capi] ${params.eventName} network error: ${msg}`);
  }
}
