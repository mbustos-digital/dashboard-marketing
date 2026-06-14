// =============================================================================
// /leads — lista de todos los leads
// =============================================================================

import Link from 'next/link';
import { listLeads, estadoMadurezLead, labelMadurez, type Lead } from '@/lib/leads';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

function fmtFechaCorta(yyyy_mm_dd: string | null): string {
  if (!yyyy_mm_dd) return '—';
  const [y, m, d] = yyyy_mm_dd.split('-').map(Number);
  const fecha = new Date(Date.UTC(y, m - 1, d));
  return new Intl.DateTimeFormat('es-MX', {
    day: 'numeric',
    month: 'short',
    year: '2-digit',
    timeZone: 'UTC',
  }).format(fecha);
}

function fmtCurrency(n: number | null): string {
  if (n === null) return '—';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(n);
}

export default async function LeadsPage() {
  let leads: Awaited<ReturnType<typeof listLeads>> = [];
  let errorMsg: string | null = null;
  try {
    leads = await listLeads();
  } catch (err) {
    errorMsg = err instanceof Error ? err.message : String(err);
  }

  return (
    <main className="min-h-screen w-full px-6 py-8 md:px-12 md:py-12 bg-[var(--bg)] text-[var(--text)]">
      {/* HEADER */}
      <header className="mb-8 flex items-end justify-between gap-4 flex-wrap">
        <div>
          <div className="flex items-center gap-3 mb-2">
            <Link
              href="/"
              className="text-base"
              style={{ color: 'var(--text-dim)' }}
            >
              ← Dashboard
            </Link>
          </div>
          <h1
            className="text-[46px] md:text-[62px] tracking-tight leading-tight"
            style={{ fontFamily: 'var(--font-cormorant)', fontWeight: 500 }}
          >
            Leads
          </h1>
          <p className="mt-1 text-base" style={{ color: 'var(--text-dim)' }}>
            {leads.length === 0
              ? 'Aún sin leads. Crea el primero para empezar.'
              : `${leads.length} ${leads.length === 1 ? 'lead' : 'leads'} en total`}
          </p>
        </div>
        <Link
          href="/leads/new"
          className="px-5 py-3 rounded-lg font-medium text-base"
          style={{ background: 'var(--accent-yellow)', color: '#000' }}
        >
          + Nuevo lead
        </Link>
      </header>

      {errorMsg ? (
        <div
          className="rounded-lg p-6 border"
          style={{ borderColor: 'var(--accent-orange)', background: '#2a1410' }}
        >
          <p className="font-semibold mb-1" style={{ color: 'var(--accent-orange)' }}>
            Error consultando Supabase
          </p>
          <p className="text-base font-mono" style={{ color: 'var(--text-dim)' }}>
            {errorMsg}
          </p>
        </div>
      ) : leads.length === 0 ? (
        <div
          className="rounded-xl border p-12 text-center"
          style={{ background: 'var(--card-bg)', borderColor: 'var(--card-border)' }}
        >
          <p className="text-lg mb-4" style={{ color: 'var(--text-dim)' }}>
            No tienes leads todavía.
          </p>
          <Link
            href="/leads/new"
            className="inline-block px-5 py-3 rounded-lg font-medium text-base"
            style={{ background: 'var(--accent-yellow)', color: '#000' }}
          >
            Crear primer lead
          </Link>
        </div>
      ) : (
        <div
          className="rounded-xl border overflow-hidden"
          style={{ background: 'var(--card-bg)', borderColor: 'var(--card-border)' }}
        >
          <table className="w-full text-base">
            <thead>
              <tr
                className="text-sm uppercase tracking-wider text-left"
                style={{ background: '#0f0f0f', color: 'var(--text-dim)' }}
              >
                <th className="px-4 py-3">Nombre</th>
                <th className="px-4 py-3 hidden md:table-cell">Empresa</th>
                <th className="px-4 py-3 hidden md:table-cell">Origen</th>
                <th className="px-4 py-3">Fecha J1</th>
                <th className="px-4 py-3">Cohorte</th>
                <th className="px-4 py-3 text-right">Estado</th>
                <th className="px-4 py-3 text-right hidden md:table-cell">Creado</th>
              </tr>
            </thead>
            <tbody>
              {leads.map((lead) => {
                const estado = estadoMadurezLead(lead);
                const { emoji, label } = labelMadurez(estado);
                return (
                  <tr
                    key={lead.id}
                    className="border-t hover:bg-[#181818] transition-colors"
                    style={{ borderColor: 'var(--card-border)' }}
                  >
                    <td className="px-4 py-3">
                      <Link
                        href={`/leads/${lead.id}`}
                        className="font-medium"
                        style={{ color: 'var(--accent-yellow)' }}
                      >
                        {lead.nombre}
                      </Link>
                      {lead.email && (
                        <div className="text-sm" style={{ color: 'var(--text-dim)' }}>
                          {lead.email}
                        </div>
                      )}
                    </td>
                    <td
                      className="px-4 py-3 hidden md:table-cell"
                      style={{ color: 'var(--text-dim)' }}
                    >
                      {lead.empresa ?? '—'}
                    </td>
                    <td
                      className="px-4 py-3 hidden md:table-cell text-sm max-w-[180px] truncate"
                      style={{ color: 'var(--text-dim)' }}
                      title={lead.meta_campaign_name ?? lead.utm_campaign ?? undefined}
                    >
                      {lead.meta_campaign_name ?? lead.utm_campaign ?? '—'}
                    </td>
                    <td className="px-4 py-3">
                      {fmtFechaCorta(lead.fecha_junta_1)}
                    </td>
                    <td className="px-4 py-3">
                      <span className="inline-flex items-center gap-2">
                        <span>{emoji}</span>
                        <span style={{ color: 'var(--text-dim)' }}>{label}</span>
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <EstadoChip lead={lead} />
                    </td>
                    <td
                      className="px-4 py-3 text-right hidden md:table-cell text-sm"
                      style={{ color: 'var(--text-dim)' }}
                    >
                      {fmtFechaCorta(lead.created_at.slice(0, 10))}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// EstadoChip — chip de desenlace del lead (Fase 8)
//   ganado: verde + monto · perdido: rojo tenue · descalificado: gris · abierto: —
// ─────────────────────────────────────────────────────────────────────────────
function EstadoChip({ lead }: { lead: Lead }) {
  const base =
    'inline-block px-2.5 py-1 rounded-full text-sm font-medium whitespace-nowrap';
  switch (lead.estado_lead) {
    case 'ganado':
      return (
        <span
          className={base}
          style={{ background: 'rgba(40,167,69,0.12)', color: 'var(--accent-green)' }}
        >
          Ganado · {fmtCurrency(lead.monto_cierre_usd)}
        </span>
      );
    case 'perdido':
      return (
        <span
          className={base}
          style={{ background: 'rgba(255,107,53,0.10)', color: 'var(--accent-orange)' }}
          title={lead.motivo_perdida ?? undefined}
        >
          Perdido
        </span>
      );
    case 'descalificado':
      return (
        <span
          className={base}
          style={{ background: '#1a1a1a', color: 'var(--text-dim)' }}
          title={lead.motivo_perdida ?? undefined}
        >
          Descalificado
        </span>
      );
    default:
      return <span style={{ color: 'var(--text-pending)' }}>—</span>;
  }
}
