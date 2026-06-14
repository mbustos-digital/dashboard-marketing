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

// Desenlace explícito del lead (Fase 8). Fuente de verdad del resultado:
//   - abierto:        en proceso, sin desenlace todavía
//   - ganado:         cerró (equivale a cerro=true)
//   - perdido:        lo trabajamos y no compró (cerro=false)
//   - descalificado:  no era buen fit (cerro=false)
// `cerro` se mantiene en sync (lo derivan las queries de Revenue).
export type EstadoLead = 'abierto' | 'ganado' | 'perdido' | 'descalificado';

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

  // Desenlace explícito (Fase 8) — coherente con `cerro`
  estado_lead: EstadoLead;
  motivo_perdida: string | null;      // solo aplica a perdido/descalificado

  monto_cierre_usd: number | null;
  fecha_cierre: string | null;

  // Confirmación verbal entre J2 y primer pago (opcional, para medir SCL)
  fecha_confirmacion: string | null;

  // Cobranza — ortogonal a cierre. Cierre = vendido. Estos = cobrado.
  // total_cobrado_usd y fecha_primer_pago se DERIVAN de los pagos (Fase 8-bis).
  fecha_primer_pago: string | null;
  monto_primer_pago: number | null;
  total_cobrado_usd: number | null;
  fecha_inicio_servicio: string | null;

  // Plan de pagos (Fase 8-bis) — genera las filas de `pagos`
  cobro_inicial_usd: number | null;
  monto_cuota_usd: number | null;
  total_cuotas: number | null;    // 1..6
  dia_de_pago: number | null;     // 1..28

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

  // Meta Lead Ads (instant form) — atribución del anuncio de origen
  meta_lead_id: string | null;
  meta_ad_id: string | null;
  meta_ad_name: string | null;
  meta_campaign_name: string | null;
  meta_adset_name: string | null;
  origen_lead: string | null;            // 'instant_form' | 'calendly' | null
  telefono_normalizado: string | null;   // solo dígitos — llave de match

  // UUID anónimo de la landing (cookie nqe_visitor_id, llega como utm_term).
  // Cruza con vsl_events para saber si el lead vio el VSL.
  visitor_id: string | null;

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
  meta_lead_id?: string | null;
  meta_ad_id?: string | null;
  meta_ad_name?: string | null;
  meta_campaign_name?: string | null;
  meta_adset_name?: string | null;
  origen_lead?: string | null;
  telefono_normalizado?: string | null;
  visitor_id?: string | null;
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

  // Desenlace (Fase 8). Si viene estado_lead, manda él y deriva cerro.
  estado_lead?: EstadoLead;
  motivo_perdida?: string | null;

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

  // ───────────────────────────────────────────────────────────────────
  // Sincronización estado_lead <-> cerro (Fase 8)
  // ───────────────────────────────────────────────────────────────────
  // estado_lead es la fuente de verdad del desenlace; cerro se deriva para no
  // romper las queries de Revenue que todavía leen cerro.
  //   ganado        -> cerro = true
  //   perdido/descal -> cerro = false
  //   abierto       -> cerro = null
  // Si el caller NO mandó estado_lead pero sí cerro (compat con flujos viejos),
  // derivamos el estado desde cerro.
  if (input.estado_lead !== undefined) {
    if (merged.estado_lead === 'ganado') merged.cerro = true;
    else if (merged.estado_lead === 'perdido' || merged.estado_lead === 'descalificado') merged.cerro = false;
    else merged.cerro = null; // abierto
  } else if (input.cerro !== undefined) {
    if (merged.cerro === true) merged.estado_lead = 'ganado';
    else if (merged.cerro === false) {
      // cerro=false puede ser perdido o descalificado; conservamos descalificado
      // si ya estaba, si no, default perdido.
      merged.estado_lead = actual.estado_lead === 'descalificado' ? 'descalificado' : 'perdido';
    } else merged.estado_lead = 'abierto';
  }
  // motivo solo tiene sentido en perdido/descalificado
  if (merged.estado_lead !== 'perdido' && merged.estado_lead !== 'descalificado') {
    merged.motivo_perdida = null;
  }

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
    estado_lead: merged.estado_lead,
    motivo_perdida: merged.motivo_perdida,
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
 * Normaliza un teléfono a solo dígitos (sin +, espacios, guiones, paréntesis).
 * Llave de match entre instant form (Meta) y Calendly.
 * @returns null si no quedan dígitos.
 */
