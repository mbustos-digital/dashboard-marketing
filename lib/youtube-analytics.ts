// =============================================================================
// YouTube Analytics API (Camino B — OAuth)
// =============================================================================
// Da vistas DIARIAS por video (no cumulativo). Requiere OAuth: el refresh_token
// se obtuvo una vez con scripts/youtube-oauth-dance.ts.
//
// Endpoints:
//   POST https://oauth2.googleapis.com/token (refresh → access)
//   GET  https://youtubeanalytics.googleapis.com/v2/reports (data)
// =============================================================================

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const ANALYTICS_URL = 'https://youtubeanalytics.googleapis.com/v2/reports';

export class YouTubeAnalyticsAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'YouTubeAnalyticsAuthError';
  }
}

export class YouTubeAnalyticsError extends Error {
  constructor(message: string, public code?: number) {
    super(message);
    this.name = 'YouTubeAnalyticsError';
  }
}

function getEnv(name: string): string {
  const v = process.env[name];
  if (!v || v.startsWith('PENDING')) {
    throw new Error(`Env var ${name} no definida`);
  }
  return v;
}

// Cache simple para no pedir access_token en cada llamada (válido ~1h)
let cachedAccessToken: { token: string; expiresAt: number } | null = null;

/**
 * Intercambia el refresh_token por un access_token fresco. Cachea ~50 min.
 */
export async function getAccessToken(): Promise<string> {
  if (cachedAccessToken && cachedAccessToken.expiresAt > Date.now() + 60_000) {
    return cachedAccessToken.token;
  }

  const clientId = getEnv('YOUTUBE_OAUTH_CLIENT_ID');
  const clientSecret = getEnv('YOUTUBE_OAUTH_CLIENT_SECRET');
  const refreshToken = getEnv('YOUTUBE_OAUTH_REFRESH_TOKEN');

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }).toString(),
  });

  const body = (await res.json()) as {
    access_token?: string;
    expires_in?: number;
    error?: string;
    error_description?: string;
  };

  if (body.error || !body.access_token) {
    throw new YouTubeAnalyticsAuthError(
      `Token refresh falló: ${body.error_description || body.error || 'sin access_token'}`,
    );
  }

  cachedAccessToken = {
    token: body.access_token,
    expiresAt: Date.now() + (body.expires_in ?? 3600) * 1000,
  };

  return body.access_token;
}

// ─────────────────────────────────────────────────────────────────────────────
// Daily report por video
// ─────────────────────────────────────────────────────────────────────────────

export type DailyVideoStat = {
  fecha: string; // YYYY-MM-DD
  views: number;
  estimated_minutes_watched: number;
  average_view_duration: number; // segundos
};

/**
 * Trae vistas diarias de UN video en un rango. Retorna un array con una fila
 * por día (días sin actividad NO aparecen — los inferimos en el caller).
 */
export async function fetchYouTubeAnalyticsDaily(
  videoId: string,
  startDate: string, // YYYY-MM-DD
  endDate: string,
): Promise<DailyVideoStat[]> {
  const accessToken = await getAccessToken();

  const url = new URL(ANALYTICS_URL);
  url.searchParams.set('ids', 'channel==MINE');
  url.searchParams.set('startDate', startDate);
  url.searchParams.set('endDate', endDate);
  url.searchParams.set(
    'metrics',
    'views,estimatedMinutesWatched,averageViewDuration',
  );
  url.searchParams.set('dimensions', 'day');
  url.searchParams.set('filters', `video==${videoId}`);

  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  type ApiResponse = {
    columnHeaders?: Array<{ name: string }>;
    rows?: Array<Array<string | number>>;
    error?: { code?: number; message?: string };
  };
  const body = (await res.json()) as ApiResponse;

  if (body.error) {
    throw new YouTubeAnalyticsError(
      `Analytics API error: ${body.error.message}`,
      body.error.code,
    );
  }

  const rows = body.rows ?? [];
  return rows.map((row) => ({
    fecha: String(row[0]),
    views: Number(row[1]) || 0,
    estimated_minutes_watched: Number(row[2]) || 0,
    average_view_duration: Number(row[3]) || 0,
  }));
}
