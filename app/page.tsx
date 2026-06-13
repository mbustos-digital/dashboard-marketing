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
  getCACAcumulado,
  listCACMensual,
  getFunnelEtapas,
  listAnunciosGanadores,
  getResumenComparativo,
  getVslSerie,
  type MarketingWindow,
  type CACAcumulado,
  type CACMensualEntry,
  type FunnelMes,
  type FunnelEtapa,
  type AnuncioGanador,
  type ResumenComparativo,
  type VslSerie,
} from '@/lib/queries';
import {
  ayerEnTijuana,
  esFechaValida,
  primerDiaDelMesDeFecha,
  diasAntes,
} from '@/lib/date-utils';
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

function fmtMesCorto(yyyy_mm: string): string {
  const [y, m] = yyyy_mm.split('-').map(Number);
  const fecha = new Date(Date.UTC(y, m - 1, 1));
  return new Intl.DateTimeFormat('es-MX', {
    month: 'short',
    year: '2-digit',
    timeZone: 'UTC',
  }).format(fecha);
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

  const mesInicio = primerDiaDelMesDeFecha(ayerReal);
  const mesAnteriorFin = diasAntes(mesInicio, 1);
  const mesAnteriorInicio = primerDiaDelMesDeFecha(mesAnteriorFin);

  let mkt: MarketingWindow | null = null;
  let funnel: FunnelMes | null = null;
  let anuncios: AnuncioGanador[] = [];
  let cacGlobal: CACAcumulado | null = null;
  let cacMensual: CACMensualEntry[] = [];
  let comparativo: ResumenComparativo | null = null;
  let vslSerie: VslSerie | null = null;
  let errorMsg: string | null = null;

  try {
    [mkt, funnel, anuncios, cacGlobal, cacMensual, comparativo, vslSerie] = await Promise.all([
      getMarketingWindow(rangoDesde, rangoHasta),
      getFunnelEtapas(rangoDesde, rangoHasta),
      listAnunciosGanadores(),
      getCACAcumulado(filtroActivo ? rangoHasta : undefined),
      listCACMensual(12),
      filtroActivo
        ? Promise.resolve(null)
        : getResumenComparativo(mesInicio, ayerReal, mesAnteriorInicio, mesAnteriorFin),
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

          {/* 2 — FUNNEL DE GAUGES */}
          <FunnelGauges funnel={funnel} periodo={filtroActivo ? `${rangoDesde} → ${rangoHasta}` : 'Mes en curso'} />

          {/* 2.5 — CARD VSL (Panda) */}
          {vslSerie && <VslCard serie={vslSerie} />}

          {/* 3 — ANUNCIOS GANADORES */}
          <AnunciosGanadores anuncios={anuncios} />

          {/* 4 — CAC MENSUAL */}
          <CACMensualChart entries={cacMensual} cacGlobal={cacGlobal} />

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
        sub={comparativo ? `mes anterior: ${fmtUSD(comparativo.inversion_usd.anterior)}` : undefined}
      />
      <KPIEstrellaCard
        label="Agendamientos"
        valor={fmtNumber(mkt.agendamientos)}
        flecha={
          comparativo ? (
            <Flecha actual={comparativo.agendas.actual} anterior={comparativo.agendas.anterior} />
          ) : null
        }
        sub={comparativo ? `mes anterior: ${fmtNumber(comparativo.agendas.anterior)}` : undefined}
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
        sub={costoAnterior !== null ? `mes anterior: ${fmtUSD(costoAnterior)}` : undefined}
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
// 2 — Funnel de gauges (SVG inline)
// ─────────────────────────────────────────────────────────────────────────────

function colorSalud(salud: FunnelEtapa['salud']): string {
  switch (salud) {
    case 'verde': return 'var(--accent-green)';
    case 'ambar': return 'var(--accent-yellow)';
    case 'rojo': return 'var(--accent-orange)';
    default: return 'var(--text-pending)';
  }
}

function Gauge({ etapa, esCuello }: { etapa: FunnelEtapa; esCuello: boolean }) {
  const pct = etapa.pct;
  // Arco semicircular: largo total = π * r = π * 40 ≈ 125.66
  const ARC_LEN = Math.PI * 40;
  const filled = pct !== null ? Math.min(pct, 100) / 100 * ARC_LEN : 0;
  const color = colorSalud(etapa.salud);

  return (
    <div
      className="rounded-xl border p-4 relative"
      style={{
        background: 'var(--card-bg)',
        borderColor: esCuello ? 'var(--accent-orange)' : 'var(--card-border)',
      }}
    >
      {esCuello && (
        <span
          className="absolute -top-2.5 left-3 px-2 py-0.5 rounded text-xs font-semibold uppercase tracking-wide"
          style={{ background: 'var(--accent-orange)', color: '#000' }}
        >
          Cuello de botella
        </span>
      )}

      <div className="flex items-start justify-between gap-1 mb-1">
        <div className="text-sm" style={{ color: 'var(--text-dim)' }}>
          {etapa.label}
        </div>
        <InfoTooltip texto={etapa.benchmark} />
      </div>

      <svg viewBox="0 0 100 58" className="w-full">
        <path
          d="M 10 52 A 40 40 0 0 1 90 52"
          fill="none"
          stroke="#1a1a1a"
          strokeWidth="8"
          strokeLinecap="round"
        />
        {pct !== null && (
          <path
            d="M 10 52 A 40 40 0 0 1 90 52"
            fill="none"
            stroke={color}
            strokeWidth="8"
            strokeLinecap="round"
            strokeDasharray={`${filled} ${ARC_LEN}`}
          />
        )}
        <text
          x="50"
          y="46"
          textAnchor="middle"
          fontSize="17"
          fontWeight="600"
          fill={pct !== null ? color : 'var(--text-pending)'}
        >
          {pct !== null ? `${pct < 10 ? pct.toFixed(1) : pct.toFixed(0)}%` : '—'}
        </text>
      </svg>

      <div className="text-center text-sm mt-1 tabular-nums" style={{ color: 'var(--text-pending)' }}>
        {fmtNumber(etapa.entrada)} → {fmtNumber(etapa.salida)}
      </div>
    </div>
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

function FunnelGauges({ funnel, periodo }: { funnel: FunnelMes; periodo: string }) {
  return (
    <section
      className="rounded-xl border p-6 md:p-8"
      style={{ background: 'var(--card-bg)', borderColor: 'var(--card-border)' }}
    >
      <h2
        className="text-[28px]"
        style={{ fontFamily: 'var(--font-cormorant)', fontWeight: 500 }}
      >
        Funnel — conversión entre etapas
      </h2>
      <p className="text-base mt-1 mb-6" style={{ color: 'var(--text-dim)' }}>
        {periodo}. Pasa el cursor sobre la (i) de cada dial para ver el benchmark.
      </p>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4 pt-2">
        {funnel.etapas.map((e) => (
          <Gauge key={e.key} etapa={e} esCuello={funnel.cuelloKey === e.key} />
        ))}
      </div>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 3 — Anuncios ganadores
// ─────────────────────────────────────────────────────────────────────────────

function AnunciosGanadores({ anuncios }: { anuncios: AnuncioGanador[] }) {
  return (
    <section
      className="rounded-xl border p-6 md:p-8"
      style={{ background: 'var(--card-bg)', borderColor: 'var(--card-border)' }}
    >
      <h2
        className="text-[28px]"
        style={{ fontFamily: 'var(--font-cormorant)', fontWeight: 500 }}
      >
        Anuncios ganadores
      </h2>
      <p className="text-base mt-1 mb-5" style={{ color: 'var(--text-dim)' }}>
        Rankeados por agendas. Datos de los leads que llegan con anuncio
        identificado (instant form de Meta).
      </p>

      {anuncios.length === 0 ? (
        <p className="text-base py-4" style={{ color: 'var(--text-pending)' }}>
          Aún sin leads con anuncio identificado. Esta tabla se llena sola
          cuando el webhook de Meta Lead Ads empiece a recibir leads de los
          formularios instantáneos (pendiente: publicar la app de Meta).
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-base">
            <thead>
              <tr
                className="text-sm uppercase tracking-wider text-left"
                style={{ background: '#0f0f0f', color: 'var(--text-dim)' }}
              >
                <th className="px-4 py-3">Anuncio</th>
                <th className="px-3 py-3 text-right">Leads</th>
                <th className="px-3 py-3 text-right">Agendas</th>
                <th className="px-3 py-3 text-right">Cierres</th>
                <th className="px-3 py-3 text-right">Cash</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {anuncios.map((a) => {
                const sinAgendas = a.leads > 0 && a.agendas === 0;
                return (
                  <tr key={a.ad_name} className="border-t" style={{ borderColor: 'var(--card-border)' }}>
                    <td className="px-4 py-3 font-medium max-w-[280px] truncate" title={a.ad_name}>
                      {a.ad_name}
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums">{a.leads}</td>
                    <td className="px-3 py-3 text-right tabular-nums">{a.agendas}</td>
                    <td className="px-3 py-3 text-right tabular-nums">{a.cierres}</td>
                    <td className="px-3 py-3 text-right tabular-nums" style={{ color: a.cash_usd > 0 ? 'var(--accent-green)' : undefined }}>
                      {a.cash_usd > 0 ? fmtUSD(a.cash_usd) : '—'}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {sinAgendas && (
                        <span
                          className="text-xs px-2 py-1 rounded uppercase tracking-wide"
                          style={{ background: '#2a1410', color: 'var(--accent-orange)' }}
                        >
                          candidato a pausar
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 4 — CAC mensual (tendencia) + acumulado de referencia
// ─────────────────────────────────────────────────────────────────────────────

function CACMensualChart({
  entries,
  cacGlobal,
}: {
  entries: CACMensualEntry[];
  cacGlobal: CACAcumulado | null;
}) {
  if (entries.length === 0) {
    return (
      <section
        className="rounded-xl border px-6 py-5"
        style={{ background: 'var(--card-bg)', borderColor: 'var(--card-border)' }}
      >
        <div className="text-sm uppercase tracking-widest mb-2" style={{ color: 'var(--text-dim)' }}>
          CAC mensual (Spend ÷ primeros pagos del mes)
        </div>
        <p className="text-base" style={{ color: 'var(--text-pending)' }}>
          Aún sin meses con primeros pagos capturados. Marcá fecha_primer_pago
          en al menos 1 lead para activar la tendencia.
        </p>
        {cacGlobal && cacGlobal.cac_usd !== null && (
          <p className="text-sm mt-3" style={{ color: 'var(--text-dim)' }}>
            CAC acumulado histórico (referencia, basado en cierres):{' '}
            <strong>{fmtUSD(cacGlobal.cac_usd)}</strong> ÷ {cacGlobal.cierres_total}{' '}
            cierre{cacGlobal.cierres_total === 1 ? '' : 's'}
          </p>
        )}
      </section>
    );
  }

  const maxCAC = Math.max(...entries.map((e) => e.cac_usd));
  const totalSpend = entries.reduce((s, e) => s + e.spend_usd, 0);
  const totalPagos = entries.reduce((s, e) => s + e.primeros_pagos, 0);
  const cacPromedio = totalPagos > 0 ? totalSpend / totalPagos : null;

  return (
    <section
      className="rounded-xl border p-6 md:p-8"
      style={{ background: 'var(--card-bg)', borderColor: 'var(--card-border)' }}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-3 mb-4">
        <div>
          <h2 className="text-[28px]" style={{ fontFamily: 'var(--font-cormorant)', fontWeight: 500 }}>
            CAC mensual — tendencia
          </h2>
          <p className="text-base" style={{ color: 'var(--text-dim)' }}>
            Spend Meta del mes (USD) ÷ leads con primer pago en ese mes.
          </p>
        </div>
        {cacPromedio !== null && (
          <div
            className="text-[22px] tracking-tight tabular-nums"
            style={{ fontFamily: 'var(--font-cormorant)', fontWeight: 500, color: 'var(--accent-yellow)' }}
          >
            Promedio: {fmtUSD(cacPromedio)} / cliente
          </div>
        )}
      </div>

      <div className="space-y-2">
        {entries.map((e) => {
          const widthPct = maxCAC > 0 ? (e.cac_usd / maxCAC) * 100 : 0;
          return (
            <div key={e.mes} className="flex items-center gap-3 text-base">
              <div className="w-20 shrink-0" style={{ color: 'var(--text-dim)' }}>
                {fmtMesCorto(e.mes)}
              </div>
              <div className="flex-1 h-6 rounded relative" style={{ background: '#0f0f0f' }}>
                <div
                  className="h-full rounded"
                  style={{
                    width: `${Math.max(widthPct, 2)}%`,
                    background: 'var(--accent-yellow)',
                    opacity: 0.85,
                  }}
                  title={`${fmtMesCorto(e.mes)}: ${fmtUSD(e.cac_usd)} (${e.primeros_pagos} cliente${e.primeros_pagos === 1 ? '' : 's'})`}
                />
              </div>
              <div className="w-28 shrink-0 text-right tabular-nums" style={{ color: 'var(--text)' }}>
                {fmtUSD(e.cac_usd)}
              </div>
              <div className="w-20 shrink-0 text-right text-sm tabular-nums" style={{ color: 'var(--text-pending)' }}>
                {e.primeros_pagos} {e.primeros_pagos === 1 ? 'cliente' : 'clientes'}
              </div>
            </div>
          );
        })}
      </div>

      {cacGlobal && cacGlobal.cac_usd !== null && (
        <p className="text-sm mt-4" style={{ color: 'var(--text-dim)' }}>
          CAC acumulado histórico (referencia, basado en <em>cierres</em> firmados):{' '}
          <strong style={{ color: 'var(--text)' }}>{fmtUSD(cacGlobal.cac_usd)}</strong>{' '}
          · {cacGlobal.cierres_total} cierre{cacGlobal.cierres_total === 1 ? '' : 's'}
        </p>
      )}
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 5 — Eficiencia secundaria (texto, sin amarillo)
// ─────────────────────────────────────────────────────────────────────────────

function EficienciaSecundaria({ mkt }: { mkt: MarketingWindow }) {
  const items: Array<{ label: string; value: string }> = [
    { label: 'Clicks (todos)', value: fmtNumber(mkt.clicks) },
    { label: 'CTR global', value: fmtPercent(mkt.ctr_global) },
    { label: 'CPC global', value: fmtUSD(mkt.cpc_global, 2) },
    { label: 'Costo por Landing View', value: fmtUSD(mkt.cpl_global, 2) },
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
          <span key={i.label} style={{ color: 'var(--text-dim)' }}>
            {i.label}:{' '}
            <strong className="tabular-nums" style={{ color: 'var(--text)' }}>
              {i.value}
            </strong>
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
