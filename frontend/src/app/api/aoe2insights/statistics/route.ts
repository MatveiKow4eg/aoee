import { NextResponse } from "next/server";
import * as cheerio from "cheerio";

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

type StatsPayload = {
  userId: string;
  matchesPlayed: MatchesPlayed | null;
  overallBestCiv: BestPick | null;
  overallBestMap: BestPick | null;
  overallBestPosition: BestPick | null;
  rawUpdatedAt: string;
  /** present only when debug=1 */
  debug?: {
    upstreamUrl: string;
    upstreamStatus: number;
    htmlLength: number;
    statCardsFound: number;
    notes: string[];
    cards?: Array<{
      header: string | null;
      name: string | null;
      value: string | null;
      imgSrc: string | null;
    }>;
  };
};

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
    .replace(/[’']/g, "") // убрать апострофы/типографские кавычки
    .replace(/[^a-z0-9]+/g, "_") // пробелы/дефисы -> _
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

function safeParseFromCard(card: cheerio.Cheerio<cheerio.Element>, notes: string[]): Omit<BestPick, "imageUrl" | "upstreamImageUrl"> {
  // In upstream HTML, the meaningful data is inside .stat-name and .stat-value
  const name = normalizeText(card.find(".stat-name").first().text()) || null;
  const value = normalizeText(card.find(".stat-value").first().text()) || null;

  // value is typically:
  // "65.4% win\n52 matches, 34 wins" OR "328 matches" etc.
  let winRateText: string | null = null;
  let matchesText: string | null = null;

  if (value) {
    const parts = value
      .split(/\n|\r\n/)
      .map((p) => normalizeText(p))
      .filter(Boolean);

    winRateText = parts.find((p) => /%\s*win/i.test(p)) ?? null;
    matchesText = parts.find((p) => /matches/i.test(p)) ?? null;

    // fallback: sometimes everything is in one line
    if (!winRateText && /%\s*win/i.test(value)) winRateText = value;
    if (!matchesText && /matches/i.test(value)) matchesText = value;
  }

  if (!name) notes.push("Card parsed but .stat-name is empty");
  if (!value) notes.push("Card parsed but .stat-value is empty");

  return { name, winRateText, matchesText };
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const userId = searchParams.get("userId");
  const debug = searchParams.get("debug") === "1";

  if (!userId) {
    return NextResponse.json({ error: "userId is required" }, { status: 400 });
  }

  const upstreamUrl = `https://www.aoe2insights.com/user/${encodeURIComponent(userId)}/includes/statistics`;
  const notes: string[] = [];

  try {
    const res = await fetch(upstreamUrl, {
      headers: {
        "user-agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome Safari",
        accept: "text/html,*/*",
        "accept-language": "en-US,en;q=0.9,ru;q=0.8",
        referer: `https://www.aoe2insights.com/user/${encodeURIComponent(userId)}/`,
      },
      next: { revalidate: 60 * 30 },
    });

    if (!res.ok) {
      console.error("[aoe2insights/statistics] upstream not ok", {
        userId,
        upstreamUrl,
        upstreamStatus: res.status,
      });
      return NextResponse.json(
        { error: `Upstream error: ${res.status}`, userId },
        { status: 502 }
      );
    }

    const html = await res.text();

    // basic diagnostics
    console.info("[aoe2insights/statistics] fetched", {
      userId,
      upstreamUrl,
      upstreamStatus: res.status,
      htmlLength: html.length,
    });

    if (debug) {
      return new NextResponse(html, {
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }

    const $ = cheerio.load(html);
    const cards = $(".stat-card");

    console.info("[aoe2insights/statistics] parse", {
      userId,
      statCardsFound: cards.length,
    });

    // Build quick index by normalized header
    const byHeader = new Map<string, cheerio.Cheerio<cheerio.Element>>();
    cards.each((_, el) => {
      const card = $(el);
      const header = normalizeKey(card.find("header.card-header-muted").first().text());
      if (header) byHeader.set(header, card);
    });

    const findCard = (expectedHeader: string) => {
      const key = normalizeKey(expectedHeader);
      const card = byHeader.get(key);
      if (!card) {
        notes.push(`Card not found: ${expectedHeader}`);
      }
      return card ?? null;
    };

    const payload: StatsPayload = {
      userId,
      matchesPlayed: null,
      overallBestCiv: null,
      overallBestMap: null,
      overallBestPosition: null,
      rawUpdatedAt: new Date().toISOString(),
    };

    // Matches played
    const matchesCard = findCard("Matches played");
    if (matchesCard) {
      const header = normalizeText(matchesCard.find("header.card-header-muted").first().text());
      const totalText = normalizeText(matchesCard.find(".stat-name").first().text());
      const valueText = normalizeText(matchesCard.find(".stat-value").first().text());

      payload.matchesPlayed = {
        total: toNumberLoose(valueText) ?? toNumberLoose(totalText),
        mostOnText: header || null,
      };

      // try to extract "Most on RM Team (...)" if present anywhere in card
      const cardText = normalizeText(matchesCard.text());
      const mostOnMatch = cardText.match(/Most\s+on\s+RM\s+Team\s*\(([^)]+)\)/i);
      if (mostOnMatch?.[1]) {
        payload.matchesPlayed.mostOnText = `Most on RM Team (${normalizeText(mostOnMatch[1])})`;
      }
    }

    // Overall best civ/map/position
    const bestCivCard = findCard("Overall best civ");
    if (bestCivCard) {
      const parsed = safeParseFromCard(bestCivCard, notes);
      const pick = bestPickFromName("civ", parsed.name);
      payload.overallBestCiv = {
        ...pick,
        winRateText: parsed.winRateText,
        matchesText: parsed.matchesText,
      };
    }

    const bestMapCard = findCard("Overall best map");
    if (bestMapCard) {
      const parsed = safeParseFromCard(bestMapCard, notes);
      const pick = bestPickFromName("map", parsed.name);
      payload.overallBestMap = {
        ...pick,
        winRateText: parsed.winRateText,
        matchesText: parsed.matchesText,
      };
    }

    const bestPosCard = findCard("Overall best position");
    if (bestPosCard) {
      const parsed = safeParseFromCard(bestPosCard, notes);

      // Position card sometimes uses <picture>.<img class="stat-bg"> for background.
      // We don't rely on it; but log it for diagnostics.
      const imgSrc = bestPosCard.find("img.stat-bg").first().attr("src") ?? null;
      const absImg = toAbsoluteUrl(imgSrc);
      if (!imgSrc) notes.push("Overall best position: img.stat-bg src is missing");
      if (absImg) notes.push(`Overall best position: upstream bg ${absImg}`);

      const pick = bestPickFromName("position", parsed.name);
      payload.overallBestPosition = {
        ...pick,
        winRateText: parsed.winRateText,
        matchesText: parsed.matchesText,
      };
    }

    if (debug) {
      // (won't reach here because debug returns raw html earlier)
      payload.debug = {
        upstreamUrl,
        upstreamStatus: res.status,
        htmlLength: html.length,
        statCardsFound: cards.length,
        notes,
      };
    }

    // Extra detailed diagnostics available via ?diagnostics=1 (without returning HTML)
    if (searchParams.get("diagnostics") === "1") {
      payload.debug = {
        upstreamUrl,
        upstreamStatus: res.status,
        htmlLength: html.length,
        statCardsFound: cards.length,
        notes,
        cards: cards
          .toArray()
          .slice(0, 20)
          .map((el) => {
            const card = $(el);
            const header = normalizeText(card.find("header.card-header-muted").first().text()) || null;
            const name = normalizeText(card.find(".stat-name").first().text()) || null;
            const value = normalizeText(card.find(".stat-value").first().text()) || null;
            const imgSrc = card.find("img.stat-bg").first().attr("src") ?? null;
            return { header, name, value, imgSrc };
          }),
      };
    }

    console.info("[aoe2insights/statistics] built payload", {
      userId,
      hasMatchesPlayed: Boolean(payload.matchesPlayed),
      hasBestCiv: Boolean(payload.overallBestCiv),
      hasBestMap: Boolean(payload.overallBestMap),
      hasBestPosition: Boolean(payload.overallBestPosition),
      notesCount: notes.length,
    });

    return NextResponse.json(payload);
  } catch (err) {
    console.error("[aoe2insights/statistics] handler failed", {
      userId,
      upstreamUrl,
      error: err instanceof Error ? { message: err.message, stack: err.stack } : err,
    });

    // Don't hard-fail due to parsing quirks; return controlled JSON.
    const payload: StatsPayload = {
      userId,
      matchesPlayed: null,
      overallBestCiv: null,
      overallBestMap: null,
      overallBestPosition: null,
      rawUpdatedAt: new Date().toISOString(),
      debug: {
        upstreamUrl,
        upstreamStatus: 0,
        htmlLength: 0,
        statCardsFound: 0,
        notes: ["Unhandled error during fetch/parse"],
      },
    };

    return NextResponse.json(payload, { status: 200 });
  }
}
