import * as cheerio from 'cheerio';

export type ParsedAoeSearchResult = {
  resultsCount: number;
  exactName: string | null;
  profileId: string | null;
  profileUrl: string | null;
};

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
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
  const nickname = (nicknameRaw ?? '').trim();
  if (!nickname) return null;

  try {
    const url = `https://www.aoe2insights.com/search/?q=${encodeURIComponent(nickname)}`;

    const res = await fetchWithTimeout(
      url,
      {
        method: 'GET',
        headers: {
          accept: 'text/html,*/*',
          'user-agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome Safari',
          'accept-language': 'en-US,en;q=0.9',
        },
      },
      2500,
    );

    if (!res.ok) return null;

    const html = await res.text();
    return parseAoe2InsightsSearch(html);
  } catch {
    return null;
  }
}
