import { NextResponse } from "next/server";
import * as cheerio from "cheerio";
import type { AnyNode } from "domhandler";

export const runtime = "nodejs";

type BestPick = {
  name: string | null;
  winRateText: string | null;
  matchesText: string | null;
  /** proxied via /api/img */
  imageUrl: string | null;
  /** upstream absolute url (diagnostics) */
  upstreamImageUrl: string | null;
};

type MatchesPlayed = {
  total: number | null;
  mostOnText: string | null;
};

type StatsData = {
  matchesPlayed: MatchesPlayed | null;
  overallBestCiv: BestPick | null;
  overallBestMap: BestPick | null;
  overallBestPosition: BestPick | null;
};

type ResponseShape = {
  userId: string;
  data: StatsData | null;
  source: "live" | "cache" | "none";
  stale: boolean;
  fetchedAt: string | null;
  error: string | null;
  upstreamStatus: number | null;
};

type CacheEntry = {
  data: StatsData;
  fetchedAt: number; // epoch ms
  upstreamStatus: number;
};

// In-memory cache (per Next.js server instance)
const globalForAoe2 = globalThis as unknown as {
  __aoe2insightsStatsCache?: Map<string, CacheEntry>;
};

const cache = (globalForAoe2.__aoe2insightsStatsCache ??= new Map<string, CacheEntry>());

// Cooldown for upstream calls per userId
const COOLDOWN_HOURS = 6;
const COOLDOWN_MS = COOLDOWN_HOURS * 60 * 60 * 1000;

function normalizeText(s: string | null | undefined) {
  return (s ?? "").replace(/\s+/g, " ").trim();
}

function normalizeKey(s: string | null | undefined) {
  return normalizeText(s).toLowerCase();
}

function toNumberLoose(s: string | null | undefined) {
  const cleaned = (s ?? "").replace(/[^\d]/g, "");
  return cleaned ? Number(cleaned) : null;
}

function toAbsoluteUrl(u: string | null | undefined) {
  if (!u) return null;
  try {
    return new URL(u, "https://www.aoe2insights.com").toString();
  } catch {
    return null;
  }
}

