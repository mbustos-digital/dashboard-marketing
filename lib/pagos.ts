// =============================================================================
// Pagos — plan de cobranza por cuotas (Fase 8-bis)
// =============================================================================
// Una fila por movimiento esperado de un lead:
//   numero = 0  → cobro inicial
//   numero = 1..6 → cuotas mensuales
// El cash collected del dashboard se calcula sumando los pagos pagado=true por
// su fecha_pago. total_cobrado_usd del lead se DERIVA de acá (se sincroniza en
// cada mutación). Outstanding = Σ pagos no pagados.
// =============================================================================

import 'server-only';
import { getSupabaseServer } from './supabase';

export type Pago = {
  id: number;
  lead_id: number;
  numero: number;          // 0 = inicial, 1..6 = cuota
  monto_usd: number;
  fecha_esperada: string | null; // YYYY-MM-DD
  pagado: boolean;
  fecha_pago: string | null;
  created_at: string;
};

export type PlanPagos = {
  cobro_inicial_usd: number | null;
  monto_cuota_usd: number | null;
  total_cuotas: number | null;   // 1..6
  dia_de_pago: number | null;    // 1..28
};

// ─────────────────────────────────────────────────────────────────────────────
// Queries
// ─────────────────────────────────────────────────────────────────────────────

