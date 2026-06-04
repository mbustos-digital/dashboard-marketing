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
  getSCL,
  type CohorteSemana,
  type CohorteMes,
  type EstadoMadurezCohorte,
  type SCL,
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
  let scl: SCL | null = null;
  let errorMsg: string | null = null;

  try {
    [semanales, mensuales, scl] = await Promise.all([
      listCohortesSemanales(8),
      listCohortesMensuales(6),
      getSCL(),
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
          {/* SCL — Sales Cycle Length */}
          <SCLCard scl={scl} />

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

          <p className="text-base" style={{ color: 'var(--text-pending)' }}>
            🟢 Madura (≥14d desde último J1, tasa confiable) · 🟡 Madurando
            (5-13d, % parcial) · ⚪ Reciente (&lt;5d, no juzgar todavía). El
            <strong style={{ color: 'var(--accent-green)' }}> ratio joya </strong>
            es Cierres ÷ Reuniones Limpias — mide tu capacidad de cierre puro.
            {' '}<strong style={{ color: 'var(--accent-orange)' }}>No-show &gt; 35%</strong>{' '}
            (rojo) sugiere problema de calificación previa o recordatorios.
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
      <header className="px-7 py-6 border-b" style={{ borderColor: 'var(--card-border)' }}>
        <h2
          className="text-[36px]"
          style={{ fontFamily: 'var(--font-cormorant)', fontWeight: 500 }}
        >
          {title}
        </h2>
        <p className="text-lg mt-1" style={{ color: 'var(--text-dim)' }}>
          {subtitle}
        </p>
      </header>

      {cohortes.length === 0 ? (
        <div className="p-10 text-center text-lg" style={{ color: 'var(--text-dim)' }}>
          Sin cohortes todavía. Cuando tengas leads con fecha de J1, aparecerán aquí.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-lg">
            <thead>
              <tr
                className="text-base uppercase tracking-wider text-left"
                style={{ background: '#0f0f0f', color: 'var(--text-dim)' }}
              >
                <th className="px-5 py-4">{fechaColLabel}</th>
                <th className="px-4 py-4 text-right">J1 total</th>
                <th className="px-4 py-4 text-right">Asistió</th>
                <th className="px-4 py-4 text-right">No-show</th>
                <th className="px-4 py-4 text-right">
                  <TermWithTooltip
                    term="Limpias"
                    explain="Reuniones donde el lead asistió a J1 y fue calificado (asistio_j1 = Sí Y calificado = Sí). Es la base honesta para juzgar tu capacidad de cierre."
                  />
                </th>
                <th className="px-4 py-4 text-right">Cierres</th>
                <th className="px-4 py-4 text-right">
                  <TermWithTooltip
                    term="Tasa cierre"
                    explain="Ratio joya: Cierres ÷ Limpias. Mide tu capacidad de cierre puro, independiente del volumen de leads. Mientras más alto, mejor calificás Y mejor cerrás."
                  />
                </th>
                {showCiclo && <th className="px-4 py-4 text-right">Ciclo (d)</th>}
                <th className="px-4 py-4 text-right">Ventas</th>
                <th className="px-5 py-4">Estado</th>
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
                    <td className="px-5 py-4 font-medium">{fechaFormat(fechaInicio)}</td>
                    <td className="px-4 py-4 text-right tabular-nums">{fmtNumber(c.total_j1)}</td>
                    <td className="px-4 py-4 text-right tabular-nums">
                      {fmtNumber(c.asistencias)}
                    </td>
                    <td className="px-4 py-4 text-right tabular-nums">
                      {renderNoShow(c.total_j1, c.asistencias)}
                    </td>
                    <td className="px-4 py-4 text-right tabular-nums">{fmtNumber(c.limpias)}</td>
                    <td className="px-4 py-4 text-right tabular-nums">{fmtNumber(c.cierres)}</td>
                    <td className="px-4 py-4 text-right tabular-nums">{tasaDisplay}</td>
                    {showCiclo && (
                      <td
                        className="px-4 py-4 text-right tabular-nums"
                        style={{ color: 'var(--text-dim)' }}
                      >
                        {cohorteMes.dias_promedio_ciclo !== null &&
                        cohorteMes.dias_promedio_ciclo !== undefined
                          ? Number(cohorteMes.dias_promedio_ciclo).toFixed(1)
                          : '—'}
                      </td>
                    )}
                    <td className="px-4 py-4 text-right tabular-nums">
                      {c.cierres > 0 ? (
                        <span style={{ color: 'var(--accent-green)' }}>
                          {fmtCurrency(c.ingreso_total_usd)}
                        </span>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="px-5 py-4">
                      <span className="inline-flex items-center gap-2 text-base">
                        <span className="text-lg">{emojiMadurez(c.estado_madurez)}</span>
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

// Tooltip inline con ícono — patrón puro CSS (hover + focus + tap-friendly).
// El span externo es focusable para que en mobile (sin hover) un tap muestre
// el tooltip. Sin librerías.
function TermWithTooltip({ term, explain }: { term: string; explain: string }) {
  return (
    <span className="relative inline-flex items-center gap-1 group">
      <span>{term}</span>
      <button
        type="button"
        aria-label={`Explicar ${term}`}
        className="inline-flex items-center justify-center w-4 h-4 rounded-full border text-xs leading-none focus:outline-none focus:ring-1"
        style={{
          borderColor: 'var(--text-pending)',
          color: 'var(--text-pending)',
          background: 'transparent',
        }}
      >
        ?
      </button>
      <span
        role="tooltip"
        className="absolute z-20 left-1/2 -translate-x-1/2 top-full mt-2 w-64 px-3 py-2 rounded-md text-sm normal-case tracking-normal text-left opacity-0 invisible group-hover:opacity-100 group-hover:visible group-focus-within:opacity-100 group-focus-within:visible transition-opacity shadow-lg"
        style={{
          background: '#0a0a0a',
          color: 'var(--text)',
          border: '1px solid var(--card-border)',
          fontWeight: 400,
        }}
      >
        {explain}
      </span>
    </span>
  );
}

// Render del No-show: % con color condicional. >35% → naranja. Sin J1 → —.
function renderNoShow(total_j1: number, asistencias: number): React.ReactNode {
  if (total_j1 === 0) {
    return <span style={{ color: 'var(--text-pending)' }}>—</span>;
  }
  const noShow = ((total_j1 - asistencias) / total_j1) * 100;
  const color = noShow > 35 ? 'var(--accent-orange)' : 'var(--text-dim)';
  return <span style={{ color }}>{noShow.toFixed(0)}%</span>;
}

// Card SCL — promedio + P90 de días entre fecha_agenda y fecha_primer_pago
function SCLCard({ scl }: { scl: SCL | null }) {
  const titulo = 'SCL — Sales Cycle Length';
  const tagline = 'Días entre agendamiento de J1 y primer pago real.';

  // Sin datos suficientes
  if (!scl || scl.count < 3) {
    return (
      <section
        className="rounded-xl border p-6 md:p-8"
        style={{ background: 'var(--card-bg)', borderColor: 'var(--card-border)' }}
      >
        <h2
          className="text-[28px]"
          style={{ fontFamily: 'var(--font-cormorant)', fontWeight: 500 }}
        >
          {titulo}
        </h2>
        <p className="text-base mt-1" style={{ color: 'var(--text-dim)' }}>{tagline}</p>
        <p className="mt-4 text-lg" style={{ color: 'var(--text-pending)' }}>
          SCL: — (pocos datos: {scl?.count ?? 0} de 3 mínimos).
          Captura <code>fecha_primer_pago</code> en al menos 3 leads para activar la métrica.
        </p>
      </section>
    );
  }

  return (
    <section
      className="rounded-xl border p-6 md:p-8"
      style={{ background: 'var(--card-bg)', borderColor: 'var(--card-border)' }}
    >
      <h2
        className="text-[28px]"
        style={{ fontFamily: 'var(--font-cormorant)', fontWeight: 500 }}
      >
        {titulo}
      </h2>
      <p className="text-base mt-1 mb-4" style={{ color: 'var(--text-dim)' }}>
        {tagline} Calculado sobre {scl.count} lead{scl.count === 1 ? '' : 's'} con ambas fechas.
      </p>
      <div className="flex flex-wrap items-baseline gap-8">
        <div>
          <div className="text-sm uppercase tracking-wider" style={{ color: 'var(--text-dim)' }}>
            Promedio
          </div>
          <div
            className="text-[44px] leading-none tracking-tight tabular-nums"
            style={{ fontFamily: 'var(--font-cormorant)', fontWeight: 500, color: 'var(--accent-green)' }}
          >
            {scl.avg_dias!.toFixed(1)}
            <span className="text-xl ml-2" style={{ color: 'var(--text-dim)' }}>días</span>
          </div>
        </div>
        <div>
          <div className="text-sm uppercase tracking-wider" style={{ color: 'var(--text-dim)' }}>
            P90 (el 10% más lento)
          </div>
          <div
            className="text-[44px] leading-none tracking-tight tabular-nums"
            style={{ fontFamily: 'var(--font-cormorant)', fontWeight: 500, color: 'var(--accent-yellow)' }}
          >
            {scl.p90_dias}
            <span className="text-xl ml-2" style={{ color: 'var(--text-dim)' }}>días</span>
          </div>
        </div>
      </div>
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
        {tasaStr} <span className="text-base">(parcial)</span>
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
      className="rounded-xl border p-14 text-center"
      style={{ background: 'var(--card-bg)', borderColor: 'var(--card-border)' }}
    >
      <p className="text-xl mb-4" style={{ color: 'var(--text-dim)' }}>
        Aún no hay leads con fecha de Junta 1.
      </p>
      <p className="text-lg" style={{ color: 'var(--text-pending)' }}>
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
      <p className="text-lg font-semibold mb-1" style={{ color: 'var(--accent-orange)' }}>
        Error consultando Supabase
      </p>
      <p className="text-base font-mono" style={{ color: 'var(--text-dim)' }}>
        {message}
      </p>
    </div>
  );
}
