// =============================================================================
// Tipos compartidos del dashboard
// =============================================================================

/**
 * Shape de una fila de la tabla `marketing_metrics_daily` al hacer INSERT/UPSERT.
 * Los campos `id`, `created_at` y `updated_at` los pone la DB automáticamente.
 *
 * Una fila representa la métrica diaria de:
 *   - Un adset (cuando plataforma = 'meta'), o
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

  // YouTube (relleno en Fase 3)
  youtube_video_id?: string | null;
  youtube_video_type?: 'vsl' | 'thanks' | null;
  youtube_views?: number | null;
  youtube_minutes_watched?: number | null;
  youtube_avg_view_duration?: number | null;

  // Payload crudo de la API origen (para debug y reconstrucción)
  raw_payload?: Record<string, unknown> | null;
};

/**
 * Shape raw de un row del endpoint Meta /insights con level=adset.
 * Meta devuelve todos los números como strings; los convertimos al parsear.
 */
export type MetaInsightRaw = {
  adset_id?: string;
  adset_name?: string;
  campaign_id?: string;
  campaign_name?: string;
  account_id?: string;

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

  date_start?: string;
  date_stop?: string;
};
