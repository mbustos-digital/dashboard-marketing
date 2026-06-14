// =============================================================================
// Tab Vista General — panel de salud tipo semáforo (Fase 8A + 8E)
// =============================================================================
// En vez de repetir métricas de otros tabs:
//   a) Veredicto arriba (verde/ámbar/rojo) según el peor problema activo
//   b) Alertas ordenadas por urgencia — CONCLUSIÓN + qué revisar + atajo al tab
//   c) Estado del pipeline (distribución por madurez)
//   d) Resumen del mes: 4 números con tendencia vs mes anterior
// =============================================================================

import Link from 'next/link';
import {
  getFunnelEtapas,
  getResumenComercialMaduras,
  getDistribucionPipeline,
  getRevenuePeriod,
  getResumenComparativo,
  getPendientesDeMarcar,
  getJuntasProximas,
  getColaDeAccion,
  getObjetivoProgreso,
  type ResumenComercialMaduras,
  type DistribucionPipeline,
  type FunnelMes,
  type ResumenComparativo,
  type Pendientes,
  type JuntaProxima,
  type ColaItem,
  type ObjetivoProgreso,
} from '@/lib/queries';
import { getDataSources, sourcesToMap } from '@/lib/sources';
import { getCuotasPendientes, type CuotaPendiente } from '@/lib/pagos';
import { ayerEnTijuana, hoyEnTijuana, primerDiaDelMesDeFecha, diasAntes } from '@/lib/date-utils';
import { DashboardHeader } from '../_components/DashboardHeader';
import { DashboardTabs } from '../_components/DashboardTabs';
import { PendienteActions } from '../leads/PendienteActions';
import { ObjetivoBloque } from './ObjetivoBloque';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

// ─────────────────────────────────────────────────────────────────────────────
// Format helpers
// ─────────────────────────────────────────────────────────────────────────────

function fmtUSD(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(n);
}

function fmtNumber(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  return new Intl.NumberFormat('es-MX').format(Math.round(n));
}

function fmtFechaCorta(yyyy_mm_dd: string | null): string {
  if (!yyyy_mm_dd) return '—';
  const [y, m, d] = yyyy_mm_dd.split('-').map(Number);
  return new Intl.DateTimeFormat('es-MX', {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(y, m - 1, d)));
}

// ─────────────────────────────────────────────────────────────────────────────
// Motor de alertas (8E) — conclusiones accionables, no datos crudos
// ─────────────────────────────────────────────────────────────────────────────

type Nivel = 'rojo' | 'ambar' | 'verde';

type Alerta = {
  nivel: Nivel;
  titulo: string;
  detalle: string;
  href: string;
  hrefLabel: string;
};

function etiquetaCuota(numero: number): string {
  return numero === 0 ? 'Cobro inicial' : `Cuota ${numero}`;
}

