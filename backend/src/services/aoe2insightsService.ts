import * as cheerio from 'cheerio';

export type ParsedAoeSearchResult = {
  resultsCount: number;
  exactName: string | null;
  profileId: string | null;
  profileUrl: string | null;
};

export type Aoe2InsightsSearchResult =
  | { ok: true; parsed: ParsedAoeSearchResult; url: string; status: number; contentType: string | null; finalUrl: string | null }
  | {
      ok: false;
      reason:
        | 'aoe_search_timeout'
        | 'aoe_search_http_403'
        | 'aoe_search_http_429'
        | 'aoe_search_http_5xx'
        | 'aoe_search_http_non_200'
        | 'aoe_search_cloudflare_challenge'
        | 'aoe_search_parse_failed'
        | 'aoe_search_network_error';
      url: string;
      status?: number;
      contentType?: string | null;
      finalUrl?: string | null;
      bodyPreview?: string;
      errorMessage?: string;
      errorStack?: string;
    };

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal, redirect: 'follow' });
  } finally {
    clearTimeout(t);
  }
}

export function normalizeNickname(value: string): string {
  return (value ?? '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

export function parseAoe2InsightsSearch(html: string): ParsedAoeSearchResult {
  const $ = cheerio.load(html);

  const headerText = $('.search-results-header').first().text().trim();
  let resultsCount = 0;

  const matchCount = headerText.match(/(\d+)\s+result/i);
  if (matchCount) {
    resultsCount = Number(matchCount[1]);
  }

  const firstTile = $('.user-tile').first();

  if (!firstTile.length) {
    return {
      resultsCount,
      exactName: null,
      profileId: null,
      profileUrl: null,
    };
  }

  const exactName = firstTile.find('.user-tile-name').first().text().trim() || null;
  const href = firstTile.find('a.stretched-link').attr('href') || null;

  let profileId: string | null = null;
  let profileUrl: string | null = null;

  if (href) {
    const idMatch = href.match(/\/user\/(\d+)\/?/);
    if (idMatch) {
      profileId = idMatch[1];
      profileUrl = `https://www.aoe2insights.com/user/${profileId}/`;
    }
  }

  return {
    resultsCount,
    exactName,
    profileId,
    profileUrl,
  };
}

export async function aoe2InsightsSearchByNickname(nicknameRaw: string): Promise<ParsedAoeSearchResult | null> {
  const r = await aoe2InsightsSearchByNicknameDetailed(nicknameRaw);
  return r && r.ok ? r.parsed : null;
}

function looksLikeCloudflareChallenge(html: string): boolean {
  const s = (html || '').toLowerCase();
  // Heuristics for typical Cloudflare challenge / block pages.
  return (
    s.includes('cf-browser-verification') ||
    s.includes('cloudflare') && (s.includes('attention required') || s.includes('checking your browser')) ||
    s.includes('challenge-platform')
  );
}

export async function aoe2InsightsSearchByNicknameDetailed(nicknameRaw: string): Promise<Aoe2InsightsSearchResult | null> {
  const nickname = (nicknameRaw ?? '').trim();
  if (!nickname) return null;

  const url = `https://www.aoe2insights.com/search/?q=${encodeURIComponent(nickname)}`;

  const log = (event: string, extra?: Record<string, unknown>) => {
    try {
      // eslint-disable-next-line no-console
      console.log(`[aoe2insights] ${event}`, { url, nickname, ...(extra ?? {}) });
    } catch {
      // ignore
    }
  };

  try {
    log('search_request');

    const res = await fetchWithTimeout(
      url,
      {
        method: 'GET',
        headers: {
          // Try to look as close to a real browser navigation as possible.
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
          'Cache-Control': 'no-cache',
          Pragma: 'no-cache',
          Referer: 'https://www.aoe2insights.com/',
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        },
      },
      6000,
    );

    const contentType = res.headers.get('content-type');
    const finalUrl = (res as any)?.url ? String((res as any).url) : null;

    log('search_response', { status: res.status, contentType, finalUrl });

    const html = await res.text();
    const bodyPreview = html.slice(0, 500);
    log('search_body_preview', { bodyPreview });

    if (!res.ok) {
      const reason =
        res.status === 403
          ? 'aoe_search_http_403'
          : res.status === 429
            ? 'aoe_search_http_429'
            : res.status >= 500
              ? 'aoe_search_http_5xx'
              : 'aoe_search_http_non_200';

      // Distinguish Cloudflare blocks even if status is 403/503.
      if (looksLikeCloudflareChallenge(html)) {
        log('search_error', { reason: 'aoe_search_cloudflare_challenge' });
        return {
          ok: false,
          reason: 'aoe_search_cloudflare_challenge',
          url,
          status: res.status,
          contentType,
          finalUrl,
          bodyPreview,
        };
      }

      log('search_error', { reason });
      return {
        ok: false,
        reason,
        url,
        status: res.status,
        contentType,
        finalUrl,
        bodyPreview,
      };
    }

    if (looksLikeCloudflareChallenge(html)) {
      log('search_error', { reason: 'aoe_search_cloudflare_challenge' });
      return {
        ok: false,
        reason: 'aoe_search_cloudflare_challenge',
        url,
        status: res.status,
        contentType,
        finalUrl,
        bodyPreview,
      };
    }

    let parsed: ParsedAoeSearchResult;
    try {
      parsed = parseAoe2InsightsSearch(html);
    } catch (e: any) {
      log('search_error', { reason: 'aoe_search_parse_failed', message: e?.message ? String(e.message) : undefined });
      return {
        ok: false,
        reason: 'aoe_search_parse_failed',
        url,
        status: res.status,
        contentType,
        finalUrl,
        bodyPreview,
        errorMessage: e?.message ? String(e.message) : undefined,
        errorStack: e?.stack ? String(e.stack) : undefined,
      };
    }

    log('search_parsed', parsed as any);
    return {
      ok: true,
      parsed,
      url,
      status: res.status,
      contentType,
      finalUrl,
    };
  } catch (e: any) {
    const message = e?.message ? String(e.message) : 'Unknown error';
    const stack = e?.stack ? String(e.stack) : undefined;

    // AbortError typically means timeout.
    const reason: NonNullable<Extract<Aoe2InsightsSearchResult, { ok: false }>['reason']> = message.toLowerCase().includes('aborted')
      ? 'aoe_search_timeout'
      : 'aoe_search_network_error';

    log('search_error', { reason, message, stack });

    return {
      ok: false,
      reason,
      url,
      errorMessage: message,
      errorStack: stack,
    };
  }
}
