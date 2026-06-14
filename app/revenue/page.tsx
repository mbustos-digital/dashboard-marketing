// =============================================================================
// Tab Revenue — ¿cuánto dinero realmente entró? (Prompt 4 del mentor)
// =============================================================================
// Default: mes en curso. Con filtro Desde/Hasta toma el rango elegido (mismo
// patrón que Marketing y Vista General).
//
// Métricas:
//   Revenue del período
//     - Sold Revenue       USD   (lo vendido)
//     - Cash Collected     USD   (lo cobrado)
//     - Outstanding        USD   (Sold - Cash)
//   Eficiencia
//     - Meta Spend         MXN
//     - CAC real           MXN/cliente nuevo
//     - ROAS cash          ratio
//     - ROAS sold          ratio
// =============================================================================

import { getRevenuePeriod, type RevenuePeriod } from '@/lib/queries';
import { getOutstandingDetalle, type OutstandingLead } from '@/lib/pagos';
import {
  ayerEnTijuana,
  esFechaValida,
  hoyEnTijuana,
  primerDiaDelMesDeFecha,
} from '@/lib/date-utils';
import Link from 'next/link';
import { DashboardHeader } from '../_components/DashboardHeader';
import { DashboardTabs } from '../_components/DashboardTabs';
import { FechaSelector } from '../_components/FechaSelector';

function fmtFechaCorta(yyyy_mm_dd: string | null): string {
  if (!yyyy_mm_dd) return '—';
  const [y, m, d] = yyyy_mm_dd.split('-').map(Number);
  return new Intl.DateTimeFormat('es-MX', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(Date.UTC(y, m - 1, d)));
}

export const dynamic = 'force-dynamic';
export const revalidate = 0;

// ─────────────────────────────────────────────────────────────────────────────
// Format helpers
// ─────────────────────────────────────────────────────────────────────────────

function fmtUSD(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(n);
}

