'use client';

// =============================================================================
// CobranzaPlanCard — plan de pagos + lista de cuotas (Fase 8-bis)
// =============================================================================
// Reemplaza los campos sueltos de cobranza. El plan (cobro inicial + cuotas)
// genera filas en `pagos`; cada cuota se marca cobrada con su fecha real. El
// cash collected del dashboard se lee de estas filas.
// =============================================================================

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { savePlanPagosAction, marcarPagoAction } from '../actions';
import type { Lead } from '@/lib/leads';
import type { Pago } from '@/lib/pagos';

function hoyISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function fmtFecha(yyyy_mm_dd: string | null): string {
  if (!yyyy_mm_dd) return '—';
  const [y, m, d] = yyyy_mm_dd.split('-').map(Number);
  return new Intl.DateTimeFormat('es-MX', {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(y, m - 1, d)));
}

function fmtUSD(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(n);
}

export function CobranzaPlanCard({ lead, pagos }: { lead: Lead; pagos: Pago[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<{ kind: 'ok' | 'err'; msg: string } | null>(null);

  // Estado del formulario del plan
  const [cobroInicial, setCobroInicial] = useState(lead.cobro_inicial_usd?.toString() ?? '');
  const [montoCuota, setMontoCuota] = useState(lead.monto_cuota_usd?.toString() ?? '');
  const [totalCuotas, setTotalCuotas] = useState<string>(lead.total_cuotas?.toString() ?? '0');
  const [diaPago, setDiaPago] = useState<string>(lead.dia_de_pago?.toString() ?? '1');

  const nCuotas = parseInt(totalCuotas, 10) || 0;
  const inicialNum = parseFloat(cobroInicial) || 0;
  const cuotaNum = parseFloat(montoCuota) || 0;
  const totalPlan = inicialNum + cuotaNum * nCuotas;

  const cobrado = pagos.filter((p) => p.pagado).reduce((s, p) => s + Number(p.monto_usd), 0);
  const pendiente = pagos.filter((p) => !p.pagado).reduce((s, p) => s + Number(p.monto_usd), 0);

  const guardarPlan = () => {
    setFeedback(null);
    startTransition(async () => {
      try {
        await savePlanPagosAction(lead.id, {
          cobro_inicial_usd: cobroInicial.trim() ? parseFloat(cobroInicial) : null,
          monto_cuota_usd: montoCuota.trim() ? parseFloat(montoCuota) : null,
          total_cuotas: nCuotas > 0 ? nCuotas : null,
          dia_de_pago: parseInt(diaPago, 10) || null,
        });
        setFeedback({ kind: 'ok', msg: 'Plan guardado ✓' });
        router.refresh();
      } catch (err) {
        setFeedback({ kind: 'err', msg: err instanceof Error ? err.message : String(err) });
      }
    });
  };

  return (
    <section
      className="rounded-xl border p-6 md:p-8"
      style={{ background: 'var(--card-bg)', borderColor: 'var(--card-border)' }}
    >
      <h2
        className="text-[28px] mb-1"
        style={{ fontFamily: 'var(--font-cormorant)', fontWeight: 500 }}
      >
        Plan de pagos
      </h2>
      <p className="text-base mb-5" style={{ color: 'var(--text-dim)' }}>
        Cobro inicial + cuotas mensuales. Al guardar se generan las cuotas; cada
        una se marca cobrada con su fecha real. El cash del dashboard lee de acá.
      </p>

      {/* ── Formulario del plan ── */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        <Field label="Monto del cobro inicial (USD)">
          <NumInput value={cobroInicial} onChange={setCobroInicial} />
        </Field>
        <Field label="Monto de cada cuota (USD)">
          <NumInput value={montoCuota} onChange={setMontoCuota} />
        </Field>
        <Field label="Total de cuotas">
          <select
            value={totalCuotas}
            onChange={(e) => setTotalCuotas(e.target.value)}
            className="w-full px-3 py-2 rounded border text-lg"
            style={{ background: '#0a0a0a', borderColor: 'var(--card-border)', color: 'var(--text)' }}
          >
            <option value="0">Sin cuotas (solo inicial)</option>
            {[1, 2, 3, 4, 5, 6].map((n) => (
              <option key={n} value={n}>{n} cuota{n === 1 ? '' : 's'}</option>
            ))}
          </select>
        </Field>
        <Field label="Día de pago (1–28)" hint="Tope 28 para que exista en todos los meses.">
          <select
            value={diaPago}
            onChange={(e) => setDiaPago(e.target.value)}
            className="w-full px-3 py-2 rounded border text-lg"
            style={{ background: '#0a0a0a', borderColor: 'var(--card-border)', color: 'var(--text)' }}
          >
            {Array.from({ length: 28 }, (_, i) => i + 1).map((d) => (
              <option key={d} value={d}>{d}</option>
            ))}
          </select>
        </Field>
      </div>

      <div className="flex items-center justify-between mt-5 flex-wrap gap-3">
        <div className="text-base" style={{ color: 'var(--text-dim)' }}>
          Total del plan:{' '}
          <span style={{ color: 'var(--text)', fontWeight: 600 }}>{fmtUSD(totalPlan)}</span>
          {nCuotas > 0 && (
            <span className="text-sm ml-2">
              ({fmtUSD(inicialNum)} inicial + {nCuotas} × {fmtUSD(cuotaNum)})
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={guardarPlan}
          disabled={pending}
          className="px-5 py-2.5 rounded-lg font-medium text-base disabled:opacity-50"
          style={{ background: 'var(--accent-yellow)', color: '#000' }}
        >
          {pending ? 'Guardando…' : 'Guardar plan'}
        </button>
      </div>

      {feedback && (
        <div
          className="rounded-lg px-4 py-3 text-base mt-4"
          style={{
            background: feedback.kind === 'ok' ? '#0f2d20' : '#2a1410',
            color: feedback.kind === 'ok' ? 'var(--accent-green)' : 'var(--accent-orange)',
          }}
        >
          {feedback.msg}
        </div>
      )}

      {/* ── Lista de cuotas ── */}
      {pagos.length > 0 && (
        <div className="mt-7">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-xl" style={{ fontFamily: 'var(--font-cormorant)', fontWeight: 500 }}>
              Cuotas
            </h3>
            <div className="text-sm" style={{ color: 'var(--text-dim)' }}>
              Cobrado {fmtUSD(cobrado)} · Pendiente {fmtUSD(pendiente)}
            </div>
          </div>
          <div className="space-y-2">
            {pagos.map((p) => (
              <CuotaRow key={p.id} pago={p} leadId={lead.id} pending={pending} startTransition={startTransition} router={router} setFeedback={setFeedback} />
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// CuotaRow — una fila de pago con botón de marcar cobrada
// ─────────────────────────────────────────────────────────────────────────────
function CuotaRow({
  pago,
  leadId,
  pending,
  startTransition,
  router,
  setFeedback,
}: {
  pago: Pago;
  leadId: number;
  pending: boolean;
  startTransition: React.TransitionStartFunction;
  router: ReturnType<typeof useRouter>;
  setFeedback: (f: { kind: 'ok' | 'err'; msg: string } | null) => void;
}) {
  const [fechaPago, setFechaPago] = useState(pago.fecha_pago ?? hoyISO());

  const vencida = !pago.pagado && pago.fecha_esperada !== null && pago.fecha_esperada < hoyISO();
  const etiqueta = pago.numero === 0 ? 'Cobro inicial' : `Cuota ${pago.numero}`;

  const marcar = (pagado: boolean) => {
    setFeedback(null);
    startTransition(async () => {
      try {
        await marcarPagoAction(pago.id, leadId, pagado, pagado ? fechaPago : null);
        router.refresh();
      } catch (err) {
        setFeedback({ kind: 'err', msg: err instanceof Error ? err.message : String(err) });
      }
    });
  };

  return (
    <div
      className="flex items-center justify-between gap-3 rounded-lg border px-4 py-3 flex-wrap"
      style={{
        borderColor: vencida ? 'var(--accent-orange)' : 'var(--card-border)',
        background: pago.pagado ? 'rgba(40,167,69,0.06)' : 'transparent',
      }}
    >
      <div className="flex items-center gap-3">
        <span style={{ color: 'var(--text)', fontWeight: 600 }}>{etiqueta}</span>
        <span style={{ color: 'var(--text-dim)' }}>{fmtUSD(Number(pago.monto_usd))}</span>
        <span className="text-sm" style={{ color: vencida ? 'var(--accent-orange)' : 'var(--text-dim)' }}>
          {pago.pagado
            ? `cobrada el ${fmtFecha(pago.fecha_pago)}`
            : `vence ${fmtFecha(pago.fecha_esperada)}${vencida ? ' · vencida' : ''}`}
        </span>
      </div>

      {pago.pagado ? (
        <button
          type="button"
          onClick={() => marcar(false)}
          disabled={pending}
          className="text-sm disabled:opacity-50"
          style={{ color: 'var(--text-dim)' }}
        >
          deshacer
        </button>
      ) : (
        <div className="flex items-center gap-2">
          <input
            type="date"
            value={fechaPago}
            onChange={(e) => setFechaPago(e.target.value)}
            className="px-2 py-1.5 rounded border text-sm"
            style={{ background: '#0a0a0a', borderColor: 'var(--card-border)', color: 'var(--text)' }}
          />
          <button
            type="button"
            onClick={() => marcar(true)}
            disabled={pending}
            className="px-3 py-1.5 rounded-lg text-sm font-medium disabled:opacity-50"
            style={{ background: 'var(--accent-green)', color: '#000' }}
          >
            Marcar pagada
          </button>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Sub-components mínimos
// ─────────────────────────────────────────────────────────────────────────────
function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="block text-base mb-1.5" style={{ color: 'var(--text-dim)' }}>
        {label}
      </span>
      {children}
      {hint && (
        <span className="block text-sm mt-1" style={{ color: 'var(--text-pending)' }}>
          {hint}
        </span>
      )}
    </label>
  );
}

function NumInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <input
      type="number"
      step="0.01"
      min="0"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full px-3 py-2 rounded border text-lg"
      style={{ background: '#0a0a0a', borderColor: 'var(--card-border)', color: 'var(--text)' }}
    />
  );
}
