'use server';

// =============================================================================
// Server actions para la UI de leads
// =============================================================================
// Convierten FormData (HTML forms) o input parseado a llamadas a lib/leads.ts
// y revalidan las páginas relevantes.
// =============================================================================

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import {
  createLead,
  updateLead,
  deleteLead,
  type LeadUpdateInput,
} from '@/lib/leads';
import { savePlanPagos, marcarPago, type PlanPagos } from '@/lib/pagos';

function emptyToNull(v: FormDataEntryValue | null): string | null {
  if (v === null) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
}

function emptyToNullable<T extends FormDataEntryValue | null>(
  v: T,
): string | null {
  return emptyToNull(v);
}

/**
 * Crea un lead nuevo desde el form de /leads/new.
 * Redirige a la vista detalle del lead creado.
 */
export async function createLeadAction(formData: FormData): Promise<void> {
  const nombre = emptyToNull(formData.get('nombre'));
  if (!nombre) {
    throw new Error('Nombre es requerido');
  }
  const created = await createLead({
    nombre,
    email: emptyToNullable(formData.get('email')),
    telefono: emptyToNullable(formData.get('telefono')),
    empresa: emptyToNullable(formData.get('empresa')),
    fecha_agenda: emptyToNullable(formData.get('fecha_agenda')),
    fecha_junta_1: emptyToNullable(formData.get('fecha_junta_1')),
  });
  revalidatePath('/leads');
  redirect(`/leads/${created.id}`);
}

/**
 * Actualiza un lead desde el form de detalle. Recibe input ya parseado
 * (el client component lo construye con sus toggles y validaciones).
 */
export async function updateLeadAction(
  id: number,
  input: LeadUpdateInput,
): Promise<void> {
  await updateLead(id, input);
  revalidatePath('/leads');
  revalidatePath(`/leads/${id}`);
}

/**
 * Guarda el plan de pagos de un lead y regenera las cuotas no pagadas.
 */
export async function savePlanPagosAction(
  leadId: number,
  plan: PlanPagos,
): Promise<void> {
  await savePlanPagos(leadId, plan);
  revalidatePath(`/leads/${leadId}`);
  revalidatePath('/revenue');
  revalidatePath('/general');
}

/**
 * Marca (o desmarca) una cuota como cobrada. fechaPago editable.
 */
export async function marcarPagoAction(
  pagoId: number,
  leadId: number,
  pagado: boolean,
  fechaPago: string | null,
): Promise<void> {
  await marcarPago(pagoId, pagado, fechaPago);
  revalidatePath(`/leads/${leadId}`);
  revalidatePath('/revenue');
  revalidatePath('/general');
}

/**
 * Borra un lead. Después redirige a la lista.
 */
export async function deleteLeadAction(id: number): Promise<void> {
  await deleteLead(id);
  revalidatePath('/leads');
  redirect('/leads');
}
