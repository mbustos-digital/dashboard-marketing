'use client';

// =============================================================================
// EditLeadForm — client component con la lógica de edición de un lead
// =============================================================================
// Maneja:
//   - Información de contacto (nombre, email, teléfono, empresa)
//   - Datos comerciales con dependencias:
//     · asistio_j1 deshabilitado si !fecha_junta_1
//     · calificado deshabilitado si asistio_j1 !== true
//     · monto_cierre_usd visible solo si cerro === true
//   - Save vía server action (con loading + feedback)
//   - Borrar (con confirm)
// =============================================================================

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { updateLeadAction, deleteLeadAction } from '../actions';
import type { Lead, LeadUpdateInput } from '@/lib/leads';

type TriState = boolean | null;

export function EditLeadForm({ lead }: { lead: Lead }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<{ kind: 'ok' | 'err'; msg: string } | null>(null);

  // Estado local — inicializado con el lead actual
  const [nombre, setNombre] = useState(lead.nombre);
  const [email, setEmail] = useState(lead.email ?? '');
  const [telefono, setTelefono] = useState(lead.telefono ?? '');
  const [empresa, setEmpresa] = useState(lead.empresa ?? '');

  const [fechaAgenda, setFechaAgenda] = useState(lead.fecha_agenda ?? '');
  const [fechaJ1, setFechaJ1] = useState(lead.fecha_junta_1 ?? '');
  const [fechaJ2, setFechaJ2] = useState(lead.fecha_junta_2 ?? '');

  const [asistioJ1, setAsistioJ1] = useState<TriState>(lead.asistio_j1);
  const [asistioJ2, setAsistioJ2] = useState<TriState>(lead.asistio_j2);
  const [calificado, setCalificado] = useState<TriState>(lead.calificado);
  const [cerro, setCerro] = useState<TriState>(lead.cerro);
  const [montoCierre, setMontoCierre] = useState<string>(
    lead.monto_cierre_usd?.toString() ?? '',
  );
  const [fechaCierre, setFechaCierre] = useState(lead.fecha_cierre ?? '');

  // ── Reglas de dependencia (UI) ──
  const asistioJ1Disabled = !fechaJ1;
  const calificadoDisabled = asistioJ1 !== true;
  const asistioJ2Disabled = !fechaJ2;
  const mostrarCierreCampos = cerro === true;

  // Auto-cleanup en cambios de parents (espejo de las reglas del backend)
  const handleFechaJ1Change = (v: string) => {
    setFechaJ1(v);
    if (!v) {
      setAsistioJ1(null);
      setCalificado(null);
    }
  };
  const handleAsistioJ1Change = (v: TriState) => {
    setAsistioJ1(v);
    if (v !== true) setCalificado(null);
  };
  const handleCerroChange = (v: TriState) => {
    setCerro(v);
    if (v !== true) {
      setMontoCierre('');
      setFechaCierre('');
    }
  };
  const handleFechaJ2Change = (v: string) => {
    setFechaJ2(v);
    if (!v) setAsistioJ2(null);
  };

  // ── Submit ──
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setFeedback(null);

    if (!nombre.trim()) {
      setFeedback({ kind: 'err', msg: 'Nombre es requerido' });
      return;
    }
    if (cerro === true) {
      const monto = parseFloat(montoCierre);
      if (!Number.isFinite(monto) || monto <= 0) {
        setFeedback({ kind: 'err', msg: 'Si cerró = Sí, monto debe ser un número positivo' });
        return;
      }
    }

    const payload: LeadUpdateInput = {
      nombre: nombre.trim(),
      email: email.trim() || null,
      telefono: telefono.trim() || null,
      empresa: empresa.trim() || null,
      fecha_agenda: fechaAgenda || null,
      fecha_junta_1: fechaJ1 || null,
      fecha_junta_2: fechaJ2 || null,
      asistio_j1: asistioJ1,
      asistio_j2: asistioJ2,
      calificado,
      cerro,
      monto_cierre_usd: cerro === true ? parseFloat(montoCierre) : null,
      fecha_cierre: cerro === true ? fechaCierre || null : null,
    };

    startTransition(async () => {
      try {
        await updateLeadAction(lead.id, payload);
        setFeedback({ kind: 'ok', msg: 'Cambios guardados ✓' });
        router.refresh();
      } catch (err) {
        setFeedback({
          kind: 'err',
          msg: err instanceof Error ? err.message : String(err),
        });
      }
    });
  };

  const handleDelete = () => {
    if (!confirm(`¿Borrar lead "${lead.nombre}"? Esta acción no se puede deshacer.`)) return;
    startTransition(async () => {
      try {
        await deleteLeadAction(lead.id);
      } catch (err) {
        setFeedback({
          kind: 'err',
          msg: err instanceof Error ? err.message : String(err),
        });
      }
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* ─── CONTACTO ─── */}
      <Card title="Información de contacto">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          <Field label="Nombre" required>
            <TextInput value={nombre} onChange={setNombre} required />
          </Field>
          <Field label="Empresa">
            <TextInput value={empresa} onChange={setEmpresa} />
          </Field>
          <Field label="Email">
            <TextInput type="email" value={email} onChange={setEmail} />
          </Field>
          <Field label="Teléfono">
            <TextInput type="tel" value={telefono} onChange={setTelefono} />
          </Field>
        </div>
      </Card>

      {/* ─── COMERCIAL ─── */}
      <Card title="Datos comerciales">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          <Field label="Fecha de agendamiento">
            <TextInput type="date" value={fechaAgenda} onChange={setFechaAgenda} />
          </Field>
          <Field label="Fecha de Junta 1 (anchor de cohorte)">
            <TextInput type="date" value={fechaJ1} onChange={handleFechaJ1Change} />
          </Field>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-5 mt-5">
          <Field label="¿Asistió a J1?" disabled={asistioJ1Disabled} hint={asistioJ1Disabled ? 'Marca fecha J1 primero' : undefined}>
            <TriToggle value={asistioJ1} onChange={handleAsistioJ1Change} disabled={asistioJ1Disabled} />
          </Field>
          <Field label="¿Era lead calificado?" disabled={calificadoDisabled} hint={calificadoDisabled ? 'Solo si asistió a J1 = Sí' : undefined}>
            <TriToggle value={calificado} onChange={setCalificado} disabled={calificadoDisabled} />
          </Field>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-5 mt-5">
          <Field label="Fecha de Junta 2 (opcional)">
            <TextInput type="date" value={fechaJ2} onChange={handleFechaJ2Change} />
          </Field>
          <Field label="¿Asistió a J2?" disabled={asistioJ2Disabled} hint={asistioJ2Disabled ? 'Marca fecha J2 primero' : undefined}>
            <TriToggle value={asistioJ2} onChange={setAsistioJ2} disabled={asistioJ2Disabled} />
          </Field>
        </div>
      </Card>

      {/* ─── CIERRE ─── */}
      <Card title="Cierre">
        <Field label="¿Cerró cliente?">
          <TriToggle value={cerro} onChange={handleCerroChange} />
        </Field>

        {mostrarCierreCampos && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5 mt-5">
            <Field label="Monto del cierre (USD)" required>
              <input
                type="number"
                step="0.01"
                min="0"
                value={montoCierre}
                onChange={(e) => setMontoCierre(e.target.value)}
                required={cerro === true}
                className="w-full px-3 py-2 rounded border text-lg"
                style={{
                  background: '#0a0a0a',
                  borderColor: 'var(--card-border)',
                  color: 'var(--text)',
                }}
              />
            </Field>
            <Field label="Fecha de cierre">
              <TextInput type="date" value={fechaCierre} onChange={setFechaCierre} />
            </Field>
          </div>
        )}
      </Card>

      {/* ─── FEEDBACK + ACCIONES ─── */}
      {feedback && (
        <div
          className="rounded-lg px-4 py-3 text-base"
          style={{
            background: feedback.kind === 'ok' ? '#0f2d20' : '#2a1410',
            color: feedback.kind === 'ok' ? 'var(--accent-green)' : 'var(--accent-orange)',
          }}
        >
          {feedback.msg}
        </div>
      )}

      <div className="flex items-center justify-between gap-3 pt-2">
        <button
          type="button"
          onClick={handleDelete}
          disabled={pending}
          className="px-4 py-2 rounded border text-base disabled:opacity-50"
          style={{ borderColor: 'var(--accent-orange)', color: 'var(--accent-orange)' }}
        >
          Borrar lead
        </button>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => router.push('/leads')}
            className="px-4 py-2 text-base"
            style={{ color: 'var(--text-dim)' }}
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={pending}
            className="px-5 py-3 rounded-lg font-medium text-base disabled:opacity-50"
            style={{ background: 'var(--accent-yellow)', color: '#000' }}
          >
            {pending ? 'Guardando…' : 'Guardar cambios'}
          </button>
        </div>
      </div>
    </form>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────────────────────────────────────

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section
      className="rounded-xl border p-6 md:p-8"
      style={{ background: 'var(--card-bg)', borderColor: 'var(--card-border)' }}
    >
      <h2
        className="text-[28px] mb-5"
        style={{ fontFamily: 'var(--font-cormorant)', fontWeight: 500 }}
      >
        {title}
      </h2>
      {children}
    </section>
  );
}

