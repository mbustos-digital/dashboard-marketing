// =============================================================================
// Conector de Meta Ads (Graph API /insights)
// =============================================================================
// Responsabilidades:
//   1. fetchMetaInsights(fecha)        → llama Graph API, maneja paginación y
//                                        retries por rate limit, devuelve raw.
//   2. parseInsightsToMetrics(raw,fch) → transforma raw a la shape de la tabla.
//   3. upsertMetrics(metrics)          → escribe en marketing_metrics_daily.
//
// Errores tipados:
//   - MetaTokenError      → código 190 (token inválido/expirado)
//   - MetaRateLimitError  → código 17/4 tras agotar retries
//   - MetaApiError        → cualquier otro error de Meta
// =============================================================================

import { getSupabaseServer } from './supabase';
import type { MarketingMetricRow, MetaInsightRaw, MetaAdsetRaw } from './types';

const GRAPH_BASE = 'https://graph.facebook.com';
const MAX_BACKOFF_ATTEMPTS = 5;
const MAX_PAGES = 50;
const PAGE_SIZE = 100;

// ─────────────────────────────────────────────────────────────────────────────
// Errores
// ─────────────────────────────────────────────────────────────────────────────

export class MetaTokenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MetaTokenError';
  }
}

export class MetaRateLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MetaRateLimitError';
  }
}

