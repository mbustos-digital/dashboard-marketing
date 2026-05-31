// =============================================================================
// Tab Vista General — KPIs Marketing + Comercial + diagnóstico cruzado
// =============================================================================
// 4 KPIs Marketing (mes actual) + 4 KPIs Comercial (cohortes maduras) +
// mensaje de diagnóstico que ubica el cuello del funnel.
// =============================================================================

import {
  getMarketingWindow,
  getResumenComercialMaduras,
  type MarketingWindow,
  type ResumenComercialMaduras,
} from '@/lib/queries';
import {
  ayerEnTijuana,
  primerDiaDelMesEnTijuana,
} from '@/lib/date-utils';
import { DashboardHeader } from '../_components/DashboardHeader';
import { DashboardTabs } from '../_components/DashboardTabs';

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
    maximumFractionDigits: 0,
  }).format(n);
}

function fmtPercent(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  return `${n.toFixed(0)}%`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Diagnóstico cruzado — define dónde está el cuello del funnel
// ─────────────────────────────────────────────────────────────────────────────

type DiagnosticoCuello = {
  mensaje: string;
  color: string;
  emoji: string;
};

function diagnosticarCuello(
  mes: MarketingWindow,
  maduras: ResumenComercialMaduras,
): DiagnosticoCuello {
  const tasa = maduras.tasa_cierre_madura;

  // Sin data de cohortes maduras aún
  if (tasa === null) {
    return {
      mensaje:
        'Aún no hay cohortes maduras (≥14d post-J1) para juzgar el sistema de venta. Sigue capturando leads y vuelve cuando tengas al menos una cohorte madura.',
      color: 'var(--text-dim)',
      emoji: '⚪',
    };
  }

  // Identificar peor ratio del funnel marketing (mes)
  const ratios: Array<{ label: string; valor: number }> = [];
  if (mes.ratio_imp_landing !== null) {
    ratios.push({ label: 'Impresiones → Landing', valor: mes.ratio_imp_landing });
  }
  if (mes.ratio_landing_vsl !== null) {
    ratios.push({ label: 'Landing → VSL', valor: mes.ratio_landing_vsl });
  }
  const peorRatio =
    ratios.length > 0
      ? ratios.reduce((max, r) => (r.valor > max.valor ? r : max))
      : null;

  // Lógica del brief original
  if (tasa >= 30) {
    return {
      mensaje:
        `Tu sistema de venta está SALUDABLE (${tasa.toFixed(0)}% de cierre sobre limpias en cohortes maduras). ` +
        (peorRatio
          ? `El cuello está en MARKETING — específicamente en el ratio "${peorRatio.label}" (1 de cada ${Math.round(peorRatio.valor)}). ` +
            `Si subes ese ratio, escalas cierres sin tocar tu cierre. Foco: traer más leads o mejor calidad de lead.`
          : 'Cuando tengas más data de marketing del mes, te marco el peor ratio para enfocar ahí.'),
      color: 'var(--accent-green)',
      emoji: '🟢',
    };
  }

  if (tasa < 20) {
    return {
      mensaje:
        `Tu sistema de venta tiene PROBLEMA (${tasa.toFixed(0)}% de cierre — bajo umbral 20%). ` +
        `Hay leads pero no cierras. El cuello está en VENTAS — revisa: calidad del lead que pasa a calificado, ` +
        `proceso comercial, propuesta, follow-up post-J1.`,
      color: 'var(--accent-orange)',
      emoji: '🔴',
    };
  }

  // Zona intermedia 20-30%
  return {
    mensaje:
      `Cuello MIXTO (${tasa.toFixed(0)}% de cierre, zona intermedia). ` +
      (peorRatio
        ? `Atiende el peor ratio del momento ("${peorRatio.label}" = 1 de cada ${Math.round(peorRatio.valor)}) ` +
          `y al mismo tiempo afina tu proceso comercial post-J1. Ambos lados tienen margen.`
        : 'Optimiza marketing y proceso comercial en paralelo.'),
    color: 'var(--accent-yellow)',
    emoji: '🟡',
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Page
// ─────────────────────────────────────────────────────────────────────────────

export default async function GeneralPage() {
  const fechaAyer = ayerEnTijuana();
  const mesInicio = primerDiaDelMesEnTijuana();

  let mes: MarketingWindow | null = null;
  let maduras: ResumenComercialMaduras | null = null;
  let errorMsg: string | null = null;

  try {
    [mes, maduras] = await Promise.all([
      getMarketingWindow(mesInicio, fechaAyer),
      getResumenComercialMaduras(),
    ]);
  } catch (err) {
    errorMsg = err instanceof Error ? err.message : String(err);
  }

  return (
    <main className="min-h-screen w-full px-6 py-8 md:px-12 md:py-12 bg-[var(--bg)] text-[var(--text)]">
      <DashboardHeader fechaAyer={fechaAyer} />
      <DashboardTabs active="general" />

      {errorMsg || !mes || !maduras ? (
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
          {/* DIAGNÓSTICO CRUZADO */}
          <DiagnosticoCard data={diagnosticarCuello(mes, maduras)} />

          {/* KPIs Marketing del mes */}
          <Section
            title="Marketing — mes actual"
            subtitle="Datos automáticos de Meta + YouTube"
          >
            <Grid>
              <KPI
                label="Impresiones"
                value={fmtNumber(mes.impressions)}
                accent="yellow"
              />
              <KPI
                label="Visitas Landing"
                value={fmtNumber(mes.landing_page_views)}
                accent="yellow"
              />
              <KPI
                label="Vistas VSL"
                value={fmtNumber(mes.vsl_views)}
                accent="yellow"
                hint={mes.vsl_views === null ? 'Aún sin baseline' : undefined}
              />
              <KPI
                label="Inversión total"
                value={fmtCurrency(mes.spend_usd)}
                accent="yellow"
              />
            </Grid>
          </Section>

          {/* KPIs Comercial - cohortes maduras */}
          <Section
            title="Comercial — cohortes maduras"
            subtitle={
              maduras.cohortes_maduras_count === 0
                ? 'Aún sin cohortes maduras. Datos llegan ≥14 días después de J1.'
                : `Acumulado de ${maduras.cohortes_maduras_count} cohorte${maduras.cohortes_maduras_count === 1 ? '' : 's'} mensual${maduras.cohortes_maduras_count === 1 ? '' : 'es'} con J1 hace ≥14d`
            }
          >
            <Grid>
              <KPI
                label="Limpias acumuladas"
                value={fmtNumber(maduras.limpias)}
                accent="default"
              />
              <KPI
                label="Cierres"
                value={fmtNumber(maduras.cierres)}
                accent="green"
              />
              <KPI
                label="Tasa cierre (ratio joya)"
                value={fmtPercent(maduras.tasa_cierre_madura)}
                accent="green"
                hint="Cierres ÷ Limpias"
              />
              <KPI
                label="Ingreso acumulado"
                value={fmtCurrency(maduras.ingreso_total_usd)}
                accent="green"
              />
            </Grid>
            {maduras.dias_promedio_ciclo !== null && (
              <p className="mt-4 text-base" style={{ color: 'var(--text-dim)' }}>
                Ciclo promedio J1 → cierre:{' '}
                <strong style={{ color: 'var(--text)' }}>
                  {maduras.dias_promedio_ciclo.toFixed(1)} días
                </strong>
              </p>
            )}
          </Section>
        </div>
      )}
    </main>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Diagnóstico card — el mensaje grande arriba
// ─────────────────────────────────────────────────────────────────────────────

function DiagnosticoCard({ data }: { data: DiagnosticoCuello }) {
  return (
    <section
      className="rounded-xl border p-6 md:p-8"
      style={{
        background: 'var(--card-bg)',
        borderColor: data.color,
        borderWidth: 2,
      }}
    >
      <div className="flex items-start gap-4">
        <span className="text-4xl shrink-0 leading-none">{data.emoji}</span>
        <div className="flex-1">
          <h2
            className="text-[24px] mb-2"
            style={{ fontFamily: 'var(--font-cormorant)', fontWeight: 500, color: data.color }}
          >
            Diagnóstico
          </h2>
          <p className="text-lg leading-relaxed">{data.mensaje}</p>
        </div>
      </div>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Building blocks — Section, Grid, KPI
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
  accent: 'yellow' | 'green' | 'default';
  hint?: string;
}) {
  const color =
    accent === 'yellow'
      ? 'var(--accent-yellow)'
      : accent === 'green'
      ? 'var(--accent-green)'
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
