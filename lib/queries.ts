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
  agendamientos: number;          // Etapa 4 (count leads con fecha_agenda en rango — vía Calendly)
  thanks_views: number | null;    // Etapa 5 (YouTube, video 9-min de intent real)

  // Métrica auxiliar (no es etapa del funnel, mide alcance de página Thanks)
  thanks_prep_views: number | null;
  thanks_prep_days_baseline_only: number;

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

  // Cumulativo histórico (vistas totales desde publicación del video)
  // No es del rango, es global — sirve para dar contexto cuando los deltas
  // diarios apenas empiezan.
  vsl_cumulative_total: number | null;
  thanks_cumulative_total: number | null;
  thanks_prep_cumulative_total: number | null;

  // Fechas de publicación (YYYY-MM-DD) — para que el "histórico" se contextualice
  vsl_published_at: string | null;
  thanks_published_at: string | null;
  thanks_prep_published_at: string | null;
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
  youtube_video_type: 'vsl' | 'thanks' | 'thanks_prep' | null;
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

  // Query del último cumulativo de cada video (raw_payload de la fila más
  // reciente, sin importar fecha — es la "vistas totales del video desde su
  // publicación", para dar contexto cuando el delta diario apenas arranca).
  const ytLatestRes = await supabase
    .from('marketing_metrics_daily')
    .select('youtube_video_type, raw_payload')
    .eq('plataforma', 'youtube')
    .order('created_at', { ascending: false })
    .limit(50); // suficiente para tener al menos 1 fila por video_type
  if (ytLatestRes.error) {
    throw new Error(`Query latest YouTube falló: ${ytLatestRes.error.message}`);
  }
  const ytLatestRows = (ytLatestRes.data ?? []) as Array<{
    youtube_video_type: 'vsl' | 'thanks' | 'thanks_prep' | null;
    raw_payload: { cumulative_views?: number; published_at?: string } | null;
  }>;
  function getLatest(type: 'vsl' | 'thanks' | 'thanks_prep') {
    return ytLatestRows.find((r) => r.youtube_video_type === type);
  }
  function isoToFecha(iso: string | undefined): string | null {
    if (!iso) return null;
    return iso.slice(0, 10); // YYYY-MM-DD
  }
  const vslLatest = getLatest('vsl');
  const thanksLatest = getLatest('thanks');
  const thanksPrepLatest = getLatest('thanks_prep');
  const vsl_cumulative_total = vslLatest?.raw_payload?.cumulative_views ?? null;
  const thanks_cumulative_total = thanksLatest?.raw_payload?.cumulative_views ?? null;
  const thanks_prep_cumulative_total = thanksPrepLatest?.raw_payload?.cumulative_views ?? null;
  const vsl_published_at = isoToFecha(vslLatest?.raw_payload?.published_at);
  const thanks_published_at = isoToFecha(thanksLatest?.raw_payload?.published_at);
  const thanks_prep_published_at = isoToFecha(thanksPrepLatest?.raw_payload?.published_at);

  // Query paralelas: meta + youtube + leads (agendamientos)
  const [metaRes, ytRes, leadsRes] = await Promise.all([
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
    supabase
      .from('leads')
      .select('id', { count: 'exact', head: true })
      .gte('fecha_agenda', start)
      .lte('fecha_agenda', end),
  ]);

  if (metaRes.error) throw new Error(`Query Meta falló: ${metaRes.error.message}`);
  if (ytRes.error) throw new Error(`Query YouTube falló: ${ytRes.error.message}`);
  if (leadsRes.error) throw new Error(`Query leads falló: ${leadsRes.error.message}`);

  const metaRows = (metaRes.data ?? []) as MetaRow[];
  const ytRows = (ytRes.data ?? []) as YouTubeRow[];
  const agendamientos = leadsRes.count ?? 0;

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
  const thanksPrepRows = ytRows.filter((r) => r.youtube_video_type === 'thanks_prep');

  // Solo se cuentan días con dato (no null = delta calculado).
  const vslWithData = vslRows.filter((r) => r.youtube_views !== null);
  const thanksWithData = thanksRows.filter((r) => r.youtube_views !== null);
  const thanksPrepWithData = thanksPrepRows.filter((r) => r.youtube_views !== null);

  const vsl_views = vslRows.length === 0 ? null : sum(vslWithData.map((r) => r.youtube_views));
  const thanks_views = thanksRows.length === 0 ? null : sum(thanksWithData.map((r) => r.youtube_views));
  const thanks_prep_views = thanksPrepRows.length === 0 ? null : sum(thanksPrepWithData.map((r) => r.youtube_views));

  const vsl_days_baseline_only = vslRows.length - vslWithData.length;
  const thanks_days_baseline_only = thanksRows.length - thanksWithData.length;
  const thanks_prep_days_baseline_only = thanksPrepRows.length - thanksPrepWithData.length;

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

  // VSL → Agendamientos: solo si tenemos ambos
  const ratio_vsl_agenda =
    vsl_views !== null && vsl_views > 0 && agendamientos > 0
      ? safeDiv(vsl_views, agendamientos)
      : null;

  // Agendamientos → Thanks: de los que agendaron, cuántos vieron el video Thanks
  const ratio_agenda_thanks =
    agendamientos > 0 && thanks_views !== null && thanks_views > 0
      ? safeDiv(agendamientos, thanks_views)
      : null;

  return {
    start,
    end,
    dias_con_datos: fechasUnicas.size,

    impressions,
    landing_page_views,
    vsl_views,
    agendamientos,
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
    ratio_vsl_agenda,
    ratio_agenda_thanks,

    vsl_days_baseline_only,
    thanks_days_baseline_only,

    thanks_prep_views,
    thanks_prep_days_baseline_only,

    vsl_cumulative_total,
    thanks_cumulative_total,
    thanks_prep_cumulative_total,

    vsl_published_at,
    thanks_published_at,
    thanks_prep_published_at,
  };
}

