// =============================================================================
// Configuración global del dashboard
// =============================================================================

/**
 * Tipo de cambio USD → MXN actual.
 *
 * Se usa para convertir el spend de Meta (viene en MXN porque la cuenta
 * publicitaria de Mauricio está configurada en MXN) a USD ANTES de hacer
 * cualquier ratio contra revenue (que ya está en USD).
 *
 * 🔧 ACTUALIZAR A MANO cuando cambie significativamente.
 *    El valor histórico se queda fijo — no afecta retroactivamente porque
 *    los ratios se recalculan en cada request.
 *
 * Si en el futuro Meta tiene multi-currency o querés precisión retroactiva,
 * mover a una tabla de tasas históricas por fecha.
 */
export const TIPO_DE_CAMBIO_USD_MXN = 17.30;

/**
 * Convierte un monto en MXN a USD usando TIPO_DE_CAMBIO_USD_MXN.
 * Tolerante a null/undefined/NaN → retorna 0.
 */
export function mxnAUsd(montoMxn: number | null | undefined): number {
  if (montoMxn === null || montoMxn === undefined || !Number.isFinite(montoMxn)) {
    return 0;
  }
  return montoMxn / TIPO_DE_CAMBIO_USD_MXN;
}

/**
 * ID de la página de Facebook "Mauricio Bustos Eguia", dueña de los
 * formularios instantáneos. Usado por el cron de polling de leads (Fase 4 v2)
 * para listar los leadgen_forms.
 */
export const META_PAGE_ID = '282881742134130';

/**
 * Días de gracia después de la Junta 1 antes de reclamar que se agende la
 * Junta 2 (o se marque una resolución). Higiene de datos, Fase 9.
 * Ajustable: subir si el ciclo de venta da más aire entre J1 y J2.
 */
export const DIAS_GRACIA_J2 = 4;

/**
 * Umbral (días) del tramo J1 → J2 a partir del cual la Vista General avisa que
 * los deals se enfrían entre la J1 y la J2. Fase 16.
 */
export const DIAS_J1_J2_ALERTA = 10;

/**
 * Panel Recon (Fase 17). Umbral de INTENCIÓN: leads (instant forms con
 * teléfono verificado) por versión de oferta a partir del cual la señal se
 * considera validada. Metodología de Jan.
 */
export const RECON_LEADS_VALIDACION = 10;

/**
 * Panel Recon: gasto (USD) sin un solo lead que amerita apagar el anuncio.
 */
export const RECON_SPEND_SIN_LEADS_USD = 80;
