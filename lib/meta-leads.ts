// =============================================================================
// Meta Lead Ads — parseo compartido de field_data (Fase 4 v2)
// =============================================================================
// El webhook (tiempo real) y el cron de polling (red de seguridad) leen el
// mismo field_data de los leads. Este helper centraliza el parseo para que
// ambos usen exactamente la misma lógica de extracción.
// =============================================================================

import 'server-only';

export const META_GRAPH_VERSION = process.env.META_API_VERSION || 'v24.0';

export type MetaFieldData = Array<{ name?: string; values?: string[] }>;

/**
 * Extrae el primer field cuyo `name` contenga alguno de los keywords
 * (case-insensitive). Devuelve su primer value (trim) o null.
 */
export function extractField(
  fieldData: MetaFieldData | undefined,
  names: string[],
): string | null {
  if (!fieldData) return null;
  const lowered = names.map((n) => n.toLowerCase());
  const found = fieldData.find(
    (f) => f.name && lowered.some((n) => f.name!.toLowerCase().includes(n)),
  );
  return found?.values?.[0]?.trim() || null;
}

export type LeadContacto = {
  email: string | null;
  nombre: string;
  telefono: string | null;
  empresa: string | null;
};

/**
 * Saca email / nombre / teléfono / empresa de un field_data de Meta.
 * Mismos keywords en el webhook y en el polling.
 */
export function parseLeadFields(fieldData: MetaFieldData | undefined): LeadContacto {
  const email = extractField(fieldData, ['email', 'correo']);
  const nombre =
    extractField(fieldData, [
      'full_name', 'full name', 'nombre completo', 'name', 'nombre',
    ]) ?? 'Lead sin nombre (Meta)';
  const telefono = extractField(fieldData, ['phone', 'teléfono', 'telefono', 'celular']);
  const empresa = extractField(fieldData, ['company', 'empresa', 'negocio', 'organiz']);
  return { email, nombre, telefono, empresa };
}
