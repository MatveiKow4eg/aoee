"use client";

import React, { useMemo, useState, useEffect } from "react";
import { createPortal } from "react-dom";

export type PlayerHudProps = {
  nickname?: string | null;
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

export default function PlayerHud({ nickname, title, tierLabel, avatarUrl, buildingUrl, online, steamConnected, steamLinkUrl, onLogout, linkedPlayerName, aoeProfileId }: PlayerHudProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [statsOpen, setStatsOpen] = useState(false);

  const [statsState, setStatsState] = useState<
    | { status: "idle" }
    | { status: "loading" }
    | { status: "ok"; data: any }
    | { status: "empty" }
    | { status: "error"; message: string }
  >({ status: "idle" });

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

  useEffect(() => {
    if (!statsOpen) return;

    const id = (aoeProfileId ?? "").toString().trim();
    if (!id) {
      setStatsState({ status: "idle" });
      return;
    }

    let cancelled = false;
    setStatsState({ status: "loading" });

    (async () => {
      try {
        const { getAoePlayerStats } = await import("../../lib/api/aoePlayerStats");
        const r = await getAoePlayerStats(id);
        if (cancelled) return;

        const snap = (r as any)?.snapshot ?? null;
        if (!snap) {
          setStatsState({ status: "empty" });
          return;
        }

        const wins = typeof snap.wins === "number" ? snap.wins : null;
        const losses = typeof snap.losses === "number" ? snap.losses : null;
        const total = wins != null && losses != null ? wins + losses : null;
        const winRate =
          typeof snap.winRate === "number"
            ? snap.winRate
            : total && wins != null
              ? Math.round((wins / total) * 1000) / 10
              : null;

        const fmtInt = (v: any) => (typeof v === "number" && Number.isFinite(v) ? Math.round(v).toString() : "—");
        const fmtPct = (v: any) => (typeof v === "number" && Number.isFinite(v) ? `${v.toFixed(1)}%` : "—");

        const syncedAt = typeof snap.syncedAt === "string" ? snap.syncedAt : "";
        const syncedAtLabel = syncedAt
          ? (() => {
              try {
                return new Date(syncedAt).toLocaleString();
              } catch {
                return syncedAt;
              }
            })()
          : "";

        const vm = {
          ratingLabel: fmtInt(snap.rating),
          rankLabel:
            typeof snap.rank === "number" && typeof snap.rankTotal === "number"
              ? `${fmtInt(snap.rank)} / ${fmtInt(snap.rankTotal)}`
              : fmtInt(snap.rank),
          winsLabel: fmtInt(wins),
          lossesLabel: fmtInt(losses),
          winRateLabel: fmtPct(winRate),
          streakLabel: fmtInt(snap.streak),
          syncedAtLabel,
        };

        setStatsState({ status: "ok", data: vm });
      } catch (e: any) {
        if (cancelled) return;
        setStatsState({ status: "error", message: e?.message ? String(e.message) : "Failed to load stats" });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [statsOpen, aoeProfileId]);

  return (
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

              {/* Rating removed (aoe2insights dependency) */}
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
                      <div style={{ opacity: 0.9, lineHeight: 1.4 }}>Loading…</div>
                    )}

                    {statsState.status === "empty" && (
                      <div style={{ opacity: 0.9, lineHeight: 1.4 }}>No stats synced yet.</div>
                    )}

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
  );
}