/** Pagos de un lead, ordenados por numero (inicial primero). */
export async function getPagosByLead(leadId: number): Promise<Pago[]> {
  const supabase = getSupabaseServer();
  const { data, error } = await supabase
    .from('pagos')
    .select('*')
    .eq('lead_id', leadId)
    .order('numero', { ascending: true });
  if (error) throw new Error(`Error listando pagos del lead ${leadId}: ${error.message}`);
  return (data ?? []) as Pago[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers de fecha
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Suma `meses` a una fecha YYYY-MM-DD y fija el día en `dia` (1-28, ya capado).
 * Trabaja en UTC para no depender del huso del server.
 */
function fechaCuota(base: string, meses: number, dia: number): string {
  const [y, m] = base.split('-').map(Number);
  // m es 1-based; pasamos a Date con (m-1)+meses; el día se setea explícito
  const d = new Date(Date.UTC(y, m - 1 + meses, dia));
  return d.toISOString().slice(0, 10);
}

// ─────────────────────────────────────────────────────────────────────────────
// Mutations
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Guarda el plan de pagos de un lead y (re)genera las filas de `pagos`.
 *
 * Regla de regeneración: SOLO toca las filas NO pagadas. Las cuotas ya cobradas
 * quedan intactas (su monto/fecha real es histórico). Si el plan se achica, las
 * cuotas no pagadas que sobran se borran.
 *
 * fecha base = fecha_cierre del lead (o hoy si no hay). El inicial vence en la
 * fecha del cierre; la cuota N vence el `dia_de_pago` del mes N siguiente.
 */
export async function savePlanPagos(
  leadId: number,
  plan: PlanPagos,
  hoy: string = new Date().toISOString().slice(0, 10),
): Promise<Pago[]> {
  const supabase = getSupabaseServer();

  // Necesitamos la fecha de cierre como ancla del calendario
  const { data: leadRow, error: leadErr } = await supabase
    .from('leads')
    .select('fecha_cierre')
    .eq('id', leadId)
    .single();
  if (leadErr) throw new Error(`Error leyendo lead ${leadId}: ${leadErr.message}`);
  const base = (leadRow?.fecha_cierre as string | null) ?? hoy;

  // Persistir las columnas del plan en el lead
  const { error: planErr } = await supabase
    .from('leads')
    .update({
      cobro_inicial_usd: plan.cobro_inicial_usd,
      monto_cuota_usd: plan.monto_cuota_usd,
      total_cuotas: plan.total_cuotas,
      dia_de_pago: plan.dia_de_pago,
    })
    .eq('id', leadId);
  if (planErr) throw new Error(`Error guardando plan del lead ${leadId}: ${planErr.message}`);

  const existentes = await getPagosByLead(leadId);
  const pagados = new Set(existentes.filter((p) => p.pagado).map((p) => p.numero));

  // Construir las filas DESEADAS del plan
  const totalCuotas = plan.total_cuotas ?? 0;
  const dia = plan.dia_de_pago ?? 1;
  const deseadas: Array<{ numero: number; monto_usd: number; fecha_esperada: string }> = [];

  if (plan.cobro_inicial_usd && plan.cobro_inicial_usd > 0) {
    deseadas.push({ numero: 0, monto_usd: plan.cobro_inicial_usd, fecha_esperada: base });
  }
  if (plan.monto_cuota_usd && plan.monto_cuota_usd > 0) {
    for (let n = 1; n <= totalCuotas; n++) {
      deseadas.push({
        numero: n,
        monto_usd: plan.monto_cuota_usd,
        fecha_esperada: fechaCuota(base, n, dia),
      });
    }
  }

  const numerosDeseados = new Set(deseadas.map((d) => d.numero));

  // 1) Borrar filas NO pagadas que ya no están en el plan
  const aBorrar = existentes
    .filter((p) => !p.pagado && !numerosDeseados.has(p.numero))
    .map((p) => p.id);
  if (aBorrar.length > 0) {
    const { error } = await supabase.from('pagos').delete().in('id', aBorrar);
    if (error) throw new Error(`Error borrando pagos obsoletos: ${error.message}`);
  }

  // 2) Upsert de las deseadas que NO estén ya pagadas (a las pagadas no se tocan)
  const aUpsert = deseadas
    .filter((d) => !pagados.has(d.numero))
    .map((d) => ({
      lead_id: leadId,
      numero: d.numero,
      monto_usd: d.monto_usd,
      fecha_esperada: d.fecha_esperada,
    }));
  if (aUpsert.length > 0) {
    // onConflict (lead_id, numero): si ya existía una fila no pagada, actualiza
    // monto/fecha sin tocar pagado/fecha_pago (defaults solo aplican al insert).
    const { error } = await supabase
      .from('pagos')
      .upsert(aUpsert, { onConflict: 'lead_id,numero' });
    if (error) throw new Error(`Error guardando pagos del plan: ${error.message}`);
  }

  await sincronizarTotalCobrado(leadId);
  return getPagosByLead(leadId);
}

/**
 * Marca un pago como cobrado (o lo revierte). Sincroniza total_cobrado_usd y
 * fecha_primer_pago del lead.
 */
export async function marcarPago(
  pagoId: number,
  pagado: boolean,
  fechaPago: string | null = new Date().toISOString().slice(0, 10),
): Promise<void> {
  const supabase = getSupabaseServer();
  const { data: pago, error: getErr } = await supabase
    .from('pagos')
    .select('lead_id')
    .eq('id', pagoId)
    .single();
  if (getErr) throw new Error(`Error leyendo pago ${pagoId}: ${getErr.message}`);

  const { error } = await supabase
    .from('pagos')
    .update({
      pagado,
      fecha_pago: pagado ? (fechaPago ?? new Date().toISOString().slice(0, 10)) : null,
    })
    .eq('id', pagoId);
  if (error) throw new Error(`Error marcando pago ${pagoId}: ${error.message}`);

  await sincronizarTotalCobrado(pago.lead_id as number);
}

/**
 * Recalcula total_cobrado_usd y fecha_primer_pago del lead a partir de sus
 * pagos pagados. Mantiene coherentes los consumidores que leen total_cobrado.
 */
export async function sincronizarTotalCobrado(leadId: number): Promise<void> {
  const supabase = getSupabaseServer();
  const pagos = await getPagosByLead(leadId);
  const pagados = pagos.filter((p) => p.pagado);

  const total = pagados.reduce((s, p) => s + Number(p.monto_usd), 0);
  // Primer pago = la fecha_pago más temprana entre los pagados
  const fechas = pagados
    .map((p) => p.fecha_pago)
    .filter((f): f is string => !!f)
    .sort();
  const fechaPrimerPago = fechas[0] ?? null;

  const { error } = await supabase
    .from('leads')
    .update({
      total_cobrado_usd: total > 0 ? total : null,
      ...(fechaPrimerPago ? { fecha_primer_pago: fechaPrimerPago } : {}),
    })
    .eq('id', leadId);
  if (error) throw new Error(`Error sincronizando total_cobrado del lead ${leadId}: ${error.message}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Agregados para el dashboard
// ─────────────────────────────────────────────────────────────────────────────

/** Cash collected de un período: Σ pagos pagado=true con fecha_pago en rango. */
export async function getCashCollectedPeriodo(start: string, end: string): Promise<number> {
  const supabase = getSupabaseServer();
  const { data, error } = await supabase
    .from('pagos')
    .select('monto_usd')
    .eq('pagado', true)
    .gte('fecha_pago', start)
    .lte('fecha_pago', end);
  if (error) throw new Error(`Error sumando cash del período: ${error.message}`);
  return (data ?? []).reduce((s, p) => s + Number(p.monto_usd ?? 0), 0);
}

/** Outstanding global: Σ monto_usd de pagos NO pagados (lo que falta cobrar). */
export async function getOutstandingTotal(): Promise<number> {
  const supabase = getSupabaseServer();
  const { data, error } = await supabase
    .from('pagos')
    .select('monto_usd')
    .eq('pagado', false);
  if (error) throw new Error(`Error sumando outstanding: ${error.message}`);
  return (data ?? []).reduce((s, p) => s + Number(p.monto_usd ?? 0), 0);
}

export type OutstandingLead = {
  lead_id: number;
  lead_nombre: string;
  vendido_usd: number | null;
  cobrado_usd: number;
  pendiente_usd: number;
  proxima_cuota: { numero: number; monto_usd: number; fecha_esperada: string | null } | null;
  dias_desde_cierre: number | null;
  fecha_cierre: string | null;
};

/**
 * Detalle nominal del outstanding (Fase 13): un renglón por lead con cuotas
 * pendientes. La suma de pendiente_usd iguala getOutstandingTotal().
 */
export async function getOutstandingDetalle(
  hoy: string = new Date().toISOString().slice(0, 10),
): Promise<{ items: OutstandingLead[]; total: number }> {
  const supabase = getSupabaseServer();
  const { data, error } = await supabase
    .from('pagos')
    .select('lead_id, numero, monto_usd, fecha_esperada, pagado, leads(nombre, monto_cierre_usd, fecha_cierre)');
  if (error) throw new Error(`Error leyendo detalle de outstanding: ${error.message}`);

  type Row = {
    lead_id: number;
    numero: number;
    monto_usd: number;
    fecha_esperada: string | null;
    pagado: boolean;
    leads: { nombre: string; monto_cierre_usd: number | null; fecha_cierre: string | null } | { nombre: string; monto_cierre_usd: number | null; fecha_cierre: string | null }[] | null;
  };

  const porLead = new Map<number, Row[]>();
  for (const row of (data ?? []) as Row[]) {
    const arr = porLead.get(row.lead_id) ?? [];
    arr.push(row);
    porLead.set(row.lead_id, arr);
  }

  const [hy, hm, hd] = hoy.split('-').map(Number);
  const hoyUTC = Date.UTC(hy, hm - 1, hd);
  const items: OutstandingLead[] = [];

  for (const [leadId, rows] of porLead) {
    const noPagados = rows.filter((r) => !r.pagado);
    const pendiente = noPagados.reduce((s, r) => s + Number(r.monto_usd), 0);
    if (pendiente <= 0) continue;
    const cobrado = rows.filter((r) => r.pagado).reduce((s, r) => s + Number(r.monto_usd), 0);
    const rel = Array.isArray(rows[0].leads) ? rows[0].leads[0] : rows[0].leads;
    const conFecha = noPagados.filter((r) => r.fecha_esperada).sort((a, b) => (a.fecha_esperada! < b.fecha_esperada! ? -1 : 1));
    const prox = conFecha[0] ?? noPagados[0];
    const fechaCierre = rel?.fecha_cierre ?? null;
    let dias: number | null = null;
    if (fechaCierre) {
      const [cy, cm, cd] = fechaCierre.split('-').map(Number);
      dias = Math.floor((hoyUTC - Date.UTC(cy, cm - 1, cd)) / (1000 * 60 * 60 * 24));
    }
    items.push({
      lead_id: leadId,
      lead_nombre: rel?.nombre ?? `Lead #${leadId}`,
      vendido_usd: rel?.monto_cierre_usd ?? null,
      cobrado_usd: cobrado,
      pendiente_usd: pendiente,
      proxima_cuota: prox ? { numero: prox.numero, monto_usd: Number(prox.monto_usd), fecha_esperada: prox.fecha_esperada } : null,
      dias_desde_cierre: dias,
      fecha_cierre: fechaCierre,
    });
  }

  items.sort((a, b) => b.pendiente_usd - a.pendiente_usd);
  const total = items.reduce((s, i) => s + i.pendiente_usd, 0);
  return { items, total };
}