function slugifyAoe2Insights(name: string) {
  return name
    .toLowerCase()
    .trim()
    .replace(/[’']/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function proxyUrl(u: string | null) {
  return u ? `/api/img?url=${encodeURIComponent(u)}` : null;
}

function bestPickFromName(kind: "civ" | "map" | "position", name: string | null): BestPick {
  const normalizedName = normalizeText(name);
  if (!normalizedName) {
    return {
      name: null,
      winRateText: null,
      matchesText: null,
      imageUrl: null,
      upstreamImageUrl: null,
    };
  }

  const s = slugifyAoe2Insights(normalizedName);
  const upstreamImageUrl =
    kind === "civ"
      ? `https://www.aoe2insights.com/static/images/civs/big/${s}.webp`
      : kind === "map"
        ? `https://www.aoe2insights.com/static/images/maps/${s}.png`
        : `https://www.aoe2insights.com/static/images/positions/${s}.webp`;

  return {
    name: normalizedName,
    winRateText: null,
    matchesText: null,
    upstreamImageUrl,
    imageUrl: proxyUrl(upstreamImageUrl),
  };
}

function safeParseFromCard(
  card: cheerio.Cheerio<AnyNode>,
  notes: string[]
): { name: string | null; winRateText: string | null; matchesText: string | null } {
  const name = normalizeText(card.find(".stat-name").first().text()) || null;
  const value = normalizeText(card.find(".stat-value").first().text()) || null;

  let winRateText: string | null = null;
  let matchesText: string | null = null;

  if (value) {
    // value can contain both lines
    const parts = value
      .split(/\n|\r\n/)
      .map((p) => normalizeText(p))
      .filter(Boolean);

    winRateText = parts.find((p) => /%\s*win/i.test(p)) ?? null;
    matchesText = parts.find((p) => /matches/i.test(p)) ?? null;

    // fallback: sometimes everything is one line
    if (!winRateText && /%\s*win/i.test(value)) winRateText = value;
    if (!matchesText && /matches/i.test(value)) matchesText = value;
  }

  if (!name) notes.push("Card parsed but .stat-name is empty");
  if (!value) notes.push("Card parsed but .stat-value is empty");

  return { name, winRateText, matchesText };
}

function isLikelyChallengeHtml(html: string) {
  const h = html.toLowerCase();
  return (
    h.includes("cloudflare") ||
    h.includes("attention required") ||
    h.includes("access denied") ||
    h.includes("captcha") ||
    h.includes("verify you are human")
  );
}

function parseStatisticsHtml(html: string, notes: string[]): StatsData {
  const $ = cheerio.load(html);
  const cards = $(".stat-card");

  // Build index by normalized header
  const byHeader = new Map<string, cheerio.Cheerio<AnyNode>>();
  cards.each((_, el) => {
    const card = $(el);
    const header = normalizeKey(card.find("header.card-header-muted").first().text());
    if (header) byHeader.set(header, card);
  });

  const findCard = (expectedHeader: string) => {
    const card = byHeader.get(normalizeKey(expectedHeader));
    if (!card) notes.push(`Card not found: ${expectedHeader}`);
    return card ?? null;
  };

  const data: StatsData = {
    matchesPlayed: null,
    overallBestCiv: null,
    overallBestMap: null,
    overallBestPosition: null,
  };

  const matchesCard = findCard("Matches played");
  if (matchesCard) {
    // Matches card format:
    // .stat-name: Total
    // .stat-value .h3: 328
    const totalText =
      normalizeText(matchesCard.find(".stat-value .h3").first().text()) ||
      normalizeText(matchesCard.find(".stat-value").first().text()) ||
      null;

    data.matchesPlayed = {
      total: toNumberLoose(totalText),
      mostOnText: null,
    };

    const cardText = normalizeText(matchesCard.text());
    const mostOnMatch = cardText.match(/Most\s+on\s+RM\s+Team\s*\(([^)]+)\)/i);
    if (mostOnMatch?.[1]) {
      data.matchesPlayed.mostOnText = `Most on RM Team (${normalizeText(mostOnMatch[1])})`;
    }
  }

  const bestCivCard = findCard("Overall best civ");
  if (bestCivCard) {
    const parsed = safeParseFromCard(bestCivCard, notes);
    const pick = bestPickFromName("civ", parsed.name);
    data.overallBestCiv = {
      ...pick,
      winRateText: parsed.winRateText,
      matchesText: parsed.matchesText,
    };
  }

  const bestMapCard = findCard("Overall best map");
  if (bestMapCard) {
    const parsed = safeParseFromCard(bestMapCard, notes);
    const pick = bestPickFromName("map", parsed.name);
    data.overallBestMap = {
      ...pick,
      winRateText: parsed.winRateText,
      matchesText: parsed.matchesText,
    };
  }

  const bestPosCard = findCard("Overall best position");
  if (bestPosCard) {
    const parsed = safeParseFromCard(bestPosCard, notes);
    const pick = bestPickFromName("position", parsed.name);
    data.overallBestPosition = {
      ...pick,
      winRateText: parsed.winRateText,
      matchesText: parsed.matchesText,
    };

    // not used for UI, but helps to debug differences (<picture> vs <img>)
    const imgSrc = bestPosCard.find("img.stat-bg").first().attr("src") ?? null;
    const absImg = toAbsoluteUrl(imgSrc);
    if (!imgSrc) notes.push("Overall best position: img.stat-bg src is missing");
    if (absImg) notes.push(`Overall best position: upstream bg ${absImg}`);
  }

  // Extra sanity: if there are zero cards, likely not the expected page.
  if (cards.length === 0) notes.push("No .stat-card found in HTML");

  return data;
}

async function getStatsForUserId(userId: string): Promise<ResponseShape> {
  const upstreamUrl = `https://www.aoe2insights.com/user/${encodeURIComponent(userId)}/includes/statistics`;
  const now = Date.now();

  const cached = cache.get(userId) ?? null;
  const cacheAge = cached ? now - cached.fetchedAt : null;
  const inCooldown = cached ? cacheAge !== null && cacheAge < COOLDOWN_MS : false;

  // If in cooldown, do not hit upstream; return cached directly.
  if (cached && inCooldown) {
    console.info("[aoe2insights/statistics] cooldown cache hit", {
      userId,
      source: "cache",
      cacheAgeMs: cacheAge,
    });

    return {
      userId,
      data: cached.data,
      source: "cache",
      stale: false,
      fetchedAt: new Date(cached.fetchedAt).toISOString(),
      error: null,
      upstreamStatus: cached.upstreamStatus ?? null,
    };
  }

  // Try upstream
  try {
    const res = await fetch(upstreamUrl, {
      headers: {
        "user-agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
        accept: "text/html,*/*",
        "accept-language": "en-US,en;q=0.9,ru;q=0.8",
        referer: `https://www.aoe2insights.com/user/${encodeURIComponent(userId)}/`,
      },
      cache: "no-store",
      redirect: "follow",
    });

    const upstreamStatus = res.status;

    if (upstreamStatus === 403) {
      console.warn("[aoe2insights/statistics] upstream 403", {
        userId,
        upstreamUrl,
      });

      if (cached) {
        return {
          userId,
          data: cached.data,
          source: "cache",
          stale: true,
          fetchedAt: new Date(cached.fetchedAt).toISOString(),
          error: "Upstream returned 403 Forbidden",
          upstreamStatus,
        };
      }

      return {
        userId,
        data: null,
        source: "none",
        stale: false,
        fetchedAt: null,
        error: "Upstream returned 403 Forbidden",
        upstreamStatus,
      };
    }

    if (!res.ok) {
      const snippet = (await res.text().catch(() => "")).slice(0, 300);
      console.error("[aoe2insights/statistics] upstream not ok", {
        userId,
        upstreamUrl,
        upstreamStatus,
        snippet,
      });

      if (cached) {
        return {
          userId,
          data: cached.data,
          source: "cache",
          stale: true,
          fetchedAt: new Date(cached.fetchedAt).toISOString(),
          error: `Upstream error: ${upstreamStatus}`,
          upstreamStatus,
        };
      }

      return {
        userId,
        data: null,
        source: "none",
        stale: false,
        fetchedAt: null,
        error: `Upstream error: ${upstreamStatus}`,
        upstreamStatus,
      };
    }

    const html = await res.text();

    if (isLikelyChallengeHtml(html)) {
      console.warn("[aoe2insights/statistics] upstream challenge html", {
        userId,
        upstreamUrl,
        upstreamStatus,
        htmlLength: html.length,
      });

      if (cached) {
        return {
          userId,
          data: cached.data,
          source: "cache",
          stale: true,
          fetchedAt: new Date(cached.fetchedAt).toISOString(),
          error: "Upstream returned anti-bot/challenge HTML",
          upstreamStatus,
        };
      }

      return {
        userId,
        data: null,
        source: "none",
        stale: false,
        fetchedAt: null,
        error: "Upstream returned anti-bot/challenge HTML",
        upstreamStatus,
      };
    }

    const notes: string[] = [];
    const data = parseStatisticsHtml(html, notes);

    // persist cache
    cache.set(userId, {
      data,
      fetchedAt: now,
      upstreamStatus,
    });

    console.info("[aoe2insights/statistics] live ok", {
      userId,
      upstreamStatus,
      htmlLength: html.length,
      notesCount: notes.length,
    });

    return {
      userId,
      data,
      source: "live",
      stale: false,
      fetchedAt: new Date(now).toISOString(),
      error: null,
      upstreamStatus,
    };
  } catch (e) {
    console.error("[aoe2insights/statistics] live fetch/parse failed", {
      userId,
      upstreamUrl,
      error: e instanceof Error ? { message: e.message, stack: e.stack } : e,
    });

    if (cached) {
      return {
        userId,
        data: cached.data,
        source: "cache",
        stale: true,
        fetchedAt: new Date(cached.fetchedAt).toISOString(),
        error: "Live fetch failed",
        upstreamStatus: null,
      };
    }

    return {
      userId,
      data: null,
      source: "none",
      stale: false,
      fetchedAt: null,
      error: "Live fetch failed",
      upstreamStatus: null,
    };
  }
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const userIdParam = searchParams.get("userId");

  if (!userIdParam) {
    return NextResponse.json({ error: "userId is required" }, { status: 400 });
  }

  // Support multiple userIds: ?userId=1,2,3
  const userIds = userIdParam
    .split(",")
    .map((s) => normalizeText(s))
    .filter(Boolean);

  // Single id response
  if (userIds.length === 1) {
    const r = await getStatsForUserId(userIds[0]!);
    return NextResponse.json(r);
  }

  // Multi: per-user try/catch already handled; return partial results.
  const results = await Promise.all(userIds.map((id) => getStatsForUserId(id)));
  return NextResponse.json({ results });
}
