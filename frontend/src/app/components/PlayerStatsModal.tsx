"use client";

import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";

type Props = {
  open: boolean;
  aoeProfileId?: string | null;
  title?: string;
  onClose: () => void;
};

export default function PlayerStatsModal({ open, aoeProfileId, title, onClose }: Props) {
  const [state, setState] = useState<
    | { status: "idle" }
    | { status: "loading" }
    | { status: "refreshing" }
    | { status: "ok"; data: any }
    | { status: "empty" }
    | { status: "error"; message: string }
  >({ status: "idle" });

  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const buildVm = (snap: any) => {
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

  const load = async (id: string) => {
    const { getAoePlayerStats, refreshAoePlayerStats } = await import("../../lib/api/aoePlayerStats");

    const r = await getAoePlayerStats(id);
    const snap = (r as any)?.snapshot ?? null;
    if (snap) {
      setState({ status: "ok", data: buildVm(snap) });
      return;
    }

    // Lazy auto-refresh ONLY when snapshot is null.
    setState({ status: "refreshing" });
    setIsRefreshing(true);

    const rr = await refreshAoePlayerStats(id);
    const refreshedSnap = (rr as any)?.snapshot ?? null;

    if (refreshedSnap) {
      setState({ status: "ok", data: buildVm(refreshedSnap) });
    } else {
      setState({ status: "empty" });
      if (!(rr as any)?.refreshed) {
        setRefreshError((rr as any)?.reason ? `Refresh skipped: ${(rr as any).reason}` : "Refresh skipped");
      }
    }
  };

  const onManualRefresh = async () => {
    const id = (aoeProfileId ?? "").toString().trim();
    if (!id || isRefreshing) return;

    setState({ status: "refreshing" });
    setIsRefreshing(true);
    setRefreshError(null);

    try {
      const { refreshAoePlayerStats } = await import("../../lib/api/aoePlayerStats");
      const rr = await refreshAoePlayerStats(id);
      const snap = (rr as any)?.snapshot ?? null;

      if (snap) {
        setState({ status: "ok", data: buildVm(snap) });
      } else {
        setState({ status: "empty" });
        setRefreshError((rr as any)?.reason ? `Refresh skipped: ${(rr as any).reason}` : "No stats available yet.");
      }
    } catch (e: any) {
      setRefreshError(e?.message ? String(e.message) : "Failed to refresh stats");
      setState((prev) => (prev.status === "ok" ? prev : { status: "empty" }));
    } finally {
      setIsRefreshing(false);
    }
  };

  useEffect(() => {
    if (!open) return;

    const id = (aoeProfileId ?? "").toString().trim();
    if (!id) {
      setState({ status: "idle" });
      setRefreshError(null);
      setIsRefreshing(false);
      return;
    }

    let cancelled = false;
    setState({ status: "loading" });
    setRefreshError(null);
    setIsRefreshing(false);

    load(id).catch((e: any) => {
      if (cancelled) return;
      setState({ status: "error", message: e?.message ? String(e.message) : "Failed to load stats" });
    });

    return () => {
      cancelled = true;
    };
  }, [open, aoeProfileId]);

  if (!open) return null;
  if (typeof document === "undefined") return null;

  return createPortal(
    <>
      <div
        onPointerDown={(e) => {
          e.stopPropagation();
          onClose();
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
          <div style={{ fontWeight: 900, fontSize: 12, letterSpacing: 0.6, textTransform: "uppercase", opacity: 0.92 }}>
            {title || "Statistics"}
          </div>
          <button
            type="button"
            onClick={onClose}
            style={{ background: "transparent", border: 0, color: "rgba(247,240,223,0.9)", cursor: "pointer", fontSize: 16, lineHeight: 1 }}
            aria-label="Close"
            title="Close"
          >
            ×
          </button>
        </div>

        {state.status === "idle" && <div style={{ opacity: 0.9, lineHeight: 1.4 }}>No player selected.</div>}
        {state.status === "loading" && <div style={{ opacity: 0.9, lineHeight: 1.4 }}>Loading stats…</div>}
        {state.status === "refreshing" && <div style={{ opacity: 0.9, lineHeight: 1.4 }}>Refreshing stats…</div>}
        {state.status === "empty" && <div style={{ opacity: 0.9, lineHeight: 1.4 }}>No stats available yet.</div>}

        {refreshError ? (
          <div style={{ marginTop: 8, opacity: 0.75, fontSize: 12, lineHeight: 1.35, wordBreak: "break-word" }}>{refreshError}</div>
        ) : null}

        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 12 }}>
          <button
            type="button"
            onClick={onManualRefresh}
            disabled={state.status === "idle" || isRefreshing}
            style={{
              padding: "8px 10px",
              borderRadius: 10,
              border: "1px solid rgba(202,162,77,0.9)",
              background: isRefreshing ? "rgba(202,162,77,0.10)" : "rgba(202,162,77,0.18)",
              color: "#f7f0df",
              fontWeight: 900,
              cursor: state.status === "idle" || isRefreshing ? "not-allowed" : "pointer",
              opacity: state.status === "idle" ? 0.5 : 1,
            }}
            title="Refresh stats"
          >
            Refresh stats
          </button>
        </div>

        {state.status === "error" && (
          <div style={{ opacity: 0.9, lineHeight: 1.4, marginTop: 10 }}>
            Failed to refresh stats.
            <div style={{ marginTop: 6, opacity: 0.7, fontSize: 12, wordBreak: "break-word" }}>{state.message}</div>
          </div>
        )}

        {state.status === "ok" && (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, fontSize: 13, marginTop: 10 }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
              <span style={{ opacity: 0.8 }}>Rating</span>
              <span style={{ fontWeight: 900 }}>{state.data.ratingLabel}</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
              <span style={{ opacity: 0.8 }}>Rank</span>
              <span style={{ fontWeight: 900 }}>{state.data.rankLabel}</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
              <span style={{ opacity: 0.8 }}>Wins</span>
              <span style={{ fontWeight: 900 }}>{state.data.winsLabel}</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
              <span style={{ opacity: 0.8 }}>Losses</span>
              <span style={{ fontWeight: 900 }}>{state.data.lossesLabel}</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
              <span style={{ opacity: 0.8 }}>Winrate</span>
              <span style={{ fontWeight: 900 }}>{state.data.winRateLabel}</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
              <span style={{ opacity: 0.8 }}>Streak</span>
              <span style={{ fontWeight: 900 }}>{state.data.streakLabel}</span>
            </div>

            {state.data.syncedAtLabel ? (
              <div style={{ gridColumn: "1 / -1", marginTop: 6, opacity: 0.7, fontSize: 12 }}>Updated: {state.data.syncedAtLabel}</div>
            ) : null}
          </div>
        )}
      </div>
    </>,
    document.body
  );
}
