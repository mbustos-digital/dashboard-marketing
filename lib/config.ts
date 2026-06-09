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
