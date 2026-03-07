import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const url = searchParams.get("url");

  if (!url) {
    return NextResponse.json({ error: "url is required" }, { status: 400 });
  }

  // простая защита, чтобы твой прокси не стал открытым для всего подряд
  const allowedHosts = new Set(["www.aoe2insights.com", "aoe2insights.com"]);
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return NextResponse.json({ error: "invalid url" }, { status: 400 });
  }
  if (!allowedHosts.has(parsed.hostname)) {
    return NextResponse.json({ error: "host not allowed" }, { status: 403 });
  }

  const upstream = await fetch(url, {
    headers: {
      // важное: имитируем браузер + реферер на их домен
      "user-agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome Safari",
      "accept": "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
      "referer": "https://www.aoe2insights.com/",
    },
    // можно кешировать
    next: { revalidate: 60 * 60 * 24 }, // 24 часа
  });

  if (!upstream.ok) {
    return NextResponse.json(
      { error: `upstream ${upstream.status}` },
      { status: 502 }
    );
  }

  const contentType = upstream.headers.get("content-type") ?? "";
  if (!contentType.startsWith("image/")) {
    const text = await upstream.text();
    return NextResponse.json(
      { error: "Upstream did not return an image", contentType, sample: text.slice(0, 200) },
      { status: 502 }
    );
  }

  const bytes = await upstream.arrayBuffer();

  return new NextResponse(bytes, {
    headers: {
      "content-type": contentType,
      "cache-control": "public, max-age=86400, s-maxage=604800, stale-while-revalidate=86400",
    },
  });
}