// =============================================================================
// COHORTES COMERCIALES — Fase 5
// =============================================================================

export type EstadoMadurezCohorte = 'madura' | 'madurando' | 'reciente';

export type CohorteSemana = {
  semana_inicio: string;
  total_j1: number;
  asistencias: number;
  limpias: number;
  cierres: number;
  ingreso_total_usd: number;
  ultima_j1_cohorte: string;
  dias_desde_ultima_j1: number;
  estado_madurez: EstadoMadurezCohorte;
};

export type CohorteMes = {
  mes_inicio: string;
  total_j1: number;
  asistencias: number;
  limpias: number;
  cierres: number;
  ingreso_total_usd: number;
  ultima_j1_cohorte: string;
  dias_desde_ultima_j1: number;
  dias_promedio_ciclo: number | null;
  estado_madurez: EstadoMadurezCohorte;
};

/**
 * Últimas N semanas de cohortes, más recientes primero.
 */
export async function listCohortesSemanales(limit = 8): Promise<CohorteSemana[]> {
  const supabase = getSupabaseServer();
  const { data, error } = await supabase
    .from('v_cohortes_semanales')
    .select('*')
    .order('semana_inicio', { ascending: false })
    .limit(limit);
  if (error) throw new Error(`Query v_cohortes_semanales falló: ${error.message}`);
  return (data ?? []) as CohorteSemana[];
}

/**
 * Últimos N meses de cohortes, más recientes primero.
 */
export async function listCohortesMensuales(limit = 6): Promise<CohorteMes[]> {
  const supabase = getSupabaseServer();
  const { data, error } = await supabase
    .from('v_cohortes_mensuales')
    .select('*')
    .order('mes_inicio', { ascending: false })
    .limit(limit);
  if (error) throw new Error(`Query v_cohortes_mensuales falló: ${error.message}`);
  return (data ?? []) as CohorteMes[];
}

