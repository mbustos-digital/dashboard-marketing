// =============================================================================
// SourceStrip — chips compactos del estado de las fuentes (Fase 7 v2)
// =============================================================================
// Una línea discreta arriba de los tabs. Solo llama la atención si algo está
// off. Cada chip: puntito de color + label, con el detalle de última sync en
// el title (tooltip nativo).
// =============================================================================

import type { DataSource } from '@/lib/sources';

function colorDe(status: DataSource['status']): string {
  switch (status) {
    case 'ok': return 'var(--accent-green)';
    case 'stale': return 'var(--text-pending)';
    case 'off': return 'var(--accent-orange)';
  }
}

export function SourceStrip({ sources }: { sources: DataSource[] }) {
  const hayProblema = sources.some((s) => s.status === 'off');

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 mb-5 text-sm">
      <span className="uppercase tracking-widest" style={{ color: 'var(--text-pending)' }}>
        Fuentes
      </span>
      {sources.map((s) => (
        <span
          key={s.key}
          className="inline-flex items-center gap-1.5"
          title={`${s.label} — ${s.detalle}`}
          style={{ color: s.status === 'off' ? 'var(--accent-orange)' : 'var(--text-dim)' }}
        >
          <span
            className="inline-block rounded-full"
            style={{ width: 7, height: 7, background: colorDe(s.status) }}
          />
          {s.label}
        </span>
      ))}
      {hayProblema && (
        <span className="text-sm" style={{ color: 'var(--accent-orange)' }}>
          · una fuente está desconectada
        </span>
      )}
    </div>
  );
}
