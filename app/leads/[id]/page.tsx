// =============================================================================
// /leads/[id] — vista detalle + edición de lead
// =============================================================================

import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getLead, estadoMadurezLead, labelMadurez } from '@/lib/leads';
import { EditLeadForm } from './EditLeadForm';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

function fmtFechaLarga(yyyy_mm_dd: string | null): string {
  if (!yyyy_mm_dd) return '—';
  const [y, m, d] = yyyy_mm_dd.split('-').map(Number);
  const fecha = new Date(Date.UTC(y, m - 1, d));
  return new Intl.DateTimeFormat('es-MX', {
    weekday: 'short',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(fecha);
}

export default async function LeadDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: idStr } = await params;
  const idNum = Number(idStr);
  if (!Number.isFinite(idNum)) notFound();

  const lead = await getLead(idNum);
  if (!lead) notFound();

  const estado = estadoMadurezLead(lead);
  const { emoji, label, color } = labelMadurez(estado);

  // Cálculo informativo: días desde J1
  let diasDesdeJ1: number | null = null;
  if (lead.fecha_junta_1) {
    const [y, m, d] = lead.fecha_junta_1.split('-').map(Number);
    const fechaJ1 = new Date(Date.UTC(y, m - 1, d));
    const hoy = new Date();
    const hoyUTC = new Date(Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth(), hoy.getUTCDate()));
    diasDesdeJ1 = Math.floor((hoyUTC.getTime() - fechaJ1.getTime()) / (1000 * 60 * 60 * 24));
  }

  return (
    <main className="min-h-screen w-full px-6 py-8 md:px-12 md:py-12 bg-[var(--bg)] text-[var(--text)]">
      {/* HEADER */}
      <header className="mb-8">
        <Link href="/leads" className="text-base" style={{ color: 'var(--text-dim)' }}>
          ← Leads
        </Link>
        <div className="mt-2 flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1
              className="text-[46px] md:text-[62px] tracking-tight leading-tight"
              style={{ fontFamily: 'var(--font-cormorant)', fontWeight: 500 }}
            >
              {lead.nombre}
            </h1>
            <p className="mt-1 text-base" style={{ color: 'var(--text-dim)' }}>
              {lead.empresa ?? 'Sin empresa'} · Lead #{lead.id} · Creado{' '}
              {fmtFechaLarga(lead.created_at.slice(0, 10))}
            </p>
          </div>

          {/* Badge cohorte */}
          <div
            className="rounded-lg px-4 py-3 border"
            style={{ background: 'var(--card-bg)', borderColor: 'var(--card-border)' }}
          >
            <div className="text-sm uppercase tracking-widest" style={{ color: 'var(--text-dim)' }}>
              Cohorte
            </div>
            <div className="text-2xl mt-1 flex items-center gap-2">
              <span>{emoji}</span>
              <span style={{ color, fontWeight: 600 }}>{label}</span>
            </div>
            {diasDesdeJ1 !== null && (
              <div className="text-sm mt-1" style={{ color: 'var(--text-dim)' }}>
                {diasDesdeJ1} {diasDesdeJ1 === 1 ? 'día' : 'días'} desde J1
              </div>
            )}
          </div>
        </div>
      </header>

      {/* FORM */}
      <EditLeadForm lead={lead} />
    </main>
  );
}
