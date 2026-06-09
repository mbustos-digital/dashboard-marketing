// =============================================================================
// Queries de agregación para el dashboard
// =============================================================================
// getMarketingWindow(start, end) → suma métricas Meta + YouTube de un rango.
// Calcula ratios derivados (1 de cada X).
// =============================================================================

import { getSupabaseServer } from './supabase';
import { TIPO_DE_CAMBIO_USD_MXN } from './config';

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

  // Cierres en la ventana (por fecha_cierre) + CAC = spend / cierres
  cierres_en_ventana: number;
  cac: number | null;

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

  // Query paralelas: meta + youtube + leads (agendamientos) + cierres
  const [metaRes, ytRes, leadsRes, cierresRes] = await Promise.all([
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
    supabase
      .from('leads')
      .select('id', { count: 'exact', head: true })
      .eq('cerro', true)
      .gte('fecha_cierre', start)
      .lte('fecha_cierre', end),
  ]);

  if (metaRes.error) throw new Error(`Query Meta falló: ${metaRes.error.message}`);
  if (ytRes.error) throw new Error(`Query YouTube falló: ${ytRes.error.message}`);
  if (leadsRes.error) throw new Error(`Query leads falló: ${leadsRes.error.message}`);
  if (cierresRes.error) throw new Error(`Query cierres falló: ${cierresRes.error.message}`);

  const metaRows = (metaRes.data ?? []) as MetaRow[];
  const ytRows = (ytRes.data ?? []) as YouTubeRow[];
  const agendamientos = leadsRes.count ?? 0;
  const cierres_en_ventana = cierresRes.count ?? 0;

  // ── Meta aggregates ──
  const impressions = sum(metaRows.map((r) => r.impressions));
  const landing_page_views = sum(metaRows.map((r) => r.landing_page_views));
  const clicks = sum(metaRows.map((r) => r.clicks));
  const link_clicks = sum(metaRows.map((r) => r.link_clicks));
  const reach = sum(metaRows.map((r) => r.reach));
  // Meta devuelve spend en MXN (la cuenta está en MXN). Convertimos a USD
  // ANTES de cualquier cálculo para que los ratios sean válidos contra el
  // revenue en USD. spend_usd ahora es realmente USD (antes era un alias
  // legacy que guardaba MXN).
  const spend_mxn = sum(metaRows.map((r) => r.spend));
  const spend_usd = spend_mxn / TIPO_DE_CAMBIO_USD_MXN;

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

    cierres_en_ventana,
    cac: cierres_en_ventana > 0 ? safeDiv(spend_usd, cierres_en_ventana) : null,

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
// Sirve como referencia de "estado actual" del negocio. Para ver si MEJORAMOS
// mes a mes se debe comparar el CAC de la ventana mensual (mes en curso) vs
// este acumulado o vs meses anteriores.
// =============================================================================

// Toda la app expresa montos en USD post-Fase 1. El spend de Meta llega en
// MXN desde la API; convertimos antes de retornar para que los ratios sean
// matemáticamente válidos.
export type CACAcumulado = {
  spend_total_usd: number;       // convertido desde MXN
  cierres_total: number;
  cac_usd: number | null;        // USD / cliente
};

export async function getCACAcumulado(hastaFecha?: string): Promise<CACAcumulado> {
  const supabase = getSupabaseServer();

  let spendQuery = supabase
    .from('marketing_metrics_daily')
    .select('spend')
    .eq('plataforma', 'meta');
  if (hastaFecha) spendQuery = spendQuery.lte('fecha', hastaFecha);

  let cierresQuery = supabase
    .from('leads')
    .select('id', { count: 'exact', head: true })
    .eq('cerro', true);
  if (hastaFecha) cierresQuery = cierresQuery.lte('fecha_cierre', hastaFecha);

  const [spendRes, cierresRes] = await Promise.all([spendQuery, cierresQuery]);

  if (spendRes.error) throw new Error(`Query spend acumulado falló: ${spendRes.error.message}`);
  if (cierresRes.error) throw new Error(`Query cierres acumulado falló: ${cierresRes.error.message}`);

  const spend_total_mxn = (spendRes.data ?? []).reduce(
    (acc, r) => acc + Number(r.spend ?? 0),
    0,
  );
  const spend_total_usd = spend_total_mxn / TIPO_DE_CAMBIO_USD_MXN;
  const cierres_total = cierresRes.count ?? 0;
  const cac_usd = cierres_total > 0 ? spend_total_usd / cierres_total : null;

  return { spend_total_usd, cierres_total, cac_usd };
}

