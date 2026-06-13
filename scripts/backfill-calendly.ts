// =============================================================================
// Backfill histórico de Calendly (Implementación v2, Fase 2-bis)
// =============================================================================
// Importa el historial de agendas de Calendly como leads, con su atribución
// UTM. Completa cohortes viejas (campaña de diciembre) y hace posible que el
// objetivo (Fase 14) cuente cierres reales.
//
// Uso:
//   npx tsx scripts/backfill-calendly.ts --dry      (simula, no escribe)
//   npx tsx scripts/backfill-calendly.ts            (escribe en producción)
//
// Reglas de no-destrucción (vía upsertLeadFromCalendly con soloCompletarVacios):
//   - Lead existente: solo completa campos VACÍOS. Nunca pisa datos cargados
//     ni campos manuales (asistencias, resolución, cobranza).
//   - utm_term con formato UUID = visitor_id del beacon: se guarda solo si el
//     lead no tiene uno (conecta retroactivamente lo que vio del VSL).
//   - Idempotente: correrlo dos veces no duplica ni cambia nada.
// =============================================================================

import { config } from 'dotenv';
import { resolve } from 'node:path';

config({ path: resolve(process.cwd(), '.env.local') });

import { upsertLeadFromCalendly } from '../lib/leads';
import { isoToFechaTijuana, extractAnswer } from '../lib/calendly';

const API = 'https://api.calendly.com';
const MIN_START_TIME = '2025-12-01T00:00:00Z';
const PAUSA_MS = 300;
const DRY = process.argv.includes('--dry');

// Emails de PRUEBA que Mauricio borró a propósito en sesiones anteriores
// (su coach Martin, él mismo probando, y agendas de prueba). No re-importar.
const EXCLUIR_EMAILS = new Set([
  'martinkoncke@gmail.com',
  'bustoseguia@gmail.com',
  'leandrotejadogonzalvez@gmail.com',
  'tejadomartin@gmail.com',
]);

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function sleep(ms: number): Promise<void> {
  return new Promise((res) => setTimeout(res, ms));
}

function token(): string {
  const t = process.env.CALENDLY_API_TOKEN;
  if (!t) throw new Error('Falta CALENDLY_API_TOKEN en .env.local');
  return t;
}

async function calendlyGet<T>(url: string): Promise<T> {
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json' },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Calendly ${res.status} en ${url}: ${body.slice(0, 200)}`);
  }
  return (await res.json()) as T;
}

type ScheduledEvent = {
  uri: string;
  name?: string;
  start_time: string;
  status: string;
};

type Invitee = {
  email?: string;
  name?: string;
  created_at?: string;
  questions_and_answers?: Array<{ question?: string; answer?: string }>;
  tracking?: {
    utm_source?: string | null;
    utm_medium?: string | null;
    utm_campaign?: string | null;
    utm_content?: string | null;
    utm_term?: string | null;
  };
};

