"use client";

import { useEffect, useMemo, useState } from "react";
import { adminCancelChallenge, adminDeleteChallenges, adminListChallenges, adminResolveChallenge } from "../../../lib/api/challenges";

type Tab = "ACTIVE" | "COMPLETED" | "EXPIRED" | "CANCELLED";

function fmt(dt?: string | null) {
  if (!dt) return "—";
  try {
    return new Date(dt).toLocaleString();
  } catch {
    return String(dt);
  }
}

export default function AdminChallengesPage() {
  const [tab, setTab] = useState<Tab>("ACTIVE");
  const [state, setState] = useState<{ status: "loading" } | { status: "ok"; items: any[] } | { status: "error"; message: string }>({ status: "loading" });
  const [busyId, setBusyId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Record<string, boolean>>({});

  const title = useMemo(() => {
    if (tab === "ACTIVE") return "Вызовы: Active";
    if (tab === "COMPLETED") return "Вызовы: Completed";
    if (tab === "EXPIRED") return "Вызовы: Expired";
    return "Вызовы";
  }, [tab]);

  const load = async (t: Tab) => {
    setState({ status: "loading" });
    try {
      const r = await adminListChallenges(t);
      setState({ status: "ok", items: (r as any)?.challenges ?? [] });
      setSelectedIds({});
    } catch (e: any) {
      setState({ status: "error", message: e?.message ? String(e.message) : "Failed to load" });
    }
  };

  useEffect(() => {
    void load(tab);
  }, [tab]);

  return (
    <div style={{ minHeight: "100dvh" }}>
      <div className="aoe-panel" style={{ width: "min(1100px, calc(100vw - 24px))", margin: "14px auto", borderRadius: 16, overflow: "hidden" }}>
        <div className="aoe-bar">
          <div className="aoe-title" style={{ fontSize: 18 }}>{title}</div>
          <div className="aoe-spacer" />
          <button
            onClick={async () => {
              const ids = Object.entries(selectedIds)
                .filter(([, v]) => !!v)
                .map(([id]) => id);

              if (ids.length === 0) {
                alert("Select at least one challenge");
                return;
              }

              if (!confirm(`Delete selected challenges (${ids.length})? This cannot be undone.`)) return;

              try {
                const r = await adminDeleteChallenges(ids);
                alert(
                  `Deleted challenges: ${r.challengesDeleted}\nDeleted user rating events: ${r.userRatingEventsDeleted}\nDeleted player rating events: ${r.playerRatingEventsDeleted}`
                );
                await load(tab);
              } catch (e: any) {
                alert(e?.message ? String(e.message) : "Failed to delete challenges");
              }
            }}
            className="aoe-btn"
            style={{
              background: "linear-gradient(180deg, rgba(244, 63, 94, 1) 0%, rgba(190, 18, 60, 1) 100%)",
              color: "#fff1f2",
            }}
            title="Delete selected challenges"
          >
            Delete selected
          </button>
          <button onClick={() => load(tab)} className="aoe-btn">Refresh</button>
        </div>

        <div style={{ padding: 12, display: "flex", gap: 8, flexWrap: "wrap" }}>
          {(["ACTIVE", "COMPLETED", "EXPIRED", "CANCELLED"] as Tab[]).map((t) => (
            <button key={t} onClick={() => setTab(t)} className={`aoe-btn ${tab === t ? "aoe-btn--active" : ""}`}>
              {t}
            </button>
          ))}
        </div>

        <div style={{ padding: 12, paddingTop: 0 }}>
          {state.status === "loading" && <div style={{ opacity: 0.85 }}>Loading…</div>}
          {state.status === "error" && <div style={{ color: "#b42318", fontWeight: 800 }}>{state.message}</div>}

          {state.status === "ok" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {state.items.length === 0 ? (
                <div style={{ opacity: 0.7, fontWeight: 700 }}>(пусто)</div>
              ) : (
                state.items.map((ch) => {
                  const isActive = String(ch.status) === "ACTIVE";
                  const busy = busyId === ch.id;
                  const challenger = ch?.challengerUser?.displayName || ch.challengerUserId;
                  const target = ch?.targetUser?.displayName || ch.targetUserId;

                  return (
                    <div
                      key={ch.id}
                      style={{
                        padding: 12,
                        borderRadius: 14,
                        border: "1px solid rgba(0,0,0,0.25)",
                        background: "rgba(255,255,255,0.28)",
                        boxShadow: "0 10px 24px rgba(0,0,0,0.25)",
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
                        <input
                          type="checkbox"
                          checked={!!selectedIds[ch.id]}
                          onChange={() => setSelectedIds((prev) => ({ ...prev, [ch.id]: !prev[ch.id] }))}
                        />
                        <div style={{ fontSize: 12, opacity: 0.75, fontWeight: 800 }}>select</div>
                      </div>
                      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                          <div style={{ fontWeight: 900 }}>
                            {challenger} <span style={{ opacity: 0.7 }}>→</span> {target}
                          </div>
                          <div style={{ opacity: 0.85, fontSize: 12, fontWeight: 700 }}>
                            created: {fmt(ch.createdAt)} · expires: {fmt(ch.expiresAt)} · status:{" "}
                            <span style={{ fontWeight: 900 }}>{String(ch.status)}</span>
                          </div>
                          {ch.result ? (
                            <div style={{ opacity: 0.85, fontSize: 12, fontWeight: 700 }}>
                              result: <span style={{ fontWeight: 900 }}>{String(ch.result)}</span> · resolved: {fmt(ch.resolvedAt)}
                            </div>
                          ) : null}
                        </div>

                        {isActive && (
                          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                            <button
                              disabled={busy}
                              onClick={async () => {
                                setBusyId(ch.id);
                                try {
                                  await adminResolveChallenge(ch.id, "CHALLENGER_WON");
                                  await load(tab);
                                } finally {
                                  setBusyId(null);
                                }
                              }}
                              className={`aoe-btn ${busy ? "" : "aoe-btn--active"}`}
                              style={{ opacity: busy ? 0.65 : 1, cursor: busy ? "not-allowed" : "pointer" }}
                            >
                              Challenger won
                            </button>

                            <button
                              disabled={busy}
                              onClick={async () => {
                                setBusyId(ch.id);
                                try {
                                  await adminResolveChallenge(ch.id, "CHALLENGER_LOST");
                                  await load(tab);
                                } finally {
                                  setBusyId(null);
                                }
                              }}
                              className="aoe-btn"
                              style={{
                                opacity: busy ? 0.65 : 1,
                                cursor: busy ? "not-allowed" : "pointer",
                                background: "linear-gradient(180deg, rgba(76, 105, 168, 1) 0%, rgba(46, 74, 136, 1) 100%)",
                                color: "#eef2ff",
                              }}
                            >
                              Challenger lost
                            </button>

                            <button
                              disabled={busy}
                              onClick={async () => {
                                if (!confirm("Cancel this challenge?")) return;
                                setBusyId(ch.id);
                                try {
                                  await adminCancelChallenge(ch.id);
                                  await load(tab);
                                } finally {
                                  setBusyId(null);
                                }
                              }}
                              className="aoe-btn"
                              style={{
                                opacity: busy ? 0.65 : 1,
                                cursor: busy ? "not-allowed" : "pointer",
                                background: "linear-gradient(180deg, rgba(244, 63, 94, 1) 0%, rgba(190, 18, 60, 1) 100%)",
                                color: "#fff1f2",
                              }}
                            >
                              Cancel
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