// =============================================================================
// Revenue del período — Prompt 4
// =============================================================================
// Sección 'Revenue del período':
//   - Sold Revenue: SUM(monto_cierre_usd) de leads con cerro=true y
//     fecha_cierre dentro del período (en USD)
//   - Cash Collected: SUM(total_cobrado_usd) de leads con fecha_primer_pago
//     dentro del período (en USD)
//   - Outstanding: Sold Revenue - Cash Collected
//
// Sección 'Eficiencia':
//   - Meta Spend del período: SUM(spend) de marketing_metrics_daily donde
//     plataforma='meta' (en MXN — Meta cobra en pesos)
//   - CAC real: Meta Spend / cantidad de leads con fecha_primer_pago en el
//     período (¡es MXN/cliente, mezclar con USD daría sin sentido!)
//   - ROAS cash: Cash Collected (USD) / Meta Spend (MXN) — magnitud "x" sin
//     unidad porque mezclamos monedas; igual sirve como tendencia
//   - ROAS sold: Sold Revenue (USD) / Meta Spend (MXN) — idem
// =============================================================================

export type RevenuePeriod = {
  start: string;
  end: string;

  // Revenue del período (USD)
  sold_revenue_usd: number;
  cash_collected_usd: number;
  outstanding_usd: number;

  // Conteos de soporte
  cierres_en_periodo: number;
  primeros_pagos_en_periodo: number;

  // Eficiencia — TODO en USD post-Fase 1 (spend convertido vía
  // TIPO_DE_CAMBIO_USD_MXN). Los ROAS ahora son matemáticamente válidos.
  meta_spend_usd: number;
  cac_usd: number | null;        // USD por cliente nuevo (con primer pago)
  roas_cash: number | null;      // Cash USD ÷ Spend USD — ratio válido
  roas_sold: number | null;      // Sold USD ÷ Spend USD — ratio válido
};

export async function getRevenuePeriod(
  start: string,
  end: string,
): Promise<RevenuePeriod> {
  const supabase = getSupabaseServer();

  const [soldRes, cashRes, spendRes, primerosPagosCountRes] = await Promise.all([
    // Sold: cerros del período
    supabase
      .from('leads')
      .select('monto_cierre_usd')
      .eq('cerro', true)
      .gte('fecha_cierre', start)
      .lte('fecha_cierre', end),
    // Cash: primeros pagos del período
    supabase
      .from('leads')
      .select('total_cobrado_usd')
      .gte('fecha_primer_pago', start)
      .lte('fecha_primer_pago', end),
    // Spend Meta del período (MXN)
    supabase
      .from('marketing_metrics_daily')
      .select('spend')
      .eq('plataforma', 'meta')
      .gte('fecha', start)
      .lte('fecha', end),
    // Count de clientes con primer pago en el período (denominador del CAC real)
    supabase
      .from('leads')
      .select('id', { count: 'exact', head: true })
      .gte('fecha_primer_pago', start)
      .lte('fecha_primer_pago', end),
  ]);

  if (soldRes.error) throw new Error(`Sold falló: ${soldRes.error.message}`);
  if (cashRes.error) throw new Error(`Cash falló: ${cashRes.error.message}`);
  if (spendRes.error) throw new Error(`Spend falló: ${spendRes.error.message}`);
  if (primerosPagosCountRes.error) {
    throw new Error(`Primeros pagos count falló: ${primerosPagosCountRes.error.message}`);
  }

  const sold_revenue_usd = (soldRes.data ?? []).reduce(
    (acc, r) => acc + Number(r.monto_cierre_usd ?? 0),
    0,
  );
  const cash_collected_usd = (cashRes.data ?? []).reduce(
    (acc, r) => acc + Number(r.total_cobrado_usd ?? 0),
    0,
  );
  const outstanding_usd = sold_revenue_usd - cash_collected_usd;

  const meta_spend_mxn = (spendRes.data ?? []).reduce(
    (acc, r) => acc + Number(r.spend ?? 0),
    0,
  );
  // Convertir a USD ANTES de cualquier ratio (Fase 1 del mentor)
  const meta_spend_usd = meta_spend_mxn / TIPO_DE_CAMBIO_USD_MXN;

  const cierres_en_periodo = (soldRes.data ?? []).length;
  const primeros_pagos_en_periodo = primerosPagosCountRes.count ?? 0;

  const cac_usd =
    primeros_pagos_en_periodo > 0 ? meta_spend_usd / primeros_pagos_en_periodo : null;
  const roas_cash =
    meta_spend_usd > 0 ? cash_collected_usd / meta_spend_usd : null;
  const roas_sold =
    meta_spend_usd > 0 ? sold_revenue_usd / meta_spend_usd : null;

  return {
    start,
    end,
    sold_revenue_usd,
    cash_collected_usd,
    outstanding_usd,
    cierres_en_periodo,
    primeros_pagos_en_periodo,
    meta_spend_usd,
    cac_usd,
    roas_cash,
    roas_sold,
  };
}

