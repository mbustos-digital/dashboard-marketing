// =============================================================================
// Tab Marketing — KPIs estrella + funnel de gauges + anuncios ganadores (8B)
// =============================================================================
// Estructura (rediseño Fase 8B del mentor):
//   1. 3 KPIs estrella (únicos en amarillo): Inversión, Agendamientos,
//      Costo por agendamiento — con tendencia vs mes anterior
//   2. Funnel de 6 diales semicirculares (SVG inline) con cuello de botella
//      marcado automáticamente y tooltip de benchmark por etapa
//   3. Anuncios ganadores (por meta_ad_name de los leads)
//   4. CAC mensual — tendencia
//   5. Eficiencia secundaria (clicks, CTR, CPC, costo/landing) sin amarillo
// =============================================================================

import Link from 'next/link';
import {
  getMarketingWindow,
  getFunnelEtapas,
  getFunnelSeries,
  getTendencias,
  getSenalesRecon,
  getResumenComparativo,
  getVslSerie,
  type MarketingWindow,
  type FunnelMes,
  type FunnelEtapa,
  type FunnelSeries,
  type Tendencias,
  type SenalRecon,
  type ResumenComparativo,
  type VslSerie,
} from '@/lib/queries';
import { TendenciasSection } from './_components/TendenciasSection';
import { ReconPanel } from './_components/ReconPanel';
import {
  ayerEnTijuana,
  esFechaValida,
  primerDiaDelMesDeFecha,
  diasAntes,
} from '@/lib/date-utils';
import { getDataSources, sourcesToMap } from '@/lib/sources';
import { DashboardHeader } from './_components/DashboardHeader';
import { DashboardTabs } from './_components/DashboardTabs';
import { FechaSelector } from './_components/FechaSelector';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

// ─────────────────────────────────────────────────────────────────────────────
// Format helpers
// ─────────────────────────────────────────────────────────────────────────────

function fmtNumber(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  return new Intl.NumberFormat('es-MX').format(Math.round(n));
}

function fmtUSD(n: number | null | undefined, decimals = 0): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: decimals,
  }).format(n);
}

