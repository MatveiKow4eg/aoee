"use client";

import React, { useMemo, useState, useEffect } from "react";
import { createPortal } from "react-dom";

export type PlayerHudProps = {
  nickname?: string | null;
  ratingPoints?: number | null;
  title?: string | null;
  tierLabel?: string | null | undefined;
  avatarUrl?: string | null;
  buildingUrl?: string | null;
  online?: boolean;

  steamConnected?: boolean;
  steamLinkUrl?: string;
  onLogout?: () => void;

  linkedPlayerName?: string | null;

  /** Canonical claimed AoE profile id (AoePlayer.aoeProfileId). Used to fetch cached stats from backend. */
  aoeProfileId?: string | null;

  /** Map players payload (players[u005]) used to render unclaimed challenge targets by targetPlayerKey. */
  mapPlayers?: Record<string, any> | null;

  /** Called when user performs a search by nickname (free text). */
  onSearchNicknames?: (query: string) => void;

  /** List of all nicknames available on the map (for suggestions). */
  nicknameOptions?: string[];

  /** Called when building-group filters change. Groups: Замки/Крепости/Донжоны/Башня/Халупа */
  onFilterGroupsChange?: (active: Record<string, boolean>) => void;
};

function mapTierToBuildingUrl(raw?: string | null): string | null {
  const key = (raw ?? "").toString().trim();
  if (!key) return null;
  const map: Record<string, string> = {
    "Замки": "/buildings/castle/castle_v1.png",
    "Замки v2": "/buildings/castle/castle_v2.png?v=2",
    "Замки v3": "/buildings/castle/castle_v3.png",
    "Замки v4": "/buildings/castle/castle_v4.png",

    "Крепости": "/buildings/krepost/krepost.png",
    "Крепости v2": "/buildings/krepost/krepost_v2.png",
    "Крепости v3": "/buildings/krepost/krepost_v3.png",
    "Крепости v4": "/buildings/krepost/krepost_v4.png",

    "Донжоны": "/buildings/donzon/donzon.png",
    "Донжоны v2": "/buildings/donzon/donzon%20v2.png",
    "Донжоны v3": "/buildings/donzon/donzon%20v3.png",
    "Донжоны v4": "/buildings/donzon/donzon%20v4.png",

    "Халупа": "/buildings/halupa/halupa.png",
    "Халупа v2": "/buildings/halupa/halupa_v2.png",
    "Халупа v3": "/buildings/halupa/halupa_v3.png",
    "Халупа v4": "/buildings/halupa/halupa_v4.png",
    "Халупа v5": "/buildings/halupa/halupa_v5.png",
    "Халупа v6": "/buildings/halupa/halupa_v6.png",

    "Башня": "/buildings/basnja/basnja.png",
    "Башня v2": "/buildings/basnja/basnja%20v2.png",
    "Башня v3": "/buildings/basnja/basnja%20v3.png",
    "Башня v4": "/buildings/basnja/basnja%20v4.png",
  };
  return map[key] ?? null;
}