function Field({
  label,
  required,
  disabled,
  hint,
  children,
}: {
  label: string;
  required?: boolean;
  disabled?: boolean;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span
        className="block text-base mb-1.5"
        style={{ color: disabled ? 'var(--text-pending)' : 'var(--text-dim)' }}
      >
        {label}
        {required && (
          <span className="ml-1" style={{ color: 'var(--accent-orange)' }}>
            *
          </span>
        )}
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

function TextInput({
  type = 'text',
  value,
  onChange,
  required,
}: {
  type?: string;
  value: string;
  onChange: (v: string) => void;
  required?: boolean;
}) {
  return (
    <input
      type={type}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      required={required}
      className="w-full px-3 py-2 rounded border text-lg"
      style={{
        background: '#0a0a0a',
        borderColor: 'var(--card-border)',
        color: 'var(--text)',
      }}
    />
  );
}

function TriToggle({
  value,
  onChange,
  disabled,
}: {
  value: TriState;
  onChange: (v: TriState) => void;
  disabled?: boolean;
}) {
  const options: Array<{ v: TriState; label: string; color: string }> = [
    { v: true, label: 'Sí', color: 'var(--accent-green)' },
    { v: false, label: 'No', color: 'var(--accent-orange)' },
    { v: null, label: '—', color: 'var(--text-dim)' },
  ];
  return (
    <div className="inline-flex rounded-lg border overflow-hidden" style={{ borderColor: 'var(--card-border)' }}>
      {options.map((opt) => {
        const active = value === opt.v;
        return (
          <button
            key={String(opt.v)}
            type="button"
            disabled={disabled}
            onClick={() => onChange(opt.v)}
            className="px-4 py-2 text-base font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            style={{
              background: active && !disabled ? '#1a1a1a' : 'transparent',
              color: active && !disabled ? opt.color : 'var(--text-dim)',
              borderRight: opt.v !== null ? '1px solid var(--card-border)' : 'none',
            }}
            title={opt.label === '—' ? 'Aún no se sabe' : opt.label}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