export function normalizarTelefono(tel: string | null | undefined): string | null {
  if (!tel) return null;
  const digits = tel.replace(/\D/g, '');
  return digits || null;
}

/**
 * Upsert desde Meta Lead Ads (instant form) — hermana de upsertLeadFromCalendly.
 *
 * Match por teléfono O email: una persona puede usar un email en el instant
 * form y otro al agendar en Calendly. El teléfono del instant form está
 * verificado por SMS — es la llave más confiable.
 *
 * Reglas:
 * - Idempotente por meta_lead_id: si ya existe un lead con ese leadgen_id,
 *   es un reintento del webhook → retorna el existente sin tocar nada.
 * - Si matchea lead existente (tel O email): actualiza SOLO campos de Meta +
 *   origen_lead. Completa nombre/telefono/empresa solo si estaban vacíos.
 *   NUNCA toca campos manuales (asistio_j1, calificado, cerro, montos, cobranza).
 * - Si no existe: crea con origen_lead='instant_form'. fecha_agenda y
 *   fecha_junta_1 quedan NULL — las completa Calendly cuando agende.
 */
export async function upsertLeadFromMeta(input: {
  email: string | null;
  nombre: string;
  telefono?: string | null;
  empresa?: string | null;
  meta_lead_id: string;
  meta_ad_id?: string | null;
  meta_ad_name?: string | null;
  meta_campaign_name?: string | null;
  meta_adset_name?: string | null;
}): Promise<{ created: boolean; lead: Lead }> {
  if (!input.meta_lead_id) {
    throw new Error('meta_lead_id es requerido');
  }
  if (!input.nombre || !input.nombre.trim()) {
    throw new Error('Nombre es requerido en lead de Meta');
  }

  const supabase = getSupabaseServer();

  // 1) Idempotencia: ¿ya procesamos este leadgen_id? (reintento de Meta)
  const { data: porLeadId, error: leadIdErr } = await supabase
    .from('leads')
    .select('*')
    .eq('meta_lead_id', input.meta_lead_id)
    .maybeSingle();
  if (leadIdErr) throw new Error(`Error buscando por meta_lead_id: ${leadIdErr.message}`);
  if (porLeadId) {
    return { created: false, lead: porLeadId as Lead };
  }

  // 2) Normalizar señales de identidad
  const emailNorm = input.email?.trim().toLowerCase() || null;
  const telNorm = normalizarTelefono(input.telefono);

  // 3) Buscar existente por teléfono O email
  let existing: Lead | null = null;
  if (telNorm) {
    const { data, error } = await supabase
      .from('leads')
      .select('*')
      .eq('telefono_normalizado', telNorm)
      .maybeSingle();
    if (error) throw new Error(`Error buscando por teléfono: ${error.message}`);
    existing = (data as Lead | null) ?? null;
  }
  if (!existing && emailNorm) {
    const { data, error } = await supabase
      .from('leads')
      .select('*')
      .ilike('email', emailNorm)
      .maybeSingle();
    if (error) throw new Error(`Error buscando por email: ${error.message}`);
    existing = (data as Lead | null) ?? null;
  }

  // Campos de Meta — siempre se escriben (es info nueva de atribución)
  const metaFields = {
    meta_lead_id: input.meta_lead_id,
    meta_ad_id: input.meta_ad_id ?? null,
    meta_ad_name: input.meta_ad_name ?? null,
    meta_campaign_name: input.meta_campaign_name ?? null,
    meta_adset_name: input.meta_adset_name ?? null,
    origen_lead: 'instant_form',
  };

  if (existing) {
    // Completar contacto solo si estaba vacío — no pisar datos existentes
    const fillIfEmpty: Record<string, string> = {};
    if (!existing.nombre?.trim() && input.nombre.trim()) {
      fillIfEmpty.nombre = input.nombre.trim();
    }
    if (!existing.email && emailNorm) fillIfEmpty.email = emailNorm;
    if (!existing.telefono && input.telefono?.trim()) {
      fillIfEmpty.telefono = input.telefono.trim();
    }
    if (!existing.empresa && input.empresa?.trim()) {
      fillIfEmpty.empresa = input.empresa.trim();
    }
    if (!existing.telefono_normalizado && telNorm) {
      fillIfEmpty.telefono_normalizado = telNorm;
    }

    const { data, error } = await supabase
      .from('leads')
      .update({ ...metaFields, ...fillIfEmpty })
      .eq('id', existing.id)
      .select('*')
      .single();
    if (error) throw new Error(`Error actualizando lead ${existing.id} desde Meta: ${error.message}`);
    return { created: false, lead: data as Lead };
  }

  // INSERT nuevo — fechas de agenda/J1 NULL (las pone Calendly al agendar)
  const { data, error } = await supabase
    .from('leads')
    .insert({
      nombre: input.nombre.trim(),
      email: emailNorm,
      telefono: input.telefono?.trim() || null,
      empresa: input.empresa?.trim() || null,
      telefono_normalizado: telNorm,
      ...metaFields,
    })
    .select('*')
    .single();
  if (error) throw new Error(`Error creando lead desde Meta: ${error.message}`);
  return { created: true, lead: data as Lead };
}