export type ResumenComercialMaduras = {
  // Solo cohortes madura — donde la tasa de cierre es confiable
  total_j1: number;
  asistencias: number;
  limpias: number;
  cierres: number;
  ingreso_total_usd: number;
  cohortes_maduras_count: number;
  // Tasa de cierre = ratio joya = cierres / limpias
  tasa_cierre_madura: number | null; // 0–100
  // Ciclo promedio (días J1 → cierre) — pondera por cohortes mensuales maduras
  dias_promedio_ciclo: number | null;
};

/**
 * Agrega TODAS las cohortes mensuales con estado_madurez='madura'.
 * Es la base honesta para tomar decisiones — las cohortes recientes están
 * incompletas y mentirían en los promedios.
 */
export async function getResumenComercialMaduras(): Promise<ResumenComercialMaduras> {
  const supabase = getSupabaseServer();
  const { data, error } = await supabase
    .from('v_cohortes_mensuales')
    .select('*')
    .eq('estado_madurez', 'madura');
  if (error) throw new Error(`Query maduras falló: ${error.message}`);
  const cohortes = (data ?? []) as CohorteMes[];

  const total_j1 = cohortes.reduce((s, c) => s + (c.total_j1 ?? 0), 0);
  const asistencias = cohortes.reduce((s, c) => s + (c.asistencias ?? 0), 0);
  const limpias = cohortes.reduce((s, c) => s + (c.limpias ?? 0), 0);
  const cierres = cohortes.reduce((s, c) => s + (c.cierres ?? 0), 0);
  const ingreso_total_usd = cohortes.reduce((s, c) => s + Number(c.ingreso_total_usd ?? 0), 0);

  // Tasa cierre = cierres / limpias (ratio joya)
  const tasa_cierre_madura = limpias > 0 ? (cierres / limpias) * 100 : null;

  // Ciclo: promedio ponderado por cierres de cada cohorte
  const cohortesConCiclo = cohortes.filter(
    (c) => c.dias_promedio_ciclo !== null && c.cierres > 0,
  );
  const totalCierresConCiclo = cohortesConCiclo.reduce((s, c) => s + c.cierres, 0);
  const dias_promedio_ciclo =
    totalCierresConCiclo > 0
      ? cohortesConCiclo.reduce(
          (s, c) => s + Number(c.dias_promedio_ciclo!) * c.cierres,
          0,
        ) / totalCierresConCiclo
      : null;

  return {
    total_j1,
    asistencias,
    limpias,
    cierres,
    ingreso_total_usd,
    cohortes_maduras_count: cohortes.length,
    tasa_cierre_madura,
    dias_promedio_ciclo,
  };
}

// =============================================================================
// CAC acumulado (global, todo el histórico desde 1-may-2026)
// =============================================================================
// Definición simple: TODO lo gastado en Meta Ads / TODOS los clientes que han
// cerrado. Se actualiza constantemente conforme entran datos de Meta (diario
// vía cron) o se marcan cierres en /leads.
// =============================================================================

export type CACAcumulado = {
  spend_total_mxn: number;
  cierres_total: number;
  cac_mxn: number | null;       // null si aún no hay cierres
};

export async function getCACAcumulado(): Promise<CACAcumulado> {
  const supabase = getSupabaseServer();

  const [spendRes, cierresRes] = await Promise.all([
    supabase
      .from('marketing_metrics_daily')
      .select('spend')
      .eq('plataforma', 'meta'),
    supabase
      .from('leads')
      .select('id', { count: 'exact', head: true })
      .eq('cerro', true),
  ]);

  if (spendRes.error) throw new Error(`Query spend acumulado falló: ${spendRes.error.message}`);
  if (cierresRes.error) throw new Error(`Query cierres acumulado falló: ${cierresRes.error.message}`);

  const spend_total_mxn = (spendRes.data ?? []).reduce(
    (acc, r) => acc + Number(r.spend ?? 0),
    0,
  );
  const cierres_total = cierresRes.count ?? 0;
  const cac_mxn = cierres_total > 0 ? spend_total_mxn / cierres_total : null;

  return { spend_total_mxn, cierres_total, cac_mxn };
}
