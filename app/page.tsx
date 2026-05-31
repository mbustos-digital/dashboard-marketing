// =============================================================================
// Dashboard Marketing — Tab Marketing (MVP)
// =============================================================================
// 3 ventanas: Día anterior · Semana en curso · Mes acumulado.
// Datos de marketing_metrics_daily (Meta Ads). Etapas pendientes de Fase 3/4
// se muestran en gris con etiqueta "pendiente".
// =============================================================================

import Link from 'next/link';
import { getMarketingWindow, type MarketingWindow } from '@/lib/queries';
import {
  ayerEnTijuana,
  lunesActualEnTijuana,
  primerDiaDelMesEnTijuana,
} from '@/lib/date-utils';

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

export default async function Page() {
  const ayer = ayerEnTijuana();
  const lunes = lunesActualEnTijuana();
  const mesInicio = primerDiaDelMesEnTijuana();

  let dia: MarketingWindow | null = null;
  let semana: MarketingWindow | null = null;
  let mes: MarketingWindow | null = null;
  let errorMsg: string | null = null;

  try {
    [dia, semana, mes] = await Promise.all([
      getMarketingWindow(ayer, ayer),
      getMarketingWindow(lunes, ayer),
      getMarketingWindow(mesInicio, ayer),
    ]);
  } catch (err) {
    errorMsg = err instanceof Error ? err.message : String(err);
  }

  return (
    <main className="min-h-screen w-full px-6 py-8 md:px-12 md:py-12 bg-[var(--bg)] text-[var(--text)]">
      {/* HEADER */}
      <header className="mb-10 flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1
            className="text-[46px] md:text-[62px] tracking-tight leading-tight"
            style={{ fontFamily: 'var(--font-cormorant)', fontWeight: 500 }}
          >
            Dashboard Marketing
          </h1>
          <p className="mt-1 text-lg" style={{ color: 'var(--text-dim)' }}>
            Mauricio Bustos · Datos actualizados a {fmtFechaCorta(ayer)}
          </p>
        </div>
        <Link
          href="/leads"
          className="px-5 py-3 rounded-lg font-medium text-lg border"
          style={{
            background: 'transparent',
            borderColor: 'var(--accent-yellow)',
            color: 'var(--accent-yellow)',
          }}
        >
          Leads →
        </Link>
      </header>

      {/* TABS */}
      <nav className="flex items-center gap-1 mb-8 border-b" style={{ borderColor: 'var(--card-border)' }}>
        <TabActive label="Marketing" />
        <TabDisabled label="Comercial" badge="Fase 4" />
        <TabDisabled label="Vista General" badge="Fase 5" />
      </nav>

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
          />
          <VentanaCard
            title="Mes acumulado"
            subtitle={`${fmtFechaCorta(mesInicio)} → ${fmtFechaCorta(ayer)}`}
            data={mes}
          />
        </section>
      )}

      {/* FOOTER */}
      <footer className="mt-12 pt-6 border-t" style={{ borderColor: 'var(--card-border)' }}>
        <p className="text-base" style={{ color: 'var(--text-pending)' }}>
          Estado: Fase 2 en producción. Cron Meta corriendo diario a las 6:00 AM Tijuana.
          Pendientes: YouTube (Fase 3), captura manual de leads (Fase 4), pestaña Comercial y Vista General (Fase 5).
        </p>
      </footer>
    </main>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Tab components
// ─────────────────────────────────────────────────────────────────────────────

function TabActive({ label }: { label: string }) {
  return (
    <div
      className="px-4 py-3 -mb-px border-b-2 text-lg font-medium"
      style={{ borderColor: 'var(--accent-yellow)', color: 'var(--accent-yellow)' }}
    >
      {label}
    </div>
  );
}

function TabDisabled({ label, badge }: { label: string; badge: string }) {
  return (
    <div
      className="px-4 py-3 text-lg flex items-center gap-2"
      style={{ color: 'var(--text-pending)' }}
    >
      <span>{label}</span>
      <span
        className="px-2 py-0.5 text-sm rounded-full"
        style={{ background: 'var(--card-bg)', color: 'var(--text-dim)' }}
      >
        {badge}
      </span>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Ventana card
// ─────────────────────────────────────────────────────────────────────────────

function VentanaCard({
  title,
  subtitle,
  data,
}: {
  title: string;
  subtitle: string;
  data: MarketingWindow | null;
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
            <StageRow num="4" label="Agendamientos" value="—" pending="Fase 4" />
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
              <div className="flex items-baseline justify-between gap-3 py-1 pl-6">
                <span className="text-base truncate" style={{ color: 'var(--text-dim)' }}>
                  ↳ Prep video (40 seg, alcance)
                </span>
                <div className="flex items-center gap-2 shrink-0">
                  {data.thanks_prep_days_baseline_only > 0 && (
                    <span
                      className="text-sm px-1.5 py-0.5 rounded"
                      style={{ background: '#1a1a1a', color: 'var(--text-dim)' }}
                    >
                      {data.thanks_prep_days_baseline_only}d baseline
                    </span>
                  )}
                  <span className="text-base font-medium tabular-nums" style={{ color: 'var(--text-dim)' }}>
                    {fmtNumber(data.thanks_prep_views)}
                  </span>
                </div>
              </div>
            )}
          </Section>

          {/* RATIOS */}
          <Section title="Ratios (1 de cada X)">
            {(() => {
              // Identificar el peor ratio (mayor X) entre los calculables
              const calculables: Array<{ label: string; value: number }> = [];
              if (data.ratio_imp_landing !== null) calculables.push({ label: 'imp_landing', value: data.ratio_imp_landing });
              if (data.ratio_landing_vsl !== null) calculables.push({ label: 'landing_vsl', value: data.ratio_landing_vsl });
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
                    <RatioRow label="Landing → VSL" value="—" pending={data.vsl_views === null ? 'Fase 3' : 'sin datos'} />
                  )}
                  <RatioRow label="VSL → Agendamiento" value="—" pending="Fase 3+4" />
                  <RatioRow label="Agendamiento → Thanks" value="—" pending="Fase 3+4" />
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
