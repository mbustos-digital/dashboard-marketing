// =============================================================================
// Dashboard Marketing — Tab Marketing (MVP)
// =============================================================================
// 3 ventanas: Día anterior · Semana en curso · Mes acumulado.
// Datos de marketing_metrics_daily (Meta Ads). Etapas pendientes de Fase 3/4
// se muestran en gris con etiqueta "pendiente".
// =============================================================================

import Link from 'next/link';
import {
  getMarketingWindow,
  getCACAcumulado,
  listCACMensual,
  type MarketingWindow,
  type CACAcumulado,
  type CACMensualEntry,
} from '@/lib/queries';
import {
  ayerEnTijuana,
  esFechaValida,
  lunesDeFecha,
  primerDiaDelMesDeFecha,
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

function fmtCurrency(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  return new Intl.NumberFormat('es-MX', {
    style: 'currency',
    currency: 'MXN',
    maximumFractionDigits: 2,
  }).format(n);
}

function fmtPercent(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  return `${n.toFixed(2)}%`;
}

function fmtRatio(r: number | null | undefined): string {
  if (r === null || r === undefined || !Number.isFinite(r) || r <= 0) return '—';
  return `1 de cada ${fmtNumber(r)}`;
}

function fmtFechaCorta(yyyy_mm_dd: string): string {
  const [y, m, d] = yyyy_mm_dd.split('-').map(Number);
  const fecha = new Date(Date.UTC(y, m - 1, d));
  return new Intl.DateTimeFormat('es-MX', {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  }).format(fecha);
}


// ─────────────────────────────────────────────────────────────────────────────
// Page (server component)
// ─────────────────────────────────────────────────────────────────────────────

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ desde?: string; hasta?: string }>;
}) {
  const ayerReal = ayerEnTijuana();
  const params = await searchParams;

  // Si user pasó ?desde=...&hasta=... válidos → vista custom (1 ventana).
  // Si no → vista por defecto (3 ventanas: Día / Semana / Mes anclados a ayer real).
  const desdeParam = params.desde;
  const hastaParam = params.hasta;
  const filtroActivo =
    !!desdeParam &&
    !!hastaParam &&
    esFechaValida(desdeParam) &&
    esFechaValida(hastaParam) &&
    desdeParam <= hastaParam &&
    hastaParam <= ayerReal;

  const ayer = ayerReal;
  const lunes = lunesDeFecha(ayer);
  const mesInicio = primerDiaDelMesDeFecha(ayer);

  let dia: MarketingWindow | null = null;
  let semana: MarketingWindow | null = null;
  let mes: MarketingWindow | null = null;
  let custom: MarketingWindow | null = null;
  let cacGlobal: CACAcumulado | null = null;
  let cacMensual: CACMensualEntry[] = [];
  let errorMsg: string | null = null;

  try {
    if (filtroActivo) {
      [custom, cacGlobal, cacMensual] = await Promise.all([
        getMarketingWindow(desdeParam!, hastaParam!),
        getCACAcumulado(hastaParam!),
        listCACMensual(12),
      ]);
    } else {
      [dia, semana, mes, cacGlobal, cacMensual] = await Promise.all([
        getMarketingWindow(ayer, ayer),
        getMarketingWindow(lunes, ayer),
        getMarketingWindow(mesInicio, ayer),
        getCACAcumulado(),
        listCACMensual(12),
      ]);
    }
  } catch (err) {
    errorMsg = err instanceof Error ? err.message : String(err);
  }

  return (
    <main className="min-h-screen w-full px-6 py-8 md:px-12 md:py-12 bg-[var(--bg)] text-[var(--text)]">
      <DashboardHeader fechaAyer={ayer} />
      <DashboardTabs active="marketing" />

      <FechaSelector fechaActualReal={ayerReal} />

      {/* CONTENT */}
      {errorMsg ? (
        <div
          className="rounded-lg p-6 border"
          style={{ borderColor: 'var(--accent-orange)', background: '#2a1410' }}
        >
          <p className="font-semibold mb-1" style={{ color: 'var(--accent-orange)' }}>
            Error consultando Supabase
          </p>
          <p className="text-base font-mono" style={{ color: 'var(--text-dim)' }}>
            {errorMsg}
          </p>
        </div>
      ) : (
        <>
          {/* CAC MENSUAL — tendencia + acumulado como referencia secundaria */}
          <CACMensualChart entries={cacMensual} cacGlobal={cacGlobal} />

          {filtroActivo ? (
            <section className="grid grid-cols-1 gap-6">
              <VentanaCard
                title="Rango seleccionado"
                subtitle={`${fmtFechaCorta(desdeParam!)} → ${fmtFechaCorta(hastaParam!)}`}
                data={custom}
                showCAC
              />
            </section>
          ) : (
            <section className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <VentanaCard
                title="Día anterior"
                subtitle={fmtFechaCorta(ayer)}
                data={dia}
              />
              <VentanaCard
                title="Semana en curso"
                subtitle={`${fmtFechaCorta(lunes)} → ${fmtFechaCorta(ayer)}`}
                data={semana}
                showCAC
              />
              <VentanaCard
                title="Mes acumulado"
                subtitle={`${fmtFechaCorta(mesInicio)} → ${fmtFechaCorta(ayer)}`}
                data={mes}
                showCAC
              />
            </section>
          )}
        </>
      )}

      {/* FOOTER */}
      <footer className="mt-12 pt-6 border-t" style={{ borderColor: 'var(--card-border)' }}>
        <p className="text-base mb-2" style={{ color: 'var(--text-dim)' }}>
          <strong style={{ color: 'var(--accent-yellow)' }}>Funnel actual desde 1-may-2026.</strong>{' '}
          Data anterior a esa fecha fue limpiada para alinear el análisis. Los valores en
          0 de las etapas YouTube son honestos: la primera medición diaria real se publica
          mañana 6:15 AM TJ y a partir de ahí se acumulan.
        </p>
        <p className="text-base" style={{ color: 'var(--text-pending)' }}>
          Crons automáticos diarios: Meta 6:00 AM TJ, YouTube 6:15 AM TJ. Calendly webhook
          alimenta leads sin intervención. Manual: marcar asistió/calificado/cerro en{' '}
          <Link href="/leads" style={{ color: 'var(--accent-yellow)', textDecoration: 'underline' }}>/leads/[id]</Link>{' '}
          post-J1.
        </p>
      </footer>
    </main>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Ventana card
// ─────────────────────────────────────────────────────────────────────────────

function VentanaCard({
  title,
  subtitle,
  data,
  showCAC = false,
}: {
  title: string;
  subtitle: string;
  data: MarketingWindow | null;
  showCAC?: boolean;
}) {
  return (
    <article
      className="rounded-xl border p-6"
      style={{ background: 'var(--card-bg)', borderColor: 'var(--card-border)' }}
    >
      {/* Header card */}
      <header className="mb-5">
        <h2
          className="text-[31px]"
          style={{ fontFamily: 'var(--font-cormorant)', fontWeight: 500 }}
        >
          {title}
        </h2>
        <p className="text-base mt-1" style={{ color: 'var(--text-dim)' }}>
          {subtitle}
          {data && data.dias_con_datos > 0 && (
            <span> · {data.dias_con_datos} {data.dias_con_datos === 1 ? 'día' : 'días'} con datos</span>
          )}
        </p>
      </header>

      {data === null ? (
        <p className="text-lg" style={{ color: 'var(--text-pending)' }}>Sin datos</p>
      ) : (
        <>
          {/* FUNNEL */}
          <Section title="Funnel">
            <StageRow num="1" label="Impresiones Meta" value={fmtNumber(data.impressions)} highlight />
            <StageRow num="2" label="Visitas Landing" value={fmtNumber(data.landing_page_views)} highlight />
            {data.vsl_views !== null ? (
              <StageRow
                num="3"
                label="Vistas Video VSL"
                value={fmtNumber(data.vsl_views)}
                highlight
                note={data.vsl_days_baseline_only > 0 ? `${data.vsl_days_baseline_only}d baseline` : undefined}
              />
            ) : (
              <StageRow num="3" label="Vistas Video VSL" value="—" pending="Fase 3" />
            )}
            <StageRow
              num="4"
              label="Agendamientos"
              value={fmtNumber(data.agendamientos)}
              highlight
            />
            {data.thanks_views !== null ? (
              <StageRow
                num="5"
                label="Vistas Video Thanks (9 min)"
                value={fmtNumber(data.thanks_views)}
                highlight
                note={data.thanks_days_baseline_only > 0 ? `${data.thanks_days_baseline_only}d baseline` : undefined}
              />
            ) : (
              <StageRow num="5" label="Vistas Video Thanks (9 min)" value="—" pending="Fase 3" />
            )}
            {data.thanks_prep_views !== null && (
              <AuxRow
                label="↳ Prep video (40 seg, alcance)"
                value={fmtNumber(data.thanks_prep_views)}
                badge={
                  data.thanks_prep_days_baseline_only > 0
                    ? `${data.thanks_prep_days_baseline_only}d baseline`
                    : undefined
                }
              />
            )}
          </Section>

          {/* RATIOS */}
          <Section title="Ratios (1 de cada X)">
            {(() => {
              // Identificar el peor ratio (mayor X) entre los calculables
              const calculables: Array<{ label: string; value: number }> = [];
              if (data.ratio_imp_landing !== null) calculables.push({ label: 'imp_landing', value: data.ratio_imp_landing });
              if (data.ratio_landing_vsl !== null) calculables.push({ label: 'landing_vsl', value: data.ratio_landing_vsl });
              if (data.ratio_vsl_agenda !== null) calculables.push({ label: 'vsl_agenda', value: data.ratio_vsl_agenda });
              if (data.ratio_agenda_thanks !== null) calculables.push({ label: 'agenda_thanks', value: data.ratio_agenda_thanks });
              const peorLabel =
                calculables.length >= 2
                  ? calculables.reduce((max, r) => (r.value > max.value ? r : max)).label
                  : null;
              return (
                <>
                  <RatioRow
                    label="Impresiones → Landing"
                    value={fmtRatio(data.ratio_imp_landing)}
                    isPeor={peorLabel === 'imp_landing'}
                  />
                  {data.ratio_landing_vsl !== null ? (
                    <RatioRow
                      label="Landing → VSL"
                      value={fmtRatio(data.ratio_landing_vsl)}
                      isPeor={peorLabel === 'landing_vsl'}
                    />
                  ) : (
                    <RatioRow label="Landing → VSL" value="—" pending="sin datos" />
                  )}
                  {data.ratio_vsl_agenda !== null ? (
                    <RatioRow
                      label="VSL → Agendamiento"
                      value={fmtRatio(data.ratio_vsl_agenda)}
                      isPeor={peorLabel === 'vsl_agenda'}
                    />
                  ) : (
                    <RatioRow label="VSL → Agendamiento" value="—" pending="sin datos" />
                  )}
                  {data.ratio_agenda_thanks !== null ? (
                    <RatioRow
                      label="Agendamiento → Thanks"
                      value={fmtRatio(data.ratio_agenda_thanks)}
                      isPeor={peorLabel === 'agenda_thanks'}
                    />
                  ) : (
                    <RatioRow label="Agendamiento → Thanks" value="—" pending="sin datos" />
                  )}
                </>
              );
            })()}
          </Section>

          {/* INVERSIÓN */}
          <Section title="Inversión y eficiencia">
            <KvRow label="Spend total" value={fmtCurrency(data.spend_usd)} />
            <KvRow label="Clicks (todos)" value={fmtNumber(data.clicks)} />
            <KvRow label="CTR global" value={fmtPercent(data.ctr_global)} />
            <KvRow label="CPC global" value={fmtCurrency(data.cpc_global)} />
            <KvRow label="Costo por Landing View" value={fmtCurrency(data.cpl_global)} />
            {showCAC && (
              <KvRow
                label={`CAC (${data.cierres_en_ventana} cliente${data.cierres_en_ventana === 1 ? '' : 's'})`}
                value={data.cac !== null ? fmtCurrency(data.cac) : '—'}
              />
            )}
          </Section>
        </>
      )}
    </article>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-5 last:mb-0">
      <h3
        className="text-sm uppercase tracking-widest mb-2"
        style={{ color: 'var(--text-dim)' }}
      >
        {title}
      </h3>
      <div className="space-y-1">{children}</div>
    </div>
  );
}

function StageRow({
  num,
  label,
  value,
  highlight,
  pending,
  note,
}: {
  num: string;
  label: string;
  value: string;
  highlight?: boolean;
  pending?: string;
  note?: string;
}) {
  const isPending = !!pending;
  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5">
      <div className="flex items-baseline gap-2 min-w-0">
        <span
          className="text-base w-4 text-center"
          style={{ color: isPending ? 'var(--text-pending)' : 'var(--text-dim)' }}
        >
          {num}
        </span>
        <span
          className="text-lg truncate"
          style={{ color: isPending ? 'var(--text-pending)' : 'var(--text)' }}
        >
          {label}
        </span>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {note && (
          <span
            className="text-sm px-1.5 py-0.5 rounded"
            style={{ background: '#1a1a1a', color: 'var(--text-dim)' }}
            title="Días con solo snapshot baseline, sin delta diario calculable"
          >
            {note}
          </span>
        )}
        {pending && (
          <span
            className="text-sm px-1.5 py-0.5 rounded"
            style={{ background: '#1a1a1a', color: 'var(--text-pending)' }}
          >
            {pending}
          </span>
        )}
        <span
          className="text-[22px] font-semibold tabular-nums"
          style={{
            color: isPending
              ? 'var(--text-pending)'
              : highlight
              ? 'var(--accent-yellow)'
              : 'var(--text)',
          }}
        >
          {value}
        </span>
      </div>
    </div>
  );
}

function RatioRow({
  label,
  value,
  pending,
  isPeor,
}: {
  label: string;
  value: string;
  pending?: string;
  isPeor?: boolean;
}) {
  const isPending = !!pending;
  const valueColor = isPending
    ? 'var(--text-pending)'
    : isPeor
    ? 'var(--accent-orange)'
    : 'var(--accent-green)';
  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5">
      <span
        className="text-lg truncate"
        style={{ color: isPending ? 'var(--text-pending)' : 'var(--text)' }}
      >
        {label}
      </span>
      <div className="flex items-center gap-2 shrink-0">
        {isPeor && !isPending && (
          <span
            className="text-sm px-1.5 py-0.5 rounded"
            style={{ background: '#3a1810', color: 'var(--accent-orange)' }}
            title="Peor ratio del funnel — punto a optimizar"
          >
            peor
          </span>
        )}
        {pending && (
          <span
            className="text-sm px-1.5 py-0.5 rounded"
            style={{ background: '#1a1a1a', color: 'var(--text-pending)' }}
          >
            {pending}
          </span>
        )}
        <span className="text-lg font-medium tabular-nums" style={{ color: valueColor }}>
          {value}
        </span>
      </div>
    </div>
  );
}

function KvRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1">
      <span className="text-lg" style={{ color: 'var(--text-dim)' }}>
        {label}
      </span>
      <span className="text-lg font-medium tabular-nums">{value}</span>
    </div>
  );
}

function AuxRow({
  label,
  value,
  badge,
}: {
  label: string;
  value: string;
  badge?: string;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1 pl-6">
      <span className="text-base truncate" style={{ color: 'var(--text-dim)' }}>
        {label}
      </span>
      <div className="flex items-center gap-2 shrink-0">
        {badge && (
          <span
            className="text-sm px-1.5 py-0.5 rounded"
            style={{ background: '#1a1a1a', color: 'var(--text-dim)' }}
          >
            {badge}
          </span>
        )}
        <span className="text-base font-medium tabular-nums" style={{ color: 'var(--text-dim)' }}>
          {value}
        </span>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// CACMensualChart — tendencia mensual + acumulado como referencia (Prompt 11)
// ─────────────────────────────────────────────────────────────────────────────

function fmtMesCorto(yyyy_mm: string): string {
  const [y, m] = yyyy_mm.split('-').map(Number);
  const fecha = new Date(Date.UTC(y, m - 1, 1));
  return new Intl.DateTimeFormat('es-MX', {
    month: 'short',
    year: '2-digit',
    timeZone: 'UTC',
  }).format(fecha);
}

function CACMensualChart({
  entries,
  cacGlobal,
}: {
  entries: CACMensualEntry[];
  cacGlobal: CACAcumulado | null;
}) {
  // Caso vacío: aún no hay primeros pagos capturados
  if (entries.length === 0) {
    return (
      <section
        className="mb-6 rounded-xl border px-5 py-5"
        style={{ background: 'var(--card-bg)', borderColor: 'var(--card-border)' }}
      >
        <div className="text-sm uppercase tracking-widest mb-2" style={{ color: 'var(--text-dim)' }}>
          CAC mensual (Spend ÷ primeros pagos del mes)
        </div>
        <p className="text-base" style={{ color: 'var(--text-pending)' }}>
          Aún sin meses con primeros pagos capturados. Marcá{' '}
          <code>fecha_primer_pago</code> en al menos 1 lead para activar la
          tendencia.
        </p>
        {cacGlobal && cacGlobal.cac_mxn !== null && (
          <p className="text-sm mt-3" style={{ color: 'var(--text-dim)' }}>
            CAC acumulado histórico (referencia, basado en cierre):{' '}
            <strong>{
              new Intl.NumberFormat('es-MX', {
                style: 'currency',
                currency: 'MXN',
                maximumFractionDigits: 0,
              }).format(cacGlobal.cac_mxn)
            }</strong>{' '}
            ÷ {cacGlobal.cierres_total} cierre{cacGlobal.cierres_total === 1 ? '' : 's'}
          </p>
        )}
      </section>
    );
  }

  // Max para escalar barras
  const maxCAC = Math.max(...entries.map((e) => e.cac_mxn));
  const fmtMXN0 = new Intl.NumberFormat('es-MX', {
    style: 'currency',
    currency: 'MXN',
    maximumFractionDigits: 0,
  });

  // CAC promedio del periodo mostrado (los meses con pagos)
  const totalSpend = entries.reduce((s, e) => s + e.spend_mxn, 0);
  const totalPagos = entries.reduce((s, e) => s + e.primeros_pagos, 0);
  const cacPromedioPeriodo = totalPagos > 0 ? totalSpend / totalPagos : null;

  return (
    <section
      className="mb-6 rounded-xl border p-5 md:p-6"
      style={{ background: 'var(--card-bg)', borderColor: 'var(--accent-yellow)' }}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-3 mb-4">
        <div>
          <div className="text-sm uppercase tracking-widest" style={{ color: 'var(--text-dim)' }}>
            CAC mensual — tendencia
          </div>
          <p className="text-base" style={{ color: 'var(--text-dim)' }}>
            Spend Meta del mes ÷ leads con primer pago en ese mes. Solo meses con ≥1 pago.
          </p>
        </div>
        {cacPromedioPeriodo !== null && (
          <div
            className="text-[22px] tracking-tight tabular-nums"
            style={{ fontFamily: 'var(--font-cormorant)', fontWeight: 500, color: 'var(--accent-yellow)' }}
          >
            Promedio: {fmtMXN0.format(cacPromedioPeriodo)} / cliente
          </div>
        )}
      </div>

      {/* Barras horizontales: una fila por mes */}
      <div className="space-y-2">
        {entries.map((e) => {
          const widthPct = maxCAC > 0 ? (e.cac_mxn / maxCAC) * 100 : 0;
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
                  title={`${fmtMesCorto(e.mes)}: ${fmtMXN0.format(e.cac_mxn)} (${e.primeros_pagos} cliente${e.primeros_pagos === 1 ? '' : 's'})`}
                />
              </div>
              <div className="w-32 shrink-0 text-right tabular-nums" style={{ color: 'var(--text)' }}>
                {fmtMXN0.format(e.cac_mxn)}
              </div>
              <div className="w-20 shrink-0 text-right text-sm tabular-nums" style={{ color: 'var(--text-pending)' }}>
                {e.primeros_pagos} {e.primeros_pagos === 1 ? 'cliente' : 'clientes'}
              </div>
            </div>
          );
        })}
      </div>

      {/* Acumulado histórico — referencia secundaria */}
      {cacGlobal && cacGlobal.cac_mxn !== null && (
        <p className="text-sm mt-4" style={{ color: 'var(--text-dim)' }}>
          CAC acumulado histórico (referencia, basado en <em>cierres</em> firmados —
          no en primeros pagos):{' '}
          <strong style={{ color: 'var(--text)' }}>
            {fmtMXN0.format(cacGlobal.cac_mxn)}
          </strong>{' '}
          · {cacGlobal.cierres_total} cierre{cacGlobal.cierres_total === 1 ? '' : 's'}
        </p>
      )}
    </section>
  );
}
