// =============================================================================
// review_queue — cola de revisión manual (Fase 10)
// =============================================================================
// Hoy guarda J2 agendadas en Calendly sin lead que matchee. Se resuelven a
// mano desde el tab Hoy (Fase 11).
// =============================================================================

import 'server-only';
import { getSupabaseServer } from './supabase';

export type ReviewItem = {
  id: number;
  tipo: string;
  email: string | null;
  nombre: string | null;
  fecha_evento: string | null;
  payload_resumen: unknown;
  resuelto: boolean;
  created_at: string;
};

/**
 * Encola una J2 agendada cuyo lead no se encontró (ni por tel ni por email).
 * NUNCA creamos un lead desde una J2 — esto queda para resolución manual.
 */
export async function enqueueJ2SinMatch(item: {
  email: string | null;
  nombre: string | null;
  fecha_evento: string | null;
  payload_resumen: unknown;
}): Promise<void> {
  const supabase = getSupabaseServer();
  const { error } = await supabase.from('review_queue').insert({
    tipo: 'j2_sin_match',
    email: item.email,
    nombre: item.nombre,
    fecha_evento: item.fecha_evento,
    payload_resumen: item.payload_resumen ?? null,
  });
  if (error) throw new Error(`Error encolando review j2_sin_match: ${error.message}`);
}

/** Items pendientes de revisión (resuelto=false), más nuevos primero. */
export async function listReviewPendientes(): Promise<ReviewItem[]> {
  const supabase = getSupabaseServer();
  const { data, error } = await supabase
    .from('review_queue')
    .select('*')
    .eq('resuelto', false)
    .order('created_at', { ascending: false });
  if (error) throw new Error(`Error listando review_queue: ${error.message}`);
  return (data ?? []) as ReviewItem[];
}
