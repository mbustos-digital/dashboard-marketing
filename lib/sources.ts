// =============================================================================
// Estados de las fuentes de datos (Implementación v2, Fase 7)
// =============================================================================
// Distingue tres estados que antes se confundían:
//   ok    — fuente conectada y fresca
//   stale — conectada pero sin datos recientes (puede ser normal)
//   off   — desconectada / nunca tuvo datos → el dato NO es 0, NO existe
//
// Las guardias de alertas usan estos estados: una etapa con fuente off no
// muestra 0% ni dispara cuello de botella — muestra "fuente pendiente".
// =============================================================================

import { getSupabaseServer } from './supabase';

export type SourceStatus = 'ok' | 'stale' | 'off';

export type DataSource = {
  key: string;
  label: string;
  status: SourceStatus;
  lastSync: string | null;   // YYYY-MM-DD o ISO
  detalle: string;
};

function diasDesde(fecha: string | null): number | null {
  if (!fecha) return null;
  const d = new Date(fecha + (fecha.length === 10 ? 'T00:00:00Z' : ''));
  if (Number.isNaN(d.getTime())) return null;
  return Math.floor((Date.now() - d.getTime()) / 86400_000);
}

export async function getDataSources(): Promise<DataSource[]> {
  const supabase = getSupabaseServer();

  const [metaRes, pandaRes, beaconRes, metaLeadRes, calendlyRes] = await Promise.all([
    supabase
      .from('marketing_metrics_daily')
      .select('fecha')
      .eq('plataforma', 'meta')
      .order('fecha', { ascending: false })
      .limit(1),
    supabase
      .from('marketing_metrics_daily')
      .select('fecha')
      .eq('plataforma', 'panda')
      .order('fecha', { ascending: false })
      .limit(1),
    supabase
      .from('vsl_events')
      .select('created_at')
      .order('created_at', { ascending: false })
      .limit(1),
    supabase
      .from('leads')
      .select('created_at')
      .not('meta_lead_id', 'is', null)
      .order('created_at', { ascending: false })
      .limit(1),
    supabase
      .from('leads')
      .select('created_at')
      .not('fecha_agenda', 'is', null)
      .order('created_at', { ascending: false })
      .limit(1),
  ]);

  const sources: DataSource[] = [];

  // meta_insights: ok <=2d, stale <=7d, off si más viejo o vacío
  {
    const fecha = metaRes.data?.[0]?.fecha ?? null;
    const d = diasDesde(fecha);
    const status: SourceStatus = d === null ? 'off' : d <= 2 ? 'ok' : d <= 7 ? 'stale' : 'off';
    sources.push({
      key: 'meta_insights',
      label: 'Meta Ads',
      status,
      lastSync: fecha,
      detalle: fecha ? `Último día con datos: ${fecha}` : 'Sin datos de Meta',
    });
  }

  // meta_leads: ok si hubo algún lead de instant form en 30d; off si nunca
  {
    const fecha = metaLeadRes.data?.[0]?.created_at ?? null;
    const d = diasDesde(fecha ? fecha.slice(0, 10) : null);
    const status: SourceStatus = d === null ? 'off' : d <= 30 ? 'ok' : 'stale';
    sources.push({
      key: 'meta_leads',
      label: 'Leads Meta',
      status,
      lastSync: fecha,
      detalle: fecha ? `Último lead de instant form hace ${d}d` : 'Nunca llegó un lead del instant form',
    });
  }

  // calendly: ok si hubo agenda en 30d; sin actividad => stale (no off)
  {
    const fecha = calendlyRes.data?.[0]?.created_at ?? null;
    const d = diasDesde(fecha ? fecha.slice(0, 10) : null);
    const status: SourceStatus = d === null ? 'stale' : d <= 30 ? 'ok' : 'stale';
    sources.push({
      key: 'calendly',
      label: 'Calendly',
      status,
      lastSync: fecha,
      detalle: fecha ? `Última agenda hace ${d}d` : 'Sin agendas registradas',
    });
  }

  // vsl_panda: ok <=2d, si no off
  {
    const fecha = pandaRes.data?.[0]?.fecha ?? null;
    const d = diasDesde(fecha);
    const status: SourceStatus = d === null ? 'off' : d <= 2 ? 'ok' : 'off';
    sources.push({
      key: 'vsl_panda',
      label: 'VSL (Panda)',
      status,
      lastSync: fecha,
      detalle: fecha ? `Último día con plays: ${fecha}` : 'Sin métricas de Panda aún',
    });
  }

  // vsl_beacon: ok <=7d, si no stale
  {
    const fecha = beaconRes.data?.[0]?.created_at ?? null;
    const d = diasDesde(fecha ? fecha.slice(0, 10) : null);
    const status: SourceStatus = d === null ? 'stale' : d <= 7 ? 'ok' : 'stale';
    sources.push({
      key: 'vsl_beacon',
      label: 'Beacon VSL',
      status,
      lastSync: fecha,
      detalle: fecha ? `Último evento hace ${d}d` : 'Sin eventos del beacon',
    });
  }

  return sources;
}

/** Mapa key→status para que los widgets consulten rápido. */
export function sourcesToMap(sources: DataSource[]): Record<string, SourceStatus> {
  const m: Record<string, SourceStatus> = {};
  for (const s of sources) m[s.key] = s.status;
  return m;
}
