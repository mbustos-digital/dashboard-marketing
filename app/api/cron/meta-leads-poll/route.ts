// =============================================================================
// Cron: polling diario de leads de Meta (red de seguridad del webhook)
// =============================================================================
// (Implementación v2, Fase 4 — cubre #5)
//
// El webhook de Meta (app/api/webhooks/meta-leads) recibe leads en tiempo
// real. Este cron lo respalda: una vez por día repasa los formularios de la
// página y trae los leads recientes. Como upsertLeadFromMeta deduplica por
// meta_lead_id, repasar no duplica nada.
//
// También sirve de BACKFILL inicial: GET ?dias=90 trae toda la ventana de
// 90 días que Meta retiene (reemplaza la importación del CSV).
//
// Auth: Bearer ${CRON_SECRET} (mismo patrón que meta-daily).
// =============================================================================

import type { NextRequest } from 'next/server';
import { upsertLeadFromMeta } from '@/lib/leads';
import {
  parseLeadFields,
  META_GRAPH_VERSION,
  type MetaFieldData,
} from '@/lib/meta-leads';
import { META_PAGE_ID } from '@/lib/config';

export const dynamic = 'force-dynamic';

const GRAPH = 'https://graph.facebook.com';
const PAGE_SIZE = 100;
const MAX_PAGES = 100; // tope de seguridad (con dias=90 y 2 forms ~ varias páginas)

function checkAuth(request: NextRequest): Response | null {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return Response.json({ ok: false, error: 'CRON_SECRET no configurado' }, { status: 500 });
  }
  if (request.headers.get('authorization') !== `Bearer ${cronSecret}`) {
    return Response.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }
  return null;
}

function pageToken(): string {
  const t = process.env.META_PAGE_ACCESS_TOKEN;
  if (!t || t.startsWith('PENDING')) {
    throw new Error('META_PAGE_ACCESS_TOKEN no configurado');
  }
  return t;
}

type GraphPage<T> = {
  data?: T[];
  paging?: { next?: string };
  error?: { code?: number; message?: string };
};

async function graphGet<T>(url: string): Promise<GraphPage<T>> {
  const res = await fetch(url);
  const body = (await res.json()) as GraphPage<T>;
  if (body.error) {
    throw new Error(`Graph error (${body.error.code}): ${body.error.message}`);
  }
  return body;
}

type FormRow = { id?: string; name?: string };
type LeadRow = {
  id?: string;
  created_time?: string;
  ad_id?: string;
  ad_name?: string;
  adset_name?: string;
  campaign_name?: string;
  field_data?: MetaFieldData;
};

export async function GET(request: NextRequest) {
  const authFail = checkAuth(request);
  if (authFail) return authFail;

  const dias = Math.max(1, Number(request.nextUrl.searchParams.get('dias') ?? 7));
  const corteMs = Date.now() - dias * 86400_000;
  const tStart = Date.now();

  try {
    const token = pageToken();

    // 1) Listar formularios activos de la página
    const forms: FormRow[] = [];
    let formsUrl: string | null =
      `${GRAPH}/${META_GRAPH_VERSION}/${META_PAGE_ID}/leadgen_forms` +
      `?fields=id,name&limit=${PAGE_SIZE}&access_token=${token}`;
    let formPages = 0;
    while (formsUrl && formPages++ < MAX_PAGES) {
      const page: GraphPage<FormRow> = await graphGet<FormRow>(formsUrl);
      if (Array.isArray(page.data)) forms.push(...page.data);
      formsUrl = page.paging?.next ?? null;
    }

    // 2) Por cada form, traer leads recientes y upsertear
    let vistos = 0;
    let creados = 0;
    let existentes = 0;
    const errores: string[] = [];

    for (const form of forms) {
      if (!form.id) continue;
      let leadsUrl: string | null =
        `${GRAPH}/${META_GRAPH_VERSION}/${form.id}/leads` +
        `?fields=created_time,ad_id,ad_name,adset_name,campaign_name,field_data` +
        `&limit=${PAGE_SIZE}&access_token=${token}`;
      let leadPages = 0;
      let cortar = false;

      while (leadsUrl && !cortar && leadPages++ < MAX_PAGES) {
        const page: GraphPage<LeadRow> = await graphGet<LeadRow>(leadsUrl);
        for (const lr of page.data ?? []) {
          // Cortar cuando los leads se vuelven más viejos que la ventana
          if (lr.created_time && new Date(lr.created_time).getTime() < corteMs) {
            cortar = true;
            break;
          }
          if (!lr.id) continue;
          vistos++;
          try {
            const { email, nombre, telefono, empresa } = parseLeadFields(lr.field_data);
            const { created } = await upsertLeadFromMeta({
              email,
              nombre,
              telefono,
              empresa,
              meta_lead_id: lr.id,
              meta_ad_id: lr.ad_id ?? null,
              meta_ad_name: lr.ad_name ?? null,
              meta_campaign_name: lr.campaign_name ?? null,
              meta_adset_name: lr.adset_name ?? null,
            });
            if (created) creados++;
            else existentes++;
          } catch (err) {
            errores.push(`lead ${lr.id}: ${err instanceof Error ? err.message : String(err)}`);
          }
        }
        leadsUrl = cortar ? null : page.paging?.next ?? null;
      }
    }

    const ms = Date.now() - tStart;
    console.log(
      `[cron:meta-leads-poll] dias=${dias} forms=${forms.length} vistos=${vistos} creados=${creados} existentes=${existentes} errores=${errores.length} ms=${ms}`,
    );

    return Response.json({
      ok: true,
      dias,
      forms_revisados: forms.length,
      leads_vistos: vistos,
      creados,
      existentes,
      errores: errores.length,
      ...(errores.length > 0 ? { detalle_errores: errores.slice(0, 10) } : {}),
      ms,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[cron:meta-leads-poll] error: ${message}`);
    return Response.json({ ok: false, error: message }, { status: 500 });
  }
}