function construirAlertas(
  funnel: FunnelMes,
  maduras: ResumenComercialMaduras,
  pipeline: DistribucionPipeline,
  cuotas: { vencidas: CuotaPendiente[]; porVencer: CuotaPendiente[] },
  pendientes: Pendientes,
): Alerta[] {
  const alertas: Alerta[] = [];

  // ── Pendientes de marcar (Fase 9): ROJA, arriba de TODO ──
  // Si hay datos manuales sin cargar, el resto del tablero lee datos viejos.
  // Se empuja PRIMERO y, como el sort es estable y es 'rojo', queda arriba.
  if (pendientes.total > 0) {
    const partes: string[] = [];
    if (pendientes.porTipo.A > 0) partes.push(`${pendientes.porTipo.A} sin asistencia a J1`);
    if (pendientes.porTipo.B > 0) partes.push(`${pendientes.porTipo.B} sin J2 ni resolución`);
    if (pendientes.porTipo.C > 0) partes.push(`${pendientes.porTipo.C} sin asistencia a J2`);
    alertas.push({
      nivel: 'rojo',
      titulo: `Tenés ${pendientes.total} dato${pendientes.total === 1 ? '' : 's'} sin marcar — el tablero está leyendo datos viejos`,
      detalle: `${partes.join(' · ')}. Marcalos para que los números vuelvan a ser confiables.`,
      href: '/leads?pendientes=1',
      hrefLabel: 'Marcar pendientes',
    });
  }

  // ── Etapas de MARKETING del mes (8E: diagnóstico por etapa) ──
  const diagnosticos: Record<string, string> = {
    imp_click:
      'CTR de link bajo: pocos clicks por impresión. Revisá el creativo, el copy y la segmentación.',
    click_landing:
      'Clickean pero no cargan la landing. Revisá velocidad de la página y que el anuncio prometa lo mismo que muestra.',
    landing_vsl:
      'Entran a la landing pero no ven el VSL. Revisá: ¿el video se ve al entrar sin scrollear? ¿la página carga rápido? ¿el anuncio promete lo mismo que muestra la landing?',
    vsl_agenda:
      'Ven el VSL pero no agendan. Revisá el CTA del video y la fricción del calendario.',
  };

  for (const etapa of funnel.etapas) {
    if (!(etapa.key in diagnosticos)) continue; // comerciales se evalúan con maduras
    if (etapa.salud !== 'rojo' && etapa.salud !== 'ambar') continue;
    const esCuello = funnel.cuelloKey === etapa.key;
    alertas.push({
      nivel: esCuello ? 'rojo' : etapa.salud === 'rojo' ? 'rojo' : 'ambar',
      titulo: `${esCuello ? 'Cuello de botella: ' : ''}${etapa.label} en ${etapa.pct !== null ? etapa.pct.toFixed(1) + '%' : '—'}`,
      detalle: diagnosticos[etapa.key],
      href: '/',
      hrefLabel: 'Ver Marketing',
    });
  }

  // ── No-show en cohortes maduras ── (guardia Fase 7: n >= 3)
  if (maduras.total_j1 >= 3) {
    const noShow = ((maduras.total_j1 - maduras.asistencias) / maduras.total_j1) * 100;
    if (noShow > 35) {
      alertas.push({
        nivel: noShow > 50 ? 'rojo' : 'ambar',
        titulo: `No-show de ${noShow.toFixed(0)}% en cohortes maduras`,
        detalle:
          'Muchos agendan y no llegan a J1. Revisá recordatorios automáticos (WhatsApp/email 24h y 1h antes) y la calificación previa del formulario.',
        href: '/leads?noshow=1',
        hrefLabel: 'Ver no-shows',
      });
    }
  }

  // ── Tasa de cierre en maduras ──
  if (maduras.tasa_cierre_madura !== null && maduras.limpias >= 3) {
    if (maduras.tasa_cierre_madura >= 30) {
      alertas.push({
        nivel: 'verde',
        titulo: `Tu venta funciona: ${maduras.tasa_cierre_madura.toFixed(0)}% de cierre sobre limpias`,
        detalle:
          'El sistema de venta está sano. Si querés más cierres, el foco es marketing: más volumen o mejor calidad de lead.',
        href: '/comercial',
        hrefLabel: 'Ver Comercial',
      });
    } else if (maduras.tasa_cierre_madura < 20) {
      alertas.push({
        nivel: 'rojo',
        titulo: `Tasa de cierre baja: ${maduras.tasa_cierre_madura.toFixed(0)}% en cohortes maduras`,
        detalle:
          'Califican pero no cierran. Revisá la oferta y el manejo de objeciones en la J2 — y si el monto/forma de pago es el correcto para tu perfil de cliente.',
        href: '/comercial',
        hrefLabel: 'Ver Comercial',
      });
    }
  }

  // ── Cuotas VENCIDAS (rojo) — una línea por cuota (Fase 8-bis) ──
  for (const c of cuotas.vencidas) {
    const diasVencida = Math.abs(c.dias);
    alertas.push({
      nivel: 'rojo',
      titulo: `${etiquetaCuota(c.numero)} de ${c.lead_nombre} venció el ${fmtFechaCorta(c.fecha_esperada)}: ${fmtUSD(c.monto_usd)}`,
      detalle: `Vencida hace ${diasVencida} ${diasVencida === 1 ? 'día' : 'días'}. Contactá al cliente y registrá el cobro cuando entre.`,
      href: `/leads/${c.lead_id}`,
      hrefLabel: 'Ver lead',
    });
  }

  // ── Cuotas por vencer en ≤3 días (ámbar) ──
  for (const c of cuotas.porVencer) {
    alertas.push({
      nivel: 'ambar',
      titulo: `${etiquetaCuota(c.numero)} de ${c.lead_nombre} vence ${c.dias === 0 ? 'hoy' : `en ${c.dias} ${c.dias === 1 ? 'día' : 'días'}`}: ${fmtUSD(c.monto_usd)}`,
      detalle: 'Anticipá el cobro: confirmá con el cliente antes de la fecha.',
      href: `/leads/${c.lead_id}`,
      hrefLabel: 'Ver lead',
    });
  }

  // ── Pipeline maduro ──
  if (pipeline.total > 0 && pipeline.pct_madura > 60) {
    alertas.push({
      nivel: 'verde',
      titulo: 'Pipeline mayormente maduro',
      detalle: 'La tasa de cierre que ves ya es confiable como predictor del negocio.',
      href: '/comercial',
      hrefLabel: 'Ver Comercial',
    });
  }

  // Orden: rojas → ámbar → verdes
  const peso: Record<Nivel, number> = { rojo: 0, ambar: 1, verde: 2 };
  alertas.sort((a, b) => peso[a.nivel] - peso[b.nivel]);
  return alertas;
}

