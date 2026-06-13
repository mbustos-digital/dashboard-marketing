// =============================================================================
// Aplicar una migration SQL por conexión directa a Postgres
// =============================================================================
// Uso:
//   node scripts/apply-migration.mjs supabase/migrations/00XX_nombre.sql
//
// Lee DATABASE_URL de .env.local. Verifica que sea el proyecto correcto
// (leads >= 50) ANTES de tocar nada — evita aplicar en el proyecto equivocado.
// =============================================================================

import postgres from 'postgres';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { config } from 'dotenv';

config({ path: resolve(process.cwd(), '.env.local') });

const sqlFile = process.argv[2];
if (!sqlFile) {
  console.error('Uso: node scripts/apply-migration.mjs <archivo.sql>');
  process.exit(1);
}
const conn = process.env.DATABASE_URL;
if (!conn) {
  console.error('Falta DATABASE_URL en .env.local');
  process.exit(1);
}

const ddl = readFileSync(sqlFile, 'utf8');

const sql = postgres(conn, { ssl: 'require', connect_timeout: 10, max: 1 });
try {
  const [{ n }] = await sql`select count(*)::int as n from leads`;
  console.log(`Proyecto OK — leads=${n}`);
  if (n < 50) {
    console.error('⚠️ leads<50 — proyecto sospechoso, abortando sin aplicar');
    process.exit(1);
  }
  await sql.unsafe(ddl);
  console.log(`✅ Migration aplicada: ${sqlFile}`);
  process.exit(0);
} catch (e) {
  console.error('Error:', e.message);
  process.exit(1);
} finally {
  await sql.end({ timeout: 5 });
}
