"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { me } from "../../lib/api/auth";
import { claimAoePlayer, listClaimablePlayersFromMap, type AoePlayer } from "../../lib/api/aoePlayers";

export default function ClaimPlayerPage() {
  const router = useRouter();

  const [authChecked, setAuthChecked] = useState(false);
  const [isAuthed, setIsAuthed] = useState(false);
  const [claimed, setClaimed] = useState<AoePlayer | null>(null);

  const [mapPlayers, setMapPlayers] = useState<Array<{ name: string; insightsUserId: string }>>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isConfirmOpen, setIsConfirmOpen] = useState(false);
  const [pendingPick, setPendingPick] = useState<{ name: string; insightsUserId: string } | null>(null);
  const [isClaiming, setIsClaiming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await me();
        if (cancelled) return;
        const ok = !!r?.user;
        setIsAuthed(ok);
        setAuthChecked(true);

        const aoePlayer = (r as any)?.user?.aoePlayer as AoePlayer | null | undefined;
        if (aoePlayer) {
          setClaimed(aoePlayer);
        }

        if (!ok) {
          router.replace(`/login?next=${encodeURIComponent("/claim-player")}`);
        }
      } catch {
        if (cancelled) return;
        setIsAuthed(false);
        setAuthChecked(true);
        router.replace(`/login?next=${encodeURIComponent("/claim-player")}`);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [router]);

  async function load() {
    setError(null);
    setIsLoading(true);

    try {
      const { items } = await listClaimablePlayersFromMap();
      setMapPlayers(items);
    } catch (e: any) {
      setError(e?.message ? String(e.message) : "Failed to load players");
      setMapPlayers([]);
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    if (!authChecked || !isAuthed) return;
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authChecked, isAuthed]);

  if (!authChecked) {
    return (
      <div style={{ minHeight: "100dvh", display: "flex", alignItems: "center", justifyContent: "center", background: "#0b1220", color: "#f7f0df" }}>
        <div style={{ opacity: 0.85, fontWeight: 800 }}>Checking session…</div>
      </div>
    );
  }

  if (!isAuthed) {
    return <div style={{ minHeight: "100dvh", background: "#0b1220" }} />;
  }

  if (claimed) {
    return (
      <div style={{ minHeight: "100dvh", padding: 16, background: "#0b1220", color: "#f7f0df" }}>
        <div style={{ maxWidth: 720, margin: "0 auto", border: "1px solid #3a2a1a", borderRadius: 12, padding: 16, background: "rgba(0,0,0,0.25)" }}>
          <div style={{ fontWeight: 900, fontSize: 18, marginBottom: 10 }}>Player already claimed</div>
          <div style={{ opacity: 0.9, lineHeight: 1.4 }}>
            You are linked to: <b>{claimed.nickname}</b>
          </div>
          <div style={{ marginTop: 14, display: "flex", gap: 12, flexWrap: "wrap" }}>
            <Link href="/" style={{ color: "#caa24d", fontWeight: 900, textDecoration: "none" }}>Go to map</Link>
            <Link href="/admin" style={{ color: "#caa24d", fontWeight: 900, textDecoration: "none" }}>Go to admin</Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: "100dvh", padding: 16, background: "#0b1220", color: "#f7f0df" }}>
      <div style={{ maxWidth: 980, margin: "0 auto" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <div style={{ fontWeight: 900, fontSize: 18 }}>Claim your player</div>
          <div style={{ flex: 1 }} />
          <Link href="/" style={{ color: "#caa24d", fontWeight: 900, textDecoration: "none" }}>Back to map</Link>
        </div>

        <div style={{ marginTop: 12, opacity: 0.85, fontSize: 12 }}>
          Players shown here come from the current map payload and exclude players already claimed by someone else.
        </div>

        {error && (
          <div style={{ marginTop: 12, padding: 10, borderRadius: 10, background: "rgba(122,42,42,0.25)", border: "1px solid #7a2a2a" }}>
            {error}
          </div>
        )}

        <div style={{ marginTop: 14, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ opacity: 0.75, fontSize: 12 }}>
            {isLoading ? "Loading…" : mapPlayers.length ? `Loaded: ${mapPlayers.length}` : ""}
          </div>
          <button
            onClick={() => load()}
            disabled={isLoading}
            style={{ padding: "10px 14px", borderRadius: 10, border: "1px solid rgba(247,240,223,0.25)", background: "rgba(202,162,77,0.18)", color: "#f7f0df", fontWeight: 900, cursor: "pointer" }}
            title="Reload"
          >
            Reload
          </button>
        </div>

        <div style={{ marginTop: 18, opacity: 0.9, fontWeight: 900 }}>Players (legacy insightsUserId, transitional)</div>
        <div style={{ marginTop: 10, border: "1px solid #3a2a1a", borderRadius: 12, overflow: "hidden" }}>
          {mapPlayers.length === 0 ? (
            <div style={{ padding: 14, opacity: 0.85 }}>(no players with insightsUserId found in current map payload)</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column" }}>
              {mapPlayers.map((p) => (
                <div key={p.insightsUserId} style={{ display: "flex", gap: 12, alignItems: "center", padding: 12, borderTop: "1px solid rgba(255,255,255,0.08)" }}>
                  <div style={{ minWidth: 0, flex: 1, fontWeight: 900, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={p.name}>
                    {p.name}
                  </div>
                  <button
                    onClick={() => {
                      setPendingPick(p);
                      setIsConfirmOpen(true);
                    }}
                    style={{
                      padding: "10px 14px",
                      borderRadius: 10,
                      border: "1px solid #caa24d",
                      background: "#2b1a12",
                      color: "#f7f0df",
                      fontWeight: 900,
                      cursor: "pointer",
                    }}
                  >
                    Choose
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {isConfirmOpen && pendingPick && (
          <div
            onPointerDown={() => {
              setIsConfirmOpen(false);
              setPendingPick(null);
            }}
            style={{
              position: "fixed",
              inset: 0,
              background: "rgba(0,0,0,0.45)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              zIndex: 9999,
              padding: 16,
            }}
          >
            <div
              onPointerDown={(e) => e.stopPropagation()}
              style={{
                width: "min(560px, calc(100vw - 32px))",
                border: "1px solid #3a2a1a",
                borderRadius: 12,
                padding: 16,
                background: "#0b1220",
                color: "#f7f0df",
                boxShadow: "0 12px 48px rgba(0,0,0,0.45)",
              }}
            >
              <div style={{ fontWeight: 900, fontSize: 18 }}>Confirm</div>
              <div style={{ marginTop: 10, opacity: 0.9, lineHeight: 1.4 }}>
                Are you sure you want to register/claim as <b>{pendingPick.name}</b>?
              </div>
              <div style={{ marginTop: 14, display: "flex", gap: 10, justifyContent: "flex-end", flexWrap: "wrap" }}>
                <button
                  onClick={() => {
                    setIsConfirmOpen(false);
                    setPendingPick(null);
                  }}
                  style={{
                    padding: "10px 14px",
                    borderRadius: 10,
                    border: "1px solid rgba(247,240,223,0.25)",
                    background: "rgba(255,255,255,0.06)",
                    color: "#f7f0df",
                    fontWeight: 900,
                    cursor: "pointer",
                  }}
                >
                  Cancel
                </button>
                <button
                  onClick={async () => {
                    if (!pendingPick) return;
                    setError(null);
                    setIsClaiming(true);
                    try {
                      const r = await claimAoePlayer({
                        aoeProfileId: pendingPick.insightsUserId,
                        nickname: pendingPick.name,
                      });
                      setClaimed(r.player);
                      setIsConfirmOpen(false);
                      setPendingPick(null);
                      router.replace("/");
                    } catch (e: any) {
                      setError(e?.message ? String(e.message) : "Claim failed");
                    } finally {
                      setIsClaiming(false);
                    }
                  }}
                  disabled={isClaiming}
                  style={{
                    padding: "10px 14px",
                    borderRadius: 10,
                    border: "1px solid #caa24d",
                    background: "#2b1a12",
                    color: "#f7f0df",
                    fontWeight: 900,
                    cursor: "pointer",
                    opacity: isClaiming ? 0.7 : 1,
                  }}
                >
                  {isClaiming ? "Claiming…" : "Yes"}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
