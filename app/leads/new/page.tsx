// =============================================================================
// /leads/new — form de creación de lead
// =============================================================================
// Mínimo: nombre. Opcional: contacto + fechas iniciales.
// =============================================================================

import Link from 'next/link';
import { createLeadAction } from '../actions';

export const dynamic = 'force-dynamic';

export default function NewLeadPage() {
  return (
    <main className="min-h-screen w-full px-6 py-8 md:px-12 md:py-12 bg-[var(--bg)] text-[var(--text)]">
      <header className="mb-8">
        <Link href="/leads" className="text-base" style={{ color: 'var(--text-dim)' }}>
          ← Leads
        </Link>
        <h1
          className="text-[46px] md:text-[62px] tracking-tight leading-tight mt-2"
          style={{ fontFamily: 'var(--font-cormorant)', fontWeight: 500 }}
        >
          Nuevo lead
        </h1>
        <p className="mt-1 text-base" style={{ color: 'var(--text-dim)' }}>
          Captura inicial. Los datos comerciales (J1, calificado, cierre) se llenan después.
        </p>
      </header>

      <form
        action={createLeadAction}
        className="max-w-2xl rounded-xl border p-6 md:p-8 space-y-5"
        style={{ background: 'var(--card-bg)', borderColor: 'var(--card-border)' }}
      >
        {/* Nombre — único requerido */}
        <Field label="Nombre" required>
          <input
            type="text"
            name="nombre"
            required
            autoFocus
            className="w-full px-3 py-2 rounded border text-lg"
            style={{
              background: '#0a0a0a',
              borderColor: 'var(--card-border)',
              color: 'var(--text)',
            }}
          />
        </Field>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          <Field label="Email">
            <input
              type="email"
              name="email"
              className="w-full px-3 py-2 rounded border text-lg"
              style={{
                background: '#0a0a0a',
                borderColor: 'var(--card-border)',
                color: 'var(--text)',
              }}
            />
          </Field>
          <Field label="Teléfono">
            <input
              type="tel"
              name="telefono"
              className="w-full px-3 py-2 rounded border text-lg"
              style={{
                background: '#0a0a0a',
                borderColor: 'var(--card-border)',
                color: 'var(--text)',
              }}
            />
          </Field>
        </div>

        <Field label="Empresa">
          <input
            type="text"
            name="empresa"
            className="w-full px-3 py-2 rounded border text-lg"
            style={{
              background: '#0a0a0a',
              borderColor: 'var(--card-border)',
              color: 'var(--text)',
            }}
          />
        </Field>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          <Field label="Fecha de agendamiento (Calendly)">
            <input
              type="date"
              name="fecha_agenda"
              className="w-full px-3 py-2 rounded border text-lg"
              style={{
                background: '#0a0a0a',
                borderColor: 'var(--card-border)',
                color: 'var(--text)',
              }}
            />
          </Field>
          <Field label="Fecha de Junta 1 (si ya la tienes)">
            <input
              type="date"
              name="fecha_junta_1"
              className="w-full px-3 py-2 rounded border text-lg"
              style={{
                background: '#0a0a0a',
                borderColor: 'var(--card-border)',
                color: 'var(--text)',
              }}
            />
          </Field>
        </div>

        <div className="pt-3 flex items-center gap-3 justify-end">
          <Link
            href="/leads"
            className="px-4 py-2 text-base"
            style={{ color: 'var(--text-dim)' }}
          >
            Cancelar
          </Link>
          <button
            type="submit"
            className="px-5 py-3 rounded-lg font-medium text-base"
            style={{ background: 'var(--accent-yellow)', color: '#000' }}
          >
            Crear lead
          </button>
        </div>
      </form>
    </main>
  );
}

function Field({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="block text-base mb-1.5" style={{ color: 'var(--text-dim)' }}>
        {label}
        {required && (
          <span className="ml-1" style={{ color: 'var(--accent-orange)' }}>
            *
          </span>
        )}
      </span>
      {children}
    </label>
  );
}
