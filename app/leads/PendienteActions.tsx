'use client';

// =============================================================================
// PendienteActions — resolución en dos taps desde la lista (Fase 9)
// =============================================================================
// Cada lead pendiente se resuelve sin abrir la ficha. Según el tipo:
//   A) ¿Asistió a J1? [Sí] [No]
//   B) Resolución: [Perdido] [Descalificado] (+motivo) · Ganado abre la ficha
//      (necesita monto). Agendar la J2 lo hace Calendly solo.
//   C) ¿Asistió a J2? [Sí] [No]
// Guardado inmediato vía updateLeadAction; al refrescar, el lead desaparece.
// =============================================================================

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { updateLeadAction } from './actions';
import type { LeadUpdateInput } from '@/lib/leads';
import type { TipoPendiente } from '@/lib/queries';

export function PendienteActions({
  leadId,
  tipo,
  motivoActual,
}: {
  leadId: number;
  tipo: TipoPendiente;
  motivoActual: string | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  // Para tipo B: qué resolución de pérdida se eligió (revela el motivo)
  const [resol, setResol] = useState<'perdido' | 'descalificado' | null>(null);
  const [motivo, setMotivo] = useState(motivoActual ?? '');

  const guardar = (input: LeadUpdateInput) => {
    setError(null);
    startTransition(async () => {
      try {
        await updateLeadAction(leadId, input);
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    });
  };

  return (
    <div className="flex flex-col items-start md:items-end gap-2">
      {tipo === 'A' && (
        <SiNo
          label="¿Asistió a J1?"
          pending={pending}
          onSi={() => guardar({ asistio_j1: true })}
          onNo={() => guardar({ asistio_j1: false })}
        />
      )}

      {tipo === 'C' && (
        <SiNo
          label="¿Asistió a J2?"
          pending={pending}
          onSi={() => guardar({ asistio_j2: true })}
          onNo={() => guardar({ asistio_j2: false })}
        />
      )}

      {tipo === 'B' && (
        <div className="flex flex-col items-start md:items-end gap-2">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm" style={{ color: 'var(--text-dim)' }}>Resolución:</span>
            <Link
              href={`/leads/${leadId}`}
              className="px-3 py-1.5 rounded-lg border text-sm"
              style={{ borderColor: 'var(--accent-green)', color: 'var(--accent-green)' }}
            >
              Ganado (abrir ficha)
            </Link>
            <ChipBtn
              label="Perdido"
              active={resol === 'perdido'}
              color="var(--accent-orange)"
              onClick={() => setResol('perdido')}
              disabled={pending}
            />
            <ChipBtn
              label="Descalificado"
              active={resol === 'descalificado'}
              color="var(--text-dim)"
              onClick={() => setResol('descalificado')}
              disabled={pending}
            />
          </div>

          {resol && (
            <div className="flex items-center gap-2 flex-wrap">
              <input
                type="text"
                value={motivo}
                onChange={(e) => setMotivo(e.target.value)}
                placeholder="Motivo (opcional)"
                className="px-3 py-1.5 rounded border text-sm"
                style={{ background: '#0a0a0a', borderColor: 'var(--card-border)', color: 'var(--text)' }}
              />
              <button
                type="button"
                disabled={pending}
                onClick={() => guardar({ estado_lead: resol, motivo_perdida: motivo.trim() || null })}
                className="px-3 py-1.5 rounded-lg text-sm font-medium disabled:opacity-50"
                style={{ background: 'var(--accent-yellow)', color: '#000' }}
              >
                {pending ? 'Guardando…' : 'Guardar'}
              </button>
            </div>
          )}
        </div>
      )}

      {error && (
        <span className="text-sm" style={{ color: 'var(--accent-orange)' }}>{error}</span>
      )}
    </div>
  );
}

function SiNo({
  label,
  pending,
  onSi,
  onNo,
}: {
  label: string;
  pending: boolean;
  onSi: () => void;
  onNo: () => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-sm" style={{ color: 'var(--text-dim)' }}>{label}</span>
      <button
        type="button"
        disabled={pending}
        onClick={onSi}
        className="px-4 py-1.5 rounded-lg text-sm font-medium disabled:opacity-50"
        style={{ background: 'var(--accent-green)', color: '#000' }}
      >
        Sí
      </button>
      <button
        type="button"
        disabled={pending}
        onClick={onNo}
        className="px-4 py-1.5 rounded-lg text-sm font-medium border disabled:opacity-50"
        style={{ borderColor: 'var(--accent-orange)', color: 'var(--accent-orange)' }}
      >
        No
      </button>
    </div>
  );
}

function ChipBtn({
  label,
  active,
  color,
  onClick,
  disabled,
}: {
  label: string;
  active: boolean;
  color: string;
  onClick: () => void;
  disabled: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="px-3 py-1.5 rounded-lg border text-sm disabled:opacity-50"
      style={{
        borderColor: active ? color : 'var(--card-border)',
        color: active ? color : 'var(--text-dim)',
        background: active ? '#1a1a1a' : 'transparent',
      }}
    >
      {label}
    </button>
  );
}
