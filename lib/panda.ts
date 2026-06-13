// =============================================================================
// Cliente de Panda Video — métricas del VSL (Implementación v2, Fase 5)
// =============================================================================
// Dos APIs de Panda:
//   - api-v2.pandavideo.com/videos     → metadata (resolver external_id → id interno)
//   - data.pandavideo.com/general/{id} → serie de plays/views/unique por día
//   - data.pandavideo.com/retention    → engagement % + duration por video
//
// Auth: header `Authorization: <API_KEY>` (SIN prefijo Bearer).
//
// OJO: /general/{id} espera el ID INTERNO del video (no el external_id que
// Martin puso en PANDA_VSL_VIDEO_IDS). Resolvemos external→interno una vez.
// =============================================================================

import 'server-only';

const API_V2 = 'https://api-v2.pandavideo.com';
const DATA = 'https://data.pandavideo.com';

function key(): string {
  const k = process.env.PANDA_API_KEY;
  if (!k || k.startsWith('PENDING')) {
    throw new Error('PANDA_API_KEY no configurada');
  }
  return k;
}

export function getPandaVideoIds(): string[] {
  const raw = process.env.PANDA_VSL_VIDEO_IDS;
  if (!raw) return [];
  return raw.split(',').map((s) => s.trim()).filter(Boolean);
}

async function pandaGet<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: { Authorization: key() } });
  const text = await res.text();
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    throw new Error(`Panda respuesta no-JSON (${res.status}): ${text.slice(0, 120)}`);
  }
  return body as T;
}

// ─────────────────────────────────────────────────────────────────────────────
// Resolver external_id → id interno (cache en memoria del proceso)
// ─────────────────────────────────────────────────────────────────────────────

let _videoCache: Map<string, string> | null = null;

async function getVideoMap(): Promise<Map<string, string>> {
  if (_videoCache) return _videoCache;
  const map = new Map<string, string>();
  // Paginar el listado de videos
  let url: string | null = `${API_V2}/videos?limit=100`;
  let pages = 0;
  while (url && pages++ < 20) {
    const page: { videos?: Array<{ id?: string; video_external_id?: string }>; pagination?: { next?: string } } =
      await pandaGet(url);
    for (const v of page.videos ?? []) {
      if (v.video_external_id && v.id) map.set(v.video_external_id, v.id);
    }
    url = page.pagination?.next ?? null;
  }
  _videoCache = map;
  return map;
}

// ─────────────────────────────────────────────────────────────────────────────
// Métricas diarias por video
// ─────────────────────────────────────────────────────────────────────────────

export type PandaDailyStat = {
  externalId: string;
  fecha: string;            // YYYY-MM-DD
  plays: number;
  unique_viewers: number;
  engagement_pct: number | null;   // % de retención media (0-100)
  duration_seconds: number | null;
  avg_watch_seconds: number | null; // engagement_pct/100 * duration
};

/**
 * Trae las métricas de UN video (por external_id) para UN día.
 * /general entrega buckets (horarios o diarios según rango); sumamos todos
 * los de la fecha para el total del día.
 */
export async function fetchPandaDailyStat(
  externalId: string,
  fecha: string,
): Promise<PandaDailyStat> {
  const map = await getVideoMap();
  const internalId = map.get(externalId);
  if (!internalId) {
    throw new Error(`No se encontró video interno para external_id ${externalId}`);
  }

  // a) Plays/views del día
  const general = await pandaGet<{
    views_data?: Record<string, { play?: number; unique_play?: number }>;
  }>(`${DATA}/general/${internalId}?start_date=${fecha}&end_date=${fecha}`);

  let plays = 0;
  let unique = 0;
  for (const bucket of Object.values(general.views_data ?? {})) {
    plays += Number(bucket.play ?? 0);
    unique += Number(bucket.unique_play ?? 0);
  }

  // b) Retención (engagement % + duration) — endpoint a nivel cuenta, filtramos
  let engagement_pct: number | null = null;
  let duration_seconds: number | null = null;
  try {
    const ret = await pandaGet<{
      videos?: Array<{ engagement?: number | null; duration?: number; video_external_id?: string }>;
    }>(`${DATA}/retention?start_date=${fecha}&end_date=${fecha}`);
    const mine = ret.videos?.find((v) => v.video_external_id === externalId);
    if (mine) {
      engagement_pct = mine.engagement ?? null;
      duration_seconds = mine.duration ?? null;
    }
  } catch {
    // retención es opcional — si falla, plays/unique igual quedan
  }

  const avg_watch_seconds =
    engagement_pct !== null && duration_seconds !== null
      ? (engagement_pct / 100) * duration_seconds
      : null;

  return {
    externalId,
    fecha,
    plays,
    unique_viewers: unique,
    engagement_pct,
    duration_seconds,
    avg_watch_seconds,
  };
}
