// =============================================================================
// Queries de agregación para el dashboard
// =============================================================================
// getMarketingWindow(start, end) → suma métricas Meta de un rango de fechas.
// Calcula ratios derivados (1 de cada X).
// =============================================================================

import { getSupabaseServer } from './supabase';

export type MarketingWindow = {
  // Rango
  start: string; // YYYY-MM-DD
  end: string;   // YYYY-MM-DD
  dias_con_datos: number;

  // Etapas del funnel (las que tenemos hoy con datos reales)
  impressions: number;        // Etapa 1
  landing_page_views: number; // Etapa 2
  // vsl_views (Etapa 3) → null hasta Fase 3 (YouTube)
  // agendamientos (Etapa 4) → null hasta Fase 4 (UI leads)
  // thanks_views (Etapa 5) → null hasta Fase 3 (YouTube)

  // Métricas auxiliares
  clicks: number;
  link_clicks: number;
  reach: number;
  spend_usd: number;

  // Derivadas
  ctr_global: number | null;        // (clicks / impressions) * 100
  cpc_global: number | null;        // spend / clicks
  cpm_global: number | null;        // (spend / impressions) * 1000
  cpl_global: number | null;        // spend / landing_page_views (Cost per Landing view)

  // Ratios "1 de cada X" — solo el primero es calculable hoy
  ratio_imp_landing: number | null;     // imp / landing_page_views
  ratio_landing_vsl: number | null;     // null hasta Fase 3
  ratio_vsl_agenda: number | null;      // null hasta Fase 3 + 4
  ratio_agenda_thanks: number | null;   // null hasta Fase 3 + 4
};

type MetricRow = {
  fecha: string;
  impressions: number | null;
  landing_page_views: number | null;
  clicks: number | null;
  link_clicks: number | null;
  reach: number | null;
  spend: number | null;
};

function sum(arr: Array<number | null | undefined>): number {
  return arr.reduce<number>((acc, v) => acc + (typeof v === 'number' ? v : 0), 0);
}

function safeDiv(a: number, b: number): number | null {
  if (!b || !Number.isFinite(b)) return null;
  return a / b;
}

/**
 * Agrega las métricas Meta del rango [start, end] (inclusivo).
 * Suma simple para volumen, ratios recalculados sobre los totales (no promedios).
 */
export async function getMarketingWindow(
  start: string,
  end: string,
): Promise<MarketingWindow> {
  const supabase = getSupabaseServer();

  const { data, error } = await supabase
    .from('marketing_metrics_daily')
    .select('fecha, impressions, landing_page_views, clicks, link_clicks, reach, spend')
    .eq('plataforma', 'meta')
    .gte('fecha', start)
    .lte('fecha', end);

  if (error) throw new Error(`Query Supabase falló: ${error.message}`);

  const rows = (data ?? []) as MetricRow[];

  const impressions = sum(rows.map((r) => r.impressions));
  const landing_page_views = sum(rows.map((r) => r.landing_page_views));
  const clicks = sum(rows.map((r) => r.clicks));
  const link_clicks = sum(rows.map((r) => r.link_clicks));
  const reach = sum(rows.map((r) => r.reach));
  const spend_usd = sum(rows.map((r) => r.spend));

  const fechasUnicas = new Set(rows.map((r) => r.fecha));

  return {
    start,
    end,
    dias_con_datos: fechasUnicas.size,

    impressions,
    landing_page_views,

    clicks,
    link_clicks,
    reach,
    spend_usd,

    ctr_global: safeDiv(clicks, impressions) !== null ? safeDiv(clicks, impressions)! * 100 : null,
    cpc_global: safeDiv(spend_usd, clicks),
    cpm_global: safeDiv(spend_usd, impressions) !== null ? safeDiv(spend_usd, impressions)! * 1000 : null,
    cpl_global: safeDiv(spend_usd, landing_page_views),

    ratio_imp_landing: safeDiv(impressions, landing_page_views),
    ratio_landing_vsl: null,
    ratio_vsl_agenda: null,
    ratio_agenda_thanks: null,
  };
}
