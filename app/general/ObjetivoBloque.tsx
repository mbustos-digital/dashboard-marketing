'use client';

// =============================================================================
// ObjetivoBloque — objetivo global acumulado + pacing (Fase 14)
// =============================================================================
// Dos barras (cierres y cash) contra la meta, ritmo estimado y edición inline
// de los tres valores. NO se ata al filtro de rango global: es acumulado desde
// objetivo_desde, siempre. Sirve también de auditoría del conteo de cierres.
// =============================================================================

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { setObjetivoAction } from './actions';
import type { ObjetivoProgreso } from '@/lib/queries';

function fmtUSD(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);
}
function fmtFecha(yyyy_mm_dd: string): string {
  const [y, m, d] = yyyy_mm_dd.split('-').map(Number);
  return new Intl.DateTimeFormat('es-MX', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(Date.UTC(y, m - 1, d)));
}

export function ObjetivoBloque({ progreso }: { progreso: ObjetivoProgreso }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [editando, setEditando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [cierresMeta, setCierresMeta] = useState(progreso.cierres_meta?.toString() ?? '');
  const [cashMeta, setCashMeta] = useState(progreso.cash_meta?.toString() ?? '');
  const [desde, setDesde] = useState(progreso.desde);

  const guardar = () => {
    setError(null);
    startTransition(async () => {
      try {
        await setObjetivoAction('objetivo_cierres', cierresMeta);
        await setObjetivoAction('objetivo_cash_usd', cashMeta);
        await setObjetivoAction('objetivo_desde', desde);
        setEditando(false);
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    });
  };

  return (
    <section
      className="rounded-xl border p-6 md:p-8"
      style={{ background: 'var(--card-bg)', borderColor: progreso.cumplido ? 'var(--accent-green)' : 'var(--card-border)' }}
    >
      <div className="flex items-center justify-between gap-3 flex-wrap mb-1">
        <h2 className="text-[28px]" style={{ fontFamily: 'var(--font-cormorant)', fontWeight: 500 }}>
          Objetivo {progreso.cumplido && <span style={{ color: 'var(--accent-green)' }}>· cumplido 🎉</span>}
        </h2>
        <button
          type="button"
          onClick={() => setEditando((v) => !v)}
          className="text-sm"
          style={{ color: 'var(--text-dim)' }}
        >
          {editando ? 'cancelar' : '✎ editar'}
        </button>
      </div>
      <p className="text-sm mb-5" style={{ color: 'var(--text-dim)' }}>
        Acumulado desde {fmtFecha(progreso.desde)} · no depende del filtro de fechas.
      </p>

      {editando ? (
        <div className="space-y-4">
          <EditRow label="Meta de cierres">
            <input type="number" min="1" value={cierresMeta} onChange={(e) => setCierresMeta(e.target.value)} className="num-input" style={inputStyle} />
          </EditRow>
          <EditRow label="Meta de cash (USD)">
            <input type="number" min="0" value={cashMeta} onChange={(e) => setCashMeta(e.target.value)} style={inputStyle} />
          </EditRow>
          <EditRow label="Acumular desde">
            <input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} style={inputStyle} />
          </EditRow>
          {error && <p className="text-sm" style={{ color: 'var(--accent-orange)' }}>{error}</p>}
          <button
            type="button"
            onClick={guardar}
            disabled={pending}
            className="px-5 py-2.5 rounded-lg font-medium text-base disabled:opacity-50"
            style={{ background: 'var(--accent-yellow)', color: '#000' }}
          >
            {pending ? 'Guardando…' : 'Guardar objetivo'}
          </button>
        </div>
      ) : (
        <div className="space-y-5">
          <Barra
            titulo="Cierres"
            actual={progreso.cierres_actual}
            meta={progreso.cierres_meta}
            texto={progreso.cierres_meta !== null
              ? `${progreso.cierres_actual} de ${progreso.cierres_meta} — ${progreso.cierres_actual >= progreso.cierres_meta ? '¡listo!' : `faltan ${progreso.cierres_meta - progreso.cierres_actual}`}`
              : `${progreso.cierres_actual} cierres (sin meta cargada)`}
          />
          <Barra
            titulo="Cash collected"
            actual={progreso.cash_actual}
            meta={progreso.cash_meta}
            texto={progreso.cash_meta !== null
              ? `${fmtUSD(progreso.cash_actual)} de ${fmtUSD(progreso.cash_meta)} — ${progreso.cash_actual >= progreso.cash_meta ? '¡listo!' : `faltan ${fmtUSD(progreso.cash_meta - progreso.cash_actual)}`}`
              : `${fmtUSD(progreso.cash_actual)} (sin meta cargada)`}
            esDinero
          />
          {progreso.semanas_estimadas !== null && (
            <p className="text-base" style={{ color: 'var(--text-dim)' }}>
              A este ritmo ({progreso.cierres_30d} cierre{progreso.cierres_30d === 1 ? '' : 's'} en 30 días) llegás en{' '}
              <strong style={{ color: 'var(--text)' }}>~{progreso.semanas_estimadas} semana{progreso.semanas_estimadas === 1 ? '' : 's'}</strong>.
            </p>
          )}
          {progreso.cumplido && (
            <p className="text-base" style={{ color: 'var(--accent-green)' }}>
              Objetivo cumplido. Definí el próximo con ✎ editar.
            </p>
          )}
        </div>
      )}
    </section>
  );
}

const inputStyle: React.CSSProperties = {
  background: '#0a0a0a',
  borderWidth: 1,
  borderColor: 'var(--card-border)',
  color: 'var(--text)',
  borderRadius: 8,
  padding: '8px 12px',
  fontSize: '1.05rem',
  width: '100%',
  maxWidth: 240,
};

function EditRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-sm mb-1.5" style={{ color: 'var(--text-dim)' }}>{label}</span>
      {children}
    </label>
  );
}

function Barra({
  titulo,
  actual,
  meta,
  texto,
  esDinero = false,
}: {
  titulo: string;
  actual: number;
  meta: number | null;
  texto: string;
  esDinero?: boolean;
}) {
  const pct = meta && meta > 0 ? Math.min((actual / meta) * 100, 100) : 0;
  const completo = meta !== null && actual >= meta;
  return (
    <div>
      <div className="flex items-center justify-between gap-3 mb-1.5">
        <span className="text-base" style={{ fontWeight: 600 }}>{titulo}</span>
        <span className="text-sm" style={{ color: 'var(--text-dim)' }}>{texto}</span>
      </div>
      <div className="w-full h-3 rounded-full overflow-hidden" style={{ background: '#1a1a1a' }}>
        <div
          className="h-full rounded-full transition-all"
          style={{ width: `${pct}%`, background: completo ? 'var(--accent-green)' : esDinero ? 'var(--accent-yellow)' : 'var(--accent-yellow)' }}
        />
      </div>
    </div>
  );
}
