// =============================================================================
// Leads — types, queries y server actions
// =============================================================================
// Tabla `leads` ya creada en Fase 1. Esta capa concentra TODO el acceso al
// modelo: get, create, update, validaciones lógicas.
// =============================================================================

import 'server-only';
import { getSupabaseServer } from './supabase';
import { sendMetaCAPIEvent } from './meta-capi';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type Lead = {
  id: number;
  nombre: string;
  email: string | null;
  telefono: string | null;
  empresa: string | null;

  fecha_agenda: string | null;        // YYYY-MM-DD
  fecha_junta_1: string | null;
  fecha_junta_2: string | null;

  asistio_j1: boolean | null;
  asistio_j2: boolean | null;
  calificado: boolean | null;
  cerro: boolean | null;

  monto_cierre_usd: number | null;
  fecha_cierre: string | null;

  // Confirmación verbal entre J2 y primer pago (opcional, para medir SCL)
  fecha_confirmacion: string | null;

  // Cobranza — ortogonal a cierre. Cierre = vendido. Estos = cobrado.
  fecha_primer_pago: string | null;
  monto_primer_pago: number | null;
  total_cobrado_usd: number | null;
  fecha_inicio_servicio: string | null;

  adset_id_origen: string | null;

  // UTMs — vienen del webhook de Calendly (vía landing en Lovable)
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  utm_content: string | null;

  // Respuestas del formulario Calendly (calificación previa a J1)
  respuesta_facturacion: string | null;
  respuesta_colaboradores: string | null;
  respuesta_objetivo: string | null;
  respuesta_cuando_empezar: string | null;

  created_at: string;
  updated_at: string;
};

export type LeadCreateInput = {
  nombre: string;
  email?: string | null;
  telefono?: string | null;
  empresa?: string | null;
  fecha_agenda?: string | null;
  fecha_junta_1?: string | null;
  utm_source?: string | null;
  utm_medium?: string | null;
  utm_campaign?: string | null;
  utm_content?: string | null;
  respuesta_facturacion?: string | null;
  respuesta_colaboradores?: string | null;
  respuesta_objetivo?: string | null;
  respuesta_cuando_empezar?: string | null;
};

export type LeadUpdateInput = {
  // Identificación / contacto
  nombre?: string;
  email?: string | null;
  telefono?: string | null;
  empresa?: string | null;

  // Comercial
  fecha_agenda?: string | null;
  fecha_junta_1?: string | null;
  fecha_junta_2?: string | null;
  asistio_j1?: boolean | null;
  asistio_j2?: boolean | null;
  calificado?: boolean | null;
  cerro?: boolean | null;
  monto_cierre_usd?: number | null;
  fecha_cierre?: string | null;

  // Confirmación verbal entre J2 y primer pago
  fecha_confirmacion?: string | null;

  // Cobranza
  fecha_primer_pago?: string | null;
  monto_primer_pago?: number | null;
  total_cobrado_usd?: number | null;
  fecha_inicio_servicio?: string | null;
};

export type EstadoMadurez = 'madura' | 'madurando' | 'reciente' | 'sin_j1';

// ─────────────────────────────────────────────────────────────────────────────
// Queries
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Lista todos los leads ordenados por created_at desc (más nuevos primero).
 */
export async function listLeads(): Promise<Lead[]> {
  const supabase = getSupabaseServer();
  const { data, error } = await supabase
    .from('leads')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) throw new Error(`Error listando leads: ${error.message}`);
  return (data ?? []) as Lead[];
}

/**
 * Obtiene UN lead por su id.
 */