function fmtPercent(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  return `${n.toFixed(2)}%`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Page
// ─────────────────────────────────────────────────────────────────────────────

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ desde?: string; hasta?: string }>;
}) {
  const ayerReal = ayerEnTijuana();
  const params = await searchParams;
  const desdeParam = params.desde;
  const hastaParam = params.hasta;
  const filtroActivo =
    !!desdeParam &&
    !!hastaParam &&
    esFechaValida(desdeParam) &&
    esFechaValida(hastaParam) &&
    desdeParam <= hastaParam &&
    hastaParam <= ayerReal;

  const rangoDesde = filtroActivo ? desdeParam! : primerDiaDelMesDeFecha(ayerReal);
  const rangoHasta = filtroActivo ? hastaParam! : ayerReal;

  let mkt: MarketingWindow | null = null;
  let funnel: FunnelMes | null = null;
  let funnelSeries: FunnelSeries = {};
  let senales: SenalRecon[] = [];
  let tendSemanal: Tendencias | null = null;
  let tendMensual: Tendencias | null = null;
  let comparativo: ResumenComparativo | null = null;
  let vslSerie: VslSerie | null = null;
  let errorMsg: string | null = null;

  // Recon mira siempre los últimos 14 días (no depende del filtro de rango).
  const reconDesde = diasAntes(rangoHasta, 14);

  try {
    const sourceMap = sourcesToMap(await getDataSources());
    [mkt, funnel, funnelSeries, senales, tendSemanal, tendMensual, comparativo, vslSerie] = await Promise.all([
      getMarketingWindow(rangoDesde, rangoHasta),
      getFunnelEtapas(rangoDesde, rangoHasta, sourceMap),
      getFunnelSeries(rangoHasta, 12),
      getSenalesRecon(reconDesde, rangoHasta),
      getTendencias('semanal', rangoHasta),
      getTendencias('mensual', rangoHasta),
      filtroActivo
        ? Promise.resolve(null)
        : getResumenComparativo(ayerReal),
      getVslSerie(56),
    ]);
  } catch (err) {
    errorMsg = err instanceof Error ? err.message : String(err);
  }

  return (
    <main className="min-h-screen w-full px-6 py-8 md:px-12 md:py-12 bg-[var(--bg)] text-[var(--text)]">
      <DashboardHeader fechaAyer={ayerReal} />
      <DashboardTabs active="marketing" />

      <FechaSelector fechaActualReal={ayerReal} />

      {errorMsg || !mkt || !funnel ? (
        <div
          className="rounded-lg p-6 border"
          style={{ borderColor: 'var(--accent-orange)', background: '#2a1410' }}
        >
          <p className="text-lg font-semibold mb-1" style={{ color: 'var(--accent-orange)' }}>
            Error consultando datos
          </p>
          <p className="text-base font-mono" style={{ color: 'var(--text-dim)' }}>
            {errorMsg ?? 'Sin datos'}
          </p>
        </div>
      ) : (
        <div className="space-y-8">
          {/* 1 — KPIs ESTRELLA */}
          <KPIsEstrella mkt={mkt} comparativo={comparativo} filtroActivo={filtroActivo} />

          {/* 2 — FUNNEL EN LISTA DE ETAPAS (Fase 15) */}
          <FunnelEtapasList funnel={funnel} series={funnelSeries} periodo={filtroActivo ? `${rangoDesde} → ${rangoHasta}` : 'Mes en curso'} />

          {/* 2.5 — CARD VSL (Panda) */}
          {vslSerie && <VslCard serie={vslSerie} />}

          {/* 2.6 — TENDENCIAS (Fase 16): reemplaza el chart de CAC de una barra */}
          {tendSemanal && tendMensual && (
            <TendenciasSection semanal={tendSemanal} mensual={tendMensual} />
          )}

          {/* 3 — PANEL RECON (Fase 17): reemplaza Anuncios ganadores */}
          <ReconPanel senales={senales} />

          {/* 5 — EFICIENCIA SECUNDARIA */}
          <EficienciaSecundaria mkt={mkt} />
        </div>
      )}

      {/* FOOTER */}
      <footer className="mt-12 pt-6 border-t" style={{ borderColor: 'var(--card-border)' }}>
        <p className="text-base" style={{ color: 'var(--text-pending)' }}>
          Crons automáticos: Meta 6:00 AM TJ · YouTube 6:15 AM TJ · Calendly y
          Meta Lead Ads via webhook en tiempo real. Manual: marcar
          asistió/calificado/cerró/cobranza en{' '}
          <Link href="/leads" style={{ color: 'var(--accent-yellow)', textDecoration: 'underline' }}>
            /leads
          </Link>
          . Montos en USD (spend Meta convertido desde MXN).
        </p>
      </footer>
    </main>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 1 — KPIs estrella
// ─────────────────────────────────────────────────────────────────────────────

function Flecha({ actual, anterior, invertir = false }: { actual: number; anterior: number; invertir?: boolean }) {
  if (actual === anterior) return <span className="text-2xl" style={{ color: 'var(--text-pending)' }}>→</span>;
  const sube = actual > anterior;
  const color = invertir ? 'var(--text-dim)' : sube ? 'var(--accent-green)' : 'var(--accent-orange)';
  return <span className="text-2xl" style={{ color }}>{sube ? '↑' : '↓'}</span>;
}

function KPIsEstrella({
  mkt,
  comparativo,
  filtroActivo,
}: {
  mkt: MarketingWindow;
  comparativo: ResumenComparativo | null;
  filtroActivo: boolean;
}) {
  const costoPorAgenda = mkt.agendamientos > 0 ? mkt.spend_usd / mkt.agendamientos : null;
  const costoAnterior =
    comparativo && comparativo.agendas.anterior > 0
      ? comparativo.inversion_usd.anterior / comparativo.agendas.anterior
      : null;

  return (
    <section className="grid grid-cols-1 md:grid-cols-3 gap-4">
      <KPIEstrellaCard
        label={filtroActivo ? 'Inversión del rango' : 'Inversión del mes'}
        valor={fmtUSD(mkt.spend_usd)}
        flecha={
          comparativo ? (
            <Flecha actual={comparativo.inversion_usd.actual} anterior={comparativo.inversion_usd.anterior} invertir />
          ) : null
        }
        sub={comparativo ? `${comparativo.etiqueta_anterior}: ${fmtUSD(comparativo.inversion_usd.anterior)}` : undefined}
      />
      <KPIEstrellaCard
        label="Agendamientos"
        valor={fmtNumber(mkt.agendamientos)}
        flecha={
          comparativo ? (
            <Flecha actual={comparativo.agendas.actual} anterior={comparativo.agendas.anterior} />
          ) : null
        }
        sub={comparativo ? `${comparativo.etiqueta_anterior}: ${fmtNumber(comparativo.agendas.anterior)}` : undefined}
      />
      <KPIEstrellaCard
        label="Costo por agendamiento"
        valor={costoPorAgenda !== null ? fmtUSD(costoPorAgenda) : '—'}
        flecha={
          comparativo && costoPorAgenda !== null && costoAnterior !== null ? (
            // costo: BAJAR es bueno → invertimos manualmente los colores
            <span
              className="text-2xl"
              style={{
                color:
                  costoPorAgenda < costoAnterior
                    ? 'var(--accent-green)'
                    : costoPorAgenda > costoAnterior
                    ? 'var(--accent-orange)'
                    : 'var(--text-pending)',
              }}
            >
              {costoPorAgenda < costoAnterior ? '↓' : costoPorAgenda > costoAnterior ? '↑' : '→'}
            </span>
          ) : null
        }
        sub={costoAnterior !== null && comparativo ? `${comparativo.etiqueta_anterior}: ${fmtUSD(costoAnterior)}` : undefined}
      />
    </section>
  );
}

function KPIEstrellaCard({
  label,
  valor,
  flecha,
  sub,
}: {
  label: string;
  valor: string;
  flecha: React.ReactNode;
  sub?: string;
}) {
  return (
    <div
      className="rounded-xl border p-6"
      style={{ background: 'var(--card-bg)', borderColor: 'var(--card-border)' }}
    >
      <div className="text-sm uppercase tracking-widest mb-2" style={{ color: 'var(--text-dim)' }}>
        {label}
      </div>
      <div className="flex items-baseline gap-3">
        <span
          className="text-[40px] leading-none tracking-tight tabular-nums"
          style={{ fontFamily: 'var(--font-cormorant)', fontWeight: 500, color: 'var(--accent-yellow)' }}
        >
          {valor}
        </span>
        {flecha}
      </div>
      {sub && (
        <div className="text-sm mt-2" style={{ color: 'var(--text-pending)' }}>
          {sub}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 2 — Funnel en lista de etapas (Fase 15): dos bloques + fila puente
// ─────────────────────────────────────────────────────────────────────────────

function colorSalud(salud: FunnelEtapa['salud']): string {
  switch (salud) {
    case 'verde': return 'var(--accent-green)';
    case 'ambar': return 'var(--accent-yellow)';
    case 'rojo': return 'var(--accent-orange)';
    default: return 'var(--text-pending)';
  }
}

const FUENTE_LABEL: Record<string, string> = {
  meta_insights: 'Meta',
  vsl_panda: 'VSL (Panda)',
  calendly: 'Calendly',
};

function ChipFuente({ fuenteKey }: { fuenteKey: string | null }) {
  const label = fuenteKey ? (FUENTE_LABEL[fuenteKey] ?? fuenteKey) : 'manual';
  return (
    <span
      className="px-2 py-0.5 rounded-full text-xs whitespace-nowrap"
      style={{ background: '#1a1a1a', color: 'var(--text-dim)' }}
    >
      {label}
    </span>
  );
}

// Bullet bar: barra de valor sobre bandas rojo/ámbar/verde del benchmark.
function BulletBar({ etapa }: { etapa: FunnelEtapa }) {
  const { rojo, ambar, max } = etapa.umbral;
  const W = 100;
  const esc = (v: number) => Math.max(0, Math.min(v / max, 1)) * W;
  const valor = etapa.pct ?? 0;
  const color = colorSalud(etapa.salud);
  return (
    <svg viewBox="0 0 100 12" className="w-full" preserveAspectRatio="none" style={{ height: 12 }}>
      {/* bandas */}
      <rect x="0" y="3" width={esc(rojo)} height="6" fill="var(--accent-orange)" opacity="0.18" />
      <rect x={esc(rojo)} y="3" width={esc(ambar) - esc(rojo)} height="6" fill="var(--accent-yellow)" opacity="0.18" />
      <rect x={esc(ambar)} y="3" width={W - esc(ambar)} height="6" fill="var(--accent-green)" opacity="0.18" />
      {/* valor */}
      {etapa.pct !== null && !etapa.fuente_pendiente && !etapa.muestra_chica && (
        <>
          <rect x="0" y="4.5" width={esc(valor)} height="3" fill={color} rx="1.5" />
          <line x1={esc(valor)} y1="1.5" x2={esc(valor)} y2="10.5" stroke={color} strokeWidth="1.5" />
        </>
      )}
    </svg>
  );
}

// Sparkline 12 semanas (SVG, sin librería). Nulls = huecos.
function Sparkline({ serie }: { serie: Array<number | null> }) {
  const W = 80, H = 24, P = 2;
  const vals = serie.filter((v): v is number => v !== null);
  if (vals.length < 2) return <div style={{ width: W, height: H }} />;
  const min = Math.min(...vals), max = Math.max(...vals);
  const span = max - min || 1;
  const n = serie.length;
  const x = (i: number) => P + (i / (n - 1)) * (W - 2 * P);
  const y = (v: number) => H - P - ((v - min) / span) * (H - 2 * P);
  // segmentos continuos (saltando nulls)
  const segs: string[] = [];
  let cur: string[] = [];
  serie.forEach((v, i) => {
    if (v === null) { if (cur.length) { segs.push(cur.join(' ')); cur = []; } }
    else cur.push(`${cur.length ? 'L' : 'M'} ${x(i).toFixed(1)} ${y(v).toFixed(1)}`);
  });
  if (cur.length) segs.push(cur.join(' '));
  const ultimo = vals[vals.length - 1];
  const lastIdx = serie.map((v, i) => (v !== null ? i : -1)).filter((i) => i >= 0).pop() ?? 0;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: W, height: H }} aria-hidden>
      {segs.map((d, i) => (
        <path key={i} d={d} fill="none" stroke="var(--accent-yellow)" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" opacity="0.85" />
      ))}
      <circle cx={x(lastIdx)} cy={y(ultimo)} r="1.8" fill="var(--accent-yellow)" />
    </svg>
  );
}

function EtapaFila({ etapa, serie, esCuello }: { etapa: FunnelEtapa; serie: Array<number | null>; esCuello: boolean }) {
  const off = etapa.fuente_pendiente;
  const chica = etapa.muestra_chica;
  const color = colorSalud(etapa.salud);
  return (
    <div
      className="grid grid-cols-[1fr_auto] md:grid-cols-[minmax(0,1.4fr)_auto_minmax(120px,1fr)_auto] items-center gap-x-4 gap-y-2 py-3 px-3 rounded-lg"
      style={{ background: esCuello ? 'rgba(255,107,53,0.07)' : 'transparent', border: esCuello ? '1px solid var(--accent-orange)' : '1px solid transparent' }}
    >
      {/* etiqueta + % + volumen */}
      <div className="min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-base" style={{ fontWeight: 600 }}>{etapa.label}</span>
          {esCuello && (
            <span className="px-2 py-0.5 rounded text-xs font-semibold uppercase" style={{ background: 'var(--accent-orange)', color: '#000' }}>cuello</span>
          )}
          <ChipFuente fuenteKey={etapa.fuenteKey} />
          <InfoTooltip texto={etapa.benchmark} />
        </div>
        <div className="text-sm mt-0.5" style={{ color: 'var(--text-pending)' }}>
          {off ? (
            <span style={{ color: 'var(--accent-orange)' }}>fuente pendiente</span>
          ) : chica ? (
            <span>pocos datos: {fmtNumber(etapa.salida)} de {fmtNumber(etapa.entrada)}</span>
          ) : (
            <>{fmtNumber(etapa.entrada)} → {fmtNumber(etapa.salida)}</>
          )}
        </div>
      </div>

      {/* % grande */}
      <div className="text-right tabular-nums text-[26px] leading-none" style={{ fontFamily: 'var(--font-cormorant)', fontWeight: 500, color: off || chica ? 'var(--text-pending)' : color }}>
        {off ? '—' : chica ? `${etapa.salida}/${etapa.entrada}` : etapa.pct !== null ? `${etapa.pct < 10 ? etapa.pct.toFixed(1) : etapa.pct.toFixed(0)}%` : '—'}
      </div>

      {/* bullet bar (oculto en mobile estrecho) */}
      <div className="hidden md:block">
        {!off && <BulletBar etapa={etapa} />}
      </div>

      {/* sparkline */}
      <div className="hidden md:block justify-self-end">
        <Sparkline serie={serie} />
      </div>
    </div>
  );
}

function FunnelEtapasList({ funnel, series, periodo }: { funnel: FunnelMes; series: FunnelSeries; periodo: string }) {
  const marketing = funnel.etapas.filter((e) => e.bloque === 'marketing');
  const puente = funnel.etapas.filter((e) => e.bloque === 'puente');
  const comercial = funnel.etapas.filter((e) => e.bloque === 'comercial');
  const fila = (e: FunnelEtapa) => (
    <EtapaFila key={e.key} etapa={e} serie={series[e.key] ?? []} esCuello={funnel.cuelloKey === e.key} />
  );
  return (
    <section className="rounded-xl border p-6 md:p-8" style={{ background: 'var(--card-bg)', borderColor: 'var(--card-border)' }}>
      <h2 className="text-[28px]" style={{ fontFamily: 'var(--font-cormorant)', fontWeight: 500 }}>
        Funnel — etapas de conversión
      </h2>
      <p className="text-base mt-1 mb-5" style={{ color: 'var(--text-dim)' }}>
        {periodo}. Barra sobre bandas rojo/ámbar/verde del benchmark · tendencia de 12 semanas. Tocá la (i) para el detalle.
      </p>

      <BloqueTitulo>Marketing</BloqueTitulo>
      <div className="divide-y" style={{ borderColor: 'var(--card-border)' }}>{marketing.map(fila)}</div>

      <div className="my-2 px-3 py-2 rounded-lg" style={{ background: '#0f0f0f' }}>
        <p className="text-xs uppercase tracking-wider mb-1" style={{ color: 'var(--text-pending)' }}>Puente · cruza dos sistemas de medición</p>
        {puente.map(fila)}
      </div>

      <BloqueTitulo>Comercial</BloqueTitulo>
      <div className="divide-y" style={{ borderColor: 'var(--card-border)' }}>{comercial.map(fila)}</div>
    </section>
  );
}

function BloqueTitulo({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="text-sm uppercase tracking-wider mt-4 mb-1" style={{ color: 'var(--text-dim)' }}>
      {children}
    </h3>
  );
}

function InfoTooltip({ texto }: { texto: string }) {
  return (
    <span className="relative inline-flex group shrink-0">
      <button
        type="button"
        aria-label="Benchmark"
        className="inline-flex items-center justify-center w-4 h-4 rounded-full border text-xs leading-none"
        style={{ borderColor: 'var(--text-pending)', color: 'var(--text-pending)' }}
      >
        i
      </button>
      <span
        role="tooltip"
        className="absolute z-20 right-0 top-full mt-2 w-64 px-3 py-2 rounded-md text-sm text-left opacity-0 invisible group-hover:opacity-100 group-hover:visible group-focus-within:opacity-100 group-focus-within:visible transition-opacity shadow-lg"
        style={{
          background: '#0a0a0a',
          color: 'var(--text)',
          border: '1px solid var(--card-border)',
          fontWeight: 400,
        }}
      >
        {texto}
      </span>
    </span>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 5 — Eficiencia secundaria (texto, sin amarillo)
// ─────────────────────────────────────────────────────────────────────────────

function EficienciaSecundaria({ mkt }: { mkt: MarketingWindow }) {
  // CTR de LINK (inline_link_clicks) es el protagonista (Fase 15): es el dato
  // correcto para juzgar el creativo. CTR global (todos los clicks) queda como
  // referencia secundaria con tooltip.
  const ctrLink = mkt.impressions > 0 ? (mkt.link_clicks / mkt.impressions) * 100 : null;
  const items: Array<{ label: string; value: string; tip?: string }> = [
    { label: 'CTR de link', value: fmtPercent(ctrLink), tip: 'link_clicks ÷ impresiones. Es el clic que va a tu landing — el que importa para juzgar el anuncio.' },
    { label: 'Clicks de link', value: fmtNumber(mkt.link_clicks) },
    { label: 'CPC global', value: fmtUSD(mkt.cpc_global, 2) },
    { label: 'Costo por Landing View', value: fmtUSD(mkt.cpl_global, 2) },
    { label: 'Clicks (todos)', value: fmtNumber(mkt.clicks), tip: 'Incluye clicks que NO van al link (reacciones, expandir foto, ver perfil). Por eso es mayor que clicks de link y por qué su CTR infla.' },
    { label: 'CTR (todos)', value: fmtPercent(mkt.ctr_global), tip: 'Sobre todos los clicks — referencia, no protagonista. El de link es el que cuenta.' },
    { label: 'Impresiones', value: fmtNumber(mkt.impressions) },
    { label: 'Alcance', value: fmtNumber(mkt.reach) },
  ];
  return (
    <section
      className="rounded-xl border px-6 py-5"
      style={{ background: 'var(--card-bg)', borderColor: 'var(--card-border)' }}
    >
      <div className="text-sm uppercase tracking-widest mb-3" style={{ color: 'var(--text-dim)' }}>
        Eficiencia — detalle
      </div>
      <div className="flex flex-wrap gap-x-8 gap-y-2 text-base">
        {items.map((i) => (
          <span key={i.label} className="inline-flex items-center gap-1" style={{ color: 'var(--text-dim)' }}>
            {i.label}:{' '}
            <strong className="tabular-nums" style={{ color: 'var(--text)' }}>
              {i.value}
            </strong>
            {i.tip && <InfoTooltip texto={i.tip} />}
          </span>
        ))}
      </div>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Card VSL (Panda Video) — Fase 5 v2
// ─────────────────────────────────────────────────────────────────────────────

function VslCard({ serie }: { serie: VslSerie }) {
  const hayDatos = serie.dias.length > 0 && serie.total_plays > 0;

  // Sparkline SVG de plays diarios
  const W = 600;
  const H = 60;
  const maxPlays = Math.max(1, ...serie.dias.map((d) => d.plays));
  const n = serie.dias.length;
  const puntos = serie.dias.map((d, i) => {
    const x = n > 1 ? (i / (n - 1)) * W : W / 2;
    const y = H - (d.plays / maxPlays) * (H - 6) - 3;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });

  return (
    <section
      className="rounded-xl border p-6 md:p-8"
      style={{ background: 'var(--card-bg)', borderColor: 'var(--card-border)' }}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-3 mb-4">
        <div>
          <h2 className="text-[28px]" style={{ fontFamily: 'var(--font-cormorant)', fontWeight: 500 }}>
            VSL — reproducciones
          </h2>
          <p className="text-base" style={{ color: 'var(--text-dim)' }}>
            Plays diarios (últimas 8 semanas). YouTube aporta la historia, Panda el presente.
          </p>
        </div>
        {!serie.fuente_panda_activa && (
          <span className="text-sm px-3 py-1 rounded" style={{ background: '#1a1a1a', color: 'var(--text-pending)' }}>
            Panda: fuente conectándose
          </span>
        )}
      </div>

      {!hayDatos ? (
        <p className="text-base py-4" style={{ color: 'var(--text-pending)' }}>
          Aún sin reproducciones registradas. El cron de Panda corre a las 6:45 AM TJ.
        </p>
      ) : (
        <>
          {/* Sparkline */}
          <svg viewBox={`0 0 ${W} ${H}`} className="w-full" preserveAspectRatio="none" style={{ height: 60 }}>
            <polyline
              points={puntos.join(' ')}
              fill="none"
              stroke="var(--accent-green)"
              strokeWidth="2"
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          </svg>

          {/* Métricas */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-5">
            <VslKpi label="Plays totales" value={fmtNumber(serie.total_plays)} accent="green" />
            <VslKpi
              label="Espectadores únicos"
              value={serie.unique_viewers !== null ? fmtNumber(serie.unique_viewers) : '—'}
              hint={serie.unique_viewers === null ? 'solo Panda' : undefined}
            />
            <VslKpi
              label="Retención media"
              value={serie.retention_pct !== null ? `${serie.retention_pct.toFixed(0)}%` : '—'}
              accent="yellow"
            />
            <VslKpi
              label="Tiempo promedio"
              value={
                serie.avg_watch_seconds !== null
                  ? `${Math.floor(serie.avg_watch_seconds / 60)}:${String(Math.round(serie.avg_watch_seconds % 60)).padStart(2, '0')}`
                  : '—'
              }
              hint="min:seg"
            />
          </div>
        </>
      )}
    </section>
  );
}

function VslKpi({
  label,
  value,
  accent,
  hint,
}: {
  label: string;
  value: string;
  accent?: 'green' | 'yellow';
  hint?: string;
}) {
  const color = accent === 'green' ? 'var(--accent-green)' : accent === 'yellow' ? 'var(--accent-yellow)' : 'var(--text)';
  return (
    <div className="rounded-lg border p-4" style={{ borderColor: 'var(--card-border)', background: '#0f0f0f' }}>
      <div className="text-sm uppercase tracking-wider mb-2" style={{ color: 'var(--text-dim)' }}>
        {label}
      </div>
      <div className="text-[26px] font-semibold tabular-nums" style={{ color }}>
        {value}
      </div>
      {hint && <div className="text-sm mt-1" style={{ color: 'var(--text-pending)' }}>{hint}</div>}
    </div>
  );
}
