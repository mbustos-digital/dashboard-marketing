'use client';

// =============================================================================
// LeadsBrowser — lista de leads con búsqueda, filtros, orden (Fase 12)
// =============================================================================
// Recibe los leads ya enriquecidos por el server (madurez + origen legible) —
// lib/leads es server-only, así que el cálculo no puede vivir acá. Búsqueda
// client-side instantánea; filtros y orden se sincronizan a la URL para poder
// linkear vistas filtradas desde cualquier parte del dashboard.
// =============================================================================

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import type { Lead, EstadoLead, EstadoMadurez } from '@/lib/leads';

export type EnrichedLead = Lead & {
  _madurez: EstadoMadurez;
  _origen: { texto: string; tooltip: string | null };
  _origenClase: 'instant_form' | 'calendly' | 'otro';
};

export type LeadsParams = {
  q?: string;
  estado?: string;
  madurez?: string;
  origen?: string;
  agendo?: string;
  sort?: string;
  dir?: string;
};

type SortKey = 'creado' | 'j1' | 'estado' | 'monto' | 'nombre' | 'agendo';

const ESTADO_ORDEN: Record<EstadoLead, number> = {
  abierto: 0, ganado: 1, perdido: 2, descalificado: 3,
};

function fmtFechaCorta(yyyy_mm_dd: string | null): string {
  if (!yyyy_mm_dd) return '—';
  const [y, m, d] = yyyy_mm_dd.split('-').map(Number);
  return new Intl.DateTimeFormat('es-MX', { day: 'numeric', month: 'short', year: '2-digit', timeZone: 'UTC' }).format(new Date(Date.UTC(y, m - 1, d)));
}
function fmtCurrency(n: number | null): string {
  if (n === null) return '—';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);
}
function labelMadurez(e: EstadoMadurez): { emoji: string; label: string; color: string } {
  switch (e) {
    case 'madura': return { emoji: '🟢', label: 'Madura', color: 'var(--accent-green)' };
    case 'madurando': return { emoji: '🟡', label: 'Madurando', color: 'var(--accent-yellow)' };
    case 'reciente': return { emoji: '⚪', label: 'Reciente', color: 'var(--text-dim)' };
    case 'sin_j1': return { emoji: '—', label: 'Sin J1', color: 'var(--text-pending)' };
  }
}