// =============================================================================
// SCL — Sales Cycle Length (Prompt 5)
// =============================================================================
// Días entre fecha_agenda y fecha_primer_pago. Solo cuenta leads que tengan
// AMBAS fechas. Devuelve promedio y P90 (percentil 90 = el 10% más lento).
//
// Es distinto del dias_promedio_ciclo (J1 → cierre) que ya está en
// v_cohortes_mensuales — ese mide cuándo se cierra la venta, no cuándo se
// hace el primer pago real.
//
// Si hay <3 leads con ambas fechas, devolvemos null en ambos números — no es
// honesto mostrar un promedio con muy pocos datos.
// =============================================================================

export type SCL = {
  count: number;
  avg_dias: number | null;
  p90_dias: number | null;
};

export async function getSCL(): Promise<SCL> {
  const supabase = getSupabaseServer();
  const { data, error } = await supabase
    .from('leads')
    .select('fecha_agenda, fecha_primer_pago')
    .not('fecha_agenda', 'is', null)
    .not('fecha_primer_pago', 'is', null);

  if (error) throw new Error(`Query SCL falló: ${error.message}`);

  const rows = (data ?? []) as Array<{ fecha_agenda: string; fecha_primer_pago: string }>;

  // Calcular días para cada lead. Trabajamos en UTC para evitar issues de DST.
  const dias: number[] = [];
  for (const r of rows) {
    const [ay, am, ad] = r.fecha_agenda.split('-').map(Number);
    const [py, pm, pd] = r.fecha_primer_pago.split('-').map(Number);
    const agenda = Date.UTC(ay, am - 1, ad);
    const pago = Date.UTC(py, pm - 1, pd);
    const d = Math.floor((pago - agenda) / (1000 * 60 * 60 * 24));
    if (d >= 0) dias.push(d); // ignoramos negativos (pago antes de agenda = data corrupta)
  }

  const count = dias.length;

  if (count < 3) {
    return { count, avg_dias: null, p90_dias: null };
  }

  const avg_dias = dias.reduce((s, d) => s + d, 0) / count;

  // P90: ordenamos asc, tomamos el valor en la posición floor(0.9 * (n-1))
  const sorted = [...dias].sort((a, b) => a - b);
  const idx = Math.floor(0.9 * (count - 1));
  const p90_dias = sorted[idx];

  return { count, avg_dias, p90_dias };
}

// =============================================================================
// Distribución del pipeline activo (Prompt 10)
// =============================================================================
// Leads "activos" = asistio_j1=true Y cerro distinto de true (no cerraron
// todavía y siguen en el embudo). Los clasificamos por madurez vs hoy real
// usando los mismos thresholds que estadoMadurezLead.
// =============================================================================

export type DistribucionPipeline = {
  total: number;
  reciente: number;          // <5d desde J1
  madurando: number;         // 5-13d
  madura: number;            // ≥14d
  pct_reciente: number;      // 0-100
  pct_madurando: number;
  pct_madura: number;
};

