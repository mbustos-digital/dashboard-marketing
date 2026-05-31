// =============================================================================
// Conector YouTube Data API v3 (Camino A: API Key, sin OAuth)
// =============================================================================
// Estrategia:
//   - YouTube Data API solo devuelve viewCount ACUMULADO desde publicación.
//   - Snapshotteamos diario y calculamos delta vs día anterior para vistas
//     diarias.
//   - Primer día sin datos previos: youtube_views = NULL (baseline).
//   - Del día 2 en adelante: youtube_views = hoy_cum - ayer_cum.
//   - Cumulative se guarda en raw_payload.cumulative_views para usar mañana.
// =============================================================================

import { getSupabaseServer } from './supabase';
import type { MarketingMetricRow } from './types';
import { fetchYouTubeAnalyticsDaily } from './youtube-analytics';

const YOUTUBE_API_BASE = 'https://www.googleapis.com/youtube/v3';

// ─────────────────────────────────────────────────────────────────────────────
// Errores
// ─────────────────────────────────────────────────────────────────────────────

export class YouTubeAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'YouTubeAuthError';
  }
}

export class YouTubeNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'YouTubeNotFoundError';
  }
}

export class YouTubeApiError extends Error {
  constructor(message: string, public code?: number) {
    super(message);
    this.name = 'YouTubeApiError';
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function getEnv(name: string): string {
  const v = process.env[name];
  if (!v || v.startsWith('PENDING')) {
    throw new Error(`Env var ${name} no definida (o aún con placeholder)`);
  }
  return v;
}

function toNum(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Fetch stats from API
// ─────────────────────────────────────────────────────────────────────────────

export type YouTubeStatsRaw = {
  videoId: string;
  title: string;
  publishedAt: string;
  viewCount: number;
  likeCount: number | null;
  commentCount: number | null;
  snapshotAt: string; // ISO timestamp del momento del fetch
};

type ApiResponse = {
  items?: Array<{
    id: string;
    snippet?: { title?: string; publishedAt?: string };
    statistics?: {
      viewCount?: string;
      likeCount?: string;
      commentCount?: string;
    };
  }>;
  error?: { code?: number; message?: string };
};

/**
 * Trae las estadísticas acumuladas de UN video desde YouTube Data API v3.
 */
export async function fetchYouTubeStats(videoId: string): Promise<YouTubeStatsRaw> {
  const apiKey = getEnv('YOUTUBE_API_KEY');

  const url = new URL(`${YOUTUBE_API_BASE}/videos`);
  url.searchParams.set('part', 'snippet,statistics');
  url.searchParams.set('id', videoId);
  url.searchParams.set('key', apiKey);

  const res = await fetch(url.toString(), { method: 'GET' });

  let body: ApiResponse;
  try {
    body = (await res.json()) as ApiResponse;
  } catch {
    throw new YouTubeApiError(`Respuesta no-JSON de YouTube (HTTP ${res.status})`);
  }

  if (body.error) {
    const { code, message } = body.error;
    if (code === 400 || code === 403) {
      throw new YouTubeAuthError(`API Key inválida o sin permisos: ${message}`);
    }
    throw new YouTubeApiError(`YouTube API error: ${message}`, code);
  }

  if (!res.ok) {
    throw new YouTubeApiError(`HTTP ${res.status} de YouTube sin error body`);
  }

  if (!body.items || body.items.length === 0) {
    throw new YouTubeNotFoundError(`Video ${videoId} no encontrado o privado`);
  }

  const item = body.items[0];
  return {
    videoId: item.id,
    title: item.snippet?.title ?? '',
    publishedAt: item.snippet?.publishedAt ?? '',
    viewCount: toNum(item.statistics?.viewCount) ?? 0,
    likeCount: toNum(item.statistics?.likeCount),
    commentCount: toNum(item.statistics?.commentCount),
    snapshotAt: new Date().toISOString(),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Calcular delta y upsert en Supabase
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Tipos de video que trackeamos. 'thanks' es el video principal de la página
 * Thanks (etapa 5 del funnel). 'thanks_prep' es el corto de preparación que
 * mide alcance de la página, no intent.
 */
export type VideoType = 'vsl' | 'thanks' | 'thanks_prep';

/**
 * Procesa UN video (VSL, Thanks o Thanks_prep) usando Camino B (Analytics API).
 * Obtiene vistas DIARIAS reales del día indicado y las upsertea.
 * @returns el row insertado (para logging)
 */
export async function processVideo(
  videoId: string,
  videoType: VideoType,
  fecha: string,
): Promise<{
  inserted: boolean;
  daily_views: number;
  title: string;
}> {
  // Trae stats del día via Analytics API (vistas REALES de ese día, no cumulativo)
  const daily = await fetchYouTubeAnalyticsDaily(videoId, fecha, fecha);
  const stat = daily[0]; // 0 o 1 fila

  // También conseguimos el title via Data API para el log
  let title = '';
  try {
    const dataStats = await fetchYouTubeStats(videoId);
    title = dataStats.title;
  } catch {
    // si Data API falla por cuota o whatever, no es bloqueante
  }

  const row: MarketingMetricRow = {
    fecha,
    plataforma: 'youtube',

    ad_account_id: null,
    campaign_id: null,
    campaign_name: null,
    adset_id: null,
    adset_name: null,

    impressions: null,
    reach: null,
    frequency: null,
    clicks: null,
    link_clicks: null,
    ctr: null,
    cpc: null,
    cpm: null,
    spend: null,

    landing_page_views: null,
    page_views: null,
    cost_per_landing_page_view: null,

    youtube_video_id: videoId,
    youtube_video_type: videoType,
    youtube_views: stat?.views ?? 0,
    youtube_minutes_watched: stat?.estimated_minutes_watched ?? 0,
    youtube_avg_view_duration: stat?.average_view_duration ?? 0,

    raw_payload: {
      source: 'youtube-analytics-api',
      had_data: !!stat,
      title,
    },
  };

  const supabase = getSupabaseServer();

  // DELETE existente para evitar duplicado (mismo día/plataforma/video)
  const { error: delErr } = await supabase
    .from('marketing_metrics_daily')
    .delete()
    .eq('plataforma', 'youtube')
    .eq('youtube_video_id', videoId)
    .eq('fecha', fecha);
  if (delErr) throw new Error(`Error borrando fila previa: ${delErr.message}`);

  const { error: insErr } = await supabase.from('marketing_metrics_daily').insert(row);
  if (insErr) throw new Error(`Error insertando fila: ${insErr.message}`);

  return {
    inserted: true,
    daily_views: stat?.views ?? 0,
    title,
  };
}

/**
 * Itera sobre los videos configurados en env (VSL + Thanks + Thanks_prep).
 * @returns lista de resultados por video.
 */
export async function processAllVideos(
  fecha: string,
): Promise<Array<{
  videoId: string;
  videoType: VideoType;
  status: 'ok' | 'skipped' | 'error';
  daily_views?: number;
  title?: string;
  error?: string;
}>> {
  const results: Array<{
    videoId: string;
    videoType: VideoType;
    status: 'ok' | 'skipped' | 'error';
    daily_views?: number;
    title?: string;
    error?: string;
  }> = [];

  const videos: Array<{ id: string | undefined; type: VideoType }> = [
    { id: process.env.YOUTUBE_VSL_VIDEO_ID, type: 'vsl' },
    { id: process.env.YOUTUBE_THANKS_VIDEO_ID, type: 'thanks' },
    { id: process.env.YOUTUBE_THANKS_PREP_VIDEO_ID, type: 'thanks_prep' },
  ];

  for (const v of videos) {
    if (!v.id || v.id.startsWith('PENDING')) {
      results.push({ videoId: v.id ?? 'unset', videoType: v.type, status: 'skipped' });
      continue;
    }
    try {
      const r = await processVideo(v.id, v.type, fecha);
      results.push({
        videoId: v.id,
        videoType: v.type,
        status: 'ok',
        daily_views: r.daily_views,
        title: r.title,
      });
    } catch (err) {
      results.push({
        videoId: v.id,
        videoType: v.type,
        status: 'error',
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return results;
}
