// =============================================================================
// Queries de agregación para el dashboard
// =============================================================================
// getMarketingWindow(start, end) → suma métricas Meta + YouTube de un rango.
// Calcula ratios derivados (1 de cada X).
// =============================================================================

import { getSupabaseServer } from './supabase';
import { TIPO_DE_CAMBIO_USD_MXN, DIAS_GRACIA_J2, RECON_LEADS_VALIDACION, RECON_SPEND_SIN_LEADS_USD } from './config';
import { getCashCollectedPeriodo, getOutstandingTotal, getCuotasPendientes } from './pagos';
import { listReviewPendientes } from './review-queue';
import { getSettingNum, getSetting } from './settings';
import { lunesDeFecha } from './date-utils';
import {
  contarVslPlays,
  estadoMadurezLead,
  type Lead,
  type EstadoLead,
  type EstadoMadurez,
} from './leads';

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

  // Query paralelas: meta + youtube + panda + leads (agendamientos) + cierres
  const [metaRes, ytRes, pandaRes, leadsRes, cierresRes] = await Promise.all([
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
    // Panda Video (Fase 5 v2): la fuente honesta del VSL en el presente
    supabase
      .from('marketing_metrics_daily')
      .select('fecha, video_plays')
      .eq('plataforma', 'panda')
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
  if (pandaRes.error) throw new Error(`Query Panda falló: ${pandaRes.error.message}`);
  if (leadsRes.error) throw new Error(`Query leads falló: ${leadsRes.error.message}`);
  if (cierresRes.error) throw new Error(`Query cierres falló: ${cierresRes.error.message}`);

  const metaRows = (metaRes.data ?? []) as MetaRow[];
  const ytRows = (ytRes.data ?? []) as YouTubeRow[];
  const pandaRows = (pandaRes.data ?? []) as Array<{ fecha: string; video_plays: number | null }>;
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

  // VSL unificado: YouTube aporta la historia (24-abr a 10-jun), Panda el
  // presente. Sumamos los plays de Panda a las vistas YouTube del VSL.
  // (Fase 5 v2: youtube no contaba los embeds con autoplay → daba 0%.)
  const pandaPlays = sum(pandaRows.map((r) => r.video_plays));
  const vslYoutube = vslRows.length === 0 ? null : sum(vslWithData.map((r) => r.youtube_views));
  const vsl_views =
    vslYoutube === null && pandaRows.length === 0
      ? null
      : (vslYoutube ?? 0) + pandaPlays;
  const thanks_views = thanksRows.length === 0 ? null : sum(thanksWithData.map((r) => r.youtube_views));
  const thanks_prep_views = thanksPrepRows.length === 0 ? null : sum(thanksPrepWithData.map((r) => r.youtube_views));

  const vsl_days_baseline_only = vslRows.length - vslWithData.length;
  const thanks_days_baseline_only = thanksRows.length - thanksWithData.length;
  const thanks_prep_days_baseline_only = thanksPrepRows.length - thanksPrepWithData.length;

  // ── Días con datos (algún row meta o youtube ese día) ──
  const fechasUnicas = new Set<string>();
  metaRows.forEach((r) => fechasUnicas.add(r.fecha));
  ytRows.forEach((r) => fechasUnicas.add(r.fecha));
  pandaRows.forEach((r) => fechasUnicas.add(r.fecha));

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
  dias_promedio_ciclo: number | null; // J1 → cierre (agregado en 0013)
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
 * Agrega las cohortes SEMANALES con estado_madurez='madura'.
 *
 * FUENTE DE VERDAD ÚNICA del KPI de no-show / ratio joya (Fase 8). Antes esto
 * leía las cohortes MENSUALES, y eso generaba el bug medido en producción:
 * el KPI de no-show daba 0% mientras la cohorte madura de la semana del 4-may
 * mostraba 75%. La causa: la madurez del mes se mide por su ÚLTIMO J1, así que
 * un único J1 tardío de fin de mes volvía 'reciente' a TODO el mes y excluía
 * del KPI semanas tempranas ya maduras (que la tabla sí mostraba como madura).
 *
 * Definición elegida: madurez a nivel SEMANA (cohorte madura ⇔ su último J1 fue
 * hace ≥14 días). Como una semana abarca ≤7 días, una semana madura implica que
 * TODOS sus leads tuvieron ≥14 días para convertir. El KPI agrega exactamente
 * las filas verdes de la tabla semanal → KPI y tabla cuentan lo mismo.
 */
export async function getResumenComercialMaduras(): Promise<ResumenComercialMaduras> {
  const supabase = getSupabaseServer();
  const { data, error } = await supabase
    .from('v_cohortes_semanales')
    .select('*')
    .eq('estado_madurez', 'madura');
  if (error) throw new Error(`Query maduras falló: ${error.message}`);
  const cohortes = (data ?? []) as CohorteSemana[];

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

  // cash_collected y outstanding ahora salen de la tabla `pagos` (Fase 8-bis):
  //   cash    = Σ pagos pagado=true con fecha_pago en el período (inflow real,
  //             incluye cuotas de clientes cerrados en meses previos).
  //   outstanding = Σ pagos no pagados (receivables totales, NO acotado al
  //             período) — es lo que falta cobrar en todo el pipeline.
  const [soldRes, cash_collected_usd, outstanding_usd, spendRes, primerosPagosCountRes] =
    await Promise.all([
      // Sold: cerros del período
      supabase
        .from('leads')
        .select('monto_cierre_usd')
        .eq('cerro', true)
        .gte('fecha_cierre', start)
        .lte('fecha_cierre', end),
      getCashCollectedPeriodo(start, end),
      getOutstandingTotal(),
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
  if (spendRes.error) throw new Error(`Spend falló: ${spendRes.error.message}`);
  if (primerosPagosCountRes.error) {
    throw new Error(`Primeros pagos count falló: ${primerosPagosCountRes.error.message}`);
  }

  const sold_revenue_usd = (soldRes.data ?? []).reduce(
    (acc, r) => acc + Number(r.monto_cierre_usd ?? 0),
    0,
  );
  // outstanding_usd ya viene de getOutstandingTotal() arriba (Σ cuotas no pagadas)

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


// =============================================================================
// FASE 8 — queries para el rediseño visual
// =============================================================================

// ─────────────────────────────────────────────────────────────────────────────
// Funnel de 6 etapas (Prompt 8B) — conversiones entre etapas en un rango
// ─────────────────────────────────────────────────────────────────────────────

export type BloqueFunnel = 'marketing' | 'puente' | 'comercial';

export type FunnelEtapa = {
  key: string;
  label: string;
  bloque: BloqueFunnel;        // marketing / puente (cruza sistemas) / comercial
  entrada: number;
  salida: number;
  pct: number | null;          // salida/entrada * 100, null si entrada=0
  benchmark: string;           // texto del tooltip de info
  // Umbrales para el bullet bar (bandas) y la salud. max = tope de la escala.
  umbral: { rojo: number; ambar: number; max: number };
  salud: 'verde' | 'ambar' | 'rojo' | 'sin_datos';
  fuenteKey: string | null;    // qué fuente alimenta esta etapa (null = carga manual)
  fuente_pendiente: boolean;   // true si su fuente está off (Fase 7) → no es 0%, no existe
  muestra_chica: boolean;      // true si el denominador < 3 → mostrar conteo, no %
};

export type FunnelMes = {
  etapas: FunnelEtapa[];
  cuelloKey: string | null;    // etapa con peor conversión (entre las que tienen datos)
};

// Mínimo de denominador para tratar un % como confiable (Fase 7)
export const MIN_MUESTRA = 3;

export async function getFunnelEtapas(
  start: string,
  end: string,
  sourceMap?: Record<string, 'ok' | 'stale' | 'off'>,
): Promise<FunnelMes> {
  const supabase = getSupabaseServer();

  const [mkt, leadsRes] = await Promise.all([
    getMarketingWindow(start, end),
    supabase
      .from('leads')
      .select('asistio_j1, calificado, estado_lead, fecha_junta_1')
      .gte('fecha_junta_1', start)
      .lte('fecha_junta_1', end),
  ]);

  if (leadsRes.error) throw new Error(`Funnel leads falló: ${leadsRes.error.message}`);
  const rows = leadsRes.data ?? [];

  const total_j1 = rows.length;
  const asistencias = rows.filter((r) => r.asistio_j1 === true).length;
  const limpias = rows.filter((r) => r.asistio_j1 === true && r.calificado === true).length;
  // Cierre = estado_lead 'ganado' (Fase 8), no el viejo booleano cerro.
  const cierres = rows.filter((r) => r.estado_lead === 'ganado').length;

  const pctDe = (salida: number, entrada: number): number | null =>
    entrada > 0 ? (salida / entrada) * 100 : null;

  // Definición en dos bloques + fila puente (Fase 15). Cada etapa lleva su
  // umbral {rojo, ambar, max} — del que se derivan la salud y las bandas del
  // bullet bar.
  const defs: Array<Omit<FunnelEtapa, 'pct' | 'salud' | 'fuente_pendiente' | 'muestra_chica'>> = [
    // ── BLOQUE MARKETING (meta_insights / vsl_panda) ──
    {
      key: 'imp_click',
      label: 'Impresión → Click',
      bloque: 'marketing',
      entrada: mkt.impressions,
      salida: mkt.link_clicks, // CTR de LINK (inline_link_clicks), no clicks totales
      benchmark: 'CTR de link 0.9–1.5% para B2B en MX. <0.5% bajo, >1.5% fuerte. Es link_clicks, no clicks totales.',
      umbral: { rojo: 0.5, ambar: 0.9, max: 3 },
      fuenteKey: 'meta_insights',
    },
    {
      key: 'click_landing',
      label: 'Click → Landing',
      bloque: 'marketing',
      entrada: mkt.link_clicks,
      salida: mkt.landing_page_views,
      benchmark: 'De los que clickean, cuántos cargan la landing. Bajo = la página tarda o pierde gente al entrar.',
      umbral: { rojo: 50, ambar: 70, max: 100 },
      fuenteKey: 'meta_insights',
    },
    {
      key: 'landing_vsl',
      label: 'Landing → VSL',
      bloque: 'marketing',
      entrada: mkt.landing_page_views,
      salida: mkt.vsl_views ?? 0,
      benchmark: 'Referencia interna: <20% es flojo. Comparalo contra tu propio número mes a mes.',
      umbral: { rojo: 20, ambar: 35, max: 100 },
      fuenteKey: 'vsl_panda',
    },
    // ── FILA PUENTE (cruza dos sistemas de medición) ──
    {
      key: 'vsl_agenda',
      label: 'VSL → Agenda',
      bloque: 'puente',
      entrada: mkt.vsl_views ?? 0,
      salida: mkt.agendamientos,
      benchmark: 'Cruza dos sistemas de medición (Panda → Calendly): tomalo como tendencia, no como número exacto. Subirlo = mejor oferta/CTA del VSL.',
      umbral: { rojo: 1, ambar: 3, max: 10 },
      fuenteKey: 'vsl_panda',
    },
    // ── BLOQUE COMERCIAL (calendly + carga manual) ──
    {
      key: 'agenda_asistio',
      label: 'Agenda → Asistió J1',
      bloque: 'comercial',
      entrada: total_j1,
      salida: asistencias,
      benchmark: 'No-show >35% (asistencia <65%) sugiere problema de recordatorios o calificación previa.',
      umbral: { rojo: 65, ambar: 75, max: 100 },
      fuenteKey: 'calendly',
    },
    {
      key: 'asistio_calificado',
      label: 'Asistió → Limpia',
      bloque: 'comercial',
      entrada: asistencias,
      salida: limpias,
      benchmark: 'Mide la calidad del lead que llega a J1. Bajo = atraes al perfil equivocado.',
      umbral: { rojo: 40, ambar: 60, max: 100 },
      fuenteKey: null, // carga manual — siempre "disponible"
    },
    {
      key: 'calificado_cierre',
      label: 'Limpia → Cierre',
      bloque: 'comercial',
      entrada: limpias,
      salida: cierres,
      benchmark: 'Ratio joya. ≥30% sano, 20-30% mixto, <20% problema de venta (J2, oferta, objeciones).',
      umbral: { rojo: 20, ambar: 30, max: 100 },
      fuenteKey: null,
    },
  ];

  const etapas: FunnelEtapa[] = defs.map((d) => {
    const pct = pctDe(d.salida, d.entrada);
    // Fuente off → la etapa no tiene dato (no es 0%), queda fuera del cuello
    const fuente_pendiente = d.fuenteKey != null && sourceMap?.[d.fuenteKey] === 'off';
    // Muestra chica → % no confiable, se trata como sin_datos para el cuello
    const muestra_chica = d.entrada < MIN_MUESTRA;
    const salud: FunnelEtapa['salud'] =
      fuente_pendiente || muestra_chica || pct === null
        ? 'sin_datos'
        : pct < d.umbral.rojo
        ? 'rojo'
        : pct < d.umbral.ambar
        ? 'ambar'
        : 'verde';
    return { ...d, pct, salud, fuente_pendiente, muestra_chica };
  });

  // Cuello de botella: solo etapas con fuente ok y muestra suficiente
  // (las sin_datos ya quedan excluidas porque su salud es 'sin_datos').
  // Tiebreak por SEVERIDAD normalizada contra el propio umbral — así no
  // gana siempre la etapa de escala chica (el CTR ~1%) frente a una de
  // escala grande (el cierre ~30%).
  const rojas = etapas.filter((e) => e.salud === 'rojo');
  const ambars = etapas.filter((e) => e.salud === 'ambar');
  const pool = rojas.length > 0 ? rojas : ambars;
  const severidad = (e: FunnelEtapa): number => {
    const ref = rojas.length > 0 ? e.umbral.rojo : e.umbral.ambar;
    return ref > 0 ? (ref - (e.pct ?? 0)) / ref : 0; // mayor = peor
  };
  const cuello = pool.length > 0
    ? pool.reduce((peor, e) => (severidad(e) > severidad(peor) ? e : peor))
    : null;

  return { etapas, cuelloKey: cuello?.key ?? null };
}

// =============================================================================
// FUNNEL — serie semanal por etapa (Fase 15)
// =============================================================================
// Por cada etapa, el pct de las últimas `semanas` semanas. Semanas sin
// denominador devuelven null (no 0) — una sparkline honesta.
// =============================================================================

export type FunnelSeries = Record<string, Array<number | null>>;

export async function getFunnelSeries(
  end: string = new Date().toISOString().slice(0, 10),
  semanas = 12,
): Promise<FunnelSeries> {
  const supabase = getSupabaseServer();

  // Semanas (lunes) más viejas → más nuevas
  const ultimoLunes = lunesDeFecha(end);
  const inicios: string[] = [];
  for (let i = semanas - 1; i >= 0; i--) inicios.push(restarDiasISO(ultimoLunes, i * 7));
  const rangoInicio = inicios[0];
  const rangoFin = restarDiasISO(ultimoLunes, -6); // domingo de la última semana

  const [metaRes, pandaRes, agendaRes, j1Res] = await Promise.all([
    supabase
      .from('marketing_metrics_daily')
      .select('fecha, impressions, link_clicks, landing_page_views')
      .eq('plataforma', 'meta')
      .gte('fecha', rangoInicio)
      .lte('fecha', rangoFin),
    supabase
      .from('marketing_metrics_daily')
      .select('fecha, video_plays')
      .eq('plataforma', 'panda')
      .gte('fecha', rangoInicio)
      .lte('fecha', rangoFin),
    supabase
      .from('leads')
      .select('fecha_agenda')
      .gte('fecha_agenda', rangoInicio)
      .lte('fecha_agenda', rangoFin),
    supabase
      .from('leads')
      .select('fecha_junta_1, asistio_j1, calificado, estado_lead')
      .gte('fecha_junta_1', rangoInicio)
      .lte('fecha_junta_1', rangoFin),
  ]);

  for (const r of [metaRes, pandaRes, agendaRes, j1Res]) {
    if (r.error) throw new Error(`getFunnelSeries falló: ${r.error.message}`);
  }

  // Índice de semana de una fecha = lunes de esa fecha
  const semanaDe = (fecha: string): string => lunesDeFecha(fecha);

  // Acumuladores por semana
  type Acc = { imp: number; clk: number; land: number; vsl: number; agenda: number; j1: number; asis: number; lmp: number; cie: number };
  const porSemana = new Map<string, Acc>();
  for (const s of inicios) porSemana.set(s, { imp: 0, clk: 0, land: 0, vsl: 0, agenda: 0, j1: 0, asis: 0, lmp: 0, cie: 0 });
  const add = (semana: string, f: (a: Acc) => void) => {
    const a = porSemana.get(semana);
    if (a) f(a);
  };

  for (const r of (metaRes.data ?? []) as Array<{ fecha: string; impressions: number | null; link_clicks: number | null; landing_page_views: number | null }>) {
    add(semanaDe(r.fecha), (a) => { a.imp += r.impressions ?? 0; a.clk += r.link_clicks ?? 0; a.land += r.landing_page_views ?? 0; });
  }
  for (const r of (pandaRes.data ?? []) as Array<{ fecha: string; video_plays: number | null }>) {
    add(semanaDe(r.fecha), (a) => { a.vsl += r.video_plays ?? 0; });
  }
  for (const r of (agendaRes.data ?? []) as Array<{ fecha_agenda: string | null }>) {
    if (r.fecha_agenda) add(semanaDe(r.fecha_agenda), (a) => { a.agenda += 1; });
  }
  for (const r of (j1Res.data ?? []) as Array<{ fecha_junta_1: string | null; asistio_j1: boolean | null; calificado: boolean | null; estado_lead: string }>) {
    if (!r.fecha_junta_1) continue;
    add(semanaDe(r.fecha_junta_1), (a) => {
      a.j1 += 1;
      if (r.asistio_j1 === true) a.asis += 1;
      if (r.asistio_j1 === true && r.calificado === true) a.lmp += 1;
      if (r.estado_lead === 'ganado') a.cie += 1;
    });
  }

  const ratio = (num: number, den: number): number | null => (den > 0 ? (num / den) * 100 : null);
  const serie = (f: (a: Acc) => number | null): Array<number | null> =>
    inicios.map((s) => f(porSemana.get(s)!));

  return {
    imp_click: serie((a) => ratio(a.clk, a.imp)),
    click_landing: serie((a) => ratio(a.land, a.clk)),
    landing_vsl: serie((a) => ratio(a.vsl, a.land)),
    vsl_agenda: serie((a) => ratio(a.agenda, a.vsl)),
    agenda_asistio: serie((a) => ratio(a.asis, a.j1)),
    asistio_calificado: serie((a) => ratio(a.lmp, a.asis)),
    calificado_cierre: serie((a) => ratio(a.cie, a.lmp)),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Anuncios ganadores (Prompt 8B) — leads agrupados por meta_ad_name
// ─────────────────────────────────────────────────────────────────────────────

// =============================================================================
// PANEL RECON — señales por anuncio (Fase 17)
// =============================================================================
// La metodología de Jan: NO se decide con métricas de consumo (hook/hold/CTR).
// Se decide con dos señales: INTENCIÓN (≥10 instant forms por versión de
// oferta) y RITMO de presupuesto (el adset gasta su techo 3 días seguidos).
// Intención sin ritmo = falso positivo → bolitas de nieve (réplicas), no
// escalar vertical.
// =============================================================================

export type RitmoEstado = 'verde' | 'cruz' | 'sin_datos';
export type ReconVeredicto = 'explorando' | 'validada' | 'falso_positivo' | 'apagar' | 'pausada';

export type SenalRecon = {
  ad_id: string;
  ad_name: string;
  campana: string | null;
  adset_name: string | null;
  spend_usd: number;
  leads: number;                 // leads_count acumulado del rango
  meta_leads: number;            // RECON_LEADS_VALIDACION
  dias_corriendo: number;        // días con spend > 0
  ritmo: RitmoEstado;
  ritmo_dias: Array<{ fecha: string; spend_usd: number; budget_usd: number; ok: boolean }>;
  veredicto: ReconVeredicto;
  // Downstream (de leads matcheados por meta_ad_id)
  agendas: number;
  cierres: number;
  cash_usd: number;
  // Diagnóstico de consumo (solo para arreglar el creativo, NO para decidir)
  hook_rate: number | null;      // video_3s / impresiones
  hold_rate: number | null;      // thruplay / video_3s
  ctr_link: number | null;
  cpl_usd: number | null;
  frequency: number | null;
};

export async function getSenalesRecon(
  start: string,
  end: string,
): Promise<SenalRecon[]> {
  const supabase = getSupabaseServer();
  const [adsRes, budgetRes, leadsRes] = await Promise.all([
    supabase
      .from('marketing_metrics_daily')
      .select('fecha, ad_id, ad_name, campaign_name, adset_id, adset_name, spend, leads_count, impressions, link_clicks, video_3s_views, video_thruplay, frequency')
      .eq('plataforma', 'meta')
      .not('ad_id', 'is', null)
      .gte('fecha', start)
      .lte('fecha', end),
    supabase
      .from('adset_budget_daily')
      .select('fecha, adset_id, daily_budget_mxn')
      .gte('fecha', start)
      .lte('fecha', end),
    supabase
      .from('leads')
      .select('meta_ad_id, fecha_agenda, estado_lead, total_cobrado_usd')
      .not('meta_ad_id', 'is', null),
  ]);
  for (const r of [adsRes, budgetRes, leadsRes]) if (r.error) throw new Error(`getSenalesRecon falló: ${r.error.message}`);

  type AdRow = { fecha: string; ad_id: string; ad_name: string | null; campaign_name: string | null; adset_id: string | null; adset_name: string | null; spend: number | null; leads_count: number | null; impressions: number | null; link_clicks: number | null; video_3s_views: number | null; video_thruplay: number | null; frequency: number | null };
  const adRows = (adsRes.data ?? []) as AdRow[];

  // Gasto diario por adset (suma de sus anuncios) — para la señal de ritmo.
  const adsetDaySpendMxn = new Map<string, number>(); // key `${adset_id}|${fecha}`
  for (const r of adRows) {
    if (!r.adset_id) continue;
    const k = `${r.adset_id}|${r.fecha}`;
    adsetDaySpendMxn.set(k, (adsetDaySpendMxn.get(k) ?? 0) + Number(r.spend ?? 0));
  }
  // Presupuestos por adset/fecha
  const budgetByAdsetDay = new Map<string, number>();
  const budgetDaysByAdset = new Map<string, string[]>();
  for (const b of (budgetRes.data ?? []) as Array<{ fecha: string; adset_id: string; daily_budget_mxn: number | null }>) {
    budgetByAdsetDay.set(`${b.adset_id}|${b.fecha}`, Number(b.daily_budget_mxn ?? 0));
    const arr = budgetDaysByAdset.get(b.adset_id) ?? [];
    arr.push(b.fecha);
    budgetDaysByAdset.set(b.adset_id, arr);
  }

  // Downstream por ad_id (leads reales matcheados)
  const downByAd = new Map<string, { agendas: number; cierres: number; cash: number }>();
  for (const l of (leadsRes.data ?? []) as Array<{ meta_ad_id: string | null; fecha_agenda: string | null; estado_lead: string; total_cobrado_usd: number | null }>) {
    if (!l.meta_ad_id) continue;
    const d = downByAd.get(l.meta_ad_id) ?? { agendas: 0, cierres: 0, cash: 0 };
    if (l.fecha_agenda) d.agendas += 1;
    if (l.estado_lead === 'ganado') d.cierres += 1;
    d.cash += Number(l.total_cobrado_usd ?? 0);
    downByAd.set(l.meta_ad_id, d);
  }

  // Agregar por anuncio
  type Acc = { ad_name: string | null; campana: string | null; adset_id: string | null; adset_name: string | null; spendMxn: number; leads: number; imp: number; clk: number; v3: number; thru: number; freqVals: number[]; diasSpend: Set<string>; fechasSpend: string[] };
  const porAd = new Map<string, Acc>();
  for (const r of adRows) {
    const a = porAd.get(r.ad_id) ?? { ad_name: r.ad_name, campana: r.campaign_name, adset_id: r.adset_id, adset_name: r.adset_name, spendMxn: 0, leads: 0, imp: 0, clk: 0, v3: 0, thru: 0, freqVals: [], diasSpend: new Set<string>(), fechasSpend: [] };
    const sp = Number(r.spend ?? 0);
    a.spendMxn += sp;
    a.leads += Number(r.leads_count ?? 0);
    a.imp += Number(r.impressions ?? 0);
    a.clk += Number(r.link_clicks ?? 0);
    a.v3 += Number(r.video_3s_views ?? 0);
    a.thru += Number(r.video_thruplay ?? 0);
    if (r.frequency) a.freqVals.push(Number(r.frequency));
    if (sp > 0) { a.diasSpend.add(r.fecha); a.fechasSpend.push(r.fecha); }
    porAd.set(r.ad_id, a);
  }

  const ultimos3 = (() => {
    // últimos 3 días del rango (calendario), para "pausada"
    const arr: string[] = [];
    for (let i = 0; i < 3; i++) arr.push(restarDiasISO(end, i));
    return new Set(arr);
  })();

  const señales: SenalRecon[] = [];
  for (const [adId, a] of porAd) {
    const spendUsd = a.spendMxn / TIPO_DE_CAMBIO_USD_MXN;
    const down = downByAd.get(adId) ?? { agendas: 0, cierres: 0, cash: 0 };
    const diasCorriendo = a.diasSpend.size;

    // RITMO: últimos 3 días con presupuesto del adset padre
    let ritmo: RitmoEstado = 'sin_datos';
    const ritmoDias: SenalRecon['ritmo_dias'] = [];
    if (a.adset_id) {
      const days = (budgetDaysByAdset.get(a.adset_id) ?? []).slice().sort().reverse().slice(0, 3);
      if (days.length === 3) {
        let todosOk = true;
        for (const f of days.slice().reverse()) {
          const budgetMxn = budgetByAdsetDay.get(`${a.adset_id}|${f}`) ?? 0;
          const spMxn = adsetDaySpendMxn.get(`${a.adset_id}|${f}`) ?? 0;
          const ok = budgetMxn > 0 && spMxn >= 0.99 * budgetMxn;
          if (!ok) todosOk = false;
          ritmoDias.push({ fecha: f, spend_usd: spMxn / TIPO_DE_CAMBIO_USD_MXN, budget_usd: budgetMxn / TIPO_DE_CAMBIO_USD_MXN, ok });
        }
        ritmo = todosOk ? 'verde' : 'cruz';
      }
    }

    // VEREDICTO
    const conSpendReciente = a.fechasSpend.some((f) => ultimos3.has(f));
    let veredicto: ReconVeredicto;
    if (!conSpendReciente) {
      veredicto = 'pausada';
    } else if (spendUsd >= RECON_SPEND_SIN_LEADS_USD && a.leads === 0 && diasCorriendo >= 4) {
      veredicto = 'apagar';
    } else if (a.leads >= RECON_LEADS_VALIDACION) {
      veredicto = ritmo === 'verde' ? 'validada' : ritmo === 'cruz' ? 'falso_positivo' : 'explorando';
    } else {
      veredicto = 'explorando';
    }

    señales.push({
      ad_id: adId,
      ad_name: a.ad_name ?? adId,
      campana: a.campana,
      adset_name: a.adset_name,
      spend_usd: spendUsd,
      leads: a.leads,
      meta_leads: RECON_LEADS_VALIDACION,
      dias_corriendo: diasCorriendo,
      ritmo,
      ritmo_dias: ritmoDias,
      veredicto,
      agendas: down.agendas,
      cierres: down.cierres,
      cash_usd: down.cash,
      hook_rate: a.imp > 0 ? (a.v3 / a.imp) * 100 : null,
      hold_rate: a.v3 > 0 ? (a.thru / a.v3) * 100 : null,
      ctr_link: a.imp > 0 ? (a.clk / a.imp) * 100 : null,
      cpl_usd: a.leads > 0 ? spendUsd / a.leads : null,
      frequency: a.freqVals.length > 0 ? a.freqVals.reduce((s, v) => s + v, 0) / a.freqVals.length : null,
    });
  }

  return señales.sort((x, y) => y.leads - x.leads || y.spend_usd - x.spend_usd);
}

// ─────────────────────────────────────────────────────────────────────────────
// Tramos del ciclo de venta (Prompt 8C) — línea de tiempo promedio
// ─────────────────────────────────────────────────────────────────────────────

export type TramoSCL = {
  label: string;
  dias_promedio: number | null;  // null si <1 lead con ambas fechas
  n: number;                     // leads con ambas fechas del tramo
};

export type TramosSCL = {
  tramos: TramoSCL[];
  tramo_mas_lento: string | null;
};

export async function getTramosSCL(): Promise<TramosSCL> {
  const supabase = getSupabaseServer();
  const { data, error } = await supabase
    .from('leads')
    .select('fecha_agenda, fecha_junta_1, fecha_junta_2, fecha_confirmacion, fecha_primer_pago');
  if (error) throw new Error(`Tramos SCL falló: ${error.message}`);

  const dias = (a: string | null, b: string | null): number | null => {
    if (!a || !b) return null;
    const [ay, am, ad] = a.split('-').map(Number);
    const [by, bm, bd] = b.split('-').map(Number);
    const d = Math.floor((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86400000);
    return d >= 0 ? d : null;
  };

  const defs: Array<{ label: string; from: string; to: string }> = [
    { label: 'Agenda → Junta 1', from: 'fecha_agenda', to: 'fecha_junta_1' },
    { label: 'Junta 1 → Junta 2', from: 'fecha_junta_1', to: 'fecha_junta_2' },
    { label: 'Junta 2 → Confirmó', from: 'fecha_junta_2', to: 'fecha_confirmacion' },
    { label: 'Confirmó → Primer pago', from: 'fecha_confirmacion', to: 'fecha_primer_pago' },
  ];

  type Row = Record<string, string | null>;
  const rows = (data ?? []) as Row[];

  const tramos: TramoSCL[] = defs.map((def) => {
    const vals: number[] = [];
    for (const r of rows) {
      const d = dias(r[def.from], r[def.to]);
      if (d !== null) vals.push(d);
    }
    return {
      label: def.label,
      n: vals.length,
      dias_promedio: vals.length > 0 ? vals.reduce((s, v) => s + v, 0) / vals.length : null,
    };
  });

  const conDatos = tramos.filter((t) => t.dias_promedio !== null);
  const tramo_mas_lento = conDatos.length > 0
    ? conDatos.reduce((max, t) => ((t.dias_promedio ?? 0) > (max.dias_promedio ?? 0) ? t : max)).label
    : null;

  return { tramos, tramo_mas_lento };
}

// ─────────────────────────────────────────────────────────────────────────────
// Resumen comparativo mes actual vs anterior (Prompt 8A) — 4 números + tendencia
// ─────────────────────────────────────────────────────────────────────────────

// Métrica MTD: valor actual (1→hoy), mismo período del mes anterior, y
// proyección de cierre de mes (ritmo diario × días del mes).
export type MetricaMTD = { actual: number; anterior: number; proyeccion: number };

export type ResumenComparativo = {
  inversion_usd: MetricaMTD;
  agendas: MetricaMTD;
  cash_usd: MetricaMTD;
  cierres: MetricaMTD;
  etiqueta_anterior: string;   // "mismo período de mayo"
};

export type CompareMTD = {
  actualInicio: string;
  actualFin: string;       // = hoy
  anteriorInicio: string;
  anteriorFin: string;     // mismo día del mes anterior (capeado al fin de mes)
  etiqueta: string;        // "mismo período de mayo"
  diaDelMes: number;
  diasEnMesActual: number;
};

/**
 * Comparación justa MTD (Fase 16): contra el MISMO rango de días del mes
 * anterior (del 1 al día de hoy), no contra el mes anterior completo.
 */
export function compareMTD(hoy: string): CompareMTD {
  const [y, m, d] = hoy.split('-').map(Number);
  const p2 = (n: number) => String(n).padStart(2, '0');
  const actualInicio = `${y}-${p2(m)}-01`;

  // Mes anterior
  const prev = new Date(Date.UTC(y, m - 2, 1)); // m-2 = mes anterior (0-based)
  const py = prev.getUTCFullYear();
  const pm = prev.getUTCMonth() + 1;
  const anteriorInicio = `${py}-${p2(pm)}-01`;
  const ultimoDiaPrev = new Date(Date.UTC(py, pm, 0)).getUTCDate();
  const diaCap = Math.min(d, ultimoDiaPrev);
  const anteriorFin = `${py}-${p2(pm)}-${p2(diaCap)}`;

  const nombreMes = new Intl.DateTimeFormat('es-MX', { month: 'long', timeZone: 'UTC' })
    .format(new Date(Date.UTC(py, pm - 1, 1)));
  const diasEnMesActual = new Date(Date.UTC(y, m, 0)).getUTCDate();

  return {
    actualInicio,
    actualFin: hoy,
    anteriorInicio,
    anteriorFin,
    etiqueta: `mismo período de ${nombreMes}`,
    diaDelMes: d,
    diasEnMesActual,
  };
}

export async function getResumenComparativo(hoy: string): Promise<ResumenComparativo> {
  const c = compareMTD(hoy);
  const [mktAct, mktAnt, revAct, revAnt] = await Promise.all([
    getMarketingWindow(c.actualInicio, c.actualFin),
    getMarketingWindow(c.anteriorInicio, c.anteriorFin),
    getRevenuePeriod(c.actualInicio, c.actualFin),
    getRevenuePeriod(c.anteriorInicio, c.anteriorFin),
  ]);

  // Proyección a fin de mes: ritmo diario MTD × días del mes.
  const proy = (actual: number) =>
    c.diaDelMes > 0 ? (actual / c.diaDelMes) * c.diasEnMesActual : actual;

  const mtd = (actual: number, anterior: number): MetricaMTD => ({
    actual,
    anterior,
    proyeccion: proy(actual),
  });

  return {
    inversion_usd: mtd(mktAct.spend_usd, mktAnt.spend_usd),
    agendas: mtd(mktAct.agendamientos, mktAnt.agendamientos),
    cash_usd: mtd(revAct.cash_collected_usd, revAnt.cash_collected_usd),
    cierres: mtd(revAct.cierres_en_periodo, revAnt.cierres_en_periodo),
    etiqueta_anterior: c.etiqueta,
  };
}

// =============================================================================
// Serie diaria del VSL (Fase 5 v2) — para la card del tab Marketing
// =============================================================================
// Unifica YouTube (historia) + Panda (presente) en una sola línea de plays.

export type VslSerie = {
  dias: Array<{ fecha: string; plays: number }>;
  total_plays: number;
  unique_viewers: number | null;     // de Panda (YouTube no lo da por día)
  retention_pct: number | null;      // engagement medio de Panda
  avg_watch_seconds: number | null;
  fuente_panda_activa: boolean;       // hay filas panda recientes
};

export async function getVslSerie(dias = 56): Promise<VslSerie> {
  const supabase = getSupabaseServer();
  const hasta = new Date();
  const desde = new Date(hasta.getTime() - dias * 86400_000);
  const fmt = (d: Date) =>
    `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
  const desdeStr = fmt(desde);
  const hastaStr = fmt(hasta);

  const [ytRes, pandaRes] = await Promise.all([
    supabase
      .from('marketing_metrics_daily')
      .select('fecha, youtube_views')
      .eq('plataforma', 'youtube')
      .eq('youtube_video_type', 'vsl')
      .gte('fecha', desdeStr)
      .lte('fecha', hastaStr),
    supabase
      .from('marketing_metrics_daily')
      .select('fecha, video_plays, video_unique_viewers, video_retention_p50, video_avg_watch_seconds')
      .eq('plataforma', 'panda')
      .gte('fecha', desdeStr)
      .lte('fecha', hastaStr),
  ]);

  if (ytRes.error) throw new Error(`VSL serie YouTube falló: ${ytRes.error.message}`);
  if (pandaRes.error) throw new Error(`VSL serie Panda falló: ${pandaRes.error.message}`);

  const porFecha = new Map<string, number>();
  for (const r of ytRes.data ?? []) {
    porFecha.set(r.fecha, (porFecha.get(r.fecha) ?? 0) + Number(r.youtube_views ?? 0));
  }
  let unique = 0;
  let retSum = 0;
  let retN = 0;
  let watchSum = 0;
  let watchN = 0;
  for (const r of pandaRes.data ?? []) {
    porFecha.set(r.fecha, (porFecha.get(r.fecha) ?? 0) + Number(r.video_plays ?? 0));
    unique += Number(r.video_unique_viewers ?? 0);
    if (r.video_retention_p50 !== null && r.video_retention_p50 !== undefined) {
      retSum += Number(r.video_retention_p50);
      retN++;
    }
    if (r.video_avg_watch_seconds !== null && r.video_avg_watch_seconds !== undefined) {
      watchSum += Number(r.video_avg_watch_seconds);
      watchN++;
    }
  }

  const diasArr = [...porFecha.entries()]
    .map(([fecha, plays]) => ({ fecha, plays }))
    .sort((a, b) => a.fecha.localeCompare(b.fecha));

  const total_plays = diasArr.reduce((s, d) => s + d.plays, 0);
  const pandaRows = pandaRes.data ?? [];

  return {
    dias: diasArr,
    total_plays,
    unique_viewers: pandaRows.length > 0 ? unique : null,
    retention_pct: retN > 0 ? retSum / retN : null,
    avg_watch_seconds: watchN > 0 ? watchSum / watchN : null,
    fuente_panda_activa: pandaRows.length > 0,
  };
}

// =============================================================================
// HIGIENE DE DATOS — pendientes de marcar (Fase 9)
// =============================================================================
// Tres puntos del funnel dependen de una marca manual de Mauricio. Si quedan
// sin cargar, el tablero lee datos viejos y miente con confianza. Esta query
// los detecta para que Vista General los pida como alerta roja ANTES de
// cualquier veredicto.
// =============================================================================

export type TipoPendiente = 'A' | 'B' | 'C';

export type PendienteItem = {
  lead_id: number;
  lead_nombre: string;
  tipo: TipoPendiente;
  mensaje: string;
  fecha: string;       // la fecha relevante (J1 para A/B, J2 para C)
};

export type Pendientes = {
  items: PendienteItem[];
  total: number;
  porTipo: { A: number; B: number; C: number };
};

function fmtFechaPendiente(yyyy_mm_dd: string): string {
  const [y, m, d] = yyyy_mm_dd.split('-').map(Number);
  return new Intl.DateTimeFormat('es-MX', {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(y, m - 1, d)));
}

function restarDiasISO(yyyy_mm_dd: string, dias: number): string {
  const [y, m, d] = yyyy_mm_dd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d - dias)).toISOString().slice(0, 10);
}

function diasEntreISO(desde: string, hasta: string): number {
  const [dy, dm, dd] = desde.split('-').map(Number);
  const [hy, hm, hd] = hasta.split('-').map(Number);
  return Math.floor((Date.UTC(hy, hm - 1, hd) - Date.UTC(dy, dm - 1, dd)) / (1000 * 60 * 60 * 24));
}

/**
 * Leads con un dato manual pendiente de marcar. Un item por lead, con
 * prioridad A → B → C (lo más fundamental primero):
 *   A) J1 ya pasó y no se marcó asistencia.
 *   B) Asistió a J1, sigue 'abierto', no hay J2 y pasaron > DIAS_GRACIA_J2.
 *   C) J2 ya pasó y no se marcó asistencia.
 */
export async function getPendientesDeMarcar(
  hoy: string = new Date().toISOString().slice(0, 10),
): Promise<Pendientes> {
  const supabase = getSupabaseServer();
  const { data, error } = await supabase
    .from('leads')
    .select('id, nombre, fecha_junta_1, fecha_junta_2, asistio_j1, asistio_j2, estado_lead')
    .or('fecha_junta_1.not.is.null,fecha_junta_2.not.is.null');
  if (error) throw new Error(`Query pendientes de marcar falló: ${error.message}`);

  const cutoffB = restarDiasISO(hoy, DIAS_GRACIA_J2);
  const items: PendienteItem[] = [];

  for (const l of (data ?? []) as Array<{
    id: number;
    nombre: string;
    fecha_junta_1: string | null;
    fecha_junta_2: string | null;
    asistio_j1: boolean | null;
    asistio_j2: boolean | null;
    estado_lead: string;
  }>) {
    // A) J1 pasada sin marcar asistencia
    if (l.fecha_junta_1 && l.fecha_junta_1 < hoy && l.asistio_j1 === null) {
      items.push({
        lead_id: l.id,
        lead_nombre: l.nombre,
        tipo: 'A',
        mensaje: `¿Asistió a la J1 del ${fmtFechaPendiente(l.fecha_junta_1)}?`,
        fecha: l.fecha_junta_1,
      });
      continue;
    }
    // B) Asistió J1, abierto, sin J2, pasaron > DIAS_GRACIA_J2 desde J1
    if (
      l.asistio_j1 === true &&
      l.fecha_junta_2 === null &&
      l.estado_lead === 'abierto' &&
      l.fecha_junta_1 &&
      l.fecha_junta_1 < cutoffB
    ) {
      const dias = diasEntreISO(l.fecha_junta_1, hoy);
      items.push({
        lead_id: l.id,
        lead_nombre: l.nombre,
        tipo: 'B',
        mensaje: `Tuvo J1 hace ${dias} días: agendá la J2 o marcá la resolución`,
        fecha: l.fecha_junta_1,
      });
      continue;
    }
    // C) J2 pasada sin marcar asistencia
    if (l.fecha_junta_2 && l.fecha_junta_2 < hoy && l.asistio_j2 === null) {
      items.push({
        lead_id: l.id,
        lead_nombre: l.nombre,
        tipo: 'C',
        mensaje: `¿Asistió a la J2 del ${fmtFechaPendiente(l.fecha_junta_2)}?`,
        fecha: l.fecha_junta_2,
      });
      continue;
    }
  }

  const porTipo = {
    A: items.filter((i) => i.tipo === 'A').length,
    B: items.filter((i) => i.tipo === 'B').length,
    C: items.filter((i) => i.tipo === 'C').length,
  };

  return { items, total: items.length, porTipo };
}

// =============================================================================
// TAB HOY — operación diaria (Fase 11)
// =============================================================================
// getJuntasProximas: las J1/J2 de hoy y mañana con todo el contexto del lead.
// getColaDeAccion: lista tipada de pendientes concretos (marcar, cobrar,
// recontactar, formularios sin agenda, J2 sin match).
// =============================================================================

function masDiasISO(yyyy_mm_dd: string, dias: number): string {
  return restarDiasISO(yyyy_mm_dd, -dias);
}

function origenLegible(lead: Pick<Lead, 'meta_ad_name' | 'meta_campaign_name' | 'utm_campaign'>): string {
  return (
    lead.meta_ad_name?.trim() ||
    lead.meta_campaign_name?.trim() ||
    lead.utm_campaign?.trim() ||
    'directo'
  );
}

export type JuntaProxima = {
  lead_id: number;
  tipo: 'J1' | 'J2';
  fecha: string;
  dia: 'hoy' | 'mañana' | string;  // string para días futuros si dias>2
  nombre: string;
  empresa: string | null;
  respuestas: {
    facturacion: string | null;
    colaboradores: string | null;
    objetivo: string | null;
    cuando_empezar: string | null;
  };
  vsl_plays: number;
  agendo_sin_vsl: boolean;
  origen: string;
  madurez: EstadoMadurez;
  estado_lead: EstadoLead;
};

/**
 * Juntas (J1/J2) en hoy..hoy+dias-1, con el contexto del lead listo para la
 * llamada. Un lead con J1 hoy y J2 mañana produce dos entradas.
 */
export async function getJuntasProximas(
  hoy: string = new Date().toISOString().slice(0, 10),
  dias = 2,
): Promise<JuntaProxima[]> {
  const fechas: string[] = [];
  for (let i = 0; i < dias; i++) fechas.push(masDiasISO(hoy, i));
  const fechasSet = new Set(fechas);
  const enLista = fechas.join(',');

  const supabase = getSupabaseServer();
  const { data, error } = await supabase
    .from('leads')
    .select('*')
    .or(`fecha_junta_1.in.(${enLista}),fecha_junta_2.in.(${enLista})`);
  if (error) throw new Error(`Query juntas próximas falló: ${error.message}`);

  const leads = (data ?? []) as Lead[];
  const juntas: JuntaProxima[] = [];

  for (const lead of leads) {
    const candidatas: Array<{ tipo: 'J1' | 'J2'; fecha: string | null }> = [
      { tipo: 'J1', fecha: lead.fecha_junta_1 },
      { tipo: 'J2', fecha: lead.fecha_junta_2 },
    ];
    for (const c of candidatas) {
      if (!c.fecha || !fechasSet.has(c.fecha)) continue;
      const plays = await contarVslPlays(lead.visitor_id);
      juntas.push({
        lead_id: lead.id,
        tipo: c.tipo,
        fecha: c.fecha,
        dia: c.fecha === hoy ? 'hoy' : c.fecha === masDiasISO(hoy, 1) ? 'mañana' : c.fecha,
        nombre: lead.nombre,
        empresa: lead.empresa,
        respuestas: {
          facturacion: lead.respuesta_facturacion,
          colaboradores: lead.respuesta_colaboradores,
          objetivo: lead.respuesta_objetivo,
          cuando_empezar: lead.respuesta_cuando_empezar,
        },
        vsl_plays: plays,
        agendo_sin_vsl: plays === 0,
        origen: origenLegible(lead),
        madurez: estadoMadurezLead(lead),
        estado_lead: lead.estado_lead,
      });
    }
  }

  // Orden: por fecha asc, J1 antes que J2 el mismo día
  juntas.sort((a, b) => (a.fecha === b.fecha ? (a.tipo === b.tipo ? 0 : a.tipo === 'J1' ? -1 : 1) : a.fecha < b.fecha ? -1 : 1));
  return juntas;
}

export type ColaTipo =
  | 'pendiente_marcar'
  | 'cobro_vencido'
  | 'j2_sin_match'
  | 'noshow_recontactar'
  | 'form_sin_agenda'
  | 'j1_sin_j2';

export type ColaItem = {
  tipo: ColaTipo;
  lead_id: number | null;       // null para j2_sin_match (no hay lead aún)
  lead_nombre: string;
  titulo: string;
  detalle: string;
  accion: string;
  link: string;
  // Para resolver pendiente_marcar / j1_sin_j2 inline (controles de Fase 9)
  pendiente_tipo?: TipoPendiente;
  motivo_actual?: string | null;
};

/**
 * Cola de acción del día: pendientes concretos, en orden de prioridad.
 * Orden: pendiente_marcar, cobro_vencido, j2_sin_match, noshow_recontactar,
 * form_sin_agenda, j1_sin_j2.
 */
export async function getColaDeAccion(
  hoy: string = new Date().toISOString().slice(0, 10),
): Promise<ColaItem[]> {
  const supabase = getSupabaseServer();
  const items: ColaItem[] = [];

  // ── 1) pendiente_marcar (tipos A y C) y j1_sin_j2 (tipo B) ──
  const pend = await getPendientesDeMarcar(hoy);
  const marcarAC = pend.items.filter((i) => i.tipo !== 'B');
  const tipoB = pend.items.filter((i) => i.tipo === 'B');
  for (const p of marcarAC) {
    items.push({
      tipo: 'pendiente_marcar',
      lead_id: p.lead_id,
      lead_nombre: p.lead_nombre,
      titulo: p.mensaje,
      detalle: p.tipo === 'A' ? 'Marcá si asistió a la J1.' : 'Marcá si asistió a la J2.',
      accion: 'Marcar asistencia',
      link: `/leads/${p.lead_id}`,
      pendiente_tipo: p.tipo,
    });
  }

  // ── 2) cobro_vencido: cuotas no pagadas con fecha_esperada <= hoy ──
  const { vencidas, porVencer } = await getCuotasPendientes(hoy);
  const cobrosVencidos = [...vencidas, ...porVencer.filter((c) => c.dias === 0)];
  for (const c of cobrosVencidos) {
    const etiqueta = c.numero === 0 ? 'el cobro inicial' : `la cuota ${c.numero}`;
    items.push({
      tipo: 'cobro_vencido',
      lead_id: c.lead_id,
      lead_nombre: c.lead_nombre,
      titulo: `Cobrá ${etiqueta} de ${fmtUSDcola(c.monto_usd)} a ${c.lead_nombre}`,
      detalle: c.dias === 0 ? 'Vence hoy.' : `Venció el ${fmtFechaPendiente(c.fecha_esperada)} (hace ${Math.abs(c.dias)} día${Math.abs(c.dias) === 1 ? '' : 's'}).`,
      accion: 'Registrar pago',
      link: `/leads/${c.lead_id}`,
    });
  }

  // ── 3) j2_sin_match: review_queue resuelto=false ──
  const review = await listReviewPendientes();
  for (const r of review.filter((x) => x.tipo === 'j2_sin_match')) {
    items.push({
      tipo: 'j2_sin_match',
      lead_id: null,
      lead_nombre: r.nombre ?? r.email ?? 'desconocido',
      titulo: `Alguien agendó una J2 con ${r.email ?? 'email desconocido'} y no encontré su lead`,
      detalle: r.fecha_evento ? `Fecha de la J2: ${fmtFechaPendiente(r.fecha_evento)}. Buscá el lead y cargá la J2 a mano.` : 'Buscá el lead y cargá la J2 a mano.',
      accion: 'Resolver a mano',
      link: '/leads',
    });
  }

  // ── 4) noshow_recontactar: no-show de J1 en los últimos 14 días, sin junta futura, abierto ──
  const cutoff14 = restarDiasISO(hoy, 14);
  const { data: noshowRows, error: nsErr } = await supabase
    .from('leads')
    .select('id, nombre, fecha_junta_1, fecha_junta_2')
    .eq('asistio_j1', false)
    .eq('estado_lead', 'abierto')
    .gte('fecha_junta_1', cutoff14)
    .lt('fecha_junta_1', hoy);
  if (nsErr) throw new Error(`Query no-shows falló: ${nsErr.message}`);
  for (const r of (noshowRows ?? []) as Array<{ id: number; nombre: string; fecha_junta_1: string; fecha_junta_2: string | null }>) {
    if (r.fecha_junta_2 && r.fecha_junta_2 >= hoy) continue; // tiene J2 futura → no es no-show a recontactar
    items.push({
      tipo: 'noshow_recontactar',
      lead_id: r.id,
      lead_nombre: r.nombre,
      titulo: `${r.nombre} no se presentó a la J1: recontactá`,
      detalle: `La J1 era el ${fmtFechaPendiente(r.fecha_junta_1)}. Mandale un mensaje para reagendar.`,
      accion: 'Recontactar',
      link: `/leads/${r.id}`,
    });
  }

  // ── 5) form_sin_agenda: dejó el instant form y no agendó (1–7 días) ──
  const d7 = restarDiasISO(hoy, 7);
  const d1 = restarDiasISO(hoy, 1);
  const { data: formRows, error: fErr } = await supabase
    .from('leads')
    .select('id, nombre, created_at, fecha_agenda, meta_lead_id')
    .not('meta_lead_id', 'is', null)
    .is('fecha_agenda', null)
    .gte('created_at', d7)
    .lt('created_at', hoy);
  if (fErr) throw new Error(`Query form sin agenda falló: ${fErr.message}`);
  for (const r of (formRows ?? []) as Array<{ id: number; nombre: string; created_at: string }>) {
    const cd = r.created_at.slice(0, 10);
    if (cd > d1) continue; // demasiado fresco (<1 día)
    items.push({
      tipo: 'form_sin_agenda',
      lead_id: r.id,
      lead_nombre: r.nombre,
      titulo: `${r.nombre} dejó el formulario y no agendó`,
      detalle: 'Mandale el link de Calendly para que reserve su Junta 1.',
      accion: 'Mandar link',
      link: `/leads/${r.id}`,
    });
  }

  // ── 6) j1_sin_j2 (tipo B): tuvo J1, sigue abierto, sin J2 ni resolución ──
  for (const p of tipoB) {
    items.push({
      tipo: 'j1_sin_j2',
      lead_id: p.lead_id,
      lead_nombre: p.lead_nombre,
      titulo: p.mensaje,
      detalle: 'Agendá la J2 (Calendly) o marcá la resolución.',
      accion: 'Resolver',
      link: `/leads/${p.lead_id}`,
      pendiente_tipo: 'B',
    });
  }

  return items;
}

function fmtUSDcola(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);
}

// =============================================================================
// OBJETIVO GLOBAL — progreso acumulado (Fase 14)
// =============================================================================
// NO se ata al filtro de rango global: el objetivo es acumulado desde
// objetivo_desde, siempre. Sirve también de auditoría — si el contador de
// cierres no cuadra, faltan leads históricos o resoluciones sin marcar.
// =============================================================================

export type ObjetivoProgreso = {
  desde: string;
  cierres_actual: number;
  cierres_meta: number | null;
  cash_actual: number;
  cash_meta: number | null;
  // Ritmo: cierres en los últimos 30 días → semanas estimadas para la meta
  cierres_30d: number;
  semanas_estimadas: number | null;
  cumplido: boolean;
};

const OBJETIVO_DESDE_DEFAULT = '2025-12-08';

export async function getObjetivoProgreso(
  hoy: string = new Date().toISOString().slice(0, 10),
): Promise<ObjetivoProgreso> {
  const supabase = getSupabaseServer();

  const [cierresMeta, cashMeta, desdeRaw] = await Promise.all([
    getSettingNum('objetivo_cierres'),
    getSettingNum('objetivo_cash_usd'),
    getSetting('objetivo_desde'),
  ]);
  const desde = desdeRaw && /^\d{4}-\d{2}-\d{2}$/.test(desdeRaw) ? desdeRaw : OBJETIVO_DESDE_DEFAULT;

  // Cierres ganados desde `desde` (incluye ganados sin fecha_cierre cargada).
  const { data: ganados, error: gErr } = await supabase
    .from('leads')
    .select('fecha_cierre')
    .eq('estado_lead', 'ganado');
  if (gErr) throw new Error(`Query objetivo cierres falló: ${gErr.message}`);
  const ganadosRows = (ganados ?? []) as Array<{ fecha_cierre: string | null }>;
  const cierres_actual = ganadosRows.filter(
    (g) => g.fecha_cierre === null || g.fecha_cierre >= desde,
  ).length;

  // Cash: Σ pagos pagado=true con fecha_pago en [desde, hoy].
  const cash_actual = await getCashCollectedPeriodo(desde, hoy);

  // Ritmo: cierres con fecha_cierre en los últimos 30 días.
  const hace30 = restarDiasISO(hoy, 30);
  const cierres_30d = ganadosRows.filter(
    (g) => g.fecha_cierre !== null && g.fecha_cierre >= hace30 && g.fecha_cierre <= hoy,
  ).length;

  const faltanCierres = cierresMeta !== null ? Math.max(cierresMeta - cierres_actual, 0) : 0;
  const cierresPorSemana = cierres_30d / (30 / 7);
  const semanas_estimadas =
    cierresPorSemana > 0 && faltanCierres > 0 ? Math.ceil(faltanCierres / cierresPorSemana) : null;

  const cumplido =
    cierresMeta !== null &&
    cashMeta !== null &&
    cierres_actual >= cierresMeta &&
    cash_actual >= cashMeta;

  return {
    desde,
    cierres_actual,
    cierres_meta: cierresMeta,
    cash_actual,
    cash_meta: cashMeta,
    cierres_30d,
    semanas_estimadas,
    cumplido,
  };
}

// =============================================================================
// REGLAS NUEVAS DEL SEMÁFORO (Fase 16)
// =============================================================================

export type AdsetFatiga = {
  adset_name: string;
  frequency_7d: number;
  cpl_7d_usd: number;
  cpl_28d_usd: number;
};

/**
 * Adsets con posible fatiga de creativo: spend 7d > USD 50, frequency media 7d
 * > 3.5 Y CPL 7d > 1.5 × CPL 28d. (frequency y leads_count ya están por fila.)
 */
export async function getFatigaAdsets(
  hoy: string = new Date().toISOString().slice(0, 10),
): Promise<AdsetFatiga[]> {
  const supabase = getSupabaseServer();
  const d28 = restarDiasISO(hoy, 28);
  const d7 = restarDiasISO(hoy, 7);
  const { data, error } = await supabase
    .from('marketing_metrics_daily')
    .select('fecha, adset_id, adset_name, spend, frequency, leads_count')
    .eq('plataforma', 'meta')
    .gte('fecha', d28)
    .lte('fecha', hoy);
  if (error) throw new Error(`Query fatiga adsets falló: ${error.message}`);

  type Row = { fecha: string; adset_id: string | null; adset_name: string | null; spend: number | null; frequency: number | null; leads_count: number | null };
  const porAdset = new Map<string, Row[]>();
  for (const r of (data ?? []) as Row[]) {
    const k = r.adset_id ?? r.adset_name ?? 'sin_adset';
    const arr = porAdset.get(k) ?? [];
    arr.push(r);
    porAdset.set(k, arr);
  }

  const out: AdsetFatiga[] = [];
  for (const rows of porAdset.values()) {
    const en7 = rows.filter((r) => r.fecha >= d7);
    const spend7Mxn = en7.reduce((s, r) => s + Number(r.spend ?? 0), 0);
    const spend7Usd = spend7Mxn / TIPO_DE_CAMBIO_USD_MXN;
    if (spend7Usd <= 50) continue;

    const freqVals = en7.map((r) => Number(r.frequency ?? 0)).filter((v) => v > 0);
    const freq7 = freqVals.length > 0 ? freqVals.reduce((s, v) => s + v, 0) / freqVals.length : 0;
    if (freq7 <= 3.5) continue;

    const leads7 = en7.reduce((s, r) => s + Number(r.leads_count ?? 0), 0);
    const spend28Mxn = rows.reduce((s, r) => s + Number(r.spend ?? 0), 0);
    const leads28 = rows.reduce((s, r) => s + Number(r.leads_count ?? 0), 0);
    if (leads7 === 0 || leads28 === 0) continue;
    const cpl7 = spend7Mxn / TIPO_DE_CAMBIO_USD_MXN / leads7;
    const cpl28 = spend28Mxn / TIPO_DE_CAMBIO_USD_MXN / leads28;
    if (cpl7 <= 1.5 * cpl28) continue;

    out.push({
      adset_name: rows[0].adset_name ?? rows[0].adset_id ?? 'adset',
      frequency_7d: freq7,
      cpl_7d_usd: cpl7,
      cpl_28d_usd: cpl28,
    });
  }
  return out;
}

export type TramoJ1J2 = { promedio: number | null; n: number };

/**
 * Promedio del tramo J1 → J2 (días) sobre leads con J1 en los últimos `dias`
 * días (default 60) y J2 cargada. Para la alerta de "deals que se enfrían".
 */
export async function getTramoJ1J2Reciente(
  hoy: string = new Date().toISOString().slice(0, 10),
  dias = 60,
): Promise<TramoJ1J2> {
  const supabase = getSupabaseServer();
  const desde = restarDiasISO(hoy, dias);
  const { data, error } = await supabase
    .from('leads')
    .select('fecha_junta_1, fecha_junta_2')
    .gte('fecha_junta_1', desde)
    .lte('fecha_junta_1', hoy)
    .not('fecha_junta_2', 'is', null);
  if (error) throw new Error(`Query tramo J1→J2 falló: ${error.message}`);

  const difs: number[] = [];
  for (const r of (data ?? []) as Array<{ fecha_junta_1: string | null; fecha_junta_2: string | null }>) {
    if (!r.fecha_junta_1 || !r.fecha_junta_2) continue;
    const [ay, am, ad] = r.fecha_junta_1.split('-').map(Number);
    const [by, bm, bd] = r.fecha_junta_2.split('-').map(Number);
    const d = Math.floor((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86400000);
    if (d >= 0) difs.push(d);
  }
  return {
    promedio: difs.length > 0 ? difs.reduce((s, v) => s + v, 0) / difs.length : null,
    n: difs.length,
  };
}

// =============================================================================
// TENDENCIAS — series semanal/mensual de marketing + comercial (Fase 16)
// =============================================================================

export type FormatoSerie = 'usd' | 'num' | 'pct';
export type SerieMetrica = { key: string; label: string; formato: FormatoSerie; valores: Array<number | null> };
export type Tendencias = {
  granularidad: 'semanal' | 'mensual';
  periodos: string[];                 // etiquetas eje X
  marketing: SerieMetrica[];
  comercial: SerieMetrica[];
};

function nombreMesCorto(yyyy_mm_dd: string): string {
  const [y, m] = yyyy_mm_dd.split('-').map(Number);
  return new Intl.DateTimeFormat('es-MX', { month: 'short', year: '2-digit', timeZone: 'UTC' }).format(new Date(Date.UTC(y, m - 1, 1)));
}
function diaCorto(yyyy_mm_dd: string): string {
  const [y, m, d] = yyyy_mm_dd.split('-').map(Number);
  return new Intl.DateTimeFormat('es-MX', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(Date.UTC(y, m - 1, d)));
}

export async function getTendencias(
  granularidad: 'semanal' | 'mensual' = 'semanal',
  end: string = new Date().toISOString().slice(0, 10),
): Promise<Tendencias> {
  const supabase = getSupabaseServer();

  // Períodos (viejo → nuevo)
  const periodos: Array<{ inicio: string; fin: string; label: string }> = [];
  if (granularidad === 'semanal') {
    const ultimoLunes = lunesDeFecha(end);
    for (let i = 11; i >= 0; i--) {
      const inicio = restarDiasISO(ultimoLunes, i * 7);
      periodos.push({ inicio, fin: restarDiasISO(inicio, -6), label: diaCorto(inicio) });
    }
  } else {
    const [y, m] = end.split('-').map(Number);
    for (let i = 5; i >= 0; i--) {
      const d = new Date(Date.UTC(y, m - 1 - i, 1));
      const py = d.getUTCFullYear(), pm = d.getUTCMonth() + 1;
      const inicio = `${py}-${String(pm).padStart(2, '0')}-01`;
      const fin = new Date(Date.UTC(py, pm, 0)).toISOString().slice(0, 10);
      periodos.push({ inicio, fin, label: nombreMesCorto(inicio) });
    }
  }
  const rangoInicio = periodos[0].inicio;
  const rangoFin = periodos[periodos.length - 1].fin;
  const idxDe = (fecha: string): number => {
    for (let i = 0; i < periodos.length; i++) if (fecha >= periodos[i].inicio && fecha <= periodos[i].fin) return i;
    return -1;
  };
  const n = periodos.length;
  const z = () => Array.from({ length: n }, () => 0);

  const [metaRes, leadsRes, pagosRes] = await Promise.all([
    supabase.from('marketing_metrics_daily').select('fecha, impressions, link_clicks, landing_page_views, spend, leads_count').eq('plataforma', 'meta').gte('fecha', rangoInicio).lte('fecha', rangoFin),
    supabase.from('leads').select('fecha_agenda, fecha_junta_1, asistio_j1, fecha_cierre, estado_lead').or(`fecha_agenda.gte.${rangoInicio},fecha_junta_1.gte.${rangoInicio},fecha_cierre.gte.${rangoInicio}`),
    supabase.from('pagos').select('fecha_pago, monto_usd, pagado').eq('pagado', true).gte('fecha_pago', rangoInicio).lte('fecha_pago', rangoFin),
  ]);
  for (const r of [metaRes, leadsRes, pagosRes]) if (r.error) throw new Error(`getTendencias falló: ${r.error.message}`);

  const imp = z(), clk = z(), land = z(), spendMxn = z(), leads = z();
  for (const r of (metaRes.data ?? []) as Array<{ fecha: string; impressions: number | null; link_clicks: number | null; landing_page_views: number | null; spend: number | null; leads_count: number | null }>) {
    const i = idxDe(r.fecha); if (i < 0) continue;
    imp[i] += r.impressions ?? 0; clk[i] += r.link_clicks ?? 0; land[i] += r.landing_page_views ?? 0; spendMxn[i] += Number(r.spend ?? 0); leads[i] += r.leads_count ?? 0;
  }
  const agendas = z(), asistencias = z(), cierres = z();
  for (const r of (leadsRes.data ?? []) as Array<{ fecha_agenda: string | null; fecha_junta_1: string | null; asistio_j1: boolean | null; fecha_cierre: string | null; estado_lead: string }>) {
    if (r.fecha_agenda) { const i = idxDe(r.fecha_agenda); if (i >= 0) agendas[i] += 1; }
    if (r.fecha_junta_1 && r.asistio_j1 === true) { const i = idxDe(r.fecha_junta_1); if (i >= 0) asistencias[i] += 1; }
    if (r.fecha_cierre && r.estado_lead === 'ganado') { const i = idxDe(r.fecha_cierre); if (i >= 0) cierres[i] += 1; }
  }
  const cash = z();
  for (const r of (pagosRes.data ?? []) as Array<{ fecha_pago: string | null; monto_usd: number | null }>) {
    if (!r.fecha_pago) continue; const i = idxDe(r.fecha_pago); if (i >= 0) cash[i] += Number(r.monto_usd ?? 0);
  }

  const spendUsd = spendMxn.map((s) => s / TIPO_DE_CAMBIO_USD_MXN);
  const ratio = (num: number[], den: number[], k = 100): Array<number | null> => num.map((v, i) => (den[i] > 0 ? (v / den[i]) * k : null));

  return {
    granularidad,
    periodos: periodos.map((p) => p.label),
    marketing: [
      { key: 'impresiones', label: 'Impresiones', formato: 'num', valores: imp },
      { key: 'landing', label: 'Visitas a la landing', formato: 'num', valores: land },
      { key: 'ctr_link', label: 'CTR de link', formato: 'pct', valores: ratio(clk, imp) },
      { key: 'spend', label: 'Spend (USD)', formato: 'usd', valores: spendUsd },
      { key: 'leads', label: 'Leads', formato: 'num', valores: leads },
      { key: 'cpl', label: 'CPL (USD)', formato: 'usd', valores: spendUsd.map((s, i) => (leads[i] > 0 ? s / leads[i] : null)) },
    ],
    comercial: [
      { key: 'agendas', label: 'Agendas', formato: 'num', valores: agendas },
      { key: 'asistencias', label: 'Asistencias a J1', formato: 'num', valores: asistencias },
      { key: 'cierres', label: 'Cierres', formato: 'num', valores: cierres },
      { key: 'cash', label: 'Cash collected', formato: 'usd', valores: cash },
      { key: 'cac', label: 'CAC', formato: 'usd', valores: spendUsd.map((s, i) => (cierres[i] > 0 ? s / cierres[i] : null)) },
    ],
  };
}
