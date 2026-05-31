// =============================================================================
// Cliente Supabase server-side
// =============================================================================
// Usa la SERVICE_ROLE key (bypassa Row Level Security).
// IMPORTANTE: no importar este módulo desde componentes cliente — la
// service_role key NUNCA debe llegar al navegador.
//
// El cliente se cachea para no recrearlo por request.

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let cached: SupabaseClient | null = null;

export function getSupabaseServer(): SupabaseClient {
  if (cached) return cached;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url) throw new Error('NEXT_PUBLIC_SUPABASE_URL no definida');
  if (!serviceRoleKey) throw new Error('SUPABASE_SERVICE_ROLE_KEY no definida');

  cached = createClient(url, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
  return cached;
}