/**
 * Busca un lead por teléfono normalizado O email — misma lógica de match que
 * upsertLeadFromMeta. Usado por el ruteo de J2 y las cancelaciones (Fase 10).
 */
export async function findLeadByContacto(
  email: string | null,
  telefono: string | null,
): Promise<Lead | null> {
  const supabase = getSupabaseServer();
  const telNorm = normalizarTelefono(telefono);
  if (telNorm) {
    const { data, error } = await supabase
      .from('leads')
      .select('*')
      .eq('telefono_normalizado', telNorm)
      .maybeSingle();
    if (error) throw new Error(`Error buscando lead por teléfono: ${error.message}`);
    if (data) return data as Lead;
  }
  const emailNorm = email?.trim().toLowerCase();
  if (emailNorm) {
    const { data, error } = await supabase
      .from('leads')
      .select('*')
      .ilike('email', emailNorm)
      .maybeSingle();
    if (error) throw new Error(`Error buscando lead por email: ${error.message}`);
    if (data) return data as Lead;
  }
  return null;
}

/**
 * Setea SOLO fecha_junta_2 en un lead (J2 entrante de Calendly, Fase 10).
 * Nunca toca otros campos.
 */
export async function setFechaJunta2(leadId: number, fechaJ2: string): Promise<void> {
  const supabase = getSupabaseServer();
  const { error } = await supabase
    .from('leads')
    .update({ fecha_junta_2: fechaJ2 })
    .eq('id', leadId);
  if (error) throw new Error(`Error seteando fecha_junta_2 en lead ${leadId}: ${error.message}`);
}

/**
 * Aplica una cancelación de Calendly al lead (Fase 10).
 * - Si la fecha cancelada es la fecha_junta_2 y NO pasó → fecha_junta_2 = NULL.
 * - Si es la fecha_junta_1 y NO pasó → fecha_junta_1 = NULL (fecha_agenda se
 *   conserva: es el ancla histórica de cuándo agendó).
 * - Si la junta ya pasó (o no matchea ninguna fecha) → no toca nada.
 * Un reagendamiento llega como canceled + created, así que la fecha nueva la
 * vuelve a llenar el created.
 * @returns descripción de lo que cambió, para el log.
 */
export async function cancelarJuntaEnLead(
  lead: Lead,
  fechaCancelada: string,
  hoy: string,
): Promise<string> {
  const yaPaso = fechaCancelada < hoy;
  if (yaPaso) return 'junta ya pasó — sin cambios';

  let campo: 'fecha_junta_2' | 'fecha_junta_1' | null = null;
  if (lead.fecha_junta_2 && fechaCancelada === lead.fecha_junta_2) {
    campo = 'fecha_junta_2';
  } else if (lead.fecha_junta_1 && fechaCancelada === lead.fecha_junta_1) {
    campo = 'fecha_junta_1';
  }
  if (!campo) return 'fecha cancelada no coincide con J1/J2 — sin cambios';

  const supabase = getSupabaseServer();
  const { error } = await supabase
    .from('leads')
    .update({ [campo]: null })
    .eq('id', lead.id);
  if (error) throw new Error(`Error cancelando ${campo} en lead ${lead.id}: ${error.message}`);
  return `${campo} = NULL (cancelación de junta futura)`;
}

/**
 * Upsert por teléfono O email — usado por el webhook de Calendly.
 *
 * - Match (4B-bis): busca primero por telefono_normalizado, después por
 *   email. Así un lead que entró por instant form (teléfono verificado por
 *   SMS) se completa con su fecha de J1 cuando agenda en Calendly, aunque
 *   use un email distinto.
 * - Si existe: actualiza SOLO los campos que vienen de Calendly (nombre,
 *   email, fechas, empresa, telefono). NUNCA toca los campos manuales
 *   (asistio_j1, calificado, cerro, monto, fecha_cierre) ni los meta_*.
 * - UTMs y respuestas en UPDATE: solo sobrescribe si viene con valor.
 * - Si no existe: crea uno nuevo con origen_lead='calendly'.
 *
 * @returns { created: true } si fue insert, { created: false } si fue update.
 */