async function main() {
  console.log(`▶ Backfill Calendly${DRY ? ' (DRY RUN — no escribe)' : ''}`);
  console.log(`  Eventos desde: ${MIN_START_TIME}\n`);

  // a) Organización
  const me = await calendlyGet<{ resource: { current_organization: string } }>(
    `${API}/users/me`,
  );
  const org = me.resource.current_organization;
  console.log(`  Organización: ${org}\n`);

  // b) Listar scheduled_events paginando
  const eventos: ScheduledEvent[] = [];
  let pageUrl: string | null =
    `${API}/scheduled_events?organization=${encodeURIComponent(org)}` +
    `&status=active&min_start_time=${encodeURIComponent(MIN_START_TIME)}&count=100`;

  while (pageUrl) {
    const page: {
      collection: ScheduledEvent[];
      pagination: { next_page?: string | null };
    } = await calendlyGet(pageUrl);
    eventos.push(...page.collection);
    pageUrl = page.pagination.next_page ?? null;
    await sleep(PAUSA_MS);
  }
  console.log(`  Eventos encontrados: ${eventos.length}\n`);

  // c) Por cada evento, traer invitees y cargar
  let creados = 0;
  let completados = 0;
  let saltados = 0;
  const errores: string[] = [];

  for (const ev of eventos) {
    const uuid = ev.uri.split('/').pop();
    try {
      const inviteesResp = await calendlyGet<{ collection: Invitee[] }>(
        `${ev.uri}/invitees`,
      );
      for (const inv of inviteesResp.collection) {
        const email = inv.email?.trim();
        if (!email || !email.includes('@')) {
          saltados++;
          continue;
        }
        // Excluir leads de prueba que se borraron a propósito
        if (EXCLUIR_EMAILS.has(email.toLowerCase())) {
          saltados++;
          continue;
        }
        const nombre = (inv.name ?? email.split('@')[0]).trim();

        const empresa = extractAnswer(inv.questions_and_answers, [
          'empresa', 'company', 'organiz',
        ]);
        const telefono = extractAnswer(inv.questions_and_answers, [
          'tel', 'phone', 'celular', 'móvil', 'movil',
        ]);
        const respuesta_facturacion = extractAnswer(inv.questions_and_answers, [
          'facturación', 'facturacion', 'presupuesto', 'budget', 'ingreso anual', 'ingresos',
        ]);
        const respuesta_colaboradores = extractAnswer(inv.questions_and_answers, [
          'colaborador', 'equipo', 'empleado', 'tamaño', 'tamano', 'cuántas personas', 'cuantas personas',
        ]);
        const respuesta_objetivo = extractAnswer(inv.questions_and_answers, [
          'objetivo', 'lograr', 'meta', 'qué quieres', 'que quieres', 'qué querés', 'que queres',
        ]);
        const respuesta_cuando_empezar = extractAnswer(inv.questions_and_answers, [
          'cuándo empezar', 'cuando empezar', 'cuándo iniciar', 'cuando iniciar',
          'cuándo te gustaría', 'cuando te gustaria', 'urgencia', 'cuándo comenzar', 'cuando comenzar',
        ]);

        const tk = inv.tracking;
        const utmTerm = tk?.utm_term?.trim() || null;
        // utm_term con formato UUID = visitor_id del beacon del VSL
        const visitor_id = utmTerm && UUID_RE.test(utmTerm) ? utmTerm : null;

        const fechaAgenda = inv.created_at
          ? isoToFechaTijuana(inv.created_at)
          : isoToFechaTijuana(ev.start_time);
        const fechaJ1 = isoToFechaTijuana(ev.start_time);

        if (DRY) {
          console.log(`  [dry] ${nombre} <${email}> J1=${fechaJ1} utm=${tk?.utm_campaign ?? '—'} vsl=${visitor_id ? 'sí' : 'no'}`);
          continue;
        }

        const { created } = await upsertLeadFromCalendly(
          {
            email,
            nombre,
            fecha_agenda: fechaAgenda,
            fecha_junta_1: fechaJ1,
            empresa,
            telefono,
            utm_source: tk?.utm_source ?? null,
            utm_medium: tk?.utm_medium ?? null,
            utm_campaign: tk?.utm_campaign ?? null,
            utm_content: tk?.utm_content ?? null,
            respuesta_facturacion,
            respuesta_colaboradores,
            respuesta_objetivo,
            respuesta_cuando_empezar,
            visitor_id,
          },
          {
            soloCompletarVacios: true,
            // Backdatea created_at al momento real en que agendó
            fechaCreacion: inv.created_at ?? ev.start_time,
          },
        );
        if (created) {
          creados++;
          console.log(`  + ${nombre} <${email}> J1=${fechaJ1}`);
        } else {
          completados++;
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errores.push(`evento ${uuid}: ${msg}`);
      console.error(`  ERROR ${uuid}: ${msg}`);
    }
    await sleep(PAUSA_MS);
  }

  console.log('\n──────── RESUMEN ────────');
  console.log(`Eventos leídos       : ${eventos.length}`);
  console.log(`Leads creados        : ${creados}`);
  console.log(`Existentes (revisados): ${completados}`);
  console.log(`Invitees saltados    : ${saltados}`);
  console.log(`Errores              : ${errores.length}`);
  for (const e of errores) console.log(`  - ${e}`);
  process.exit(errores.length > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