export function LeadsBrowser({ leads, initial }: { leads: EnrichedLead[]; initial: LeadsParams }) {
  const router = useRouter();
  const [q, setQ] = useState(initial.q ?? '');
  const estado = initial.estado ?? '';
  const madurez = initial.madurez ?? '';
  const origen = initial.origen ?? '';
  const agendo = initial.agendo ?? '';
  const sort = (initial.sort as SortKey) ?? 'creado';
  const dir = (initial.dir as 'asc' | 'desc') ?? 'desc';

  // Sincroniza un cambio de filtro/orden/búsqueda a la URL (vista linkeable)
  const navegar = (cambios: Partial<LeadsParams>) => {
    const params = new URLSearchParams();
    const merged: LeadsParams = { q, estado, madurez, origen, agendo, sort, dir, ...cambios };
    if (merged.q) params.set('q', merged.q);
    if (merged.estado) params.set('estado', merged.estado);
    if (merged.madurez) params.set('madurez', merged.madurez);
    if (merged.origen) params.set('origen', merged.origen);
    if (merged.agendo) params.set('agendo', merged.agendo);
    if (merged.sort && merged.sort !== 'creado') params.set('sort', merged.sort);
    if (merged.dir && merged.dir !== 'desc') params.set('dir', merged.dir);
    const qs = params.toString();
    router.replace(qs ? `/leads?${qs}` : '/leads', { scroll: false });
  };

  const onSearch = (v: string) => {
    setQ(v);
    navegar({ q: v });
  };

  const toggleSort = (key: SortKey) => {
    if (sort === key) navegar({ sort: key, dir: dir === 'asc' ? 'desc' : 'asc' });
    else navegar({ sort: key, dir: key === 'agendo' || key === 'nombre' ? 'asc' : 'desc' });
  };

  // ── Filtrado + búsqueda + orden (client-side, 110 leads = trivial) ──
  const visibles = useMemo(() => {
    let arr = leads;
    if (estado) arr = arr.filter((l) => l.estado_lead === estado);
    if (madurez) arr = arr.filter((l) => l._madurez === madurez);
    if (origen) arr = arr.filter((l) => l._origenClase === origen);
    if (agendo === 'si') arr = arr.filter((l) => !!l.fecha_agenda);
    if (agendo === 'no') arr = arr.filter((l) => !l.fecha_agenda);
    const term = q.trim().toLowerCase();
    if (term) {
      arr = arr.filter((l) =>
        [l.nombre, l.email, l.empresa, l.telefono]
          .filter(Boolean)
          .some((s) => (s as string).toLowerCase().includes(term)),
      );
    }
    const mult = dir === 'asc' ? 1 : -1;
    const sorted = [...arr].sort((a, b) => {
      switch (sort) {
        case 'nombre':
          return mult * a.nombre.localeCompare(b.nombre, 'es');
        case 'j1':
          return mult * cmpNullable(a.fecha_junta_1, b.fecha_junta_1);
        case 'estado':
          return mult * (ESTADO_ORDEN[a.estado_lead] - ESTADO_ORDEN[b.estado_lead]);
        case 'monto':
          return mult * cmpNum(a.monto_cierre_usd, b.monto_cierre_usd);
        case 'agendo':
          // sin agenda primero (los que hay que perseguir)
          return mult * (toRank(a.fecha_agenda) - toRank(b.fecha_agenda));
        case 'creado':
        default:
          return mult * a.created_at.localeCompare(b.created_at);
      }
    });
    return sorted;
  }, [leads, q, estado, madurez, origen, agendo, sort, dir]);

  const filtroActivo = !!(estado || madurez || origen || agendo || q.trim());

  return (
    <div>
      {/* ── Barra de búsqueda + filtros ── */}
      <div className="mb-4 flex flex-col md:flex-row md:items-center gap-3 flex-wrap">
        <input
          type="search"
          value={q}
          onChange={(e) => onSearch(e.target.value)}
          placeholder="Buscar por nombre, email, empresa o teléfono…"
          className="flex-1 min-w-[220px] px-4 py-2.5 rounded-lg border text-base"
          style={{ background: '#0a0a0a', borderColor: 'var(--card-border)', color: 'var(--text)' }}
        />
        <Select value={estado} onChange={(v) => navegar({ estado: v })} placeholder="Estado"
          options={[['abierto', 'Abierto'], ['ganado', 'Ganado'], ['perdido', 'Perdido'], ['descalificado', 'Descalificado']]} />
        <Select value={madurez} onChange={(v) => navegar({ madurez: v })} placeholder="Madurez"
          options={[['reciente', 'Reciente'], ['madurando', 'Madurando'], ['madura', 'Madura']]} />
        <Select value={origen} onChange={(v) => navegar({ origen: v })} placeholder="Origen"
          options={[['instant_form', 'Instant form'], ['calendly', 'Calendly'], ['otro', 'Otro']]} />
        <Select value={agendo} onChange={(v) => navegar({ agendo: v })} placeholder="¿Agendó?"
          options={[['si', 'Agendó'], ['no', 'Sin agenda']]} />
      </div>

      <div className="mb-3 text-sm" style={{ color: 'var(--text-dim)' }}>
        {visibles.length} {visibles.length === 1 ? 'lead' : 'leads'}
        {filtroActivo && ' (filtrados)'}
        {filtroActivo && (
          <button onClick={() => { setQ(''); router.replace('/leads', { scroll: false }); }} className="ml-3" style={{ color: 'var(--accent-yellow)' }}>
            limpiar filtros
          </button>
        )}
      </div>

      {/* ── Tabla ── */}
      <div className="rounded-xl border overflow-x-auto" style={{ background: 'var(--card-bg)', borderColor: 'var(--card-border)' }}>
        <table className="w-full text-base">
          <thead>
            <tr className="text-sm uppercase tracking-wider text-left" style={{ background: '#0f0f0f', color: 'var(--text-dim)' }}>
              <Th label="Nombre" k="nombre" sort={sort} dir={dir} onSort={toggleSort} />
              <th className="px-4 py-3 hidden md:table-cell">Empresa</th>
              <th className="px-4 py-3 hidden md:table-cell">Origen</th>
              <Th label="¿Agendó?" k="agendo" sort={sort} dir={dir} onSort={toggleSort} />
              <Th label="Fecha J1" k="j1" sort={sort} dir={dir} onSort={toggleSort} />
              <th className="px-4 py-3">Cohorte</th>
              <Th label="Estado / monto" k="monto" sort={sort} dir={dir} onSort={toggleSort} align="right" />
              <Th label="Creado" k="creado" sort={sort} dir={dir} onSort={toggleSort} align="right" className="hidden md:table-cell" />
            </tr>
          </thead>
          <tbody>
            {visibles.map((lead) => {
              const mad = labelMadurez(lead._madurez);
              return (
                <tr key={lead.id} className="border-t hover:bg-[#181818] transition-colors" style={{ borderColor: 'var(--card-border)' }}>
                  <td className="px-4 py-3">
                    <Link href={`/leads/${lead.id}`} className="font-medium" style={{ color: 'var(--accent-yellow)' }}>{lead.nombre}</Link>
                    {lead.email && <div className="text-sm" style={{ color: 'var(--text-dim)' }}>{lead.email}</div>}
                  </td>
                  <td className="px-4 py-3 hidden md:table-cell" style={{ color: 'var(--text-dim)' }}>{lead.empresa ?? '—'}</td>
                  <td className="px-4 py-3 hidden md:table-cell text-sm max-w-[200px] truncate" style={{ color: 'var(--text-dim)' }} title={lead._origen.tooltip ?? undefined}>
                    {lead._origen.texto}
                  </td>
                  <td className="px-4 py-3 text-sm" style={{ color: lead.fecha_agenda ? 'var(--text-dim)' : 'var(--text-pending)' }}>
                    {lead.fecha_agenda ? `📅 ${fmtFechaCorta(lead.fecha_agenda)}` : '—'}
                  </td>
                  <td className="px-4 py-3">{fmtFechaCorta(lead.fecha_junta_1)}</td>
                  <td className="px-4 py-3">
                    <span className="inline-flex items-center gap-2"><span>{mad.emoji}</span><span style={{ color: 'var(--text-dim)' }}>{mad.label}</span></span>
                  </td>
                  <td className="px-4 py-3 text-right"><EstadoChip lead={lead} /></td>
                  <td className="px-4 py-3 text-right hidden md:table-cell text-sm" style={{ color: 'var(--text-dim)' }}>
                    {fmtFechaCorta(lead.created_at.slice(0, 10))}
                  </td>
                </tr>
              );
            })}
            {visibles.length === 0 && (
              <tr><td colSpan={8} className="px-4 py-10 text-center" style={{ color: 'var(--text-dim)' }}>Ningún lead coincide con la búsqueda o filtros.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function cmpNullable(a: string | null, b: string | null): number {
  if (a === b) return 0;
  if (a === null) return 1;   // nulls al final en asc
  if (b === null) return -1;
  return a < b ? -1 : 1;
}
function cmpNum(a: number | null, b: number | null): number {
  return (a ?? -Infinity) - (b ?? -Infinity);
}
function toRank(fecha: string | null): number {
  return fecha ? 1 : 0; // sin agenda (0) primero en asc
}

function Th({ label, k, sort, dir, onSort, align = 'left', className = '' }: {
  label: string; k: SortKey; sort: string; dir: string; onSort: (k: SortKey) => void; align?: 'left' | 'right'; className?: string;
}) {
  const activo = sort === k;
  return (
    <th className={`px-4 py-3 ${align === 'right' ? 'text-right' : ''} ${className}`}>
      <button onClick={() => onSort(k)} className="inline-flex items-center gap-1 uppercase tracking-wider" style={{ color: activo ? 'var(--accent-yellow)' : 'inherit' }}>
        {label}
        <span style={{ opacity: activo ? 1 : 0.3 }}>{activo ? (dir === 'asc' ? '↑' : '↓') : '↕'}</span>
      </button>
    </th>
  );
}

function Select({ value, onChange, placeholder, options }: {
  value: string; onChange: (v: string) => void; placeholder: string; options: Array<[string, string]>;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="px-3 py-2.5 rounded-lg border text-base"
      style={{ background: '#0a0a0a', borderColor: value ? 'var(--accent-yellow)' : 'var(--card-border)', color: value ? 'var(--text)' : 'var(--text-dim)' }}
    >
      <option value="">{placeholder}: todos</option>
      {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
    </select>
  );
}

function EstadoChip({ lead }: { lead: EnrichedLead }) {
  const base = 'inline-block px-2.5 py-1 rounded-full text-sm font-medium whitespace-nowrap';
  switch (lead.estado_lead) {
    case 'ganado':
      return <span className={base} style={{ background: 'rgba(40,167,69,0.12)', color: 'var(--accent-green)' }}>Ganado · {fmtCurrency(lead.monto_cierre_usd)}</span>;
    case 'perdido':
      return <span className={base} style={{ background: 'rgba(255,107,53,0.10)', color: 'var(--accent-orange)' }} title={lead.motivo_perdida ?? undefined}>Perdido</span>;
    case 'descalificado':
      return <span className={base} style={{ background: '#1a1a1a', color: 'var(--text-dim)' }} title={lead.motivo_perdida ?? undefined}>Descalificado</span>;
    default:
      return <span style={{ color: 'var(--text-pending)' }}>—</span>;
  }
}
