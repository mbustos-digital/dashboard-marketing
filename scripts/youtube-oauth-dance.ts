// =============================================================================
// OAuth Dance — obtiene refresh_token de YouTube Analytics API
// =============================================================================
// Uso: npx tsx scripts/youtube-oauth-dance.ts
//
// Flujo:
//   1. Levanta servidor local en 127.0.0.1:8765
//   2. Imprime URL de autorización (y la abre en tu navegador)
//   3. Tú autorizas con mbustos@elevate.com.mx
//   4. Google redirige a localhost con ?code=...
//   5. El servidor intercambia code por refresh_token
//   6. Guarda refresh_token en .env.local y muere
// =============================================================================

import { config } from 'dotenv';
import { resolve } from 'node:path';
import { createServer } from 'node:http';
import { URL } from 'node:url';
import { readFileSync, writeFileSync } from 'node:fs';
import { exec } from 'node:child_process';

config({ path: resolve(process.cwd(), '.env.local') });

const CLIENT_ID = process.env.YOUTUBE_OAUTH_CLIENT_ID;
const CLIENT_SECRET = process.env.YOUTUBE_OAUTH_CLIENT_SECRET;

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error('❌ Falta YOUTUBE_OAUTH_CLIENT_ID o YOUTUBE_OAUTH_CLIENT_SECRET en .env.local');
  process.exit(1);
}

const PORT = 8765;
const REDIRECT_URI = `http://127.0.0.1:${PORT}`;
const SCOPE = 'https://www.googleapis.com/auth/yt-analytics.readonly';

const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
authUrl.searchParams.set('client_id', CLIENT_ID);
authUrl.searchParams.set('redirect_uri', REDIRECT_URI);
authUrl.searchParams.set('response_type', 'code');
authUrl.searchParams.set('scope', SCOPE);
authUrl.searchParams.set('access_type', 'offline');
authUrl.searchParams.set('prompt', 'consent');

console.log('');
console.log('═══════════════════════════════════════════════════════════════════════════');
console.log('  Abriendo navegador para autorizar (autentica con mbustos@elevate.com.mx):');
console.log('');
console.log(`  ${authUrl.toString()}`);
console.log('═══════════════════════════════════════════════════════════════════════════');
console.log('');
console.log(`  Esperando autorización en http://127.0.0.1:${PORT}/ ...`);
console.log('');

type TokenResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  token_type?: string;
  error?: string;
  error_description?: string;
};

const server = createServer(async (req, res) => {
  if (!req.url) return;

  const url = new URL(req.url, REDIRECT_URI);
  const code = url.searchParams.get('code');
  const errorParam = url.searchParams.get('error');

  if (errorParam) {
    res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`<h1>Error: ${errorParam}</h1><p>Cierra esta pestaña y reintenta.</p>`);
    console.error(`❌ Error de OAuth: ${errorParam}`);
    server.close();
    process.exit(1);
  }

  if (!code) {
    // Probablemente request al favicon u otro path; ignorar
    res.writeHead(404);
    res.end();
    return;
  }

  try {
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: CLIENT_ID!,
        client_secret: CLIENT_SECRET!,
        redirect_uri: REDIRECT_URI,
        grant_type: 'authorization_code',
      }).toString(),
    });

    const tokens = (await tokenRes.json()) as TokenResponse;

    if (tokens.error || !tokens.refresh_token) {
      const msg = tokens.error_description || tokens.error || 'Sin refresh_token';
      res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(`
        <html><body style="font-family:system-ui;padding:40px;background:#0a0a0a;color:#ff9966">
          <h1>❌ Error: ${tokens.error ?? 'sin refresh_token'}</h1>
          <p>${msg}</p>
          <p>Si dice "sin refresh_token", revoca acceso en https://myaccount.google.com/permissions y reintenta.</p>
        </body></html>
      `);
      console.error(`❌ Token exchange falló: ${msg}`);
      server.close();
      process.exit(1);
      return;
    }

    // Guardar en .env.local
    const envPath = resolve(process.cwd(), '.env.local');
    let envContent = readFileSync(envPath, 'utf-8');
    if (envContent.match(/^YOUTUBE_OAUTH_REFRESH_TOKEN=.*/m)) {
      envContent = envContent.replace(
        /^YOUTUBE_OAUTH_REFRESH_TOKEN=.*/m,
        `YOUTUBE_OAUTH_REFRESH_TOKEN=${tokens.refresh_token}`,
      );
    } else {
      envContent += `\nYOUTUBE_OAUTH_REFRESH_TOKEN=${tokens.refresh_token}\n`;
    }
    writeFileSync(envPath, envContent);

    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`
      <html><body style="font-family:system-ui;padding:40px;background:#0a0a0a;color:#f5f5f5">
        <h1 style="color:#3ECF8E">✅ Autorización OK</h1>
        <p>Refresh token capturado y guardado en .env.local (${tokens.refresh_token.length} chars).</p>
        <p>Scopes otorgados: <code>${tokens.scope}</code></p>
        <p>Ya puedes cerrar esta pestaña y volver a la terminal.</p>
      </body></html>
    `);

    console.log('');
    console.log('═══════════════════════════════════════════════════════════════════════════');
    console.log('✅ Refresh token capturado y guardado en .env.local');
    console.log(`   length: ${tokens.refresh_token.length} chars`);
    console.log(`   scopes: ${tokens.scope}`);
    console.log('═══════════════════════════════════════════════════════════════════════════');

    setTimeout(() => {
      server.close();
      process.exit(0);
    }, 1500);
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'text/plain' });
    res.end(`Error: ${err}`);
    console.error('❌ Excepción:', err);
    server.close();
    process.exit(1);
  }
});

server.listen(PORT, '127.0.0.1', () => {
  // Abrir el navegador automáticamente
  exec(`open "${authUrl.toString()}"`);
});

// Timeout de seguridad: si en 5 min no autoriza, mata el server
setTimeout(() => {
  console.error('⏱  Timeout 5 min sin autorización. Abortando.');
  server.close();
  process.exit(1);
}, 5 * 60 * 1000);
