// =============================================================================
// DashboardHeader — header compartido de las 3 tabs del dashboard
// =============================================================================

import Link from 'next/link';
import { getDataSources } from '@/lib/sources';
import { SourceStrip } from './SourceStrip';

function fmtFechaCorta(yyyy_mm_dd: string): string {
  const [y, m, d] = yyyy_mm_dd.split('-').map(Number);
  const fecha = new Date(Date.UTC(y, m - 1, d));
  return new Intl.DateTimeFormat('es-MX', {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  }).format(fecha);
}

export async function DashboardHeader({ fechaAyer }: { fechaAyer: string }) {
  let sources: Awaited<ReturnType<typeof getDataSources>> = [];
  try {
    sources = await getDataSources();
  } catch {
    // si falla el chequeo de fuentes, no rompemos el header
  }

  return (
    <>
      <header className="mb-5 flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1
            className="text-[46px] md:text-[62px] tracking-tight leading-tight"
            style={{ fontFamily: 'var(--font-cormorant)', fontWeight: 500 }}
          >
            Dashboard Marketing
          </h1>
          <p className="mt-1 text-lg" style={{ color: 'var(--text-dim)' }}>
            Mauricio Bustos · Datos actualizados a {fmtFechaCorta(fechaAyer)}
          </p>
        </div>
        <Link
          href="/leads"
          className="px-5 py-3 rounded-lg font-medium text-lg border"
          style={{
            background: 'transparent',
            borderColor: 'var(--accent-yellow)',
            color: 'var(--accent-yellow)',
          }}
        >
          Leads →
        </Link>
      </header>
      {sources.length > 0 && <SourceStrip sources={sources} />}
    </>
  );
}
