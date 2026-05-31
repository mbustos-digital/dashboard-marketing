// =============================================================================
// Queries de agregación para el dashboard
// =============================================================================
// getMarketingWindow(start, end) → suma métricas Meta + YouTube de un rango.
// Calcula ratios derivados (1 de cada X).
// =============================================================================

import { getSupabaseServer } from './supabase';

export type MarketingWindow = {
  // Rango
  start: string; // YYYY-MM-DD
  end: string;   // YYYY-MM-DD
  dias_con_datos: number;

  // Etapas del funnel (con datos reales cuando están disponibles)
  impressions: number;            // Etapa 1 (Meta)
  landing_page_views: number;     // Etapa 2 (Meta Pixel)
  vsl_views: number | null;       // Etapa 3 (YouTube, null si no configurado)
  // agendamientos (Etapa 4) → null hasta Fase 4 (UI leads)
  thanks_views: number | null;    // Etapa 5 (YouTube, null si no configurado)

  // Métricas Meta auxiliares
  clicks: number;
  link_clicks: number;
  reach: number;
  spend_usd: number;

  // Derivadas
  ctr_global: number | null;
  cpc_global: number | null;
  cpm_global: number | null;
  cpl_global: number | null;

  // Ratios "1 de cada X"
  ratio_imp_landing: number | null;
  ratio_landing_vsl: number | null;     // null si no hay vsl_views
  ratio_vsl_agenda: number | null;      // null hasta Fase 4
  ratio_agenda_thanks: number | null;   // null hasta Fase 4

  // Días con baseline-only de YouTube (sin delta calculable)
  vsl_days_baseline_only: number;
  thanks_days_baseline_only: number;
};

type MetaRow = {
  fecha: string;
  impressions: number | null;
  landing_page_views: number | null;
  clicks: number | null;
  link_clicks: number | null;
  reach: number | null;
  spend: number | null;
};

type YouTubeRow = {
  fecha: string;
  youtube_video_id: string | null;
  youtube_video_type: 'vsl' | 'thanks' | null;
  youtube_views: number | null;
};

function sum(arr: Array<number | null | undefined>): number {
  return arr.reduce<number>((acc, v) => acc + (typeof v === 'number' ? v : 0), 0);
}

function safeDiv(a: number, b: number): number | null {
  if (!b || !Number.isFinite(b)) return null;
  return a / b;
}

export async function getMarketingWindow(
  start: string,
  end: string,
): Promise<MarketingWindow> {
  const supabase = getSupabaseServer();

  // Query paralelas: meta + youtube
  const [metaRes, ytRes] = await Promise.all([
    supabase
      .from('marketing_metrics_daily')
      .select('fecha, impressions, landing_page_views, clicks, link_clicks, reach, spend')
      .eq('plataforma', 'meta')
      .gte('fecha', start)
      .lte('fecha', end),
    supabase
      .from('marketing_metrics_daily')
      .select('fecha, youtube_video_id, youtube_video_type, youtube_views')
      .eq('plataforma', 'youtube')
      .gte('fecha', start)
      .lte('fecha', end),
  ]);

  if (metaRes.error) throw new Error(`Query Meta falló: ${metaRes.error.message}`);
  if (ytRes.error) throw new Error(`Query YouTube falló: ${ytRes.error.message}`);

  const metaRows = (metaRes.data ?? []) as MetaRow[];
  const ytRows = (ytRes.data ?? []) as YouTubeRow[];

  // ── Meta aggregates ──
  const impressions = sum(metaRows.map((r) => r.impressions));
  const landing_page_views = sum(metaRows.map((r) => r.landing_page_views));
  const clicks = sum(metaRows.map((r) => r.clicks));
  const link_clicks = sum(metaRows.map((r) => r.link_clicks));
  const reach = sum(metaRows.map((r) => r.reach));
  const spend_usd = sum(metaRows.map((r) => r.spend));

  // ── YouTube aggregates por tipo ──
  const vslRows = ytRows.filter((r) => r.youtube_video_type === 'vsl');
  const thanksRows = ytRows.filter((r) => r.youtube_video_type === 'thanks');

  // Solo se cuentan días con dato (no null = delta calculado).
  const vslWithData = vslRows.filter((r) => r.youtube_views !== null);
  const thanksWithData = thanksRows.filter((r) => r.youtube_views !== null);

  const vsl_views = vslRows.length === 0 ? null : sum(vslWithData.map((r) => r.youtube_views));
  const thanks_views = thanksRows.length === 0 ? null : sum(thanksWithData.map((r) => r.youtube_views));

  const vsl_days_baseline_only = vslRows.length - vslWithData.length;
  const thanks_days_baseline_only = thanksRows.length - thanksWithData.length;

  // ── Días con datos (algún row meta o youtube ese día) ──
  const fechasUnicas = new Set<string>();
  metaRows.forEach((r) => fechasUnicas.add(r.fecha));
  ytRows.forEach((r) => fechasUnicas.add(r.fecha));

  // ── Ratios ──
  const ratio_imp_landing = safeDiv(impressions, landing_page_views);

  // Landing → VSL: solo si tenemos vsl_views > 0
  const ratio_landing_vsl =
    vsl_views !== null && vsl_views > 0
      ? safeDiv(landing_page_views, vsl_views)
      : null;

  return {
    start,
    end,
    dias_con_datos: fechasUnicas.size,

    impressions,
    landing_page_views,
    vsl_views,
    thanks_views,

    clicks,
    link_clicks,
    reach,
    spend_usd,

    ctr_global: safeDiv(clicks, impressions) !== null ? safeDiv(clicks, impressions)! * 100 : null,
    cpc_global: safeDiv(spend_usd, clicks),
    cpm_global: safeDiv(spend_usd, impressions) !== null ? safeDiv(spend_usd, impressions)! * 1000 : null,
    cpl_global: safeDiv(spend_usd, landing_page_views),

    ratio_imp_landing,
    ratio_landing_vsl,
    ratio_vsl_agenda: null,
    ratio_agenda_thanks: null,

    vsl_days_baseline_only,
    thanks_days_baseline_only,
  };
}