function fmtRatio(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  return `${n.toFixed(2)}x`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Page
// ─────────────────────────────────────────────────────────────────────────────

export default async function RevenuePage({
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

  let revenue: RevenuePeriod | null = null;
  let outstandingDet: { items: OutstandingLead[]; total: number } = { items: [], total: 0 };
  let errorMsg: string | null = null;

  try {
    [revenue, outstandingDet] = await Promise.all([
      getRevenuePeriod(rangoDesde, rangoHasta),
      getOutstandingDetalle(hoyEnTijuana()),
    ]);
  } catch (err) {
    errorMsg = err instanceof Error ? err.message : String(err);
  }

  return (
    <main className="min-h-screen w-full px-6 py-8 md:px-12 md:py-12 bg-[var(--bg)] text-[var(--text)]">
      <DashboardHeader fechaAyer={ayerReal} />
      <DashboardTabs active="revenue" />

      <FechaSelector fechaActualReal={ayerReal} />

      {errorMsg || !revenue ? (
        <div
          className="rounded-lg p-6 border"
          style={{ borderColor: 'var(--accent-orange)', background: '#2a1410' }}
        >
          <p className="font-semibold mb-1" style={{ color: 'var(--accent-orange)' }}>
            Error consultando datos
          </p>
          <p className="text-base font-mono" style={{ color: 'var(--text-dim)' }}>
            {errorMsg ?? 'Sin datos'}
          </p>
        </div>
      ) : (
        <div className="space-y-8">
          {/* REVENUE DEL PERÍODO */}
          <Section
            title="Revenue del período"
            subtitle={
              filtroActivo
                ? `Rango ${rangoDesde} → ${rangoHasta}`
                : 'Mes en curso'
            }
          >
            {/* BARRA DE CASCADA (8D): sobre lo vendido, cuánto se cobró y cuánto falta */}
            <CascadaBar
              sold={revenue.sold_revenue_usd}
              cash={revenue.cash_collected_usd}
            />

            <Grid>
              <KPI
                label="Sold Revenue"
                value={fmtUSD(revenue.sold_revenue_usd)}
                accent="yellow"
                hint={`${revenue.cierres_en_periodo} cierre${revenue.cierres_en_periodo === 1 ? '' : 's'} en el período`}
              />
              <KPI
                label="Cash Collected"
                value={fmtUSD(revenue.cash_collected_usd)}
                accent="green"
                hint={`Cash que entró en el período (incluye cuotas de cierres previos) · ${revenue.primeros_pagos_en_periodo} cliente${revenue.primeros_pagos_en_periodo === 1 ? '' : 's'} con primer pago`}
              />
              <KPI
                label="Outstanding"
                value={fmtUSD(revenue.outstanding_usd)}
                accent="orange"
                hint="Pendiente de cobro — todas las cuotas no pagadas del pipeline"
              />
            </Grid>

            {/* DRILL (Fase 13): el outstanding lleva a los nombres y montos */}
            <OutstandingDrill detalle={outstandingDet} />
          </Section>

          {/* EFICIENCIA — post-Fase 1 todo en USD, ROAS válidos */}
          <Section
            title="Eficiencia"
            subtitle="Todos los valores en USD. El spend de Meta se convierte desde MXN automáticamente."
          >
            <Grid>
              <KPI
                label="Meta Spend"
                value={fmtUSD(revenue.meta_spend_usd)}
                accent="default"
              />
              <KPI
                label="CAC real"
                value={fmtUSD(revenue.cac_usd)}
                accent="default"
                hint={
                  revenue.primeros_pagos_en_periodo > 0
                    ? `Spend ÷ ${revenue.primeros_pagos_en_periodo} primeros pagos`
                    : 'Aún sin primeros pagos en el período'
                }
              />
              <KPI
                label="ROAS cash"
                value={fmtRatio(revenue.roas_cash)}
                accent="green"
                hint="Cash Collected ÷ Spend · el dinero que SÍ entró"
              />
              <KPI
                label="ROAS sold"
                value={fmtRatio(revenue.roas_sold)}
                accent="default"
                hint="Sold ÷ Spend · comprometido, no cobrado"
              />
            </Grid>
            <p className="text-sm mt-3" style={{ color: 'var(--text-pending)' }}>
              El ROAS que cuenta es el de <strong style={{ color: 'var(--accent-green)' }}>cash</strong>:
              mide la plata que entró. El de <em>sold</em> usa lo firmado y puede inflar con dinero que
              todavía no se cobró.
            </p>
          </Section>
        </div>
      )}
    </main>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// CascadaBar (8D) — proporción cobrado/pendiente sobre el total vendido
// ─────────────────────────────────────────────────────────────────────────────

function CascadaBar({
  sold,
  cash,
}: {
  sold: number;
  cash: number;
}) {
  if (sold <= 0) {
    return (
      <p className="text-base mb-6" style={{ color: 'var(--text-pending)' }}>
        Sin ventas en el período — la barra de cobranza aparece cuando haya un
        cierre con monto.
      </p>
    );
  }

  // El cash puede superar lo vendido del período (cobros de meses previos) —
  // capeamos visualmente a 100%.
  const pctCash = Math.min((cash / sold) * 100, 100);
  const pctOut = Math.max(100 - pctCash, 0);

  return (
    <div className="mb-7">
      <div
        className="flex w-full h-10 rounded-lg overflow-hidden border"
        style={{ borderColor: 'var(--card-border)' }}
      >
        {pctCash > 0 && (
          <div
            className="flex items-center justify-center text-sm font-semibold"
            title={`Cobrado: ${pctCash.toFixed(0)}%`}
            style={{ width: `${pctCash}%`, background: 'var(--accent-green)', color: '#000' }}
          >
            {pctCash >= 12 ? `${pctCash.toFixed(0)}%` : ''}
          </div>
        )}
        {pctOut > 0 && (
          <div
            className="flex items-center justify-center text-sm font-semibold"
            title={`Pendiente: ${pctOut.toFixed(0)}%`}
            style={{ width: `${pctOut}%`, background: 'var(--accent-orange)', opacity: 0.85, color: '#000' }}
          >
            {pctOut >= 12 ? `${pctOut.toFixed(0)}%` : ''}
          </div>
        )}
      </div>
      <div className="flex gap-4 mt-2 text-sm" style={{ color: 'var(--text-dim)' }}>
        <span><span style={{ color: 'var(--accent-green)' }}>■</span> cobrado</span>
        <span><span style={{ color: 'var(--accent-orange)' }}>■</span> pendiente del período</span>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// OutstandingDrill — panel nominal del outstanding (Fase 13)
// <details> nativo: clickeable, sin JS, SSR-friendly. El total iguala la card.
// ─────────────────────────────────────────────────────────────────────────────
function OutstandingDrill({ detalle }: { detalle: { items: OutstandingLead[]; total: number } }) {
  if (detalle.items.length === 0) {
    return (
      <p className="mt-4 text-base" style={{ color: 'var(--text-pending)' }}>
        Sin cuotas pendientes — todo cobrado.
      </p>
    );
  }
  return (
    <details className="mt-4 group">
      <summary
        className="cursor-pointer select-none px-4 py-3 rounded-lg border text-base flex items-center justify-between gap-3"
        style={{ borderColor: 'var(--accent-orange)', color: 'var(--accent-orange)' }}
      >
        <span>
          Ver a quién cobrarle — {detalle.items.length} lead{detalle.items.length === 1 ? '' : 's'} ·{' '}
          {fmtUSD(detalle.total)} pendiente
        </span>
        <span className="text-sm" style={{ color: 'var(--text-dim)' }}>desplegar ▾</span>
      </summary>
      <div className="mt-3 rounded-xl border overflow-x-auto" style={{ background: 'var(--card-bg)', borderColor: 'var(--card-border)' }}>
        <table className="w-full text-base">
          <thead>
            <tr className="text-sm uppercase tracking-wider text-left" style={{ background: '#0f0f0f', color: 'var(--text-dim)' }}>
              <th className="px-4 py-3">Lead</th>
              <th className="px-4 py-3 text-right">Vendido</th>
              <th className="px-4 py-3 text-right">Cobrado</th>
              <th className="px-4 py-3 text-right">Pendiente</th>
              <th className="px-4 py-3">Próxima cuota</th>
              <th className="px-4 py-3 text-right hidden md:table-cell">Días desde cierre</th>
            </tr>
          </thead>
          <tbody>
            {detalle.items.map((it) => (
              <tr key={it.lead_id} className="border-t" style={{ borderColor: 'var(--card-border)' }}>
                <td className="px-4 py-3">
                  <Link href={`/leads/${it.lead_id}`} style={{ color: 'var(--accent-yellow)' }}>{it.lead_nombre}</Link>
                </td>
                <td className="px-4 py-3 text-right tabular-nums">{fmtUSD(it.vendido_usd)}</td>
                <td className="px-4 py-3 text-right tabular-nums" style={{ color: 'var(--accent-green)' }}>{fmtUSD(it.cobrado_usd)}</td>
                <td className="px-4 py-3 text-right tabular-nums" style={{ color: 'var(--accent-orange)' }}>{fmtUSD(it.pendiente_usd)}</td>
                <td className="px-4 py-3 text-sm" style={{ color: 'var(--text-dim)' }}>
                  {it.proxima_cuota
                    ? `${it.proxima_cuota.numero === 0 ? 'inicial' : 'cuota ' + it.proxima_cuota.numero} · ${fmtUSD(it.proxima_cuota.monto_usd)} · ${fmtFechaCorta(it.proxima_cuota.fecha_esperada)}`
                    : '—'}
                </td>
                <td className="px-4 py-3 text-right hidden md:table-cell tabular-nums" style={{ color: 'var(--text-dim)' }}>
                  {it.dias_desde_cierre ?? '—'}
                </td>
              </tr>
            ))}
            <tr className="border-t" style={{ borderColor: 'var(--card-border)' }}>
              <td className="px-4 py-3 font-semibold" colSpan={3}>Total pendiente</td>
              <td className="px-4 py-3 text-right font-semibold tabular-nums" style={{ color: 'var(--accent-orange)' }}>{fmtUSD(detalle.total)}</td>
              <td className="px-4 py-3" colSpan={2}></td>
            </tr>
          </tbody>
        </table>
      </div>
    </details>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Building blocks (idénticos a /general para consistencia visual)
// ─────────────────────────────────────────────────────────────────────────────

function Section({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <section
      className="rounded-xl border p-6 md:p-8"
      style={{ background: 'var(--card-bg)', borderColor: 'var(--card-border)' }}
    >
      <h2
        className="text-[28px]"
        style={{ fontFamily: 'var(--font-cormorant)', fontWeight: 500 }}
      >
        {title}
      </h2>
      <p className="text-base mt-1 mb-5" style={{ color: 'var(--text-dim)' }}>
        {subtitle}
      </p>
      {children}
    </section>
  );
}

function Grid({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-2 md:grid-cols-4 gap-4">{children}</div>;
}

function KPI({
  label,
  value,
  accent,
  hint,
}: {
  label: string;
  value: string;
  accent: 'yellow' | 'green' | 'orange' | 'default';
  hint?: string;
}) {
  const color =
    accent === 'yellow'
      ? 'var(--accent-yellow)'
      : accent === 'green'
      ? 'var(--accent-green)'
      : accent === 'orange'
      ? 'var(--accent-orange)'
      : 'var(--text)';
  return (
    <div
      className="rounded-lg border p-4"
      style={{ borderColor: 'var(--card-border)', background: '#0f0f0f' }}
    >
      <div className="text-sm uppercase tracking-wider mb-2" style={{ color: 'var(--text-dim)' }}>
        {label}
      </div>
      <div className="text-[28px] font-semibold tabular-nums" style={{ color }}>
        {value}
      </div>
      {hint && (
        <div className="text-sm mt-1" style={{ color: 'var(--text-pending)' }}>
          {hint}
        </div>
      )}
    </div>
  );
}
