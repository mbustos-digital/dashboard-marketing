// =============================================================================
// /leads/[id] — vista detalle + edición de lead
// =============================================================================

import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  getLead,
  estadoMadurezLead,
  labelMadurez,
  textoCohorteJ1,
  contarVslPlays,
  type Lead,
} from '@/lib/leads';
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

  // Comportamiento VSL (Fase 7): cuántas veces vio el video este lead
  const vslPlays = await contarVslPlays(lead.visitor_id);

  const estado = estadoMadurezLead(lead);
  const { emoji, label, color } = labelMadurez(estado);

  // Texto informativo de la cohorte. J1 futura → "faltan X días para J1"
  // (nunca "−X días desde J1"). Fase 8.
  const textoJ1 = textoCohorteJ1(lead.fecha_junta_1);

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
            {textoJ1 && (
              <div className="text-sm mt-1" style={{ color: 'var(--text-dim)' }}>
                {textoJ1}
              </div>
            )}
          </div>
        </div>
      </header>

      {/* ORIGEN Y COMPORTAMIENTO (read-only, Fase 7) */}
      <div className="mb-6">
        <OrigenCard lead={lead} vslPlays={vslPlays} />
      </div>

      {/* FORM */}
      <EditLeadForm lead={lead} />
    </main>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// OrigenCard — de dónde vino el lead y si vio el VSL (Fase 7)
// ─────────────────────────────────────────────────────────────────────────────

function labelOrigen(origen: string | null): { texto: string; color: string } {
  switch (origen) {
    case 'instant_form':
      return { texto: '📋 Instant Form (Meta)', color: 'var(--accent-yellow)' };
    case 'calendly':
      return { texto: '📅 Calendly', color: 'var(--accent-green)' };
    default:
      return { texto: 'Orgánico / manual', color: 'var(--text-dim)' };
  }
}

function OrigenCard({ lead, vslPlays }: { lead: Lead; vslPlays: number }) {
  const tieneAtribucion =
    lead.origen_lead ||
    lead.meta_campaign_name ||
    lead.meta_adset_name ||
    lead.meta_ad_name ||
    lead.utm_campaign ||
    lead.utm_source;
  const tieneComportamiento = lead.visitor_id !== null;

  // Señal clave: agendó sin ver el VSL (se saltó el filtro)
  const agendoSinVerVsl =
    lead.fecha_agenda !== null && tieneComportamiento && vslPlays === 0;

  if (!tieneAtribucion && !tieneComportamiento) {
    return (
      <section
        className="rounded-xl border p-6 md:p-8"
        style={{ background: 'var(--card-bg)', borderColor: 'var(--card-border)' }}
      >
        <h2
          className="text-[28px] mb-2"
          style={{ fontFamily: 'var(--font-cormorant)', fontWeight: 500 }}
        >
          Origen del lead
        </h2>
        <p className="text-base" style={{ color: 'var(--text-pending)' }}>
          Sin datos de origen. Lead anterior al tracking, manual, o llegó sin
          UTMs ni instant form.
        </p>
      </section>
    );
  }

  const origen = labelOrigen(lead.origen_lead);

  const filas: Array<{ label: string; value: string | null }> = [
    { label: 'Campaña (Meta)', value: lead.meta_campaign_name },
    { label: 'Adset (Meta)', value: lead.meta_adset_name },
    { label: 'Anuncio (Meta)', value: lead.meta_ad_name },
    { label: 'UTM campaign', value: lead.utm_campaign },
    { label: 'UTM source', value: lead.utm_source },
  ].filter((f) => f.value);

  return (
    <section
      className="rounded-xl border p-6 md:p-8"
      style={{ background: 'var(--card-bg)', borderColor: 'var(--card-border)' }}
    >
      <h2
        className="text-[28px] mb-4"
        style={{ fontFamily: 'var(--font-cormorant)', fontWeight: 500 }}
      >
        Origen del lead
      </h2>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* ATRIBUCIÓN */}
        <div>
          <div
            className="text-sm uppercase tracking-wider mb-2"
            style={{ color: 'var(--text-dim)' }}
          >
            Atribución
          </div>
          <div className="text-lg mb-3" style={{ color: origen.color, fontWeight: 600 }}>
            {origen.texto}
          </div>
          {filas.length > 0 ? (
            <div className="space-y-2">
              {filas.map((f) => (
                <div key={f.label} className="text-base">
                  <span style={{ color: 'var(--text-dim)' }}>{f.label}: </span>
                  <span style={{ color: 'var(--text)' }}>{f.value}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-base" style={{ color: 'var(--text-pending)' }}>
              Sin campaña ni UTMs registrados.
            </p>
          )}
        </div>

        {/* COMPORTAMIENTO */}
        <div>
          <div
            className="text-sm uppercase tracking-wider mb-2"
            style={{ color: 'var(--text-dim)' }}
          >
            Comportamiento
          </div>
          {tieneComportamiento ? (
            <>
              <div className="text-lg mb-2">
                <span style={{ color: 'var(--text-dim)' }}>Vio el VSL: </span>
                <span
                  style={{
                    color: vslPlays > 0 ? 'var(--accent-green)' : 'var(--accent-orange)',
                    fontWeight: 600,
                  }}
                >
                  {vslPlays > 0
                    ? `Sí — ${vslPlays} ${vslPlays === 1 ? 'vez' : 'veces'}`
                    : 'No'}
                </span>
              </div>
              {agendoSinVerVsl && (
                <div
                  className="rounded-lg px-4 py-3 text-base mt-3"
                  style={{
                    background: '#2a1410',
                    color: 'var(--accent-orange)',
                    border: '1px solid var(--accent-orange)',
                  }}
                >
                  ⚠️ Agendó SIN ver el VSL — se saltó el filtro. Probablemente
                  llegue a J1 con menos contexto: dedica 5 min extra a explicar
                  el modelo antes de calificar.
                </div>
              )}
            </>
          ) : (
            <p className="text-base" style={{ color: 'var(--text-pending)' }}>
              Sin tracking de visitante (agendó antes del tracking del VSL, o
              llegó por instant form sin pasar por la landing).
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
