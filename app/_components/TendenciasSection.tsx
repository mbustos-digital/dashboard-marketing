'use client';

// =============================================================================
// TendenciasSection — mini-series de marketing + comercial (Fase 16)
// =============================================================================
// Dos grillas de gráficos de línea (Recharts, área con relleno degradado),
// un único toggle Semanal (12 sem) / Mensual (6 meses). Cada mini-gráfico:
// título + último valor + variación vs período anterior + línea; click expande
// a ancho completo. Reemplaza el chart de CAC mensual de una sola barra.
// =============================================================================

import { useState } from 'react';
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip } from 'recharts';
import type { Tendencias, SerieMetrica, FormatoSerie } from '@/lib/queries';

function fmt(v: number | null | undefined, f: FormatoSerie): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  if (f === 'usd') return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(v);
  if (f === 'pct') return `${v < 10 ? v.toFixed(1) : v.toFixed(0)}%`;
  return new Intl.NumberFormat('es-MX').format(Math.round(v));
}

export function TendenciasSection({ semanal, mensual }: { semanal: Tendencias; mensual: Tendencias }) {
  const [gran, setGran] = useState<'semanal' | 'mensual'>('semanal');
  const [expand, setExpand] = useState<string | null>(null);
  const data = gran === 'semanal' ? semanal : mensual;

  return (
    <section className="rounded-xl border p-6 md:p-8" style={{ background: 'var(--card-bg)', borderColor: 'var(--card-border)' }}>
      <div className="flex items-center justify-between gap-3 flex-wrap mb-1">
        <h2 className="text-[28px]" style={{ fontFamily: 'var(--font-cormorant)', fontWeight: 500 }}>Tendencias</h2>
        <div className="inline-flex rounded-lg border overflow-hidden" style={{ borderColor: 'var(--card-border)' }}>
          {(['semanal', 'mensual'] as const).map((g) => (
            <button
              key={g}
              type="button"
              onClick={() => setGran(g)}
              className="px-4 py-2 text-base font-medium"
              style={{ background: gran === g ? '#1a1a1a' : 'transparent', color: gran === g ? 'var(--accent-yellow)' : 'var(--text-dim)' }}
            >
              {g === 'semanal' ? '12 semanas' : '6 meses'}
            </button>
          ))}
        </div>
      </div>
      <p className="text-base mb-5" style={{ color: 'var(--text-dim)' }}>
        Tocá un gráfico para ampliarlo. Cada serie en su propia escala — no se mezclan métricas distintas en un eje.
      </p>

      <Grilla titulo="Marketing" series={data.marketing} periodos={data.periodos} expand={expand} setExpand={setExpand} />
      <div className="h-6" />
      <Grilla titulo="Comercial" series={data.comercial} periodos={data.periodos} expand={expand} setExpand={setExpand} />
    </section>
  );
}

function Grilla({
  titulo, series, periodos, expand, setExpand,
}: {
  titulo: string; series: SerieMetrica[]; periodos: string[]; expand: string | null; setExpand: (k: string | null) => void;
}) {
  return (
    <div>
      <h3 className="text-sm uppercase tracking-wider mb-3" style={{ color: 'var(--text-dim)' }}>{titulo}</h3>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {series.map((s) => (
          <MiniChart
            key={s.key}
            serie={s}
            periodos={periodos}
            expandido={expand === s.key}
            onClick={() => setExpand(expand === s.key ? null : s.key)}
          />
        ))}
      </div>
    </div>
  );
}

function MiniChart({ serie, periodos, expandido, onClick }: { serie: SerieMetrica; periodos: string[]; expandido: boolean; onClick: () => void }) {
  const datos = periodos.map((p, i) => ({ x: p, y: serie.valores[i] }));
  const noNulos = serie.valores.filter((v): v is number => v !== null);
  const ultimo = noNulos.length > 0 ? noNulos[noNulos.length - 1] : null;
  const previo = noNulos.length > 1 ? noNulos[noNulos.length - 2] : null;
  let variacion: number | null = null;
  if (ultimo !== null && previo !== null && previo !== 0) variacion = ((ultimo - previo) / previo) * 100;
  const gid = `grad-${serie.key}`;

  return (
    <button
      type="button"
      onClick={onClick}
      className={`text-left rounded-lg border p-4 ${expandido ? 'sm:col-span-2 lg:col-span-3' : ''}`}
      style={{ background: '#0f0f0f', borderColor: expandido ? 'var(--accent-yellow)' : 'var(--card-border)' }}
    >
      <div className="flex items-end justify-between gap-2 mb-2">
        <div>
          <div className="text-sm uppercase tracking-wider" style={{ color: 'var(--text-dim)' }}>{serie.label}</div>
          <div className="text-[24px] leading-none tabular-nums mt-1" style={{ fontFamily: 'var(--font-cormorant)', fontWeight: 500 }}>
            {fmt(ultimo, serie.formato)}
          </div>
        </div>
        {variacion !== null && (
          <span className="text-sm tabular-nums" style={{ color: variacion >= 0 ? 'var(--accent-green)' : 'var(--accent-orange)' }}>
            {variacion >= 0 ? '▲' : '▼'} {Math.abs(variacion).toFixed(0)}%
          </span>
        )}
      </div>
      <div style={{ width: '100%', height: expandido ? 260 : 90 }}>
        <ResponsiveContainer>
          <AreaChart data={datos} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
            <defs>
              <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--accent-yellow)" stopOpacity={0.35} />
                <stop offset="100%" stopColor="var(--accent-yellow)" stopOpacity={0} />
              </linearGradient>
            </defs>
            <XAxis dataKey="x" hide={!expandido} tick={{ fill: 'var(--text-dim)', fontSize: 11 }} interval="preserveStartEnd" />
            <YAxis hide={!expandido} tick={{ fill: 'var(--text-dim)', fontSize: 11 }} width={44} />
            <Tooltip
              contentStyle={{ background: '#0a0a0a', border: '1px solid var(--card-border)', borderRadius: 8, fontSize: 13 }}
              labelStyle={{ color: 'var(--text-dim)' }}
              formatter={(value) => [fmt(typeof value === 'number' ? value : null, serie.formato), serie.label] as [string, string]}
            />
            <Area type="monotone" dataKey="y" stroke="var(--accent-yellow)" strokeWidth={2} fill={`url(#${gid})`} connectNulls={false} dot={false} isAnimationActive={false} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </button>
  );
}
