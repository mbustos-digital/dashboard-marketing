// =============================================================================
// Helpers de fecha en zona America/Tijuana
// =============================================================================
// Toda la lógica de "ayer", "hoy", etc. del dashboard se ancla a Tijuana
// (donde vive Mauricio), NO a UTC ni a la zona del server. Razón: los crons
// corren en UTC en Vercel, pero la fecha "calendarizada" del negocio es TJ.

const TIJUANA = 'America/Tijuana';

const tjFmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: TIJUANA,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/**
 * Devuelve la fecha actual en zona Tijuana, formato 'YYYY-MM-DD'.
 */
export function hoyEnTijuana(date: Date = new Date()): string {
  return tjFmt.format(date);
}

/**
 * Devuelve la fecha de "ayer" en zona Tijuana, formato 'YYYY-MM-DD'.
 * Bulletproof contra DST: trabaja en calendar-day, no en deltas de horas.
 */
export function ayerEnTijuana(date: Date = new Date()): string {
  return diasAntes(hoyEnTijuana(date), 1);
}

/**
 * Devuelve la fecha N días antes de la dada (formato 'YYYY-MM-DD' → 'YYYY-MM-DD').
 * Opera en UTC para evitar issues de DST.
 */
export function diasAntes(fecha: string, n: number): string {
  const [y, m, d] = fecha.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() - n);
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(dt.getUTCDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

/**
 * Valida que el string sea formato 'YYYY-MM-DD' y represente una fecha real.
 * Útil para sanitizar parámetros de query.
 */
export function esFechaValida(fecha: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return false;
  const [y, m, d] = fecha.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return (
    dt.getUTCFullYear() === y &&
    dt.getUTCMonth() === m - 1 &&
    dt.getUTCDate() === d
  );
}

/**
 * Devuelve el LUNES de la semana actual en zona Tijuana, formato 'YYYY-MM-DD'.
 * Si hoy es lunes, devuelve hoy.
 */
export function lunesActualEnTijuana(date: Date = new Date()): string {
  const hoy = hoyEnTijuana(date);
  const [y, m, d] = hoy.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  // getUTCDay: 0=domingo, 1=lunes, ... 6=sábado
  // Queremos llegar a lunes: si es domingo (0), restar 6; si es lunes (1), restar 0; etc.
  const dia = dt.getUTCDay();
  const offset = dia === 0 ? 6 : dia - 1;
  return diasAntes(hoy, offset);
}

/**
 * Devuelve el primer día del mes actual en zona Tijuana, formato 'YYYY-MM-DD'.
 */
export function primerDiaDelMesEnTijuana(date: Date = new Date()): string {
  const hoy = hoyEnTijuana(date);
  const [y, m] = hoy.split('-').map(Number);
  const mm = String(m).padStart(2, '0');
  return `${y}-${mm}-01`;
}
