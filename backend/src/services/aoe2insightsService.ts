import * as cheerio from 'cheerio';

export type Aoe2InsightsProfile = {
  id: string;
  nickname: string;
  url: string;
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

function extractUserIdFromHref(href: string): string | null {
  // expected: /user/<id>/
  const m = href.match(/^\/user\/(\d+)\/?/);
  return m ? m[1] : null;
}

export async function findExactProfileByNickname(nicknameRaw: string): Promise<Aoe2InsightsProfile | null> {
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
    const $ = cheerio.load(html);

    // The page shows a header with results count.
    // We implement strict logic: collect user tiles and require exactly 1.
    const tiles = $('.user-tile');
    if (tiles.length !== 1) return null;

    const tile = tiles.first();

    const name = tile.find('.user-tile-name').first().text().trim();
    if (!name) return null;
    if (name !== nickname) return null;

    const href = tile.find('a.stretched-link').first().attr('href');
    if (!href) return null;

    const id = extractUserIdFromHref(href);
    if (!id) return null;

    const absUrl = href.startsWith('http') ? href : `https://www.aoe2insights.com${href}`;

    return { id, nickname: name, url: absUrl };
  } catch {
    // Best-effort: treat any error as "not linked".
    return null;
  }
}