export type CuotaPendiente = {
  pago_id: number;
  lead_id: number;
  lead_nombre: string;
  numero: number;
  monto_usd: number;
  fecha_esperada: string;
  dias: number; // negativo = vencida hace N días; positivo = vence en N días
};

/**
 * Cuotas no pagadas con su estado de vencimiento, para las alertas de Vista
 * General. `vencidas` = fecha_esperada < hoy; `porVencer` = vence dentro de
 * `diasAviso` días (default 3).
 */
export async function getCuotasPendientes(
  hoy: string = new Date().toISOString().slice(0, 10),
  diasAviso = 3,
): Promise<{ vencidas: CuotaPendiente[]; porVencer: CuotaPendiente[] }> {
  const supabase = getSupabaseServer();
  const { data, error } = await supabase
    .from('pagos')
    .select('id, lead_id, numero, monto_usd, fecha_esperada, leads(nombre)')
    .eq('pagado', false)
    .not('fecha_esperada', 'is', null)
    .order('fecha_esperada', { ascending: true });
  if (error) throw new Error(`Error listando cuotas pendientes: ${error.message}`);

  const [hy, hm, hd] = hoy.split('-').map(Number);
  const hoyUTC = Date.UTC(hy, hm - 1, hd);

  const vencidas: CuotaPendiente[] = [];
  const porVencer: CuotaPendiente[] = [];

  for (const row of (data ?? []) as Array<{
    id: number;
    lead_id: number;
    numero: number;
    monto_usd: number;
    fecha_esperada: string;
    leads: { nombre: string } | { nombre: string }[] | null;
  }>) {
    const [fy, fm, fd] = row.fecha_esperada.split('-').map(Number);
    const dias = Math.floor((Date.UTC(fy, fm - 1, fd) - hoyUTC) / (1000 * 60 * 60 * 24));
    const leadRel = Array.isArray(row.leads) ? row.leads[0] : row.leads;
    const item: CuotaPendiente = {
      pago_id: row.id,
      lead_id: row.lead_id,
      lead_nombre: leadRel?.nombre ?? `Lead #${row.lead_id}`,
      numero: row.numero,
      monto_usd: Number(row.monto_usd),
      fecha_esperada: row.fecha_esperada,
      dias,
    };
    if (dias < 0) vencidas.push(item);
    else if (dias <= diasAviso) porVencer.push(item);
  }

  return { vencidas, porVencer };
}