export class MetaApiError extends Error {
  constructor(
    message: string,
    public code?: number,
    public subcode?: number,
  ) {
    super(message);
    this.name = 'MetaApiError';
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers internos
// ─────────────────────────────────────────────────────────────────────────────

function getEnv(name: string): string {
  const v = process.env[name];
  if (!v || v.startsWith('PENDING')) {
    throw new Error(`Env var ${name} no definida (o aún con placeholder)`);
  }
  return v;
}

function sleep(ms: number): Promise<void> {
  return new Promise((res) => setTimeout(res, ms));
}

function toNum(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function findActionValue(
  actions: Array<{ action_type: string; value: string }> | undefined,
  type: string,
): number | null {
  if (!actions) return null;
  const found = actions.find((a) => a.action_type === type);
  return found ? toNum(found.value) : null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Fetch (con paginación y backoff)
// ─────────────────────────────────────────────────────────────────────────────

type MetaPageResponse = {
  data?: MetaInsightRaw[];
  paging?: { next?: string };
  error?: {
    message: string;
    code?: number;
    error_subcode?: number;
    type?: string;
  };
};

async function fetchPageWithBackoff(
  url: string,
  attempt = 0,
): Promise<MetaPageResponse> {
  const res = await fetch(url, { method: 'GET' });

  let body: MetaPageResponse;
  try {
    body = (await res.json()) as MetaPageResponse;
  } catch {
    throw new MetaApiError(`Respuesta no-JSON de Meta (HTTP ${res.status})`);
  }

  if (body.error) {
    const { code, error_subcode, message } = body.error;
    if (code === 190) {
      throw new MetaTokenError(`Token Meta inválido o expirado: ${message}`);
    }
    if (code === 17 && error_subcode === 4) {
      if (attempt >= MAX_BACKOFF_ATTEMPTS) {
        throw new MetaRateLimitError(
          `Rate limit excedido tras ${MAX_BACKOFF_ATTEMPTS} intentos: ${message}`,
        );
      }
      const wait = 1000 * 2 ** attempt; // 1s, 2s, 4s, 8s, 16s
      console.warn(
        `[meta] rate limit, esperando ${wait}ms (intento ${attempt + 1})`,
      );
      await sleep(wait);
      return fetchPageWithBackoff(url, attempt + 1);
    }
    throw new MetaApiError(`Meta API error: ${message}`, code, error_subcode);
  }

  if (!res.ok) {
    throw new MetaApiError(`HTTP ${res.status} de Meta sin error body`);
  }

  return body;
}

/**
 * Llama Meta Insights y devuelve TODOS los insights del día especificado
 * (un objeto por adset del Ad Account configurado). Maneja paginación
 * automática y retries por rate limit.
 *
 * @param fecha 'YYYY-MM-DD' — Meta devuelve todo el día completo.
 */
export async function fetchMetaInsights(
  fecha: string,
): Promise<MetaInsightRaw[]> {
  const adAccountId = getEnv('META_AD_ACCOUNT_ID');
  const apiVersion = getEnv('META_API_VERSION');
  const token = getEnv('META_ACCESS_TOKEN');

  const fields = [
    'adset_id',
    'adset_name',
    'campaign_id',
    'campaign_name',
    'account_id',
    'ad_id',
    'ad_name',
    'impressions',
    'reach',
    'frequency',
    'clicks',
    'inline_link_clicks',
    'ctr',
    'cpc',
    'cpm',
    'spend',
    'actions',
    'cost_per_action_type',
    // Métricas de video (Fase 1 v2) — vienen como arrays {action_type, value};
    // se toma el action_type 'video_view'
    'video_thruplay_watched_actions',
    'video_p25_watched_actions',
    'video_p50_watched_actions',
    'video_p75_watched_actions',
    'video_p100_watched_actions',
    'video_avg_time_watched_actions',
  ].join(',');

  const url = new URL(`${GRAPH_BASE}/${apiVersion}/${adAccountId}/insights`);
  url.searchParams.set('level', 'ad');
  url.searchParams.set('fields', fields);
  url.searchParams.set('action_breakdowns', 'action_type');
  url.searchParams.set(
    'time_range',
    JSON.stringify({ since: fecha, until: fecha }),
  );
  url.searchParams.set('limit', String(PAGE_SIZE));
  url.searchParams.set('access_token', token);

  const all: MetaInsightRaw[] = [];
  let nextUrl: string | null = url.toString();
  let pages = 0;

  while (nextUrl) {
    if (++pages > MAX_PAGES) {
      throw new MetaApiError(`Demasiadas páginas (>${MAX_PAGES})`);
    }
    const page = await fetchPageWithBackoff(nextUrl);
    if (Array.isArray(page.data)) all.push(...page.data);
    nextUrl = page.paging?.next ?? null;
  }

  return all;
}

// ─────────────────────────────────────────────────────────────────────────────
// Parse: raw → shape de la tabla
// ─────────────────────────────────────────────────────────────────────────────

export function parseInsightsToMetrics(
  insights: MetaInsightRaw[],
  fecha: string,
): MarketingMetricRow[] {
  return insights.map((ins): MarketingMetricRow => {
    const landingPageViews = findActionValue(ins.actions, 'landing_page_view');
    const pageViews = findActionValue(ins.actions, 'page_view');
    const costPerLPV = findActionValue(
      ins.cost_per_action_type,
      'landing_page_view',
    );

    // Leads del instant form: action_type 'lead'; si no existe, el agrupado
    // onsite_conversion.lead_grouped. NUNCA sumar ambos — es el mismo evento
    // contado dos veces.
    const leadsDirect = findActionValue(ins.actions, 'lead');
    const leadsGrouped = findActionValue(
      ins.actions,
      'onsite_conversion.lead_grouped',
    );
    const leadsCount = leadsDirect ?? leadsGrouped;

    // Video: las *_watched_actions vienen como arrays {action_type, value};
    // el valor real está bajo action_type 'video_view'
    const video3s = findActionValue(ins.actions, 'video_view');
    const videoThruplay = findActionValue(
      ins.video_thruplay_watched_actions,
      'video_view',
    );
    const videoP25 = findActionValue(ins.video_p25_watched_actions, 'video_view');
    const videoP50 = findActionValue(ins.video_p50_watched_actions, 'video_view');
    const videoP75 = findActionValue(ins.video_p75_watched_actions, 'video_view');
    const videoP100 = findActionValue(ins.video_p100_watched_actions, 'video_view');
    const videoAvgWatch = findActionValue(
      ins.video_avg_time_watched_actions,
      'video_view',
    );

    return {
      fecha,
      plataforma: 'meta',

      ad_account_id: ins.account_id ?? null,
      campaign_id: ins.campaign_id ?? null,
      campaign_name: ins.campaign_name ?? null,
      adset_id: ins.adset_id ?? null,
      adset_name: ins.adset_name ?? null,
      ad_id: ins.ad_id ?? null,
      ad_name: ins.ad_name ?? null,

      leads_count: leadsCount,
      video_3s_views: video3s,
      video_thruplay: videoThruplay,
      video_p25: videoP25,
      video_p50: videoP50,
      video_p75: videoP75,
      video_p100: videoP100,
      video_avg_watch_seconds: videoAvgWatch,

      impressions: toNum(ins.impressions),
      reach: toNum(ins.reach),
      frequency: toNum(ins.frequency),
      clicks: toNum(ins.clicks),
      link_clicks: toNum(ins.inline_link_clicks),
      ctr: toNum(ins.ctr),
      cpc: toNum(ins.cpc),
      cpm: toNum(ins.cpm),
      spend: toNum(ins.spend),

      landing_page_views: landingPageViews,
      page_views: pageViews,
      cost_per_landing_page_view: costPerLPV,

      youtube_video_id: null,
      youtube_video_type: null,
      youtube_views: null,
      youtube_minutes_watched: null,
      youtube_avg_view_duration: null,

      raw_payload: ins as unknown as Record<string, unknown>,
    };
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Upsert: escribe en Supabase
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Reemplaza atómicamente las filas Meta del día indicado por el batch nuevo.
 *
 * Estrategia: DELETE + INSERT (en vez de UPSERT) porque nuestro UNIQUE INDEX
 * usa expresiones COALESCE, y supabase-js no acepta onConflict con índices
 * de expresión. La ventana de "no hay datos" durante el cron es de milisegundos
 * y solo afecta lecturas dashboard durante esa fracción de segundo (aceptable
 * para un cron diario sin escritores concurrentes).
 *
 * @returns número de filas insertadas
 */
export async function upsertMetrics(
  metrics: MarketingMetricRow[],
): Promise<number> {
  if (metrics.length === 0) return 0;

  const fecha = metrics[0].fecha;
  if (!metrics.every((m) => m.fecha === fecha)) {
    throw new Error('upsertMetrics: todas las filas deben tener la misma fecha');
  }
  if (!metrics.every((m) => m.plataforma === 'meta')) {
    throw new Error('upsertMetrics: este path solo acepta plataforma=meta');
  }

  const supabase = getSupabaseServer();

  // 1) Borra TODAS las filas Meta de ese día. Si un adset desapareció de Meta,
  //    también desaparece de la DB (queremos reflejar el estado actual del
  //    Ad Account, no acumular fantasmas).
  const { error: delError } = await supabase
    .from('marketing_metrics_daily')
    .delete()
    .eq('fecha', fecha)
    .eq('plataforma', 'meta');

  if (delError) {
    throw new Error(`Error borrando filas previas: ${delError.message}`);
  }

  // 2) Insert del batch nuevo.
  const { data, error } = await supabase
    .from('marketing_metrics_daily')
    .insert(metrics)
    .select('id');

  if (error) {
    throw new Error(`Error insertando metrics: ${error.message}`);
  }

  return data?.length ?? 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// Presupuestos diarios de adsets (Fase 1 v2 — señal de RITMO de Recon)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Trae los adsets del Ad Account con su presupuesto diario y los upsertea en
 * adset_budget_daily para la fecha indicada.
 *
 * Meta solo expone el valor ACTUAL del presupuesto — no hay histórico, por
 * eso este snapshot diario es la única forma de construir la serie. El budget
 * se guarda en MXN crudo (daily_budget llega en CENTAVOS de MXN: /100).
 *
 * @returns número de adsets guardados
 */
export async function fetchAdsetBudgets(fecha: string): Promise<number> {
  const adAccountId = getEnv('META_AD_ACCOUNT_ID');
  const apiVersion = getEnv('META_API_VERSION');
  const token = getEnv('META_ACCESS_TOKEN');

  const url = new URL(`${GRAPH_BASE}/${apiVersion}/${adAccountId}/adsets`);
  url.searchParams.set('fields', 'id,name,daily_budget,status,effective_status');
  url.searchParams.set('limit', String(PAGE_SIZE));
  url.searchParams.set('access_token', token);

  type AdsetsPage = {
    data?: MetaAdsetRaw[];
    paging?: { next?: string };
    error?: { message: string; code?: number; error_subcode?: number };
  };

  const all: MetaAdsetRaw[] = [];
  let nextUrl: string | null = url.toString();
  let pages = 0;

  while (nextUrl) {
    if (++pages > MAX_PAGES) {
      throw new MetaApiError(`Demasiadas páginas de adsets (>${MAX_PAGES})`);
    }
    const page = (await fetchPageWithBackoff(nextUrl)) as AdsetsPage;
    if (Array.isArray(page.data)) all.push(...page.data);
    nextUrl = page.paging?.next ?? null;
  }

  const rows = all
    .filter((a) => a.id)
    .map((a) => ({
      fecha,
      adset_id: a.id!,
      adset_name: a.name ?? null,
      // daily_budget viene en centavos de MXN. Adsets sin budget propio
      // (budget a nivel campaña / CBO) no traen el campo → NULL.
      daily_budget_mxn:
        a.daily_budget !== undefined && a.daily_budget !== null
          ? Number(a.daily_budget) / 100
          : null,
      status: a.effective_status ?? a.status ?? null,
    }));

  if (rows.length === 0) return 0;

  const supabase = getSupabaseServer();
  // PK (fecha, adset_id) → upsert directo es idempotente
  const { error } = await supabase
    .from('adset_budget_daily')
    .upsert(rows, { onConflict: 'fecha,adset_id' });
  if (error) {
    throw new Error(`Error upserteando adset budgets: ${error.message}`);
  }

  return rows.length;
}