export async function getLead(id: number): Promise<Lead | null> {
  const supabase = getSupabaseServer();
  const { data, error } = await supabase
    .from('leads')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (error) throw new Error(`Error obteniendo lead ${id}: ${error.message}`);
  return data as Lead | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Mutations
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Crea un lead nuevo. Solo requiere nombre.
 */
export async function createLead(input: LeadCreateInput): Promise<Lead> {
  if (!input.nombre || !input.nombre.trim()) {
    throw new Error('Nombre es requerido');
  }
  const supabase = getSupabaseServer();
  const { data, error } = await supabase
    .from('leads')
    .insert({
      nombre: input.nombre.trim(),
      email: input.email?.trim() || null,
      telefono: input.telefono?.trim() || null,
      empresa: input.empresa?.trim() || null,
      fecha_agenda: input.fecha_agenda || null,
      fecha_junta_1: input.fecha_junta_1 || null,
    })
    .select('*')
    .single();
  if (error) throw new Error(`Error creando lead: ${error.message}`);
  return data as Lead;
}

/**
 * Actualiza un lead con validaciones lógicas.
 *
 * Reglas:
 * - Si fecha_junta_1 es null → asistio_j1 y calificado se fuerzan a null.
 * - Si asistio_j1 != true → calificado se fuerza a null (no aplica).
 * - Si cerro != true → monto_cierre_usd y fecha_cierre se fuerzan a null.
 * - Si cerro = true sin monto → error.
 */
export async function updateLead(
  id: number,
  input: LeadUpdateInput,
): Promise<Lead> {
  const supabase = getSupabaseServer();

  // Trae el lead actual para mergear estado y validar transiciones
  const actual = await getLead(id);
  if (!actual) throw new Error(`Lead ${id} no existe`);

  // Estado fusionado: lo que viene del input gana, lo demás se mantiene
  const merged = { ...actual, ...input };

  // Aplicar reglas de coherencia
  if (!merged.fecha_junta_1) {
    merged.asistio_j1 = null;
    merged.calificado = null;
  }
  if (merged.asistio_j1 !== true) {
    merged.calificado = null;
  }
  if (merged.cerro !== true) {
    merged.monto_cierre_usd = null;
    merged.fecha_cierre = null;
  } else {
    // cerro = true: validar
    if (merged.monto_cierre_usd === null || merged.monto_cierre_usd === undefined) {
      throw new Error('Si cerró = sí, monto_cierre_usd es requerido');
    }
    if (merged.monto_cierre_usd <= 0) {
      throw new Error('monto_cierre_usd debe ser positivo');
    }
    // fecha_cierre opcional pero recomendada — si no viene, usar fecha actual
    if (!merged.fecha_cierre) {
      const hoy = new Date().toISOString().slice(0, 10);
      merged.fecha_cierre = hoy;
    }
  }

  // ───────────────────────────────────────────────────────────────────
  // Detección de transiciones para Meta CAPI (Prompts 7 y 8 del mentor)
  // ───────────────────────────────────────────────────────────────────
  // Lead         — calificado pasa a true (no lo era antes)
  // QualifiedLead — asistio_j1=true Y calificado=true ambos juntos, no lo eran antes
  // Se detectan ANTES del save (usando actual vs merged ya validado) y se
  // disparan DESPUÉS del save exitoso. CAPI nunca rompe el flujo.
  // ───────────────────────────────────────────────────────────────────
  const fireLeadEvent =
    actual.calificado !== true && merged.calificado === true;
  const fireQualifiedLeadEvent =
    !(actual.asistio_j1 === true && actual.calificado === true) &&
    merged.asistio_j1 === true && merged.calificado === true;

  // Solo enviamos los campos editables (no id, created_at, updated_at)
  const payload = {
    nombre: merged.nombre,
    email: merged.email,
    telefono: merged.telefono,
    empresa: merged.empresa,
    fecha_agenda: merged.fecha_agenda,
    fecha_junta_1: merged.fecha_junta_1,
    fecha_junta_2: merged.fecha_junta_2,
    asistio_j1: merged.asistio_j1,
    asistio_j2: merged.asistio_j2,
    calificado: merged.calificado,
    cerro: merged.cerro,
    monto_cierre_usd: merged.monto_cierre_usd,
    fecha_cierre: merged.fecha_cierre,
    fecha_confirmacion: merged.fecha_confirmacion,
    fecha_primer_pago: merged.fecha_primer_pago,
    monto_primer_pago: merged.monto_primer_pago,
    total_cobrado_usd: merged.total_cobrado_usd,
    fecha_inicio_servicio: merged.fecha_inicio_servicio,
  };

  const { data, error } = await supabase
    .from('leads')
    .update(payload)
    .eq('id', id)
    .select('*')
    .single();
  if (error) throw new Error(`Error actualizando lead ${id}: ${error.message}`);

  // ───────────────────────────────────────────────────────────────────
  // Disparar eventos CAPI POST-save (con guardia defensiva extra)
  // ───────────────────────────────────────────────────────────────────
  if (fireLeadEvent) {
    try {
      await sendMetaCAPIEvent({
        eventName: 'Lead',
        email: merged.email,
        phone: merged.telefono,
        customData: { lead_type: 'calificado' },
      });
    } catch (err) {
      console.error('[updateLead] error firing Lead CAPI event:', err);
    }
  }

  if (fireQualifiedLeadEvent) {
    try {
      await sendMetaCAPIEvent({
        eventName: 'QualifiedLead',
        email: merged.email,
        phone: merged.telefono,
        customData: { lead_type: 'j1_limpia', value: 1 },
      });
    } catch (err) {
      console.error('[updateLead] error firing QualifiedLead CAPI event:', err);
    }
  }

  return data as Lead;
}

/**
 * Borra un lead. Hard delete — no hay soft delete en el esquema actual.
 */
export async function deleteLead(id: number): Promise<void> {
  const supabase = getSupabaseServer();
  const { error } = await supabase.from('leads').delete().eq('id', id);
  if (error) throw new Error(`Error borrando lead ${id}: ${error.message}`);
}

/**
 * Upsert por email — usado por el webhook de Calendly.
 *
 * - Si existe lead con ese email: actualiza SOLO los campos que vienen de
 *   Calendly (nombre, email, fechas, empresa, telefono, utm_*). NUNCA toca
 *   los campos manuales (asistio_j1, calificado, cerro, monto, fecha_cierre).
 * - Para UTMs en UPDATE: solo sobrescribe si viene con valor. Si el lead ya
 *   tenía un UTM y re-agenda sin UTMs, NO se borra el existente (no podemos
 *   perder la atribución original).
 * - Si no existe: crea uno nuevo con los datos de Calendly.
 *
 * @returns { created: true } si fue insert, { created: false } si fue update.
 */
export async function upsertLeadFromCalendly(input: {
  email: string;
  nombre: string;
  fecha_agenda: string;
  fecha_junta_1: string;
  empresa?: string | null;
  telefono?: string | null;
  utm_source?: string | null;
  utm_medium?: string | null;
  utm_campaign?: string | null;
  utm_content?: string | null;
  respuesta_facturacion?: string | null;
  respuesta_colaboradores?: string | null;
  respuesta_objetivo?: string | null;
  respuesta_cuando_empezar?: string | null;
}): Promise<{ created: boolean; lead: Lead }> {
  if (!input.email || !input.email.includes('@')) {
    throw new Error('Email inválido en payload de Calendly');
  }
  const emailNorm = input.email.trim().toLowerCase();

  const supabase = getSupabaseServer();

  // Buscar existente por email (case-insensitive vía toLowerCase normalizado)
  const { data: existing, error: findErr } = await supabase
    .from('leads')
    .select('*')
    .ilike('email', emailNorm)
    .maybeSingle();

  if (findErr) throw new Error(`Error buscando lead por email: ${findErr.message}`);

  // Base de payload — campos que SIEMPRE se actualizan en update (no rompen
  // atribución existente porque son datos de contacto / agenda).
  const basePayload = {
    nombre: input.nombre.trim(),
    email: emailNorm,
    fecha_agenda: input.fecha_agenda,
    fecha_junta_1: input.fecha_junta_1,
    empresa: input.empresa?.trim() || null,
    telefono: input.telefono?.trim() || null,
  };

  if (existing) {
    // UTMs y respuestas: solo incluir en el update si VIENEN con valor. Si
    // no vienen, no los tocamos — preservamos los datos originales (la
    // primera respuesta es la más confiable; un re-agendamiento podría no
    // re-enviar las respuestas).
    const extraUpdates: Record<string, string> = {};
    if (input.utm_source)              extraUpdates.utm_source              = input.utm_source;
    if (input.utm_medium)              extraUpdates.utm_medium              = input.utm_medium;
    if (input.utm_campaign)            extraUpdates.utm_campaign            = input.utm_campaign;
    if (input.utm_content)             extraUpdates.utm_content             = input.utm_content;
    if (input.respuesta_facturacion)   extraUpdates.respuesta_facturacion   = input.respuesta_facturacion;
    if (input.respuesta_colaboradores) extraUpdates.respuesta_colaboradores = input.respuesta_colaboradores;
    if (input.respuesta_objetivo)      extraUpdates.respuesta_objetivo      = input.respuesta_objetivo;
    if (input.respuesta_cuando_empezar) extraUpdates.respuesta_cuando_empezar = input.respuesta_cuando_empezar;

    const updatePayload = { ...basePayload, ...extraUpdates };

    const { data, error } = await supabase
      .from('leads')
      .update(updatePayload)
      .eq('id', existing.id)
      .select('*')
      .single();
    if (error) throw new Error(`Error actualizando lead ${existing.id}: ${error.message}`);
    return { created: false, lead: data as Lead };
  }

  // INSERT: incluimos todo aunque sean null (lead nuevo, no hay nada que pisar)
  const insertPayload = {
    ...basePayload,
    utm_source:               input.utm_source               ?? null,
    utm_medium:               input.utm_medium               ?? null,
    utm_campaign:             input.utm_campaign             ?? null,
    utm_content:              input.utm_content              ?? null,
    respuesta_facturacion:    input.respuesta_facturacion    ?? null,
    respuesta_colaboradores:  input.respuesta_colaboradores  ?? null,
    respuesta_objetivo:       input.respuesta_objetivo       ?? null,
    respuesta_cuando_empezar: input.respuesta_cuando_empezar ?? null,
  };

  const { data, error } = await supabase
    .from('leads')
    .insert(insertPayload)
    .select('*')
    .single();
  if (error) throw new Error(`Error creando lead desde Calendly: ${error.message}`);
  return { created: true, lead: data as Lead };
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers de presentación
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Calcula el estado de madurez de la cohorte de UN lead según su fecha_junta_1.
 * Mismos thresholds que la vista v_cohortes_semanales.
 */
export function estadoMadurezLead(lead: Lead, hoy: Date = new Date()): EstadoMadurez {
  if (!lead.fecha_junta_1) return 'sin_j1';
  const [y, m, d] = lead.fecha_junta_1.split('-').map(Number);
  const fechaJ1 = new Date(Date.UTC(y, m - 1, d));
  const hoyDate = new Date(Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth(), hoy.getUTCDate()));
  const diffMs = hoyDate.getTime() - fechaJ1.getTime();
  const dias = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  if (dias >= 14) return 'madura';
  if (dias >= 5) return 'madurando';
  return 'reciente';
}

/**
 * Devuelve emoji + label para el estado de madurez.
 */
export function labelMadurez(estado: EstadoMadurez): { emoji: string; label: string; color: string } {
  switch (estado) {
    case 'madura':
      return { emoji: '🟢', label: 'Madura', color: 'var(--accent-green)' };
    case 'madurando':
      return { emoji: '🟡', label: 'Madurando', color: 'var(--accent-yellow)' };
    case 'reciente':
      return { emoji: '⚪', label: 'Reciente', color: 'var(--text-dim)' };
    case 'sin_j1':
      return { emoji: '—', label: 'Sin J1', color: 'var(--text-pending)' };
  }
}
