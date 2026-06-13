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
  getResumenComercialMaduras,
  getTramosSCL,
  type CohorteSemana,
  type CohorteMes,
  type EstadoMadurezCohorte,
  type SCL,
  type ResumenComercialMaduras,
  type TramosSCL,
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
  let maduras: ResumenComercialMaduras | null = null;
  let tramos: TramosSCL | null = null;
  let errorMsg: string | null = null;

  try {
    [semanales, mensuales, scl, maduras, tramos] = await Promise.all([
      listCohortesSemanales(8),
      listCohortesMensuales(6),
      getSCL(),
      getResumenComercialMaduras(),
      getTramosSCL(),
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
          {/* KPIs ESTRELLA (8C) */}
          {maduras && <KPIsComercial maduras={maduras} scl={scl} />}

          {/* SCL — línea de tiempo de tramos (8C) */}
          <SCLTimeline scl={scl} tramos={tramos} />

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
              {(() => {
                // 8C: maduras nítidas arriba, el resto atenuado abajo con separador
                const maduras = cohortes.filter((c) => c.estado_madurez === 'madura');
                const inmaduras = cohortes.filter((c) => c.estado_madurez !== 'madura');
                const ordenadas = [...maduras, ...inmaduras];
                const idxSeparador = maduras.length; // antes de la primera inmadura
                return ordenadas.map((c, idx) => (
                  <CohorteRowGroup
                    key={'semana_inicio' in c ? c.semana_inicio : c.mes_inicio}
                    c={c}
                    fechaFormat={fechaFormat}
                    showCiclo={showCiclo}
                    atenuada={c.estado_madurez !== 'madura'}
                    conSeparadorMaduras={idx === 0 && maduras.length > 0}
                    conSeparadorInmaduras={idx === idxSeparador && inmaduras.length > 0}
                  />
                ));
              })()}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

// Fila de cohorte + separadores de grupo (8C)
function CohorteRowGroup({
  c,
  fechaFormat,
  showCiclo,
  atenuada,
  conSeparadorMaduras,
  conSeparadorInmaduras,
}: {
  c: CohorteSemana | (CohorteMes & { dias_promedio_ciclo: number | null });
  fechaFormat: (s: string) => string;
  showCiclo: boolean;
  atenuada: boolean;
  conSeparadorMaduras: boolean;
  conSeparadorInmaduras: boolean;
}) {
  const fechaInicio = 'semana_inicio' in c ? c.semana_inicio : c.mes_inicio;
  const tasa = tasaCierre(c.cierres, c.limpias);
  const tasaDisplay = renderTasa(tasa, c.estado_madurez);
  const cohorteMes = c as CohorteMes;
  const nCols = showCiclo ? 9 : 8;
  return (
    <>
      {conSeparadorMaduras && (
        <tr>
          <td
            colSpan={nCols}
            className="px-5 py-2 text-sm uppercase tracking-wider"
            style={{ background: '#0f1f17', color: 'var(--accent-green)' }}
          >
            Maduras · tasa confiable
          </td>
        </tr>
      )}
      {conSeparadorInmaduras && (
        <tr>
          <td
            colSpan={nCols}
            className="px-5 py-2 text-sm uppercase tracking-wider"
            style={{ background: '#0f0f0f', color: 'var(--text-pending)' }}
          >
            Aún madurando · tasa parcial — estas tasas pueden cambiar, no cuentan para el ratio joya
          </td>
        </tr>
      )}
      <RowCohorte
        c={c}
        fechaInicio={fechaInicio}
        tasaDisplay={tasaDisplay}
        cohorteMes={cohorteMes}
        fechaFormat={fechaFormat}
        showCiclo={showCiclo}
        atenuada={atenuada}
      />
    </>
  );
}

function RowCohorte({
  c,
  fechaInicio,
  tasaDisplay,
  cohorteMes,
  fechaFormat,
  showCiclo,
  atenuada,
}: {
  c: CohorteSemana | CohorteMes;
  fechaInicio: string;
  tasaDisplay: React.ReactNode;
  cohorteMes: CohorteMes;
  fechaFormat: (s: string) => string;
  showCiclo: boolean;
  atenuada: boolean;
}) {
  return (
                  <tr
                    className="border-t"
                    style={{ borderColor: 'var(--card-border)', opacity: atenuada ? 0.55 : 1 }}
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

// ─────────────────────────────────────────────────────────────────────────────
// KPIs estrella (8C): Ratio joya · No-show · SCL promedio
// ─────────────────────────────────────────────────────────────────────────────
function KPIsComercial({ maduras, scl }: { maduras: ResumenComercialMaduras; scl: SCL | null }) {
  const noShow =
    maduras.total_j1 > 0
      ? ((maduras.total_j1 - maduras.asistencias) / maduras.total_j1) * 100
      : null;

  return (
    <section className="grid grid-cols-1 md:grid-cols-3 gap-4">
      {/* Ratio joya */}
      <div
        className="rounded-xl border p-6"
        style={{ background: 'var(--card-bg)', borderColor: 'var(--card-border)' }}
      >
        <div className="text-sm uppercase tracking-widest mb-2 flex items-center gap-2" style={{ color: 'var(--text-dim)' }}>
          Ratio joya
          <TermWithTooltip
            term=""
            explain="Cierres ÷ Limpias en cohortes maduras. Mide tu capacidad de cierre puro, independiente del volumen de leads."
          />
        </div>
        <div
          className="text-[40px] leading-none tracking-tight tabular-nums"
          style={{
            fontFamily: 'var(--font-cormorant)',
            fontWeight: 500,
            color:
              maduras.limpias < 3
                ? 'var(--text-pending)'
                : maduras.tasa_cierre_madura === null
                ? 'var(--text-pending)'
                : maduras.tasa_cierre_madura >= 30
                ? 'var(--accent-green)'
                : maduras.tasa_cierre_madura < 20
                ? 'var(--accent-orange)'
                : 'var(--accent-yellow)',
          }}
        >
          {/* Guardia Fase 7: con <3 limpias mostramos conteo, no % gigante */}
          {maduras.limpias < 3
            ? `${maduras.cierres} de ${maduras.limpias}`
            : maduras.tasa_cierre_madura !== null
            ? `${maduras.tasa_cierre_madura.toFixed(0)}%`
            : '—'}
        </div>
        <div className="text-sm mt-2" style={{ color: 'var(--text-pending)' }}>
          {maduras.limpias < 3
            ? 'pocos datos — se muestra conteo, no %'
            : `${maduras.cierres} cierre${maduras.cierres === 1 ? '' : 's'} ÷ ${maduras.limpias} limpia${maduras.limpias === 1 ? '' : 's'} (maduras)`}
        </div>
      </div>

      {/* No-show */}
      <div
        className="rounded-xl border p-6"
        style={{ background: 'var(--card-bg)', borderColor: 'var(--card-border)' }}
      >
        <div className="text-sm uppercase tracking-widest mb-2" style={{ color: 'var(--text-dim)' }}>
          No-show rate
        </div>
        <div
          className="text-[40px] leading-none tracking-tight tabular-nums"
          style={{
            fontFamily: 'var(--font-cormorant)',
            fontWeight: 500,
            color:
              maduras.total_j1 < 3
                ? 'var(--text-pending)'
                : noShow === null
                ? 'var(--text-pending)'
                : noShow > 35
                ? 'var(--accent-orange)'
                : 'var(--accent-green)',
          }}
        >
          {/* Guardia Fase 7: con <3 J1 mostramos conteo */}
          {maduras.total_j1 < 3
            ? `${maduras.total_j1 - maduras.asistencias} de ${maduras.total_j1}`
            : noShow !== null
            ? `${noShow.toFixed(0)}%`
            : '—'}
        </div>
        <div className="text-sm mt-2" style={{ color: 'var(--text-pending)' }}>
          {maduras.total_j1 < 3
            ? 'pocos datos (no-shows / J1)'
            : noShow !== null && noShow > 35
            ? '>35% — revisá recordatorios'
            : 'cohortes maduras'}
        </div>
      </div>

      {/* SCL promedio */}
      <div
        className="rounded-xl border p-6"
        style={{ background: 'var(--card-bg)', borderColor: 'var(--card-border)' }}
      >
        <div className="text-sm uppercase tracking-widest mb-2" style={{ color: 'var(--text-dim)' }}>
          SCL promedio
        </div>
        <div
          className="text-[40px] leading-none tracking-tight tabular-nums"
          style={{
            fontFamily: 'var(--font-cormorant)',
            fontWeight: 500,
            color: scl && scl.avg_dias !== null ? 'var(--accent-green)' : 'var(--text-pending)',
          }}
        >
          {scl && scl.avg_dias !== null ? `${scl.avg_dias.toFixed(1)} días` : '—'}
        </div>
        <div className="text-sm mt-2" style={{ color: 'var(--text-pending)' }}>
          {scl && scl.avg_dias !== null
            ? `agenda → primer pago · P90: ${scl.p90_dias} días`
            : `pocos datos (${scl?.count ?? 0} de 3 mínimos)`}
        </div>
      </div>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// SCL como línea de tiempo (8C) — tramos promedio del ciclo de venta
// ─────────────────────────────────────────────────────────────────────────────
function SCLTimeline({ scl, tramos }: { scl: SCL | null; tramos: TramosSCL | null }) {
  const sinDatos = !scl || scl.count < 3;

  return (
    <section
      className="rounded-xl border p-6 md:p-8"
      style={{ background: 'var(--card-bg)', borderColor: 'var(--card-border)' }}
    >
      <h2 className="text-[28px]" style={{ fontFamily: 'var(--font-cormorant)', fontWeight: 500 }}>
        SCL — línea de tiempo del ciclo de venta
      </h2>
      <p className="text-base mt-1 mb-6" style={{ color: 'var(--text-dim)' }}>
        Días promedio entre cada hito. Cada tramo se calcula solo con los leads
        que tienen ambas fechas.
      </p>

      {sinDatos && (
        <p className="text-lg mb-6" style={{ color: 'var(--text-pending)' }}>
          SCL global: — (pocos datos: {scl?.count ?? 0} de 3 leads mínimos con
          fecha de primer pago). Los tramos abajo se muestran con la data
          disponible.
        </p>
      )}

      {/* Línea de tiempo horizontal */}
      <div className="flex flex-wrap items-stretch gap-0 overflow-x-auto pb-2">
        <TimelineNodo label="Día 0" sub="Agenda J1" />
        {(tramos?.tramos ?? []).map((t) => (
          <TimelineTramo key={t.label} tramo={t} esMasLento={tramos?.tramo_mas_lento === t.label} />
        ))}
      </div>

      {!sinDatos && scl && (
        <p className="text-base mt-5" style={{ color: 'var(--text-dim)' }}>
          SCL total promedio:{' '}
          <strong style={{ color: 'var(--accent-green)' }}>{scl.avg_dias!.toFixed(1)} días</strong>
          {' '}· P90 (los lentos):{' '}
          <strong style={{ color: 'var(--accent-yellow)' }}>{scl.p90_dias} días</strong>
          {tramos?.tramo_mas_lento && (
            <>
              {' '}· Tramo más lento:{' '}
              <strong style={{ color: 'var(--accent-orange)' }}>{tramos.tramo_mas_lento}</strong>
            </>
          )}
        </p>
      )}
    </section>
  );
}

function TimelineNodo({ label, sub }: { label: string; sub: string }) {
  return (
    <div className="flex flex-col items-center justify-center px-3 py-2 shrink-0">
      <div
        className="w-4 h-4 rounded-full mb-2"
        style={{ background: 'var(--accent-yellow)' }}
      />
      <div className="text-base font-semibold">{label}</div>
      <div className="text-sm" style={{ color: 'var(--text-dim)' }}>{sub}</div>
    </div>
  );
}

function TimelineTramo({ tramo, esMasLento }: { tramo: { label: string; dias_promedio: number | null; n: number }; esMasLento: boolean }) {
  const [, destino] = tramo.label.split('→').map((s) => s.trim());
  const tieneDato = tramo.dias_promedio !== null;
  return (
    <div className="flex items-center shrink-0">
      {/* Conector con días */}
      <div className="flex flex-col items-center px-1">
        <div
          className="text-sm mb-1 tabular-nums px-2 py-0.5 rounded"
          style={{
            color: tieneDato ? (esMasLento ? 'var(--accent-orange)' : 'var(--text)') : 'var(--text-pending)',
            background: esMasLento && tieneDato ? '#2a1410' : 'transparent',
          }}
          title={`${tramo.n} lead${tramo.n === 1 ? '' : 's'} con ambas fechas`}
        >
          {tieneDato ? `+${tramo.dias_promedio!.toFixed(1)}d` : 's/d'}
        </div>
        <div
          className="h-0.5 w-16 md:w-24"
          style={{ background: tieneDato ? 'var(--card-border)' : '#1a1a1a' }}
        />
        <div className="text-[10px] mt-1" style={{ color: 'var(--text-pending)' }}>
          n={tramo.n}
        </div>
      </div>
      {/* Nodo destino */}
      <div className="flex flex-col items-center justify-center px-3 py-2">
        <div
          className="w-4 h-4 rounded-full mb-2"
          style={{ background: tieneDato ? 'var(--accent-green)' : '#1a1a1a' }}
        />
        <div className="text-base font-semibold">{destino}</div>
      </div>
    </div>
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
