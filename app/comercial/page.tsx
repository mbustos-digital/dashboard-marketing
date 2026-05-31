// =============================================================================
// Tab Comercial — tablas de cohortes semanales y mensuales
// =============================================================================
// Lee v_cohortes_semanales (últimas 8) y v_cohortes_mensuales (últimos 6).
// Muestra tasa de cierre (cierres / limpias) con honestidad por madurez:
//   - madura ≥14d:   tasa completa, color verde
//   - madurando 5-13: tasa marcada "parcial" en gris
//   - reciente <5:    "—" no es honesto mostrar todavía
// =============================================================================

import {
  listCohortesSemanales,
  listCohortesMensuales,
  type CohorteSemana,
  type CohorteMes,
  type EstadoMadurezCohorte,
} from '@/lib/queries';
import { ayerEnTijuana } from '@/lib/date-utils';
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
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(n);
}

function fmtSemana(yyyy_mm_dd: string): string {
  const [y, m, d] = yyyy_mm_dd.split('-').map(Number);
  const fecha = new Date(Date.UTC(y, m - 1, d));
  return new Intl.DateTimeFormat('es-MX', {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  }).format(fecha);
}

function fmtMes(yyyy_mm_dd: string): string {
  const [y, m, d] = yyyy_mm_dd.split('-').map(Number);
  const fecha = new Date(Date.UTC(y, m - 1, d));
  return new Intl.DateTimeFormat('es-MX', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(fecha);
}

function tasaCierre(cierres: number, limpias: number): number | null {
  if (limpias === 0) return null;
  return (cierres / limpias) * 100;
}

function emojiMadurez(e: EstadoMadurezCohorte): string {
  return e === 'madura' ? '🟢' : e === 'madurando' ? '🟡' : '⚪';
}

// ─────────────────────────────────────────────────────────────────────────────
// Page
// ─────────────────────────────────────────────────────────────────────────────

export default async function ComercialPage() {
  const fechaAyer = ayerEnTijuana();

  let semanales: CohorteSemana[] = [];
  let mensuales: CohorteMes[] = [];
  let errorMsg: string | null = null;

  try {
    [semanales, mensuales] = await Promise.all([
      listCohortesSemanales(8),
      listCohortesMensuales(6),
    ]);
  } catch (err) {
    errorMsg = err instanceof Error ? err.message : String(err);
  }

  return (
    <main className="min-h-screen w-full px-6 py-8 md:px-12 md:py-12 bg-[var(--bg)] text-[var(--text)]">
      <DashboardHeader fechaAyer={fechaAyer} />
      <DashboardTabs active="comercial" />

      {errorMsg ? (
        <ErrorCard message={errorMsg} />
      ) : semanales.length === 0 && mensuales.length === 0 ? (
        <EmptyState />
      ) : (
        <div className="space-y-8">
          <CohortesTable
            title="Cohortes semanales"
            subtitle="Últimas 8 semanas, agrupadas por la semana de Junta 1"
            cohortes={semanales}
            fechaColLabel="Semana de"
            fechaFormat={fmtSemana}
            showCiclo={false}
          />

          <CohortesTable
            title="Cohortes mensuales"
            subtitle="Últimos 6 meses, agrupados por el mes de Junta 1"
            cohortes={mensuales}
            fechaColLabel="Mes"
            fechaFormat={fmtMes}
            showCiclo={true}
          />

          <p className="text-sm" style={{ color: 'var(--text-pending)' }}>
            🟢 Madura (≥14d desde último J1, tasa confiable) · 🟡 Madurando
            (5-13d, % parcial) · ⚪ Reciente (&lt;5d, no juzgar todavía). El
            <strong style={{ color: 'var(--accent-green)' }}> ratio joya </strong>
            es Cierres ÷ Reuniones Limpias — mide tu capacidad de cierre puro.
          </p>
        </div>
      )}
    </main>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Tabla de cohortes
// ─────────────────────────────────────────────────────────────────────────────

function CohortesTable({
  title,
  subtitle,
  cohortes,
  fechaColLabel,
  fechaFormat,
  showCiclo,
}: {
  title: string;
  subtitle: string;
  cohortes: Array<CohorteSemana | (CohorteMes & { dias_promedio_ciclo: number | null })>;
  fechaColLabel: string;
  fechaFormat: (s: string) => string;
  showCiclo: boolean;
}) {
  return (
    <section
      className="rounded-xl border overflow-hidden"
      style={{ background: 'var(--card-bg)', borderColor: 'var(--card-border)' }}
    >
      <header className="px-6 py-5 border-b" style={{ borderColor: 'var(--card-border)' }}>
        <h2
          className="text-[28px]"
          style={{ fontFamily: 'var(--font-cormorant)', fontWeight: 500 }}
        >
          {title}
        </h2>
        <p className="text-base mt-1" style={{ color: 'var(--text-dim)' }}>
          {subtitle}
        </p>
      </header>

      {cohortes.length === 0 ? (
        <div className="p-8 text-center text-base" style={{ color: 'var(--text-dim)' }}>
          Sin cohortes todavía. Cuando tengas leads con fecha de J1, aparecerán aquí.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-base">
            <thead>
              <tr
                className="text-sm uppercase tracking-wider text-left"
                style={{ background: '#0f0f0f', color: 'var(--text-dim)' }}
              >
                <th className="px-4 py-3">{fechaColLabel}</th>
                <th className="px-3 py-3 text-right">J1 total</th>
                <th className="px-3 py-3 text-right">Asistió</th>
                <th className="px-3 py-3 text-right">Limpias</th>
                <th className="px-3 py-3 text-right">Cierres</th>
                <th className="px-3 py-3 text-right">Tasa cierre</th>
                {showCiclo && <th className="px-3 py-3 text-right">Ciclo (d)</th>}
                <th className="px-3 py-3 text-right">Ventas</th>
                <th className="px-4 py-3">Estado</th>
              </tr>
            </thead>
            <tbody>
              {cohortes.map((c) => {
                const fechaInicio = 'semana_inicio' in c ? c.semana_inicio : c.mes_inicio;
                const tasa = tasaCierre(c.cierres, c.limpias);
                const tasaDisplay = renderTasa(tasa, c.estado_madurez);
                const cohorteMes = c as CohorteMes;
                return (
                  <tr
                    key={fechaInicio}
                    className="border-t"
                    style={{ borderColor: 'var(--card-border)' }}
                  >
                    <td className="px-4 py-3 font-medium">{fechaFormat(fechaInicio)}</td>
                    <td className="px-3 py-3 text-right tabular-nums">{fmtNumber(c.total_j1)}</td>
                    <td className="px-3 py-3 text-right tabular-nums">
                      {fmtNumber(c.asistencias)}
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums">{fmtNumber(c.limpias)}</td>
                    <td className="px-3 py-3 text-right tabular-nums">{fmtNumber(c.cierres)}</td>
                    <td className="px-3 py-3 text-right tabular-nums">{tasaDisplay}</td>
                    {showCiclo && (
                      <td
                        className="px-3 py-3 text-right tabular-nums"
                        style={{ color: 'var(--text-dim)' }}
                      >
                        {cohorteMes.dias_promedio_ciclo !== null &&
                        cohorteMes.dias_promedio_ciclo !== undefined
                          ? Number(cohorteMes.dias_promedio_ciclo).toFixed(1)
                          : '—'}
                      </td>
                    )}
                    <td className="px-3 py-3 text-right tabular-nums">
                      {c.cierres > 0 ? (
                        <span style={{ color: 'var(--accent-green)' }}>
                          {fmtCurrency(c.ingreso_total_usd)}
                        </span>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span className="inline-flex items-center gap-2 text-sm">
                        <span>{emojiMadurez(c.estado_madurez)}</span>
                        <span style={{ color: 'var(--text-dim)' }}>{c.estado_madurez}</span>
                      </span>
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

function renderTasa(tasa: number | null, estado: EstadoMadurezCohorte): React.ReactNode {
  if (tasa === null) return <span style={{ color: 'var(--text-pending)' }}>—</span>;
  if (estado === 'reciente') {
    return <span style={{ color: 'var(--text-pending)' }}>—</span>;
  }
  const tasaStr = `${tasa.toFixed(0)}%`;
  if (estado === 'madurando') {
    return (
      <span style={{ color: 'var(--text-dim)' }}>
        {tasaStr} <span className="text-sm">(parcial)</span>
      </span>
    );
  }
  // madura
  return <span style={{ color: 'var(--accent-green)' }}>{tasaStr}</span>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Empty + Error
// ─────────────────────────────────────────────────────────────────────────────

function EmptyState() {
  return (
    <div
      className="rounded-xl border p-12 text-center"
      style={{ background: 'var(--card-bg)', borderColor: 'var(--card-border)' }}
    >
      <p className="text-lg mb-4" style={{ color: 'var(--text-dim)' }}>
        Aún no hay leads con fecha de Junta 1.
      </p>
      <p className="text-base" style={{ color: 'var(--text-pending)' }}>
        Cuando alguien agende vía Calendly (webhook automático) o crees uno manual en /leads,
        y le pongas fecha de J1, aparecerá agrupado en cohortes aquí.
      </p>
    </div>
  );
}

function ErrorCard({ message }: { message: string }) {
  return (
    <div
      className="rounded-lg p-6 border"
      style={{ borderColor: 'var(--accent-orange)', background: '#2a1410' }}
    >
      <p className="font-semibold mb-1" style={{ color: 'var(--accent-orange)' }}>
        Error consultando Supabase
      </p>
      <p className="text-base font-mono" style={{ color: 'var(--text-dim)' }}>
        {message}
      </p>
    </div>
  );
}