export async function getDistribucionPipeline(): Promise<DistribucionPipeline> {
  const supabase = getSupabaseServer();

  // Activos = asistieron J1 y NO han cerrado (cerro != true)
  const { data, error } = await supabase
    .from('leads')
    .select('fecha_junta_1, cerro, asistio_j1')
    .eq('asistio_j1', true);

  if (error) throw new Error(`Query distribución pipeline falló: ${error.message}`);

  const activos = (data ?? []).filter((r) => r.cerro !== true && r.fecha_junta_1);

  // Hoy en UTC (consistente con estadoMadurezLead)
  const ahora = new Date();
  const hoyUTC = Date.UTC(
    ahora.getUTCFullYear(),
    ahora.getUTCMonth(),
    ahora.getUTCDate(),
  );

  let reciente = 0;
  let madurando = 0;
  let madura = 0;

  for (const r of activos) {
    if (!r.fecha_junta_1) continue;
    const [y, m, d] = r.fecha_junta_1.split('-').map(Number);
    const fechaJ1UTC = Date.UTC(y, m - 1, d);
    const dias = Math.floor((hoyUTC - fechaJ1UTC) / (1000 * 60 * 60 * 24));
    if (dias >= 14) madura++;
    else if (dias >= 5) madurando++;
    else reciente++;
  }

  const total = reciente + madurando + madura;
  const pct = (n: number) => (total > 0 ? (n / total) * 100 : 0);

  return {
    total,
    reciente,
    madurando,
    madura,
    pct_reciente: pct(reciente),
    pct_madurando: pct(madurando),
    pct_madura: pct(madura),
  };
}

// =============================================================================
// CAC mensual (Prompt 11)
// =============================================================================
// CAC del mes = SUM(spend Meta del mes USD) / leads con fecha_primer_pago en
// el mismo mes. USD/cliente. Solo retornamos meses con ≥1 primer pago.
//
// Post-Fase 1: spend convertido a USD vía TIPO_DE_CAMBIO_USD_MXN.
//
// Se devuelve la lista ordenada cronológicamente (más viejo → más reciente),
// limitada a últimos N meses con datos.
// =============================================================================

export type CACMensualEntry = {
  mes: string;              // 'YYYY-MM'
  spend_usd: number;        // convertido desde MXN
  primeros_pagos: number;
  cac_usd: number;          // USD por cliente — siempre definido (>0 por filtro)
};

export async function listCACMensual(limit = 12): Promise<CACMensualEntry[]> {
  const supabase = getSupabaseServer();

  // Pull spend Meta + leads con fecha_primer_pago en paralelo
  const [spendRes, pagosRes] = await Promise.all([
    supabase
      .from('marketing_metrics_daily')
      .select('fecha, spend')
      .eq('plataforma', 'meta'),
    supabase
      .from('leads')
      .select('fecha_primer_pago')
      .not('fecha_primer_pago', 'is', null),
  ]);

  if (spendRes.error) throw new Error(`Spend mensual falló: ${spendRes.error.message}`);
  if (pagosRes.error) throw new Error(`Pagos mensual falló: ${pagosRes.error.message}`);

  // Agrupar spend por YYYY-MM (sumamos en MXN, convertimos al final del mes)
  const spendPorMes = new Map<string, number>();
  for (const r of spendRes.data ?? []) {
    if (!r.fecha) continue;
    const ym = r.fecha.slice(0, 7); // YYYY-MM
    spendPorMes.set(ym, (spendPorMes.get(ym) ?? 0) + Number(r.spend ?? 0));
  }

  // Contar primeros pagos por YYYY-MM
  const pagosPorMes = new Map<string, number>();
  for (const r of pagosRes.data ?? []) {
    if (!r.fecha_primer_pago) continue;
    const ym = r.fecha_primer_pago.slice(0, 7);
    pagosPorMes.set(ym, (pagosPorMes.get(ym) ?? 0) + 1);
  }

  // Solo meses con ≥1 primer pago
  const entries: CACMensualEntry[] = [];
  for (const [mes, primeros_pagos] of pagosPorMes) {
    if (primeros_pagos <= 0) continue;
    const spend_mxn = spendPorMes.get(mes) ?? 0;
    const spend_usd = spend_mxn / TIPO_DE_CAMBIO_USD_MXN;
    entries.push({
      mes,
      spend_usd,
      primeros_pagos,
      cac_usd: spend_usd / primeros_pagos,
    });
  }

  // Ordenar cronológicamente y truncar
  entries.sort((a, b) => a.mes.localeCompare(b.mes));
  return entries.slice(-limit);
}

