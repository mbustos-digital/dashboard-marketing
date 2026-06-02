'use client';

// =============================================================================
// FechaSelector — selector "como si fuera hoy"
// =============================================================================
// El usuario pone una fecha y las 3 ventanas (Día/Semana/Mes) se recalculan
// como si ese fuera el día actual. Por defecto = hoy real.
// Estado se mantiene en la URL (?fecha=YYYY-MM-DD) para que sea bookmarkeable.
// =============================================================================

import { useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';

export function FechaSelector({ fechaActualReal }: { fechaActualReal: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const fechaEnUrl = searchParams.get('fecha') ?? fechaActualReal;
  const [fecha, setFecha] = useState(fechaEnUrl);

  const esActual = fecha === fechaActualReal;

  const aplicar = (nuevaFecha: string) => {
    setFecha(nuevaFecha);
    const params = new URLSearchParams(searchParams.toString());
    if (nuevaFecha === fechaActualReal) {
      params.delete('fecha');
    } else {
      params.set('fecha', nuevaFecha);
    }
    const qs = params.toString();
    router.push(qs ? `/?${qs}` : '/');
  };

  return (
    <div
      className="mb-6 rounded-xl border px-5 py-4 flex flex-wrap items-center gap-4"
      style={{ background: 'var(--card-bg)', borderColor: 'var(--card-border)' }}
    >
      <span
        className="text-sm uppercase tracking-widest"
        style={{ color: 'var(--text-dim)' }}
      >
        Ver datos hasta el día:
      </span>

      <input
        type="date"
        value={fecha}
        max={fechaActualReal}
        onChange={(e) => aplicar(e.target.value)}
        className="px-3 py-2 rounded border text-base"
        style={{
          background: '#0a0a0a',
          borderColor: 'var(--card-border)',
          color: 'var(--text)',
          colorScheme: 'dark',
        }}
      />

      {!esActual && (
        <button
          type="button"
          onClick={() => aplicar(fechaActualReal)}
          className="text-base underline"
          style={{ color: 'var(--accent-yellow)' }}
        >
          ← Volver al día más reciente
        </button>
      )}

      <span
        className="text-base ml-auto"
        style={{ color: esActual ? 'var(--text-pending)' : 'var(--accent-yellow)' }}
      >
        {esActual
          ? `Mostrando datos hasta ${fechaActualReal}`
          : `📅 Vista histórica · hasta ${fecha}`}
      </span>
    </div>
  );
}
