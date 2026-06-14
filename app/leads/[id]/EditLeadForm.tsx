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
import type { Lead, LeadUpdateInput, EstadoLead } from '@/lib/leads';

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

  // Resolución (Fase 8) — estado del lead reemplaza al booleano cerro
  const [estado, setEstado] = useState<EstadoLead>(lead.estado_lead);
  const [motivoPerdida, setMotivoPerdida] = useState(lead.motivo_perdida ?? '');
  const [montoCierre, setMontoCierre] = useState<string>(
    lead.monto_cierre_usd?.toString() ?? '',
  );
  const [fechaCierre, setFechaCierre] = useState(lead.fecha_cierre ?? '');
  const [fechaConfirmacion, setFechaConfirmacion] = useState(lead.fecha_confirmacion ?? '');

  // Inicio de servicio (la cobranza real vive en la card Plan de pagos / pagos)
  const [fechaInicioServicio, setFechaInicioServicio] = useState(lead.fecha_inicio_servicio ?? '');

  // ── Reglas de dependencia (UI) ──
  const asistioJ1Disabled = !fechaJ1;
  const calificadoDisabled = asistioJ1 !== true;
  const asistioJ2Disabled = !fechaJ2;
  const esGanado = estado === 'ganado';
  const esPerdidaODescal = estado === 'perdido' || estado === 'descalificado';

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
  const handleEstadoChange = (v: EstadoLead) => {
    setEstado(v);
    // Espejo de las reglas del backend: limpiar lo que deja de aplicar.
    if (v !== 'ganado') {
      setMontoCierre('');
      setFechaCierre('');
    }
    if (v !== 'perdido' && v !== 'descalificado') {
      setMotivoPerdida('');
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
    if (estado === 'ganado') {
      const monto = parseFloat(montoCierre);
      if (!Number.isFinite(monto) || monto <= 0) {
        setFeedback({ kind: 'err', msg: 'Si el estado es Ganado, el monto debe ser un número positivo' });
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
      // Resolución (Fase 8): estado_lead es la fuente de verdad; updateLead
      // deriva `cerro` para no romper Revenue.
      estado_lead: estado,
      motivo_perdida: esPerdidaODescal ? (motivoPerdida.trim() || null) : null,
      monto_cierre_usd: estado === 'ganado' ? parseFloat(montoCierre) : null,
      fecha_cierre: estado === 'ganado' ? fechaCierre || null : null,
      fecha_confirmacion: fechaConfirmacion || null,
      fecha_inicio_servicio: estado === 'ganado' ? fechaInicioServicio || null : null,
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

      {/* ─── RESPUESTAS DEL FORMULARIO (read-only) ─── */}
      <RespuestasCalendlyCard lead={lead} />

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

        <div className="grid grid-cols-1 md:grid-cols-2 gap-5 mt-5">
          <Field
            label="Fecha de confirmación (opcional)"
            hint="Cuándo el cliente confirmó verbalmente el cierre (entre J2 y primer pago)."
          >
            <TextInput type="date" value={fechaConfirmacion} onChange={setFechaConfirmacion} />
          </Field>
        </div>
      </Card>

      {/* ─── RESOLUCIÓN ─── */}
      <Card title="Resolución">
        <p className="text-base mb-5" style={{ color: 'var(--text-dim)' }}>
          Cómo terminó este lead. <strong>Perdido</strong> = lo trabajamos y no
          compró. <strong>Descalificado</strong> = no era buen fit (presupuesto,
          tamaño, timing). <strong>Abierto</strong> = sigue en proceso.
        </p>
        <Field label="Estado del lead">
          <EstadoSelector value={estado} onChange={handleEstadoChange} />
        </Field>

        {esGanado && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5 mt-5">
            <Field label="Monto del cierre (USD)" required>
              <input
                type="number"
                step="0.01"
                min="0"
                value={montoCierre}
                onChange={(e) => setMontoCierre(e.target.value)}
                required={estado === 'ganado'}
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
            <Field label="Fecha inicio de servicio (opcional)">
              <TextInput type="date" value={fechaInicioServicio} onChange={setFechaInicioServicio} />
            </Field>
          </div>
        )}

        {esPerdidaODescal && (
          <div className="mt-5">
            <Field
              label="Motivo"
              hint="Tocá una sugerencia o escribí el tuyo. Sirve para ver patrones de pérdida."
            >
              <MotivoSugerencias value={motivoPerdida} onChange={setMotivoPerdida} />
            </Field>
          </div>
        )}
      </Card>

      {/* La cobranza real (plan de pagos + cuotas) vive en su propia card,
          renderizada en la ficha (CobranzaPlanCard) — Fase 8-bis. */}

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

// ─────────────────────────────────────────────────────────────────────────────
// EstadoSelector — selector segmentado de 4 estados (Fase 8)
// ─────────────────────────────────────────────────────────────────────────────
function EstadoSelector({
  value,
  onChange,
}: {
  value: EstadoLead;
  onChange: (v: EstadoLead) => void;
}) {
  const options: Array<{ v: EstadoLead; label: string; color: string }> = [
    { v: 'abierto', label: 'Abierto', color: 'var(--text-dim)' },
    { v: 'ganado', label: 'Ganado', color: 'var(--accent-green)' },
    { v: 'perdido', label: 'Perdido', color: 'var(--accent-orange)' },
    { v: 'descalificado', label: 'Descalificado', color: 'var(--text-dim)' },
  ];
  return (
    <div className="inline-flex rounded-lg border overflow-hidden flex-wrap" style={{ borderColor: 'var(--card-border)' }}>
      {options.map((opt, i) => {
        const active = value === opt.v;
        return (
          <button
            key={opt.v}
            type="button"
            onClick={() => onChange(opt.v)}
            className="px-4 py-2 text-base font-medium transition-colors"
            style={{
              background: active ? '#1a1a1a' : 'transparent',
              color: active ? opt.color : 'var(--text-dim)',
              borderRight: i < options.length - 1 ? '1px solid var(--card-border)' : 'none',
            }}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// MotivoSugerencias — chips de sugerencia + texto libre (Fase 8)
// ─────────────────────────────────────────────────────────────────────────────
function MotivoSugerencias({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  const sugerencias = ['Precio', 'Timing', 'No calificado', 'Fantasma', 'Otro'];
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {sugerencias.map((s) => {
          const active = value.trim().toLowerCase() === s.toLowerCase();
          return (
            <button
              key={s}
              type="button"
              onClick={() => onChange(s)}
              className="px-3 py-1.5 rounded-full border text-sm transition-colors"
              style={{
                background: active ? '#1a1a1a' : 'transparent',
                borderColor: active ? 'var(--accent-yellow)' : 'var(--card-border)',
                color: active ? 'var(--accent-yellow)' : 'var(--text-dim)',
              }}
            >
              {s}
            </button>
          );
        })}
      </div>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Motivo (texto libre)"
        className="w-full px-3 py-2 rounded border text-lg"
        style={{
          background: '#0a0a0a',
          borderColor: 'var(--card-border)',
          color: 'var(--text)',
        }}
      />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// RespuestasCalendlyCard — read-only, datos del formulario (Fase 2)
// ─────────────────────────────────────────────────────────────────────────────
function RespuestasCalendlyCard({ lead }: { lead: Lead }) {
  const rows: Array<{ label: string; value: string | null }> = [
    { label: 'Facturación / Presupuesto', value: lead.respuesta_facturacion },
    { label: 'Tamaño del equipo',         value: lead.respuesta_colaboradores },
    { label: '¿Qué quiere lograr?',       value: lead.respuesta_objetivo },
    { label: '¿Cuándo quiere empezar?',   value: lead.respuesta_cuando_empezar },
  ];

  const hayAlguna = rows.some((r) => r.value && r.value.trim());

  return (
    <Card title="Respuestas del formulario">
      {!hayAlguna ? (
        <p className="text-base" style={{ color: 'var(--text-pending)' }}>
          Sin respuestas capturadas. Probablemente un lead orgánico, manual, o
          agendado antes de que el form de Calendly tuviera estas preguntas.
        </p>
      ) : (
        <div className="space-y-4">
          {rows.map((r) => (
            <div key={r.label}>
              <div
                className="text-sm uppercase tracking-wider mb-1"
                style={{ color: 'var(--text-dim)' }}
              >
                {r.label}
              </div>
              <div
                className="text-lg"
                style={{ color: r.value ? 'var(--text)' : 'var(--text-pending)' }}
              >
                {r.value && r.value.trim() ? r.value : '—'}
              </div>
            </div>
          ))}
        </div>
      )}
      <p className="text-sm mt-4" style={{ color: 'var(--text-pending)' }}>
        Datos automáticos del webhook de Calendly. Solo lectura.
      </p>
    </Card>
  );
}
