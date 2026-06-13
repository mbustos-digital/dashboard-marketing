// =============================================================================
// Tipos compartidos del dashboard
// =============================================================================

/**
 * Shape de una fila de la tabla `marketing_metrics_daily` al hacer INSERT/UPSERT.
 * Los campos `id`, `created_at` y `updated_at` los pone la DB automáticamente.
 *
 * Una fila representa la métrica diaria de:
 *   - Un ANUNCIO (cuando plataforma = 'meta', level=ad desde Fase 1 v2;
 *     filas históricas a nivel adset quedan con ad_id NULL), o
 *   - Un video (cuando plataforma = 'youtube').
 */
export type MarketingMetricRow = {
  fecha: string; // YYYY-MM-DD
  plataforma: 'meta' | 'youtube';

  // Identificadores Meta
  ad_account_id?: string | null;
  campaign_id?: string | null;
  campaign_name?: string | null;
  adset_id?: string | null;
  adset_name?: string | null;
  ad_id?: string | null;
  ad_name?: string | null;

  // Métricas top funnel (Meta)
  impressions?: number | null;
  reach?: number | null;
  frequency?: number | null;
  clicks?: number | null;
  link_clicks?: number | null;
  ctr?: number | null;
  cpc?: number | null;
  cpm?: number | null;
  spend?: number | null;

  // Métricas Pixel (Meta)
  landing_page_views?: number | null;
  page_views?: number | null;
  cost_per_landing_page_view?: number | null;

  // Leads del instant form (de Insights, action_type lead — Fase 1 v2)
  leads_count?: number | null;

  // Métricas de video del anuncio (Fase 1 v2 — diagnóstico de consumo Recon)
  video_3s_views?: number | null;
  video_thruplay?: number | null;
  video_p25?: number | null;
  video_p50?: number | null;
  video_p75?: number | null;
  video_p100?: number | null;
  video_avg_watch_seconds?: number | null;

  // YouTube (relleno en Fase 3)
  youtube_video_id?: string | null;
  youtube_video_type?: 'vsl' | 'thanks' | 'thanks_prep' | null;
  youtube_views?: number | null;
  youtube_minutes_watched?: number | null;
  youtube_avg_view_duration?: number | null;

  // Payload crudo de la API origen (para debug y reconstrucción)
  raw_payload?: Record<string, unknown> | null;
};

/**
 * Shape raw de un row del endpoint Meta /insights con level=ad.
 * Meta devuelve todos los números como strings; los convertimos al parsear.
 * Los campos de video vienen como arrays {action_type, value} — se toma el
 * action_type 'video_view'.
 */
export type MetaInsightRaw = {
  adset_id?: string;
  adset_name?: string;
  campaign_id?: string;
  campaign_name?: string;
  account_id?: string;
  ad_id?: string;
  ad_name?: string;

  impressions?: string;
  reach?: string;
  frequency?: string;
  clicks?: string;
  inline_link_clicks?: string;
  ctr?: string;
  cpc?: string;
  cpm?: string;
  spend?: string;

  actions?: Array<{ action_type: string; value: string }>;
  cost_per_action_type?: Array<{ action_type: string; value: string }>;

  video_thruplay_watched_actions?: Array<{ action_type: string; value: string }>;
  video_p25_watched_actions?: Array<{ action_type: string; value: string }>;
  video_p50_watched_actions?: Array<{ action_type: string; value: string }>;
  video_p75_watched_actions?: Array<{ action_type: string; value: string }>;
  video_p100_watched_actions?: Array<{ action_type: string; value: string }>;
  video_avg_time_watched_actions?: Array<{ action_type: string; value: string }>;

  date_start?: string;
  date_stop?: string;
};

/**
 * Shape raw de un adset del edge /adsets (presupuestos — Fase 1 v2).
 * daily_budget viene en CENTAVOS de la moneda de la cuenta (MXN).
 */
export type MetaAdsetRaw = {
  id?: string;
  name?: string;
  daily_budget?: string;
  status?: string;
  effective_status?: string;
};