export default function PlayerHud({ nickname, ratingPoints, title, tierLabel, avatarUrl, buildingUrl, online, steamConnected, steamLinkUrl, onLogout, linkedPlayerName, aoeProfileId, mapPlayers, onSearchNicknames, onFilterGroupsChange, nicknameOptions }: PlayerHudProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [statsOpen, setStatsOpen] = useState(false);
  const [historyModalOpen, setHistoryModalOpen] = useState(false);
  const [historyExpanded, setHistoryExpanded] = useState(false);
  const [historyState, setHistoryState] = useState<
    | { status: "idle" }
    | { status: "loading" }
    | { status: "ok"; challenges: any[] }
    | { status: "error"; message: string }
  >({ status: "idle" });

  // Tools panel (search/filter/history)
  const [toolsOpen, setToolsOpen] = useState<{ search: boolean; filter: boolean; history: boolean }>({
    search: false,
    filter: false,
    history: false,
  });
  const [searchQuery, setSearchQuery] = useState("");
  const [historySeed, setHistorySeed] = useState(0);
  const [filterGroups, setFilterGroups] = useState<Record<string, boolean>>({
    "Замки": true,
    "Крепости": true,
    "Донжоны": true,
    "Башня": true,
    "Халупа": true,
  });

  // Local history stack for UI actions. pushHistory records a short text entry and bumps historySeed
  // so other parts of the component can react (open history panel, refresh list, etc.).
  const pushHistory = (text: string) => {
    try {
      const key = "localHudHistory";
      const raw = typeof window !== "undefined" ? window.localStorage.getItem(key) : null;
      const arr = raw ? JSON.parse(raw) : [];
      if (Array.isArray(arr)) {
        arr.unshift({ id: Date.now(), text });
        // keep last 200 entries
        const trimmed = arr.slice(0, 200);
        if (typeof window !== "undefined") window.localStorage.setItem(key, JSON.stringify(trimmed));
      }
    } catch {
      // ignore
    }
    setHistorySeed((x) => x + 1);
  };

  // History modal: unified history (solo challenges + admin match events)
  const openHistoryModal = async () => {
    setHistoryExpanded(false);
    setHistoryModalOpen(true);
    setHistoryState({ status: "loading" });
    try {
      const { listUnifiedHistory } = await import("../../lib/api/history");
      const r = await listUnifiedHistory();
      const list = (r as any)?.items ?? [];
      const items = Array.isArray(list) ? list : [];
      // Filter cancelled for both types
      const filtered = items.filter((it: any) => {
        const t = String(it?.type || "");
        if (t === "matchEvent") return String(it?.data?.status || "").toUpperCase() !== "CANCELLED";
        return String(it?.data?.status || "").toUpperCase() !== "CANCELLED";
      });
      setHistoryState({ status: "ok", challenges: filtered });
    } catch (e: any) {
      setHistoryState({ status: "error", message: e?.message ? String(e.message) : "Failed to load history" });
    }
  };

  const avatarUrlByMapKey = (key: any) => {
    const k = typeof key === "string" ? key.trim() : "";
    if (!k) return null;
    return `/people/${encodeURIComponent(k)}.png`;
  };

  const avatarFromUser = (u: any, userIdFallback: string | null) => {
    // Prefer explicit avatar if backend provides it.
    const explicit = typeof u?.avatarUrl === "string" ? u.avatarUrl.trim() : "";
    if (explicit) return explicit;

    // Fallback: derive from user id as uXXX (legacy). Prefer using challengerPlayerKey/targetPlayerKey instead.
    const rawId = (typeof u?.id === "string" && u.id.trim()) ? u.id.trim() : (userIdFallback ? String(userIdFallback).trim() : "");
    if (!rawId) return null;

    const digits = rawId.replace(/\D+/g, "");
    if (!digits) return null;

    const n = parseInt(digits.slice(0, 3), 10);
    if (!Number.isFinite(n) || n <= 0) return null;

    const code = `u${String(n).padStart(3, "0")}`;
    return `/people/${encodeURIComponent(code)}.png`;
  };

  const resolveMapPlayerAvatar = (playerKey: string): string | null => {
    const k = (playerKey ?? "").toString().trim();
    if (!k || !mapPlayers) return null;
    const rec = (mapPlayers as any)[k];
    if (!rec) return null;

    // Try common avatar fields in map payload (best-effort).
    const candidates = [
      rec?.avatarUrl,
      rec?.portrait,
      rec?.image,
      rec?.icon,
      rec?.avatar,
      rec?.photoUrl,
      rec?.photo,
      rec?.img,
    ];

    for (const c of candidates) {
      const s = typeof c === "string" ? c.trim() : "";
      if (s) return s;
    }

    // Fallback to local static people sprites by playerKey (u001/u005/...)
    return avatarUrlByMapKey(k);
  };

  const fmtSigned = (v: unknown): string => {
    if (v == null) return "—";
    if (typeof v !== "number" || !Number.isFinite(v)) return "—";
    if (v > 0) return `+${Math.round(v)}`;
    if (v < 0) return `${Math.round(v)}`;
    return "0";
  };

  const resolveHistoryParticipant = (opts: {
    user?: any | null;
    userIdFallback?: string | null;
    playerKey?: string | null;
    displayNameFallback?: string | null;
  }) => {
    const user = opts.user ?? null;
    const playerKey = typeof opts.playerKey === "string" ? opts.playerKey.trim() : "";

    // Name resolution: keep existing behavior (prefer user.displayName, then provided fallback)
    const name =
      (typeof user?.displayName === "string" && user.displayName.trim())
        ? user.displayName.trim()
        : (opts.displayNameFallback ?? "").toString().trim() || (opts.userIdFallback ?? "").toString().trim() || "?";

    // Avatar resolution order:
    // 1) user.avatarUrl
    // 2) mapPlayers avatar fields by playerKey (or /people/{playerKey}.png fallback)
    // 3) legacy avatarFromUser (uXXX derived from user id)
    // 4) null => initials fallback in <Avatar>
    const fromUser = typeof user?.avatarUrl === "string" ? user.avatarUrl.trim() : "";
    if (fromUser) return { name, avatarUrl: fromUser };

    if (playerKey) {
      const fromMap = resolveMapPlayerAvatar(playerKey);
      if (fromMap) return { name, avatarUrl: fromMap };
    }

    const legacy = avatarFromUser(user, opts.userIdFallback ?? null);
    if (legacy) return { name, avatarUrl: legacy };

    return { name, avatarUrl: null };
  };

  const challengeVm = (ch: any) => {
    // Unified history item wrapper: { type, createdAt, data }
    const itemType = String(ch?.type || "");
    const data = itemType ? (ch?.data ?? null) : ch;

    // Match event rendering path
    if (itemType === "matchEvent") {
      const ev = data ?? {};
      const parts = Array.isArray((ev as any)?.participants) ? (ev as any).participants : [];
      const a = parts
        .filter((p: any) => String(p?.side || "").toUpperCase() === "A")
        .sort((x: any, y: any) => (x.slot ?? 0) - (y.slot ?? 0));
      const b = parts
        .filter((p: any) => String(p?.side || "").toUpperCase() === "B")
        .sort((x: any, y: any) => (x.slot ?? 0) - (y.slot ?? 0));

      const aName = a.map((p: any) => String(p?.displayNameSnapshot || p?.playerKey || "?").trim()).filter(Boolean).join(", ") || "Team A";
      const bName = b.map((p: any) => String(p?.displayNameSnapshot || p?.playerKey || "?").trim()).filter(Boolean).join(", ") || "Team B";

      const aAvatar = a[0]?.avatarUrlSnapshot ? String(a[0].avatarUrlSnapshot) : (a[0]?.playerKey ? `/people/${encodeURIComponent(String(a[0].playerKey))}.png` : null);
      const bAvatar = b[0]?.avatarUrlSnapshot ? String(b[0].avatarUrlSnapshot) : (b[0]?.playerKey ? `/people/${encodeURIComponent(String(b[0].playerKey))}.png` : null);

      const status = String((ev as any)?.status || "").toUpperCase();
      const winnerSide = (ev as any)?.winnerSide ? String((ev as any).winnerSide).toUpperCase() : null;

      const outcome =
        status === "OPEN"
          ? { label: "Ожидание", tone: "pending" as const }
          : status === "COMPLETED"
            ? winnerSide === "A"
              ? { label: "A won", tone: "win" as const }
              : winnerSide === "B"
                ? { label: "B won", tone: "loss" as const }
                : { label: "Completed", tone: "neutral" as const }
            : { label: status ? status.toLowerCase() : "—", tone: "neutral" as const };

      const ts = (ev as any)?.createdAt ? String((ev as any).createdAt) : "";
      const when = ts
        ? (() => {
            try {
              return new Date(ts).toLocaleString();
            } catch {
              return ts;
            }
          })()
        : "";

      // Deltas: show per-side if rating was applied
      const ratingAppliedAt = (ev as any)?.ratingAppliedAt ?? (ev as any)?.rating_applied_at ?? null;
      const ratingWasApplied = !!ratingAppliedAt;

      const aDelta = ratingWasApplied && winnerSide ? (winnerSide === "A" ? +20 : -10) : null;
      const bDelta = ratingWasApplied && winnerSide ? (winnerSide === "B" ? +20 : -10) : null;

      return { aName, bName, aAvatar, bAvatar, outcome, when, challengerDelta: aDelta, targetDelta: bDelta };
    }

    // Challenge rendering path (existing)
    const challenger = data?.challengerUser ?? null;
    const target = data?.targetUser ?? null;

    const challengerProfile = data?.challengerProfile ?? null;
    const targetProfile = data?.targetProfile ?? null;

    // Target name resolution order:
    // 1) target user displayName (claimed/registered user)
    // 2) targetProfile.displayName (works even when targetUser.id is null)
    // 3) map payload by targetPlayerKey (unclaimed player)
    // 4) targetUserId fallback (legacy)
    // 5) "?"
    const mapKey = typeof ch?.targetPlayerKey === "string" ? ch.targetPlayerKey.trim() : "";
    const mapRec = mapKey && mapPlayers ? (mapPlayers as any)[mapKey] : null;
    const mapName = mapRec ? String((mapRec as any)?.name ?? (mapRec as any)?.nickname ?? "").trim() : "";

    const a = resolveHistoryParticipant({
      user: challenger,
      userIdFallback: ch?.challengerUserId ?? null,
      playerKey: ch?.challengerPlayerKey ?? null,
      displayNameFallback:
        (typeof challengerProfile?.displayName === "string" && challengerProfile.displayName.trim())
          ? challengerProfile.displayName.trim()
          : ch?.challengerUserId ?? null,
    });

    const b = resolveHistoryParticipant({
      user: target,
      userIdFallback: ch?.targetUserId ?? null,
      playerKey: ch?.targetPlayerKey ?? null,
      displayNameFallback:
        (typeof target?.displayName === "string" && target.displayName.trim())
          ? target.displayName.trim()
          : (typeof targetProfile?.displayName === "string" && targetProfile.displayName.trim())
            ? targetProfile.displayName.trim()
            : (mapName || null) ?? ch?.targetUserId ?? null,
    });

    const aName = a.name;
    const bName = b.name;

    const aAvatar = a.avatarUrl;
    const bAvatar = b.avatarUrl;

    const status = String(data?.status || "").toUpperCase();
    const result = String(data?.result || "").toUpperCase();

    const outcome =
      status === "ACTIVE"
        ? { label: "Ожидание", tone: "pending" as const }
        : status === "COMPLETED"
          ? result === "CHALLENGER_WON"
            ? { label: "Win", tone: "win" as const }
            : result === "CHALLENGER_LOST"
              ? { label: "Loss", tone: "loss" as const }
              : { label: result ? result.toLowerCase() : "Completed", tone: "neutral" as const }
          : { label: status ? status.toLowerCase() : "—", tone: "neutral" as const };

    const ts = data?.createdAt ? String(data.createdAt) : "";
    const when = ts
      ? (() => {
          try {
            return new Date(ts).toLocaleString();
          } catch {
            return ts;
          }
        })()
      : "";

    // Match rating delta display
    // Show deltas ONLY when backend actually applied rating (ratingAppliedAt != null).
    const winDelta = +20;
    const lossDelta = -10;

    let challengerDelta: number | null = null;
    let targetDelta: number | null = null;

    const ratingAppliedAt = data?.ratingAppliedAt ?? (data as any)?.rating_applied_at ?? null;
    const ratingWasApplied = !!ratingAppliedAt;

    if (ratingWasApplied && status === "COMPLETED" && (result === "CHALLENGER_WON" || result === "CHALLENGER_LOST")) {
      if (result === "CHALLENGER_WON") {
        challengerDelta = winDelta;
        targetDelta = lossDelta;
      } else {
        challengerDelta = lossDelta;
        targetDelta = winDelta;
      }
    }

    return { aName, bName, aAvatar, bAvatar, outcome, when, challengerDelta, targetDelta };
  };

  // TEMP DEBUG: existence check for /people/{key}.png to diagnose missing avatars in history.
  // Kept local to PlayerHud to avoid refactors.
  const peoplePngExistsCacheRef = React.useRef(new Map<string, boolean>());
  const checkPeoplePngExists = async (url: string): Promise<boolean> => {
    try {
      const cached = peoplePngExistsCacheRef.current.get(url);
      if (typeof cached === "boolean") return cached;

      // HEAD is enough; Next static files should respond 200/404.
      const r = await fetch(url, { method: "HEAD" });
      const ok = r.ok;
      peoplePngExistsCacheRef.current.set(url, ok);
      return ok;
    } catch {
      // If network fails, don't treat as missing.
      return true;
    }
  };

  const Avatar = ({ url, name }: { url: string | null; name: string }) => {
    const initial = (name || "?").trim().slice(0, 1).toUpperCase();
    return (
      <div
        title={name}
        style={{
          width: 56,
          height: 56,
          borderRadius: 999,
          border: "1px solid rgba(202,162,77,0.65)",
          overflow: "hidden",
          background: "rgba(255,255,255,0.06)",
          display: "grid",
          placeItems: "center",
          color: "rgba(247,240,223,0.92)",
          fontWeight: 900,
          boxShadow: "0 10px 18px rgba(0,0,0,0.35)",
        }}
      >
        {url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={url} alt={name} style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
        ) : (
          <span style={{ fontSize: 18 }}>{initial}</span>
        )}
      </div>
    );
  };

  const fmtTime = (ts: number) => {
    try {
      return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    } catch {
      return "";
    }
  };

  const searchSuggestions = useMemo(() => {
    const q = (searchQuery ?? "").toString().trim().toLocaleLowerCase("ru");
    const opts = (nicknameOptions ?? []).map((x) => (x ?? "").toString().trim()).filter(Boolean);
    if (!q) return [] as { label: string; exact: boolean }[];

    const scored = opts
      .map((label) => {
        const lc = label.toLocaleLowerCase("ru");
        const exact = lc === q;
        const starts = lc.startsWith(q);
        const includes = lc.includes(q);
        const score = exact ? 1000 : starts ? 500 : includes ? 100 : 0;
        return { label, exact, starts, includes, score };
      })
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score || a.label.localeCompare(b.label, "ru"))
      .slice(0, 8)
      .map(({ label, exact }) => ({ label, exact }));

    return scored;
  }, [searchQuery, nicknameOptions]);

  const [statsState, setStatsState] = useState<
    | { status: "idle" }
    | { status: "loading" }
    | { status: "refreshing" }
    | { status: "ok"; data: any }
    | { status: "empty" }
    | { status: "error"; message: string }
  >({ status: "idle" });

  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const name = (nickname ?? "").trim() || "Player";
  const subtitle = (title ?? "").trim();
  const autoBuildingUrl = useMemo(() => {
    // Priority: explicit tierLabel prop from parent
    const fromProp = mapTierToBuildingUrl(tierLabel ?? null);
    if (fromProp) return fromProp;
    // Backward-compat: attempt to read tierLabel from title if it is an object (not in our case now)
    return mapTierToBuildingUrl((title as any)?.tierLabel ?? null) || null;
  }, [tierLabel, title]);
  const resolvedBuildingUrl = buildingUrl ?? autoBuildingUrl ?? null;
  // rating removed (was based on aoe2insights HTML parsing)

  // ==========================
  // Variant A (ACTIVE): dark wood + bronze + gold
  // ==========================
  const panelStyle: React.CSSProperties = {
    backgroundImage: [
      "linear-gradient(180deg, rgba(0,0,0,0.10), rgba(0,0,0,0.22))",
      "repeating-linear-gradient(90deg, rgba(255,255,255,0.035) 0px, rgba(255,255,255,0.035) 1px, rgba(0,0,0,0.00) 1px, rgba(0,0,0,0.00) 6px)",
      "repeating-linear-gradient(0deg, rgba(255,255,255,0.025) 0px, rgba(255,255,255,0.025) 2px, rgba(0,0,0,0.00) 2px, rgba(0,0,0,0.00) 10px)",
      "radial-gradient(120% 180% at 10% 0%, rgba(255,255,255,0.06), rgba(0,0,0,0.08) 60%, rgba(0,0,0,0.12))",
      "linear-gradient(180deg, #3a2a1b 0%, #2d2117 55%, #22180f 100%)",
    ].join(", "),
    backgroundBlendMode: "multiply, normal, normal, overlay, normal",
  };

  const outerBorderColor = "#2b241d"; // dark metal
  const innerBorderColor = "rgba(211,176,106,0.78)"; // gold line (slightly brighter)
  const rivetColor = "#8e6a3d"; // bronze

  // ==========================
  // Variant B (ALTERNATIVE): stone + gold (commented)
  // ==========================
  /*
  const panelStyle: React.CSSProperties = {
    backgroundImage: [
      "linear-gradient(180deg, rgba(255,255,255,0.05) 0%, rgba(0,0,0,0.10) 100%)",
      "repeating-linear-gradient(45deg, rgba(0,0,0,0.08) 0px, rgba(0,0,0,0.08) 2px, rgba(255,255,255,0.02) 3px, rgba(255,255,255,0.02) 8px)",
      "linear-gradient(180deg, #3b465d 0%, #1f2a44 60%, #121a2a 100%)",
    ].join(", "),
  };

  const outerBorderColor = "#1b1a17";
  const innerBorderColor = "rgba(211,176,106,0.72)";
  const rivetColor = "#b99655";
  */

  // Width and how much of the panel remains visible when collapsed (toggle button width)
  const W = 680;
  const HANDLE_W = 38;
  const shiftX = useMemo(() => {
    // slide to the right, leaving the handle visible
    // Use px because the panel is fixed-sized and should feel like game UI
    const dx = W - HANDLE_W;
    return collapsed ? -dx : 0;
  }, [collapsed]);

  const toggle = () => setCollapsed((v) => !v);

  // History should only contain "calls" ("вызовы").
  // NOTE: this local history is temporary for debug. Real history should be loaded from backend (DB).

  useEffect(() => {
    if (!settingsOpen && !statsOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setSettingsOpen(false);
      setStatsOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [settingsOpen, statsOpen]);

  const buildStatsVm = (snap: any) => {
    const wins = typeof snap?.wins === "number" ? snap.wins : null;
    const losses = typeof snap?.losses === "number" ? snap.losses : null;
    const total = wins != null && losses != null ? wins + losses : null;
    const winRate =
      typeof snap?.winRate === "number"
        ? snap.winRate
        : total && wins != null
          ? Math.round((wins / total) * 1000) / 10
          : null;

    const fmtInt = (v: any) => (typeof v === "number" && Number.isFinite(v) ? Math.round(v).toString() : "—");
    const fmtPct = (v: any) => (typeof v === "number" && Number.isFinite(v) ? `${v.toFixed(1)}%` : "—");

    const syncedAt = typeof snap?.syncedAt === "string" ? snap.syncedAt : "";
    const syncedAtLabel = syncedAt
      ? (() => {
          try {
            return new Date(syncedAt).toLocaleString();
          } catch {
            return syncedAt;
          }
        })()
      : "";

    return {
      ratingLabel: fmtInt(snap?.rating),
      rankLabel:
        typeof snap?.rank === "number" && typeof snap?.rankTotal === "number"
          ? `${fmtInt(snap.rank)} / ${fmtInt(snap.rankTotal)}`
          : fmtInt(snap?.rank),
      winsLabel: fmtInt(wins),
      lossesLabel: fmtInt(losses),
      winRateLabel: fmtPct(winRate),
      streakLabel: fmtInt(snap?.streak),
      syncedAtLabel,
    };
  };

  const onManualRefresh = async () => {
    const id = (aoeProfileId ?? "").toString().trim();
    if (!id || isRefreshing) return;

    setStatsState({ status: "refreshing" });
    setIsRefreshing(true);
    setRefreshError(null);

    try {
      const { refreshAoePlayerStats } = await import("../../lib/api/aoePlayerStats");
      const rr = await refreshAoePlayerStats(id);
      const snap = (rr as any)?.snapshot ?? null;

      if (snap) {
        setStatsState({ status: "ok", data: buildStatsVm(snap) });
      } else {
        setStatsState({ status: "empty" });
        setRefreshError((rr as any)?.reason ? `Refresh skipped: ${(rr as any).reason}` : "No stats available yet.");
      }
    } catch (e: any) {
      setRefreshError(e?.message ? String(e.message) : "Failed to refresh stats");
      setStatsState((prev) => (prev.status === "ok" ? prev : { status: "empty" }));
    } finally {
      setIsRefreshing(false);
    }
  };

  useEffect(() => {
    if (!statsOpen) return;

    const id = (aoeProfileId ?? "").toString().trim();
    if (!id) {
      setStatsState({ status: "idle" });
      setRefreshError(null);
      setIsRefreshing(false);
      return;
    }

    let cancelled = false;
    setStatsState({ status: "loading" });
    setRefreshError(null);
    setIsRefreshing(false);

    (async () => {
      try {
        const { getAoePlayerStats, refreshAoePlayerStats } = await import("../../lib/api/aoePlayerStats");
        const r = await getAoePlayerStats(id);
        if (cancelled) return;

        const snap = (r as any)?.snapshot ?? null;
        if (snap) {
          setStatsState({ status: "ok", data: buildStatsVm(snap) });
          return;
        }

        // Lazy auto-refresh ONLY when snapshot is null.
        setStatsState({ status: "refreshing" });
        setIsRefreshing(true);

        const rr = await refreshAoePlayerStats(id);
        if (cancelled) return;

        const refreshedSnap = (rr as any)?.snapshot ?? null;
        if (refreshedSnap) {
          setStatsState({ status: "ok", data: buildStatsVm(refreshedSnap) });
          return;
        }

        setStatsState({ status: "empty" });
        if (!(rr as any)?.refreshed) {
          setRefreshError((rr as any)?.reason ? `Refresh skipped: ${(rr as any).reason}` : "Refresh skipped");
        }
      } catch (e: any) {
        if (cancelled) return;
        setStatsState({ status: "empty" });
        setRefreshError(e?.message ? String(e.message) : "Failed to refresh stats");
      } finally {
        if (!cancelled) setIsRefreshing(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [statsOpen, aoeProfileId]);

  return (
    <>
      {/* Tools panel is rendered into <body> so it's not inside hud-root */}
      {typeof document !== "undefined" &&
        createPortal(
          <div
            className="hud-tools"
            style={{
              position: "fixed",
              top: 12,
              right: 12,
              zIndex: 100002,
              display: "flex",
              flexDirection: "row",
              alignItems: "center",
              gap: 8,
              pointerEvents: "auto",
            }}
          >
            <button
              type="button"
              aria-label="Search"
              title="Поиск"
              onClick={(e) => {
                e.stopPropagation();
                setToolsOpen((s) => ({ ...s, search: !s.search, filter: false, history: false }));
              }}
              style={{
                cursor: "pointer",
                background: "#caa24d",
                border: "1px solid #caa24d",
                color: "#1b1b1b",
                borderRadius: 10,
                padding: "6px 8px",
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 6,
              }}
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="#1b1b1b"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <circle cx="11" cy="11" r="8"></circle>
                <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
              </svg>
              <span style={{ fontWeight: 900, fontSize: 12 }}>Поиск</span>
            </button>

            <button
              type="button"
              aria-label="Filter"
              title="Фильтр"
              onClick={(e) => {
                e.stopPropagation();
                setToolsOpen((s) => ({ ...s, filter: !s.filter, search: false, history: false }));
              }}
              style={{
                cursor: "pointer",
                background: "#caa24d",
                border: "1px solid #caa24d",
                color: "#1b1b1b",
                borderRadius: 10,
                padding: "6px 8px",
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 6,
              }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="#1b1b1b" xmlns="http://www.w3.org/2000/svg">
                <path d="M3 5h18l-7 8v4l-4 2v-6L3 5z" />
              </svg>
              <span style={{ fontWeight: 900, fontSize: 12 }}>Фильтр</span>
            </button>

            <button
              type="button"
              aria-label="History"
              title="История"
              onClick={(e) => {
                e.stopPropagation();
                openHistoryModal();
              }}
              style={{
                cursor: "pointer",
                background: "#caa24d",
                border: "1px solid #caa24d",
                color: "#1b1b1b",
                borderRadius: 10,
                padding: "6px 8px",
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 6,
              }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="#1b1b1b" xmlns="http://www.w3.org/2000/svg">
                <path d="M13 3a9 9 0 1 0 8 8h-2a7 7 0 1 1-7-7V3z" />
                <path d="M12 7h1v6h-4v-1h3V7z" />
              </svg>
              <span style={{ fontWeight: 900, fontSize: 12 }}>История</span>
            </button>

            {toolsOpen.search && (
              <div
                onPointerDown={(e) => e.stopPropagation()}
                style={{
                  position: "absolute",
                  right: "calc(100% + 8px)",
                  top: 0,
                  width: 260,
                  padding: 10,
                  borderRadius: 12,
                  border: "1px solid rgba(202,162,77,0.55)",
                  background: "rgba(20,14,10,0.96)",
                  boxShadow: "0 18px 44px rgba(0,0,0,0.70)",
                  color: "#f7f0df",
                  display: "flex",
                  flexDirection: "column",
                  gap: 8,
                }}
              >
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                  <div style={{ fontWeight: 900, fontSize: 12, letterSpacing: 0.6, textTransform: "uppercase", opacity: 0.92 }}>Поиск</div>
                  <button
                    type="button"
                    onClick={() => setToolsOpen((s) => ({ ...s, search: false }))}
                    style={{ background: "transparent", border: 0, color: "rgba(247,240,223,0.9)", cursor: "pointer", fontSize: 16, lineHeight: 1 }}
                    aria-label="Close"
                    title="Close"
                  >
                    ×
                  </button>
                </div>
                <div style={{ position: "relative" }}>
                  <input
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Имя игрока…"
                    style={{
                      width: "100%",
                      padding: "8px 34px 8px 10px",
                      borderRadius: 10,
                      border: "1px solid rgba(255,255,255,0.22)",
                      background: "rgba(255,255,255,0.06)",
                      color: "#f7f0df",
                      outline: "none",
                    }}
                  />
                  {searchQuery.trim() && (
                    <button
                      type="button"
                      onClick={() => {
                        setSearchQuery("");
                        onSearchNicknames?.("");
                      }}
                      title="Очистить поиск"
                      aria-label="Очистить поиск"
                      style={{
                        position: "absolute",
                        right: 8,
                        top: "50%",
                        transform: "translateY(-50%)",
                        width: 22,
                        height: 22,
                        borderRadius: 8,
                        border: "1px solid rgba(255,255,255,0.18)",
                        background: "rgba(255,255,255,0.06)",
                        color: "rgba(247,240,223,0.92)",
                        cursor: "pointer",
                        display: "grid",
                        placeItems: "center",
                        padding: 0,
                        lineHeight: 1,
                        fontWeight: 900,
                      }}
                    >
                      ×
                    </button>
                  )}
                </div>
                {searchSuggestions.length > 0 && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    <div style={{ fontWeight: 900, fontSize: 11, opacity: 0.75, letterSpacing: 0.4, textTransform: "uppercase" }}>
                      Подсказки
                    </div>
                    {searchSuggestions.map((sug) => (
                      <button
                        key={sug.label}
                        type="button"
                        onClick={() => {
                          setSearchQuery(sug.label);
                          pushHistory(`Поиск: ${sug.label}`);
                          setToolsOpen((s) => ({ ...s, history: true, search: false, filter: false }));
                          setHistorySeed((x) => x + 1);
                          onSearchNicknames?.(sug.label);
                          setToolsOpen((st) => ({ ...st, search: false }));
                        }}
                        style={{
                          width: "100%",
                          textAlign: "left",
                          padding: "8px 10px",
                          borderRadius: 10,
                          border: sug.exact ? "1px solid rgba(43,187,115,0.85)" : "1px solid rgba(255,255,255,0.14)",
                          background: sug.exact ? "rgba(43,187,115,0.12)" : "rgba(255,255,255,0.06)",
                          color: "#f7f0df",
                          cursor: "pointer",
                          fontWeight: 800,
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          gap: 10,
                        }}
                        title={sug.exact ? "Точное совпадение" : "Похожий ник"}
                      >
                        <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{sug.label}</span>
                        {sug.exact ? (
                          <span style={{ fontSize: 11, fontWeight: 900, color: "#2bb673" }}>EXACT</span>
                        ) : (
                          <span style={{ fontSize: 11, opacity: 0.7 }}>match</span>
                        )}
                      </button>
                    ))}
                  </div>
                )}

                <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
                  <button
                    type="button"
                    onClick={() => {
                      const q = searchQuery.trim();
                      if (q) {
                        pushHistory(`Поиск: ${q}`);
                        setToolsOpen((s) => ({ ...s, history: true, search: false, filter: false }));
                        setHistorySeed((x) => x + 1);
                        onSearchNicknames?.(q);
                      }
                      setToolsOpen((s) => ({ ...s, search: false }));
                    }}
                    style={{
                      padding: "8px 10px",
                      borderRadius: 10,
                      border: "1px solid #caa24d",
                      background: "#caa24d",
                      color: "#1b1b1b",
                      fontWeight: 900,
                      cursor: "pointer",
                    }}
                  >
                    Найти
                  </button>
                </div>
              </div>
            )}

            {toolsOpen.filter && (
              <div
                onPointerDown={(e) => e.stopPropagation()}
                style={{
                  position: "absolute",
                  right: "calc(100% + 8px)",
                  top: 0,
                  width: 220,
                  padding: 10,
                  borderRadius: 12,
                  border: "1px solid rgba(202,162,77,0.55)",
                  background: "rgba(20,14,10,0.96)",
                  boxShadow: "0 18px 44px rgba(0,0,0,0.70)",
                  color: "#f7f0df",
                  display: "flex",
                  flexDirection: "column",
                  gap: 8,
                }}
              >
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                  <div style={{ fontWeight: 900, fontSize: 12, letterSpacing: 0.6, textTransform: "uppercase", opacity: 0.92 }}>Фильтр</div>
                  <button
                    type="button"
                    onClick={() => setToolsOpen((s) => ({ ...s, filter: false }))}
                    style={{ background: "transparent", border: 0, color: "rgba(247,240,223,0.9)", cursor: "pointer", fontSize: 16, lineHeight: 1 }}
                    aria-label="Close"
                    title="Close"
                  >
                    ×
                  </button>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {Object.keys(filterGroups).map((k) => {
                    const checked = !!filterGroups[k];
                    return (
                      <label key={k} style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", userSelect: "none" }}>
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => {
                            setFilterGroups((prev) => {
                              const next = { ...prev, [k]: !prev[k] };
                              onFilterGroupsChange?.(next);
                          pushHistory(`Фильтр: ${Object.entries(next)
                            .filter(([, v]) => !!v)
                            .map(([k]) => k)
                            .join(", ") || "ничего"}`);
                              setToolsOpen((s) => ({ ...s, history: true, search: false, filter: false }));
                              setHistorySeed((x) => x + 1);
                              return next;
                            });
                          }}
                          style={{ width: 16, height: 16, cursor: "pointer" }}
                        />
                        <span style={{ fontWeight: 900, fontSize: 13 }}>{k}</span>
                      </label>
                    );
                  })}
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8, marginTop: 8 }}>
                  <button
                    type="button"
                    onClick={() => {
                      const next = {
                        "Замки": true,
                        "Крепости": true,
                        "Донжоны": true,
                        "Башня": true,
                        "Халупа": true,
                      };
                      setFilterGroups(next);
                      onFilterGroupsChange?.(next);
                      pushHistory(`Фильтр: Замки, Крепости, Донжоны, Башня, Халупа`);
                      setToolsOpen((s) => ({ ...s, history: true, search: false, filter: false }));
                      setHistorySeed((x) => x + 1);
                    }}
                    style={{
                      padding: "8px 10px",
                      borderRadius: 10,
                      border: "1px solid rgba(255,255,255,0.22)",
                      background: "rgba(255,255,255,0.06)",
                      color: "#f7f0df",
                      fontWeight: 900,
                      cursor: "pointer",
                    }}
                    title="Сбросить фильтр"
                  >
                    Сбросить
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      onFilterGroupsChange?.(filterGroups);
                      pushHistory(`Фильтр применён`);
                      setToolsOpen((s) => ({ ...s, history: true, search: false, filter: false }));
                      setHistorySeed((x) => x + 1);
                      setToolsOpen((s) => ({ ...s, filter: false }));
                    }}
                    style={{
                      padding: "8px 10px",
                      borderRadius: 10,
                      border: "1px solid #caa24d",
                      background: "#caa24d",
                      color: "#1b1b1b",
                      fontWeight: 900,
                      cursor: "pointer",
                    }}
                  >
                    Закрыть
                  </button>
                </div>
              </div>
            )}

                      {historyModalOpen &&
              typeof document !== "undefined" &&
              createPortal(
                <>
                  <div
                    onPointerDown={(e) => {
                      e.stopPropagation();
                      setHistoryModalOpen(false);
                    }}
                    style={{
                      position: "fixed",
                      inset: 0,
                      zIndex: 100010,
                      pointerEvents: "auto",
                      background: "rgba(0,0,0,0.45)",
                    }}
                  />
                  <div
                    onPointerDown={(e) => e.stopPropagation()}
                    style={{
                      position: "fixed",
                      left: "50%",
                      top: "50%",
                      transform: "translate(-50%, -50%)",
                      width: "min(720px, calc(100vw - 32px))",
                      maxHeight: "min(520px, calc(100vh - 32px))",
                      overflow: "auto",
                      padding: 14,
                      borderRadius: 12,
                      border: "1px solid rgba(202,162,77,0.65)",
                      background: "rgba(20, 14, 10, 0.97)",
                      boxShadow: "0 18px 44px rgba(0,0,0,0.70)",
                      color: "#f7f0df",
                      zIndex: 100011,
                      pointerEvents: "auto",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 10 }}>
                      <div style={{ fontWeight: 900, fontSize: 12, letterSpacing: 0.6, textTransform: "uppercase", opacity: 0.92 }}>История вызовов</div>
                      <button
                        type="button"
                        onClick={() => setHistoryModalOpen(false)}
                        style={{ background: "transparent", border: 0, color: "rgba(247,240,223,0.9)", cursor: "pointer", fontSize: 16, lineHeight: 1 }}
                        aria-label="Close"
                        title="Close"
                      >
                        ×
                      </button>
                    </div>

                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, marginBottom: 10 }}>
                      <div style={{ opacity: 0.75, fontSize: 12 }}>
                        {historyState.status === "ok" ? `${historyState.challenges.length} записей` : ""}
                      </div>
                      <button
                        type="button"
                        onClick={() => setHistoryExpanded((v) => !v)}
                        style={{
                          padding: "8px 12px",
                          borderRadius: 10,
                          border: "1px solid rgba(202,162,77,0.9)",
                          background: "rgba(202,162,77,0.18)",
                          color: "#f7f0df",
                          fontWeight: 900,
                          cursor: "pointer",
                        }}
                        title="Показать всю историю"
                      >
                        История
                      </button>
                    </div>

                    {historyState.status === "loading" && <div style={{ opacity: 0.9, lineHeight: 1.4 }}>Загрузка…</div>}

                    {historyState.status === "error" && <div style={{ opacity: 0.9, lineHeight: 1.4 }}>{historyState.message}</div>}

                    {historyState.status === "ok" && (
                      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                        {historyState.challenges.length === 0 ? (
                          <div style={{ opacity: 0.8, fontSize: 12 }}>Пусто</div>
                        ) : (
                          historyState.challenges
                            .slice(0, historyExpanded ? 200 : 3)
                            .map((ch, idx) => {
                              const vm = challengeVm(ch);

                              // TEMP DEBUG: log only in history modal and only for suspicious/missing avatars.
                              // Suspicious = derived /people/*.png (may not exist) or empty.
                              const aUrl = vm.aAvatar;
                              const bUrl = vm.bAvatar;
                              const isSuspicious = (u: any) => {
                                const s = typeof u === "string" ? u.trim() : "";
                                if (!s) return true;
                                return s.startsWith("/people/") && s.endsWith(".png");
                              };

                              if (historyModalOpen && (isSuspicious(aUrl) || isSuspicious(bUrl))) {
                                // Fire-and-forget async checks; keep logs grouped.
                                (async () => {
                                  const challengerUser = ch?.challengerUser ?? null;
                                  const targetUser = ch?.targetUser ?? null;

                                  const challengerPlayerKey = typeof ch?.challengerPlayerKey === "string" ? ch.challengerPlayerKey.trim() : "";
                                  const targetPlayerKey = typeof ch?.targetPlayerKey === "string" ? ch.targetPlayerKey.trim() : "";

                                  const mapChallenger = challengerPlayerKey && mapPlayers ? (mapPlayers as any)[challengerPlayerKey] : null;
                                  const mapTarget = targetPlayerKey && mapPlayers ? (mapPlayers as any)[targetPlayerKey] : null;

                                  const aPeopleExists = typeof aUrl === "string" && aUrl.startsWith("/people/") ? await checkPeoplePngExists(aUrl) : null;
                                  const bPeopleExists = typeof bUrl === "string" && bUrl.startsWith("/people/") ? await checkPeoplePngExists(bUrl) : null;

                                  // eslint-disable-next-line no-console
                                  console.groupCollapsed(
                                    `[history-avatar-debug] ch=${String(ch?.id ?? "?")} idx=${idx} a=${vm.aName} b=${vm.bName}`
                                  );
                                  // eslint-disable-next-line no-console
                                  console.log({
                                    challengeId: ch?.id ?? null,
                                    challengerUser_displayName: challengerUser?.displayName ?? null,
                                    targetUser_displayName: targetUser?.displayName ?? null,
                                    challengerUser_avatarUrl: challengerUser?.avatarUrl ?? null,
                                    targetUser_avatarUrl: targetUser?.avatarUrl ?? null,
                                    challengerPlayerKey: challengerPlayerKey || null,
                                    targetPlayerKey: targetPlayerKey || null,
                                    mapPlayers_challenger: mapChallenger,
                                    mapPlayers_target: mapTarget,
                                    vm_aAvatar: vm.aAvatar,
                                    vm_bAvatar: vm.bAvatar,
                                    vm_aName: vm.aName,
                                    vm_bName: vm.bName,
                                    peoplePngExists_a: aPeopleExists,
                                    peoplePngExists_b: bPeopleExists,
                                  });
                                  // eslint-disable-next-line no-console
                                  console.groupEnd();
                                })();
                              }

                              const badgeBg =
                                vm.outcome.tone === "win"
                                  ? "rgba(43,187,115,0.18)"
                                  : vm.outcome.tone === "loss"
                                    ? "rgba(232,76,61,0.18)"
                                    : vm.outcome.tone === "pending"
                                      ? "rgba(202,162,77,0.16)"
                                      : "rgba(255,255,255,0.08)";
                              const badgeBorder =
                                vm.outcome.tone === "win"
                                  ? "rgba(43,187,115,0.55)"
                                  : vm.outcome.tone === "loss"
                                    ? "rgba(232,76,61,0.55)"
                                    : vm.outcome.tone === "pending"
                                      ? "rgba(202,162,77,0.55)"
                                      : "rgba(255,255,255,0.16)";

                              const isHero = !historyExpanded && idx < 3;

                              return (
                                <div
                                  key={String(ch?.id || idx)}
                                  style={{
                                    padding: isHero ? 20 : 12,
                                    borderRadius: isHero ? 18 : 12,
                                    background: isHero ? "rgba(255,255,255,0.085)" : "rgba(255,255,255,0.055)",
                                    border: isHero ? "1px solid rgba(202,162,77,0.35)" : "1px solid rgba(255,255,255,0.10)",
                                    display: "grid",
                                    gridTemplateColumns: "1fr auto",
                                    gap: isHero ? 18 : 12,
                                    alignItems: "center",
                                  }}
                                  title={String(ch?.id || "")}
                                >
                                  <div style={{ display: "flex", alignItems: "center", gap: isHero ? 18 : 12, minWidth: 0 }}>
                                    <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
                                      <div style={{ transform: isHero ? "scale(1.25)" : "scale(1)", transformOrigin: "left center" }}>
                                        <Avatar url={vm.aAvatar} name={vm.aName} />
                                      </div>
                                      <div style={{ fontWeight: 950, fontSize: isHero ? 20 : 15, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{vm.aName}</div>
                                    </div>

                                    <div style={{ opacity: 0.9, fontWeight: 900, padding: "0 8px", letterSpacing: 1.2, fontSize: isHero ? 16 : 13 }}>VS</div>

                                    <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
                                      <div style={{ transform: isHero ? "scale(1.25)" : "scale(1)", transformOrigin: "left center" }}>
                                        <Avatar url={vm.bAvatar} name={vm.bName} />
                                      </div>
                                      <div style={{ fontWeight: 950, fontSize: isHero ? 20 : 15, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{vm.bName}</div>
                                    </div>
                                  </div>

                                  <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: isHero ? 10 : 8 }}>
                                    <div
                                      style={{
                                        padding: isHero ? "9px 12px" : "7px 10px",
                                        borderRadius: 999,
                                        background: badgeBg,
                                        border: `1px solid ${badgeBorder}`,
                                        fontWeight: 950,
                                        fontSize: isHero ? 14 : 13,
                                        letterSpacing: 0.4,
                                      }}
                                    >
                                      {vm.outcome.label}
                                    </div>
                                    {vm.when ? <div style={{ opacity: 0.7, fontSize: isHero ? 13 : 12, textAlign: "right" }}>{vm.when}</div> : null}

                                    {(vm as any)?.challengerDelta != null || (vm as any)?.targetDelta != null ? (
                                      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", justifyContent: "flex-end" }}>
                                        {(vm as any)?.challengerDelta != null ? (
                                          <div style={{ fontSize: 12, fontWeight: 950, color: (vm as any).challengerDelta > 0 ? "#2bb673" : "#ffb4b4" }}>
                                            {vm.aName}: {fmtSigned((vm as any).challengerDelta)}
                                          </div>
                                        ) : null}
                                        {(vm as any)?.targetDelta != null ? (
                                          <div style={{ fontSize: 12, fontWeight: 950, color: (vm as any).targetDelta > 0 ? "#2bb673" : "#ffb4b4" }}>
                                            {vm.bName}: {fmtSigned((vm as any).targetDelta)}
                                          </div>
                                        ) : null}
                                      </div>
                                    ) : null}
                                  </div>
                                </div>
                              );
                            })
                        )}
                      </div>
                    )}
                  </div>
                </>,
                document.body
              )}

          </div>,
          document.body
        )}

      <div
        className="hud-root"
        style={{
          position: "fixed",
          bottom: 14,
          left: 12,
          zIndex: 100000,
          pointerEvents: "none", // do not block map interactions
        }}
      >
        <div
          className="hud-wrap"
          style={{
            width: W,
            transform: `translateX(${shiftX}px)`,
            transition: "transform 220ms ease",
            willChange: "transform",
            pointerEvents: "auto", // allow clicking on toggle/panel
            display: "flex",
            justifyContent: "flex-start",
            position: "relative",
          }}
        >
        {/* Main panel */}
        <div
          className="hud-card"
          style={{
            ...panelStyle,
            width: W - HANDLE_W,
            minHeight: 180,
            borderRadius: "6px 0 0 6px",
            border: `1px solid ${outerBorderColor}`,
            borderRight: 0,
            padding: 16,
            boxShadow: [
              "0 10px 22px rgba(0,0,0,0.45)",
              "inset 0 1px 0 rgba(255,255,255,0.10)",
              "inset 0 -1px 0 rgba(0,0,0,0.55)",
              "inset 0 0 0 1px rgba(0,0,0,0.25)",
            ].join(", "),
            position: "relative",
            overflow: "hidden",
            clipPath: "inset(0px 0px 0px 0px)",
          }}
        >
                    {/* background: full avatar */}
          <div aria-hidden style={{ position: "absolute", inset: 0, overflow: "hidden" }}>
            {resolvedBuildingUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={resolvedBuildingUrl}
                alt=""
                style={{ position: "absolute", width: "auto", height: "100%", objectFit: "contain", filter: "none", bottom: -6, opacity: 0.96, maxWidth: "none", zIndex: 1, left: "32%", transform: "translateX(-50%)" }}
              />
            ) : null}
            {avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={avatarUrl}
                alt=""
                style={{ position: "absolute", left: "20%", bottom: "0px", width: "50%", height: "auto", maxHeight: "100%", objectFit: "contain", objectPosition: "center bottom", transform: "translateX(-50%)", background: "transparent", zIndex: 3, filter: "brightness(1.05) drop-shadow(rgba(0, 0, 0, 0.55) 0px 8px 22px)" }}
              />
            ) : null}
            <div
              style={{
                position: "absolute",
                inset: 0,
                backgroundImage: [
                  // vignette keeps center brighter for the avatar
                  "radial-gradient(ellipse at 50% 75%, rgba(42,32,22,0.00) 0%, rgba(42,32,22,0.00) 36%, rgba(42,32,22,0.35) 70%, rgba(42,32,22,0.55) 100%)",
                  // subtle vertical warmth
                  "linear-gradient(180deg, rgba(58,42,27,0.30) 0%, rgba(42,32,22,0.45) 100%)",
                ].join(", "),
                zIndex: 2,
              }}
            />
          </div>

          {/* ornamental corner accents */}
          <div aria-hidden style={{ position: "absolute", left: 6, top: 6, width: 12, height: 12, borderLeft: `2px solid rgba(211,176,106,0.55)`, borderTop: `2px solid rgba(211,176,106,0.55)`, opacity: 0.9 }} />
          <div aria-hidden style={{ position: "absolute", right: 6, top: 6, width: 12, height: 12, borderRight: `2px solid rgba(211,176,106,0.55)`, borderTop: `2px solid rgba(211,176,106,0.55)`, opacity: 0.9 }} />
          <div aria-hidden style={{ position: "absolute", left: 6, bottom: 6, width: 12, height: 12, borderLeft: `2px solid rgba(211,176,106,0.35)`, borderBottom: `2px solid rgba(211,176,106,0.35)`, opacity: 0.75 }} />
          <div aria-hidden style={{ position: "absolute", right: 6, bottom: 6, width: 12, height: 12, borderRight: `2px solid rgba(211,176,106,0.35)`, borderBottom: `2px solid rgba(211,176,106,0.35)`, opacity: 0.75 }} />

          {/* rivets */}
          <div aria-hidden style={{ position: "absolute", left: 18, top: 10, width: 6, height: 6, borderRadius: 999, background: rivetColor, boxShadow: "inset 0 1px 1px rgba(255,255,255,0.20), inset 0 -1px 1px rgba(0,0,0,0.55)" }} />
          <div aria-hidden style={{ position: "absolute", right: 18, top: 10, width: 6, height: 6, borderRadius: 999, background: rivetColor, boxShadow: "inset 0 1px 1px rgba(255,255,255,0.20), inset 0 -1px 1px rgba(0,0,0,0.55)" }} />
          <div aria-hidden style={{ position: "absolute", left: 18, bottom: 10, width: 6, height: 6, borderRadius: 999, background: rivetColor, boxShadow: "inset 0 1px 1px rgba(255,255,255,0.20), inset 0 -1px 1px rgba(0,0,0,0.55)" }} />
          <div aria-hidden style={{ position: "absolute", right: 18, bottom: 10, width: 6, height: 6, borderRadius: 999, background: rivetColor, boxShadow: "inset 0 1px 1px rgba(255,255,255,0.20), inset 0 -1px 1px rgba(0,0,0,0.55)" }} />

          <div
            style={{
              position: "relative",
              zIndex: 3,
              display: "grid",
              gridTemplateColumns: "1fr",
              alignItems: "center",
              justifyItems: "end",
              gap: "10px",
              paddingLeft: "12px",
              paddingRight: 0,
              maxWidth: "100%",
            }}
          >
            {/* Portrait frame / medallion */}
            <div
              style={{
                display: "none",
                width: 88,
                height: 88,
                borderRadius: 999,
                padding: 3,
                background: "linear-gradient(180deg, #d3b06a 0%, #b99655 55%, #7a5a34 100%)",
                boxShadow: [
                  "inset 0 1px 0 rgba(255,255,255,0.35)",
                  "inset 0 -2px 4px rgba(0,0,0,0.55)",
                  "0 6px 14px rgba(0,0,0,0.45)",
                ].join(", "),
              }}
            >
              <div
                style={{
                  width: "100%",
                  height: "100%",
                  borderRadius: 999,
                  overflow: "hidden",
                  background: "linear-gradient(180deg, rgba(0,0,0,0.35), rgba(0,0,0,0.70))",
                  border: "1px solid rgba(43,36,29,0.75)",
                  boxShadow: "inset 0 2px 6px rgba(0,0,0,0.55)",
                }}
              >
                {avatarUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={avatarUrl}
                    alt="avatar"
                    style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
                  />
                ) : (
                  <div
                    aria-hidden
                    style={{
                      width: "100%",
                      height: "100%",
                      background:
                        "radial-gradient(circle at 30% 30%, rgba(241,230,200,0.12) 0%, rgba(0,0,0,0.35) 55%, rgba(0,0,0,0.65) 100%)",
                    }}
                  />
                )}
              </div>
            </div>

            {/* Text block */}
            <div style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: 3, alignItems: "flex-end", textAlign: "right" }}>
              <div
                title={name}
                style={{
                  color: "#f8ecd4",
                  fontWeight: 800,
                  fontSize: 22,
                  letterSpacing: 0.2,
                  textShadow: "0 1px 0 rgba(0,0,0,0.55)",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  wordBreak: "normal",
                  overflowWrap: "normal",
                }}
              >
                {name}
              </div>

              {subtitle ? (
                <div
                  title={subtitle}
                  style={{
                  color: "#e0cf9f",
                  fontWeight: 700,
                  fontSize: 16,
                  letterSpacing: 1.2,
                  textTransform: "uppercase",
                  textShadow: "0 1px 0 rgba(0,0,0,0.55)",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  wordBreak: "normal",
                  overflowWrap: "normal",
                  }}
                >
                  {subtitle}
                </div>
              ) : (
                <div style={{ height: 13 }} />
              )}

              {/* Challenge rating points */}
              <div
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 8,
                  marginTop: 2,
                  padding: "6px 10px",
                  borderRadius: 999,
                  border: "1px solid rgba(202,162,77,0.55)",
                  background: "rgba(0,0,0,0.22)",
                  color: "rgba(247,240,223,0.92)",
                  fontWeight: 900,
                  fontSize: 13,
                  letterSpacing: 0.2,
                  boxShadow: "inset 0 1px 0 rgba(255,255,255,0.08)",
                }}
                title="Challenge rating"
              >
                <span style={{ opacity: 0.75, fontWeight: 900 }}>Rating</span>
                <span style={{ fontWeight: 950 }}>{typeof ratingPoints === "number" ? ratingPoints : "—"}</span>
              </div>
            </div>

                      </div>
          {/* bottom-right controls inside hud-card */}
          <div
            style={{
              position: "absolute",
              right: 20,
              bottom: 0,
              display: "flex",
              gap: 12,
              padding: "8px 10px",
              pointerEvents: "auto",
              zIndex: 4,
            }}
          >
            {statsOpen &&
              typeof document !== "undefined" &&
              createPortal(
                <>
                  <div
                    onPointerDown={(e) => {
                      e.stopPropagation();
                      setStatsOpen(false);
                    }}
                    style={{
                      position: "fixed",
                      inset: 0,
                      zIndex: 999996,
                      pointerEvents: "auto",
                      background: "rgba(0,0,0,0.35)",
                    }}
                  />
                  <div
                    onPointerDown={(e) => e.stopPropagation()}
                    style={{
                      position: "fixed",
                      left: "50%",
                      top: "50%",
                      transform: "translate(-50%, -50%)",
                      width: "min(520px, calc(100vw - 32px))",
                      padding: 14,
                      borderRadius: 12,
                      border: "1px solid rgba(202,162,77,0.65)",
                      background: "rgba(20, 14, 10, 0.97)",
                      boxShadow: "0 18px 44px rgba(0,0,0,0.70)",
                      color: "#f7f0df",
                      zIndex: 999997,
                      pointerEvents: "auto",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 10 }}>
                      <div style={{ fontWeight: 900, fontSize: 12, letterSpacing: 0.6, textTransform: "uppercase", opacity: 0.92 }}>Statistics</div>
                      <button
                        type="button"
                        onClick={() => setStatsOpen(false)}
                        style={{ background: "transparent", border: 0, color: "rgba(247,240,223,0.9)", cursor: "pointer", fontSize: 16, lineHeight: 1 }}
                        aria-label="Close"
                        title="Close"
                      >
                        ×
                      </button>
                    </div>

                    {statsState.status === "idle" && (
                      <div style={{ opacity: 0.9, lineHeight: 1.4 }}>Claim a player to see stats.</div>
                    )}

                    {statsState.status === "loading" && (
                      <div style={{ opacity: 0.9, lineHeight: 1.4 }}>Loading stats…</div>
                    )}

                    {statsState.status === "refreshing" && (
                      <div style={{ opacity: 0.9, lineHeight: 1.4 }}>Refreshing stats…</div>
                    )}

                    {statsState.status === "empty" && (
                      <div style={{ opacity: 0.9, lineHeight: 1.4 }}>No stats available yet.</div>
                    )}

                    {refreshError ? (
                      <div style={{ marginTop: 8, opacity: 0.75, fontSize: 12, lineHeight: 1.35, wordBreak: "break-word" }}>{refreshError}</div>
                    ) : null}

                    <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 12 }}>
                      <button
                        type="button"
                        onClick={onManualRefresh}
                        disabled={statsState.status === "idle" || isRefreshing}
                        style={{
                          padding: "8px 10px",
                          borderRadius: 10,
                          border: "1px solid rgba(202,162,77,0.9)",
                          background: isRefreshing ? "rgba(202,162,77,0.10)" : "rgba(202,162,77,0.18)",
                          color: "#f7f0df",
                          fontWeight: 900,
                          cursor: statsState.status === "idle" || isRefreshing ? "not-allowed" : "pointer",
                          opacity: statsState.status === "idle" ? 0.5 : 1,
                        }}
                        title="Refresh stats"
                      >
                        Refresh stats
                      </button>
                    </div>

                    {statsState.status === "error" && (
                      <div style={{ opacity: 0.9, lineHeight: 1.4 }}>
                        Stats unavailable.
                        <div style={{ marginTop: 6, opacity: 0.7, fontSize: 12, wordBreak: "break-word" }}>{statsState.message}</div>
                      </div>
                    )}

                    {statsState.status === "ok" && (
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, fontSize: 13 }}>
                        <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                          <span style={{ opacity: 0.8 }}>Rating</span>
                          <span style={{ fontWeight: 900 }}>{statsState.data.ratingLabel}</span>
                        </div>
                        <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                          <span style={{ opacity: 0.8 }}>Rank</span>
                          <span style={{ fontWeight: 900 }}>{statsState.data.rankLabel}</span>
                        </div>
                        <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                          <span style={{ opacity: 0.8 }}>Wins</span>
                          <span style={{ fontWeight: 900 }}>{statsState.data.winsLabel}</span>
                        </div>
                        <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                          <span style={{ opacity: 0.8 }}>Losses</span>
                          <span style={{ fontWeight: 900 }}>{statsState.data.lossesLabel}</span>
                        </div>
                        <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                          <span style={{ opacity: 0.8 }}>Winrate</span>
                          <span style={{ fontWeight: 900 }}>{statsState.data.winRateLabel}</span>
                        </div>
                        <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                          <span style={{ opacity: 0.8 }}>Streak</span>
                          <span style={{ fontWeight: 900 }}>{statsState.data.streakLabel}</span>
                        </div>

                        {statsState.data.syncedAtLabel ? (
                          <div style={{ gridColumn: "1 / -1", marginTop: 6, opacity: 0.7, fontSize: 12 }}>
                            Updated: {statsState.data.syncedAtLabel}
                          </div>
                        ) : null}
                      </div>
                    )}
                  </div>
                </>,
                document.body
              )}

            {settingsOpen &&
              typeof document !== "undefined" &&
              createPortal(
                <>
                  <div
                    onPointerDown={(e) => {
                      e.stopPropagation();
                      setSettingsOpen(false);
                    }}
                    style={{
                      position: "fixed",
                      inset: 0,
                      zIndex: 999998,
                      pointerEvents: "auto",
                      background: "transparent",
                    }}
                  />
                  <div
                    onPointerDown={(e) => e.stopPropagation()}
                    style={{
                      position: "fixed",
                      left: "50%",
                      top: "50%",
                      transform: "translate(-50%, -50%)",
                      width: 260,
                      padding: 12,
                      borderRadius: 12,
                      border: "1px solid rgba(202,162,77,0.65)",
                      background: "rgba(20, 14, 10, 0.96)",
                      boxShadow: "0 18px 44px rgba(0,0,0,0.70)",
                      color: "#f7f0df",
                      zIndex: 999999,
                      pointerEvents: "auto",
                    }}
                  >
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 10 }}>
                  <div style={{ fontWeight: 900, fontSize: 12, letterSpacing: 0.6, textTransform: "uppercase", opacity: 0.92 }}>Settings</div>
                  <button
                    type="button"
                    onClick={() => setSettingsOpen(false)}
                    style={{ background: "transparent", border: 0, color: "rgba(247,240,223,0.9)", cursor: "pointer", fontSize: 16, lineHeight: 1 }}
                    aria-label="Close"
                    title="Close"
                  >
                    ×
                  </button>
                </div>

                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  <div style={{ fontSize: 12, opacity: 0.92 }}>
                    Linked player: <span style={{ fontWeight: 900 }}>{(linkedPlayerName ?? name) || "—"}</span>
                  </div>

                  <div style={{ fontSize: 12, opacity: 0.92 }}>
                    Status: <span style={{ fontWeight: 900 }}>steam - {steamConnected ? "connected" : "not connected"}</span>
                  </div>

                  {!steamConnected && steamLinkUrl && (
                    <a
                      href={steamLinkUrl}
                      style={{
                        display: "inline-block",
                        width: "fit-content",
                        padding: "6px 10px",
                        borderRadius: 10,
                        border: "1px solid rgba(202,162,77,0.9)",
                        background: "rgba(202,162,77,0.18)",
                        color: "#f7f0df",
                        fontWeight: 900,
                        textDecoration: "none",
                      }}
                      title="Connect Steam"
                    >
                      Connect Steam
                    </a>
                  )}

                  <button
                    type="button"
                    onClick={() => {
                      setSettingsOpen(false);
                      onLogout?.();
                    }}
                    style={{
                      width: "100%",
                      padding: "8px 10px",
                      borderRadius: 10,
                      border: "1px solid rgba(255,255,255,0.22)",
                      background: "rgba(255,255,255,0.06)",
                      color: "#f7f0df",
                      fontWeight: 900,
                      cursor: "pointer",
                      textAlign: "center",
                    }}
                    title="Log out"
                  >
                    Log out
                  </button>
                </div>
              </div>
                </>,
                document.body
              )}

            <button
              type="button"
              aria-label="Settings"
              title="Settings"
              onClick={(e) => {
                e.stopPropagation();
                setSettingsOpen((v) => !v);
              }}
              style={{
                cursor: "pointer",
                background: "transparent",
                border: "none",
                padding: 4,
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <svg
                width="22"
                height="22"
                viewBox="0 0 24 24"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
                style={{ display: "block", filter: "none" }}
                stroke="#e0cf9f"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <circle cx="12" cy="12" r="3"></circle>
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82 2 2 0 1 1-2.83 2.83 1.65 1.65 0 0 0-1.82.33 1.65 1.65 0 0 0-.5 1.5 2 2 0 1 1-3.9 0 1.65 1.65 0 0 0-1.18-1.18 1.65 1.65 0 0 0-1.5.5 2 2 0 1 1-2.83-2.83 1.65 1.65 0 0 0-.33-1.82 1.65 1.65 0 0 0-1.5-.5 2 2 0 1 1 0-3.9 1.65 1.65 0 0 0 1.5-.5 1.65 1.65 0 0 0 .33-1.82 2 2 0 1 1 2.83-2.83 1.65 1.65 0 0 0 1.82-.33 1.65 1.65 0 0 0 .5-1.5 2 2 0 1 1 3.9 0 1.65 1.65 0 0 0 1.18 1.18 1.65 1.65 0 0 0 1.5-.5 2 2 0 1 1 2.83 2.83 1.65 1.65 0 0 0 .33 1.82 1.65 1.65 0 0 0 1.5.5 2 2 0 1 1 0 3.9 1.65 1.65 0 0 0-1.5.5z"></path>
              </svg>
            </button>
            <button
              type="button"
              aria-label="Statistics"
              title="Statistics"
              onClick={(e) => {
                e.stopPropagation();
                setStatsOpen(true);
              }}
              style={{
                cursor: "pointer",
                background: "transparent",
                border: "none",
                padding: 4,
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                opacity: 0.7,
              }}
            >
              <svg
                width="22"
                height="22"
                viewBox="0 0 24 24"
                fill="#e0cf9f"
                xmlns="http://www.w3.org/2000/svg"
                style={{ display: "block", filter: "none" }}
              >
                <path d="M4 19h3V9H4v10zm6 0h3V5h-3v14zm6 0h3v-7h-3v7z" />
              </svg>
            </button>
          </div>
        </div>
        <button
          type="button"
          onClick={toggle}
          aria-label={collapsed ? "Show HUD" : "Hide HUD"}
          title={collapsed ? "Show" : "Hide"}
          style={{
            width: HANDLE_W,
            minWidth: HANDLE_W,
            height: 168,
            borderRadius: "0 6px 6px 0",
            border: `1px solid ${outerBorderColor}`,
            borderLeft: 0,
            padding: 0,
            cursor: "pointer",
            backgroundImage: [
              "linear-gradient(180deg, rgba(255,255,255,0.05) 0%, rgba(0,0,0,0.18) 100%)",
              "linear-gradient(180deg, #7a5a34 0%, #4a2e1d 55%, #2b1a12 100%)",
            ].join(", "),
            boxShadow: [
              "0 10px 22px rgba(0,0,0,0.45)",
              "inset 0 1px 0 rgba(255,255,255,0.10)",
              "inset 0 -1px 0 rgba(0,0,0,0.55)",
            ].join(", "),
            color: "rgba(241,230,200,0.92)",
            userSelect: "none",
            display: "grid",
            placeItems: "center",
          }}
        >
          <span
            aria-hidden
            style={{
              display: "inline-block",
              fontWeight: 900,
              fontSize: 16,
              lineHeight: 1,
              transform: collapsed ? "translateX(-1px)" : "translateX(0)",
              textShadow: "0 1px 0 rgba(0,0,0,0.65)",
            }}
          >
            {collapsed ? "▶" : "◀"}
          </span>
        </button>

              </div>
    </div>
    </>
  );
}
