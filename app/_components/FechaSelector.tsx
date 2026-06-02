'use client';

// =============================================================================
// FechaSelector — rango Desde/Hasta con presets
// =============================================================================
// Inputs: Desde + Hasta. Cuando ambos están puestos, la página muestra UNA
// ventana única con los datos del rango. Si están vacíos, vuelve a las 3
// ventanas por defecto (Día anterior / Semana / Mes acumulado).
// Estado en URL: ?desde=YYYY-MM-DD&hasta=YYYY-MM-DD (bookmarkeable).
// =============================================================================

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';

type Preset = { label: string; desde: string; hasta: string };

function isoMes(y: number, m: number): { desde: string; hasta: string } {
  const mm = String(m).padStart(2, '0');
  const ultDia = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return {
    desde: `${y}-${mm}-01`,
    hasta: `${y}-${mm}-${String(ultDia).padStart(2, '0')}`,
  };
}

export function FechaSelector({ fechaActualReal }: { fechaActualReal: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const desdeUrl = searchParams.get('desde') ?? '';
  const hastaUrl = searchParams.get('hasta') ?? '';
  const [desde, setDesde] = useState(desdeUrl);
  const [hasta, setHasta] = useState(hastaUrl);

  const filtroActivo = !!(desdeUrl && hastaUrl);

  const aplicar = (d: string, h: string) => {
    setDesde(d);
    setHasta(h);
    const params = new URLSearchParams(searchParams.toString());
    if (d && h) {
      params.set('desde', d);
      params.set('hasta', h);
    } else {
      params.delete('desde');
      params.delete('hasta');
    }
    const qs = params.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
  };

  const limpiar = () => aplicar('', '');

  // Presets dinámicos relativos a hoy real
  const [y, m] = fechaActualReal.split('-').map(Number);
  const mesActual = isoMes(y, m);
  const mesAnterior = m === 1 ? isoMes(y - 1, 12) : isoMes(y, m - 1);
  // 'Mes actual' termina en hoy real (no fin de mes futuro)
  mesActual.hasta = fechaActualReal;

  const presets: Preset[] = [
    { label: 'Mes actual', ...mesActual },
    { label: 'Mes anterior', ...mesAnterior },
  ];
  // Agregar últimos 4 meses como presets adicionales
  for (let i = 2; i <= 5; i++) {
    const my = m - i;
    const yy = my <= 0 ? y - 1 : y;
    const mm = my <= 0 ? my + 12 : my;
    const rango = isoMes(yy, mm);
    const nombre = new Date(Date.UTC(yy, mm - 1, 1)).toLocaleDateString('es-MX', {
      month: 'long',
      year: 'numeric',
      timeZone: 'UTC',
    });
    presets.push({ label: nombre, ...rango });
  }

  return (
    <div
      className="mb-6 rounded-xl border px-5 py-4 space-y-3"
      style={{ background: 'var(--card-bg)', borderColor: 'var(--card-border)' }}
    >
      {/* Row 1: inputs */}
      <div className="flex flex-wrap items-center gap-3">
        <span
          className="text-sm uppercase tracking-widest"
          style={{ color: 'var(--text-dim)' }}
        >
          Filtrar por rango:
        </span>

        <label className="flex items-center gap-2">
          <span className="text-base" style={{ color: 'var(--text-dim)' }}>Desde</span>
          <input
            type="date"
            value={desde}
            max={hasta || fechaActualReal}
            onChange={(e) => {
              const d = e.target.value;
              if (d && hasta) aplicar(d, hasta);
              else setDesde(d);
            }}
            className="px-3 py-2 rounded border text-base"
            style={{
              background: '#0a0a0a',
              borderColor: 'var(--card-border)',
              color: 'var(--text)',
              colorScheme: 'dark',
            }}
          />
        </label>

        <label className="flex items-center gap-2">
          <span className="text-base" style={{ color: 'var(--text-dim)' }}>Hasta</span>
          <input
            type="date"
            value={hasta}
            min={desde || undefined}
            max={fechaActualReal}
            onChange={(e) => {
              const h = e.target.value;
              if (desde && h) aplicar(desde, h);
              else setHasta(h);
            }}
            className="px-3 py-2 rounded border text-base"
            style={{
              background: '#0a0a0a',
              borderColor: 'var(--card-border)',
              color: 'var(--text)',
              colorScheme: 'dark',
            }}
          />
        </label>

        {filtroActivo && (
          <button
            type="button"
            onClick={limpiar}
            className="px-3 py-2 rounded border text-base"
            style={{ borderColor: 'var(--accent-orange)', color: 'var(--accent-orange)' }}
          >
            ✕ Limpiar
          </button>
        )}

        <span
          className="text-base ml-auto"
          style={{ color: filtroActivo ? 'var(--accent-yellow)' : 'var(--text-pending)' }}
        >
          {filtroActivo
            ? `📅 ${desdeUrl} → ${hastaUrl}`
            : 'Sin filtro · vista por defecto'}
        </span>
      </div>

      {/* Row 2: presets */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm" style={{ color: 'var(--text-pending)' }}>
          Atajos:
        </span>
        {presets.map((p) => {
          const activo = desdeUrl === p.desde && hastaUrl === p.hasta;
          return (
            <button
              key={p.label}
              type="button"
              onClick={() => aplicar(p.desde, p.hasta)}
              className="px-3 py-1.5 rounded border text-base capitalize"
              style={{
                borderColor: activo ? 'var(--accent-yellow)' : 'var(--card-border)',
                color: activo ? 'var(--accent-yellow)' : 'var(--text-dim)',
                background: activo ? '#1a1a1a' : 'transparent',
              }}
            >
              {p.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