export async function upsertLeadFromCalendly(
  input: {
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
    visitor_id?: string | null;
  },
  opts?: {
    // Backfill histórico (Fase 2-bis): backdatea created_at del lead SOLO
    // al crearlo, para que la fila refleje cuándo agendó realmente.
    fechaCreacion?: string;
    // Backfill histórico: en UPDATE solo completa campos vacíos del lead
    // existente — NUNCA pisa datos ya cargados (fechas más recientes,
    // empresa puesta a mano, etc.). El webhook en vivo usa false (default):
    // refresca fechas porque Calendly es la fuente fresca.
    soloCompletarVacios?: boolean;
  },
): Promise<{ created: boolean; lead: Lead }> {
  if (!input.email || !input.email.includes('@')) {
    throw new Error('Email inválido en payload de Calendly');
  }
  const emailNorm = input.email.trim().toLowerCase();
  const telNorm = normalizarTelefono(input.telefono);
  const soloVacios = opts?.soloCompletarVacios ?? false;

  const supabase = getSupabaseServer();

  // Match 4B-bis: primero por teléfono normalizado (la señal más confiable
  // — la comparte con el instant form de Meta), después por email.
  let existing: Lead | null = null;
  if (telNorm) {
    const { data, error } = await supabase
      .from('leads')
      .select('*')
      .eq('telefono_normalizado', telNorm)
      .maybeSingle();
    if (error) throw new Error(`Error buscando lead por teléfono: ${error.message}`);
    existing = (data as Lead | null) ?? null;
  }
  if (!existing) {
    const { data, error } = await supabase
      .from('leads')
      .select('*')
      .ilike('email', emailNorm)
      .maybeSingle();
    if (error) throw new Error(`Error buscando lead por email: ${error.message}`);
    existing = (data as Lead | null) ?? null;
  }

  // Base de payload — campos de contacto / agenda.
  const basePayload = {
    nombre: input.nombre.trim(),
    email: emailNorm,
    fecha_agenda: input.fecha_agenda,
    fecha_junta_1: input.fecha_junta_1,
    empresa: input.empresa?.trim() || null,
    telefono: input.telefono?.trim() || null,
    ...(telNorm ? { telefono_normalizado: telNorm } : {}),
  };

  if (existing) {
    let updatePayload: Record<string, unknown>;

    if (soloVacios) {
      // BACKFILL: solo rellena lo que está vacío en el lead existente.
      // Nunca pisa fechas, empresa, ni atribución ya cargada.
      updatePayload = {};
      const setIfEmpty = (campo: keyof Lead, valor: string | null | undefined) => {
        const actual = existing![campo];
        if ((actual === null || actual === undefined || actual === '') && valor) {
          updatePayload[campo] = valor;
        }
      };
      setIfEmpty('email', emailNorm);
      setIfEmpty('telefono', input.telefono?.trim() || null);
      setIfEmpty('telefono_normalizado', telNorm);
      setIfEmpty('empresa', input.empresa?.trim() || null);
      setIfEmpty('fecha_agenda', input.fecha_agenda);
      setIfEmpty('fecha_junta_1', input.fecha_junta_1);
      setIfEmpty('utm_source', input.utm_source);
      setIfEmpty('utm_medium', input.utm_medium);
      setIfEmpty('utm_campaign', input.utm_campaign);
      setIfEmpty('utm_content', input.utm_content);
      setIfEmpty('respuesta_facturacion', input.respuesta_facturacion);
      setIfEmpty('respuesta_colaboradores', input.respuesta_colaboradores);
      setIfEmpty('respuesta_objetivo', input.respuesta_objetivo);
      setIfEmpty('respuesta_cuando_empezar', input.respuesta_cuando_empezar);
      setIfEmpty('visitor_id', input.visitor_id);

      // Nada que completar → no escribir
      if (Object.keys(updatePayload).length === 0) {
        return { created: false, lead: existing };
      }
    } else {
      // WEBHOOK EN VIVO: refresca contacto/agenda; UTMs y respuestas solo
      // si vienen con valor (no borrar lo que ya estaba).
      const extraUpdates: Record<string, string> = {};
      if (input.utm_source)               extraUpdates.utm_source               = input.utm_source;
      if (input.utm_medium)               extraUpdates.utm_medium               = input.utm_medium;
      if (input.utm_campaign)             extraUpdates.utm_campaign             = input.utm_campaign;
      if (input.utm_content)              extraUpdates.utm_content              = input.utm_content;
      if (input.respuesta_facturacion)    extraUpdates.respuesta_facturacion    = input.respuesta_facturacion;
      if (input.respuesta_colaboradores)  extraUpdates.respuesta_colaboradores  = input.respuesta_colaboradores;
      if (input.respuesta_objetivo)       extraUpdates.respuesta_objetivo       = input.respuesta_objetivo;
      if (input.respuesta_cuando_empezar) extraUpdates.respuesta_cuando_empezar = input.respuesta_cuando_empezar;
      if (input.visitor_id)               extraUpdates.visitor_id               = input.visitor_id;
      updatePayload = { ...basePayload, ...extraUpdates };
    }

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
    origen_lead:              'calendly',
    utm_source:               input.utm_source               ?? null,
    utm_medium:               input.utm_medium               ?? null,
    utm_campaign:             input.utm_campaign             ?? null,
    utm_content:              input.utm_content              ?? null,
    respuesta_facturacion:    input.respuesta_facturacion    ?? null,
    respuesta_colaboradores:  input.respuesta_colaboradores  ?? null,
    respuesta_objetivo:       input.respuesta_objetivo       ?? null,
    respuesta_cuando_empezar: input.respuesta_cuando_empezar ?? null,
    visitor_id:               input.visitor_id               ?? null,
    // Backdatear created_at SOLO en backfill, para reflejar cuándo agendó
    ...(opts?.fechaCreacion ? { created_at: opts.fechaCreacion } : {}),
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
  const dias = diasDesdeJ1(lead.fecha_junta_1, hoy);
  if (dias === null) return 'sin_j1';
  // J1 en el futuro (dias < 0): la cohorte recién arranca → 'reciente', nunca
  // 'madura'. Evita el bug de "−9 días desde J1" / madurez falsa (Fase 8).
  if (dias < 0) return 'reciente';
  if (dias >= 14) return 'madura';
  if (dias >= 5) return 'madurando';
  return 'reciente';
}

/**
 * Días (enteros) entre la J1 y hoy. Negativo si la J1 es futura.
 * @returns null si no hay fecha_junta_1.
 */
export function diasDesdeJ1(fechaJ1: string | null, hoy: Date = new Date()): number | null {
  if (!fechaJ1) return null;
  const [y, m, d] = fechaJ1.split('-').map(Number);
  const fecha = new Date(Date.UTC(y, m - 1, d));
  const hoyUTC = new Date(Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth(), hoy.getUTCDate()));
  return Math.floor((hoyUTC.getTime() - fecha.getTime()) / (1000 * 60 * 60 * 24));
}

