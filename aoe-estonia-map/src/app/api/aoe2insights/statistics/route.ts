import { NextResponse } from "next/server";
import * as cheerio from "cheerio";

export const runtime = "nodejs";

type BestPick = {
  name: string;
  winRateText: string;
  matchesText: string;
  imageUrl?: string;
  imageUrlWebp?: string;
};

type StatsPayload = {
  userId: string;
  matchesPlayed?: {
    total?: number;
    mostOnText?: string;
  };
  overallBestCiv?: BestPick;
  overallBestMap?: BestPick;
  overallBestPosition?: BestPick;
  rawUpdatedAt: string;
};

function toNumberLoose(s: string) {
  const cleaned = s.replace(/[^\d]/g, "");
  return cleaned ? Number(cleaned) : undefined;
}

function absUrl(u?: string) {
  if (!u) return undefined;
  if (u.startsWith("http")) return u;
  return `https://www.aoe2insights.com${u}`;
}

function slugifyAoe2Insights(name: string) {
  return name
    .toLowerCase()
    .trim()
    .replace(/['']/g, "")        // убрать апострофы
    .replace(/[^a-z0-9]+/g, "_") // пробелы/дефисы -> _
    .replace(/^_+|_+$/g, "");
}

function proxyUrl(u?: string) {
  return u ? `/api/img?url=${encodeURIComponent(u)}` : undefined;
}

function setAoe2InsightsIcons(payload: any) {
  if (payload.overallBestCiv?.name) {
    const s = slugifyAoe2Insights(payload.overallBestCiv.name);
    const originalUrl = `https://www.aoe2insights.com/static/images/civs/big/${s}.webp`;
    payload.overallBestCiv.imageUrl = proxyUrl(originalUrl);
  }

  if (payload.overallBestMap?.name) {
    const s = slugifyAoe2Insights(payload.overallBestMap.name);
    const originalUrl = `https://www.aoe2insights.com/static/images/maps/${s}.png`;
    payload.overallBestMap.imageUrl = proxyUrl(originalUrl);
  }

  if (payload.overallBestPosition?.name) {
    const s = slugifyAoe2Insights(payload.overallBestPosition.name);
    const originalUrl = `https://www.aoe2insights.com/static/images/positions/${s}.webp`;
    payload.overallBestPosition.imageUrl = proxyUrl(originalUrl);
  }
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const userId = searchParams.get("userId");
  const debug = searchParams.get("debug") === "1";

  if (!userId) {
    return NextResponse.json({ error: "userId is required" }, { status: 400 });
  }

  const url = `https://www.aoe2insights.com/user/${encodeURIComponent(userId)}/includes/statistics`;

  const res = await fetch(url, {
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
    return NextResponse.json({ error: `Upstream error: ${res.status}` }, { status: 502 });
  }

  const html = await res.text();

  if (debug) {
    return new NextResponse(html, {
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }

  const $ = cheerio.load(html);

  const payload: StatsPayload = {
    userId,
    rawUpdatedAt: new Date().toISOString(),
  };

  const bodyText = $.root().text();

  const totalMatch = bodyText.match(/Matches played[\s\S]*?Total\s*([\d.,]+)/i);
  if (totalMatch?.[1]) {
    payload.matchesPlayed = payload.matchesPlayed ?? {};
    payload.matchesPlayed.total = toNumberLoose(totalMatch[1]);
  }

  const mostOnMatch = bodyText.match(/Most on\s+RM Team\s*\(([^)]+)\)/i);
  if (mostOnMatch?.[1]) {
    payload.matchesPlayed = payload.matchesPlayed ?? {};
    payload.matchesPlayed.mostOnText = `Most on RM Team (${mostOnMatch[1]})`;
  }

  function extractSection(title: string): BestPick | undefined {
    const regex = new RegExp(
      `${title}\\s*([\\s\\S]*?)(?=Overall best|$)`,
      "i"
    );

    const match = bodyText.match(regex);
    if (!match) return undefined;

    const lines = match[1]
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);

    // ожидаем формат:
    // Turks
    // 65.4% win
    // 52 matches, 34 wins

    const name = lines[0] ?? "";
    const winRateText = lines.find((l) => /%.*win/i.test(l)) ?? "";
    const matchesText =
      lines.find((l) => /matches/i.test(l) && /wins?/i.test(l)) ?? "";

    if (!name) return undefined;

    return {
      name,
      winRateText,
      matchesText,
    };
  }

  payload.overallBestCiv = extractSection("Overall best civ");
  payload.overallBestMap = extractSection("Overall best map");
  payload.overallBestPosition = extractSection("Overall best position");

  setAoe2InsightsIcons(payload);

  return NextResponse.json(payload);
}