// ─────────────────────────────────────────────────────────────────────────────
// Page
// ─────────────────────────────────────────────────────────────────────────────

export default async function GeneralPage() {
  const ayerReal = ayerEnTijuana();
  const mesInicio = primerDiaDelMesDeFecha(ayerReal);
  // Mes anterior: del 1 del mes pasado al día antes del 1 de este mes
  const mesAnteriorFin = diasAntes(mesInicio, 1);
  const mesAnteriorInicio = primerDiaDelMesDeFecha(mesAnteriorFin);

  let funnel: FunnelMes | null = null;
  let maduras: ResumenComercialMaduras | null = null;
  let pipeline: DistribucionPipeline | null = null;
  let cuotas: { vencidas: CuotaPendiente[]; porVencer: CuotaPendiente[] } = {
    vencidas: [],
    porVencer: [],
  };
  let pendientes: Pendientes = { items: [], total: 0, porTipo: { A: 0, B: 0, C: 0 } };
  let juntas: JuntaProxima[] = [];
  let cola: ColaItem[] = [];
  let objetivo: ObjetivoProgreso | null = null;
  let comparativo: ResumenComparativo | null = null;
  let errorMsg: string | null = null;

  const hoyReal = hoyEnTijuana();

  try {
    const sourceMap = sourcesToMap(await getDataSources());
    const [f, m, p, cuo, pend, jun, col, obj, comp] = await Promise.all([
      getFunnelEtapas(mesInicio, ayerReal, sourceMap),
      getResumenComercialMaduras(),
      getDistribucionPipeline(),
      getCuotasPendientes(ayerReal),
      getPendientesDeMarcar(hoyReal),
      getJuntasProximas(hoyReal, 2),
      getColaDeAccion(hoyReal),
      getObjetivoProgreso(hoyReal),
      getResumenComparativo(mesInicio, ayerReal, mesAnteriorInicio, mesAnteriorFin),
    ]);
    funnel = f;
    maduras = m;
    pipeline = p;
    cuotas = cuo;
    pendientes = pend;
    juntas = jun;
    cola = col;
    objetivo = obj;
    comparativo = comp;
  } catch (err) {
    errorMsg = err instanceof Error ? err.message : String(err);
  }

  return (
    <main className="min-h-screen w-full px-6 py-8 md:px-12 md:py-12 bg-[var(--bg)] text-[var(--text)]">
      <DashboardHeader fechaAyer={ayerReal} />
      <DashboardTabs active="general" />

      {errorMsg || !funnel || !maduras || !pipeline || !comparativo ? (
        <div
          className="rounded-lg p-6 border"
          style={{ borderColor: 'var(--accent-orange)', background: '#2a1410' }}
        >
          <p className="text-lg font-semibold mb-1" style={{ color: 'var(--accent-orange)' }}>
            Error consultando datos
          </p>
          <p className="text-base font-mono" style={{ color: 'var(--text-dim)' }}>
            {errorMsg ?? 'Sin datos'}
          </p>
        </div>
      ) : (
        <GeneralContent
          alertas={construirAlertas(funnel, maduras, pipeline, cuotas, pendientes)}
          juntas={juntas}
          cola={cola}
          objetivo={objetivo}
          pipeline={pipeline}
          comparativo={comparativo}
          notaConfiabilidad={
            pendientes.total > 0
              ? 'Confiabilidad limitada hasta marcar pendientes'
              : null
          }
        />
      )}
    </main>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Contenido (veredicto + alertas + pipeline + resumen)
// ─────────────────────────────────────────────────────────────────────────────

function GeneralContent({
  alertas,
  juntas,
  cola,
  objetivo,
  pipeline,
  comparativo,
  notaConfiabilidad,
}: {
  alertas: Alerta[];
  juntas: JuntaProxima[];
  cola: ColaItem[];
  objetivo: ObjetivoProgreso | null;
  pipeline: DistribucionPipeline;
  comparativo: ResumenComparativo;
  notaConfiabilidad: string | null;
}) {
  const urgentes = alertas.filter((a) => a.nivel === 'rojo').length;
  const vigilar = alertas.filter((a) => a.nivel === 'ambar').length;
  const enOrden = alertas.filter((a) => a.nivel === 'verde').length;

  // La alerta roja de pendientes va arriba de todo (Fase 11); el resto del
  // semáforo diagnóstico queda debajo del bloque operativo.
  const alertaPendientes = alertas.find((a) => a.href === '/leads?pendientes=1') ?? null;
  const alertasResto = alertas.filter((a) => a.href !== '/leads?pendientes=1');

  const veredicto =
    urgentes > 0
      ? { texto: 'Hay algo urgente que atender', color: 'var(--accent-orange)', emoji: '🔴' }
      : vigilar > 0
      ? { texto: 'En general bien — hay cosas que vigilar', color: 'var(--accent-yellow)', emoji: '🟡' }
      : { texto: 'El negocio está sano', color: 'var(--accent-green)', emoji: '🟢' };

  return (
    <div className="space-y-6 md:space-y-8">
      {/* 1) PENDIENTES (alerta roja, arriba de todo) */}
      {alertaPendientes && <AlertaCard alerta={alertaPendientes} />}

      {/* 2) TUS JUNTAS (hoy y mañana) */}
      <TusJuntas juntas={juntas} />

      {/* 3) COLA DE ACCIÓN */}
      <ColaDeAccion items={cola} />

      {/* 4) OBJETIVO GLOBAL (acumulado, no atado al filtro) */}
      {objetivo && <ObjetivoBloque progreso={objetivo} />}

      {/* 5) VEREDICTO + diagnóstico */}
      <section
        className="rounded-xl border p-6 md:p-8 flex flex-wrap items-center justify-between gap-4"
        style={{ background: 'var(--card-bg)', borderColor: veredicto.color, borderWidth: 2 }}
      >
        <div className="flex items-center gap-4">
          <span className="text-5xl leading-none">{veredicto.emoji}</span>
          <div>
            <h2
              className="text-[34px] leading-tight"
              style={{ fontFamily: 'var(--font-cormorant)', fontWeight: 500, color: veredicto.color }}
            >
              {veredicto.texto}
            </h2>
            {notaConfiabilidad && (
              <p className="text-base mt-1" style={{ color: 'var(--accent-orange)' }}>
                ⚠ {notaConfiabilidad}
              </p>
            )}
          </div>
        </div>
        <div className="flex gap-5 text-base" style={{ color: 'var(--text-dim)' }}>
          <span>🔴 <strong style={{ color: 'var(--text)' }}>{urgentes}</strong> urgente{urgentes === 1 ? '' : 's'}</span>
          <span>🟡 <strong style={{ color: 'var(--text)' }}>{vigilar}</strong> vigilar</span>
          <span>🟢 <strong style={{ color: 'var(--text)' }}>{enOrden}</strong> en orden</span>
        </div>
      </section>

      {/* ALERTAS diagnósticas (sin la de pendientes, ya mostrada arriba) */}
      {alertasResto.length > 0 && (
        <div className="space-y-4">
          {alertasResto.map((a, i) => (
            <AlertaCard key={i} alerta={a} />
          ))}
        </div>
      )}

      {/* PIPELINE */}
      <PipelineCard data={pipeline} />

      {/* RESUMEN DEL MES */}
      <ResumenMes comparativo={comparativo} />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// TusJuntas — J1/J2 de hoy y mañana con contexto (Fase 11)
// ─────────────────────────────────────────────────────────────────────────────
function TusJuntas({ juntas }: { juntas: JuntaProxima[] }) {
  return (
    <section>
      <h2 className="text-[28px] mb-3" style={{ fontFamily: 'var(--font-cormorant)', fontWeight: 500 }}>
        Tus juntas
      </h2>
      {juntas.length === 0 ? (
        <p className="text-base" style={{ color: 'var(--text-dim)' }}>Sin juntas hoy ni mañana.</p>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {juntas.map((j) => (
            <JuntaCard key={`${j.lead_id}-${j.tipo}-${j.fecha}`} junta={j} />
          ))}
        </div>
      )}
    </section>
  );
}

function JuntaCard({ junta }: { junta: JuntaProxima }) {
  const respuestas = [
    { label: 'Facturación', value: junta.respuestas.facturacion },
    { label: 'Equipo', value: junta.respuestas.colaboradores },
    { label: 'Objetivo', value: junta.respuestas.objetivo },
    { label: 'Cuándo', value: junta.respuestas.cuando_empezar },
  ].filter((r) => r.value && r.value.trim());

  return (
    <div
      className="rounded-xl border p-5"
      style={{ background: 'var(--card-bg)', borderColor: 'var(--card-border)' }}
    >
      <div className="flex items-center justify-between gap-3 flex-wrap mb-2">
        <div className="flex items-center gap-2">
          <span
            className="px-2.5 py-1 rounded-full text-sm font-semibold"
            style={{
              background: junta.tipo === 'J1' ? 'rgba(240,198,10,0.15)' : 'rgba(62,207,142,0.15)',
              color: junta.tipo === 'J1' ? 'var(--accent-yellow)' : 'var(--accent-green)',
            }}
          >
            {junta.tipo} · {junta.dia}
          </span>
          {junta.agendo_sin_vsl ? (
            <span
              className="px-2.5 py-1 rounded-full text-sm font-semibold"
              style={{ background: 'rgba(255,107,53,0.15)', color: 'var(--accent-orange)' }}
            >
              ⚠ agendó sin ver el VSL
            </span>
          ) : (
            <span className="text-sm" style={{ color: 'var(--text-dim)' }}>
              vio el VSL {junta.vsl_plays}×
            </span>
          )}
        </div>
        <Link href={`/leads/${junta.lead_id}`} className="text-sm" style={{ color: 'var(--accent-yellow)' }}>
          Abrir ficha →
        </Link>
      </div>

      <div className="text-xl" style={{ fontWeight: 600 }}>{junta.nombre}</div>
      <div className="text-base mb-3" style={{ color: 'var(--text-dim)' }}>
        {junta.empresa ?? 'Sin empresa'} · de {junta.origen}
      </div>

      {respuestas.length > 0 ? (
        <div className="space-y-1.5">
          {respuestas.map((r) => (
            <div key={r.label} className="text-base">
              <span className="text-sm uppercase tracking-wider mr-2" style={{ color: 'var(--text-dim)' }}>
                {r.label}
              </span>
              <span>{r.value}</span>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-sm" style={{ color: 'var(--text-pending)' }}>
          Sin respuestas del formulario (lead manual u orgánico).
        </p>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// ColaDeAccion — pendientes concretos del día (Fase 11)
// ─────────────────────────────────────────────────────────────────────────────
const COLA_LABEL: Record<ColaItem['tipo'], string> = {
  pendiente_marcar: 'Marcar asistencia',
  cobro_vencido: 'Cobranza',
  j2_sin_match: 'J2 sin match',
  noshow_recontactar: 'Recontactar no-shows',
  form_sin_agenda: 'Formularios sin agenda',
  j1_sin_j2: 'Sin J2 ni resolución',
};
const COLA_ORDEN: Array<ColaItem['tipo']> = [
  'pendiente_marcar', 'cobro_vencido', 'j2_sin_match', 'noshow_recontactar', 'form_sin_agenda', 'j1_sin_j2',
];

function ColaDeAccion({ items }: { items: ColaItem[] }) {
  return (
    <section>
      <h2 className="text-[28px] mb-3" style={{ fontFamily: 'var(--font-cormorant)', fontWeight: 500 }}>
        Cola de acción
      </h2>
      {items.length === 0 ? (
        <p className="text-base" style={{ color: 'var(--accent-green)' }}>Nada urgente — todo al día.</p>
      ) : (
        <div className="space-y-5">
          {COLA_ORDEN.map((tipo) => {
            const grupo = items.filter((i) => i.tipo === tipo);
            if (grupo.length === 0) return null;
            return (
              <div key={tipo}>
                <div className="text-sm uppercase tracking-wider mb-2" style={{ color: 'var(--text-dim)' }}>
                  {COLA_LABEL[tipo]} · {grupo.length}
                </div>
                <div className="space-y-2">
                  {grupo.map((item, i) => (
                    <ColaCard key={`${tipo}-${item.lead_id ?? 'x'}-${i}`} item={item} />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

function ColaCard({ item }: { item: ColaItem }) {
  const inline = item.tipo === 'pendiente_marcar' || item.tipo === 'j1_sin_j2';
  return (
    <div
      className="rounded-lg border p-4 flex flex-col md:flex-row md:items-center md:justify-between gap-3"
      style={{ background: 'var(--card-bg)', borderColor: 'var(--card-border)' }}
    >
      <div className="min-w-0">
        <div className="text-base" style={{ fontWeight: 600 }}>{item.titulo}</div>
        <div className="text-sm" style={{ color: 'var(--text-dim)' }}>{item.detalle}</div>
      </div>
      {inline && item.lead_id != null && item.pendiente_tipo ? (
        <PendienteActions
          leadId={item.lead_id}
          tipo={item.pendiente_tipo}
          motivoActual={item.motivo_actual ?? null}
        />
      ) : (
        <Link
          href={item.link}
          className="shrink-0 px-4 py-2 rounded-lg border text-base text-center"
          style={{ borderColor: 'var(--accent-yellow)', color: 'var(--accent-yellow)' }}
        >
          {item.accion} →
        </Link>
      )}
    </div>
  );
}

function colorDe(nivel: Nivel): string {
  return nivel === 'rojo'
    ? 'var(--accent-orange)'
    : nivel === 'ambar'
    ? 'var(--accent-yellow)'
    : 'var(--accent-green)';
}

function AlertaCard({ alerta }: { alerta: Alerta }) {
  const color = colorDe(alerta.nivel);
  return (
    <section
      className="rounded-xl border p-5 md:p-6"
      style={{
        background: 'var(--card-bg)',
        borderColor: 'var(--card-border)',
        borderLeft: `4px solid ${color}`,
      }}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex-1 min-w-[260px]">
          <h3 className="text-xl mb-1" style={{ color, fontWeight: 600 }}>
            {alerta.titulo}
          </h3>
          <p className="text-base leading-relaxed" style={{ color: 'var(--text-dim)' }}>
            {alerta.detalle}
          </p>
        </div>
        <Link
          href={alerta.href}
          className="shrink-0 px-4 py-2 rounded-lg border text-base"
          style={{ borderColor: 'var(--card-border)', color: 'var(--text-dim)' }}
        >
          {alerta.hrefLabel} →
        </Link>
      </div>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// PipelineCard — distribución de leads activos por madurez
// ─────────────────────────────────────────────────────────────────────────────

function PipelineCard({ data }: { data: DistribucionPipeline }) {
  let interpretacion: { texto: string; color: string };
  if (data.total === 0) {
    interpretacion = {
      texto: 'No hay leads activos (asistieron a J1 y aún no cierran).',
      color: 'var(--text-dim)',
    };
  } else if (data.pct_madura > 60) {
    interpretacion = {
      texto: 'Pipeline maduro, tasa de cierre confiable.',
      color: 'var(--accent-green)',
    };
  } else if (data.pct_reciente > 60) {
    interpretacion = {
      texto: 'Pipeline nuevo, esperá 2 semanas para evaluar.',
      color: 'var(--text-pending)',
    };
  } else {
    interpretacion = {
      texto: 'Pipeline mixto, confiabilidad parcial.',
      color: 'var(--accent-yellow)',
    };
  }

  return (
    <section
      className="rounded-xl border p-6 md:p-8"
      style={{ background: 'var(--card-bg)', borderColor: 'var(--card-border)' }}
    >
      <h2
        className="text-[28px]"
        style={{ fontFamily: 'var(--font-cormorant)', fontWeight: 500 }}
      >
        Estado del pipeline
      </h2>
      <p className="text-base mt-1 mb-5" style={{ color: 'var(--text-dim)' }}>
        {data.total} lead{data.total === 1 ? '' : 's'} activo{data.total === 1 ? '' : 's'} (asistió a J1, no ha cerrado).
      </p>

      {data.total > 0 && (
        <>
          <div
            className="flex w-full h-8 rounded-md overflow-hidden border"
            style={{ borderColor: 'var(--card-border)' }}
          >
            {data.reciente > 0 && (
              <div
                title={`Reciente: ${data.reciente}`}
                style={{ width: `${data.pct_reciente}%`, background: 'var(--text-dim)' }}
              />
            )}
            {data.madurando > 0 && (
              <div
                title={`Madurando: ${data.madurando}`}
                style={{ width: `${data.pct_madurando}%`, background: 'var(--accent-yellow)' }}
              />
            )}
            {data.madura > 0 && (
              <div
                title={`Madura: ${data.madura}`}
                style={{ width: `${data.pct_madura}%`, background: 'var(--accent-green)' }}
              />
            )}
          </div>
          <div className="flex flex-wrap gap-x-6 gap-y-2 mt-4 text-base">
            <span style={{ color: 'var(--text-dim)' }}>
              ⚪ Reciente: <strong>{data.reciente}</strong> ({data.pct_reciente.toFixed(0)}%)
            </span>
            <span style={{ color: 'var(--accent-yellow)' }}>
              🟡 Madurando: <strong>{data.madurando}</strong> ({data.pct_madurando.toFixed(0)}%)
            </span>
            <span style={{ color: 'var(--accent-green)' }}>
              🟢 Madura: <strong>{data.madura}</strong> ({data.pct_madura.toFixed(0)}%)
            </span>
          </div>
        </>
      )}

      <p className="mt-5 text-lg" style={{ color: interpretacion.color }}>
        {interpretacion.texto}
      </p>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Resumen del mes — 4 números con flecha de tendencia vs mes anterior
// ─────────────────────────────────────────────────────────────────────────────

function Tendencia({ actual, anterior, invertir = false }: { actual: number; anterior: number; invertir?: boolean }) {
  if (anterior === 0 && actual === 0) {
    return <span style={{ color: 'var(--text-pending)' }}>→</span>;
  }
  const sube = actual > anterior;
  const igual = actual === anterior;
  if (igual) return <span style={{ color: 'var(--text-pending)' }}>→</span>;
  // invertir=true → subir es "malo" (ej: inversión) → color neutro
  const color = invertir
    ? 'var(--text-dim)'
    : sube
    ? 'var(--accent-green)'
    : 'var(--accent-orange)';
  return <span style={{ color }}>{sube ? '↑' : '↓'}</span>;
}

function ResumenMes({ comparativo }: { comparativo: ResumenComparativo }) {
  const items = [
    {
      label: 'Inversión',
      valor: fmtUSD(comparativo.inversion_usd.actual),
      anterior: fmtUSD(comparativo.inversion_usd.anterior),
      nodo: <Tendencia actual={comparativo.inversion_usd.actual} anterior={comparativo.inversion_usd.anterior} invertir />,
    },
    {
      label: 'Agendas',
      valor: fmtNumber(comparativo.agendas.actual),
      anterior: fmtNumber(comparativo.agendas.anterior),
      nodo: <Tendencia actual={comparativo.agendas.actual} anterior={comparativo.agendas.anterior} />,
    },
    {
      label: 'Cash collected',
      valor: fmtUSD(comparativo.cash_usd.actual),
      anterior: fmtUSD(comparativo.cash_usd.anterior),
      nodo: <Tendencia actual={comparativo.cash_usd.actual} anterior={comparativo.cash_usd.anterior} />,
    },
    {
      label: 'Cierres',
      valor: fmtNumber(comparativo.cierres.actual),
      anterior: fmtNumber(comparativo.cierres.anterior),
      nodo: <Tendencia actual={comparativo.cierres.actual} anterior={comparativo.cierres.anterior} />,
    },
  ];

  return (
    <section
      className="rounded-xl border p-6 md:p-8"
      style={{ background: 'var(--card-bg)', borderColor: 'var(--card-border)' }}
    >
      <h2
        className="text-[28px] mb-1"
        style={{ fontFamily: 'var(--font-cormorant)', fontWeight: 500 }}
      >
        Resumen del mes
      </h2>
      <p className="text-base mb-5" style={{ color: 'var(--text-dim)' }}>
        Mes en curso vs mes anterior completo.
      </p>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {items.map((item) => (
          <div
            key={item.label}
            className="rounded-lg border p-4"
            style={{ borderColor: 'var(--card-border)', background: '#0f0f0f' }}
          >
            <div className="text-sm uppercase tracking-wider mb-2" style={{ color: 'var(--text-dim)' }}>
              {item.label}
            </div>
            <div className="text-[26px] font-semibold tabular-nums flex items-center gap-2">
              {item.valor} {item.nodo}
            </div>
            <div className="text-sm mt-1" style={{ color: 'var(--text-pending)' }}>
              mes anterior: {item.anterior}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