/**
 * Texto humano de la cohorte para la ficha del lead (Fase 8).
 * J1 futura → "faltan X días para J1"; J1 pasada → "X días desde J1".
 * @returns null si no hay J1.
 */
export function textoCohorteJ1(fechaJ1: string | null, hoy: Date = new Date()): string | null {
  const dias = diasDesdeJ1(fechaJ1, hoy);
  if (dias === null) return null;
  if (dias < 0) {
    const faltan = Math.abs(dias);
    return `faltan ${faltan} ${faltan === 1 ? 'día' : 'días'} para J1`;
  }
  if (dias === 0) return 'J1 es hoy';
  return `${dias} ${dias === 1 ? 'día' : 'días'} desde J1`;
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

// ─────────────────────────────────────────────────────────────────────────────
// VSL tracking (Fase 6)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Cuenta cuántos eventos vsl_play tiene un visitor_id en vsl_events.
 * Para la ficha del lead (Fase 7): "vio el VSL N veces".
 * @returns 0 si visitorId es null o no hay eventos.
 */
export async function contarVslPlays(visitorId: string | null): Promise<number> {
  if (!visitorId) return 0;
  const supabase = getSupabaseServer();
  const { count, error } = await supabase
    .from('vsl_events')
    .select('id', { count: 'exact', head: true })
    .eq('visitor_id', visitorId)
    .eq('event', 'vsl_play');
  if (error) {
    console.error(`[contarVslPlays] falló: ${error.message}`);
    return 0;
  }
  return count ?? 0;
}
