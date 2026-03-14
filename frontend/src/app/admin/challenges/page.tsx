"use client";

import { useEffect, useMemo, useState } from "react";
import { adminCancelChallenge, adminListChallenges, adminResolveChallenge } from "../../../lib/api/challenges";

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
      setState({ status: "ok"; items: (r as any)?.challenges ?? [] } as any);
    } catch (e: any) {
      setState({ status: "error", message: e?.message ? String(e.message) : "Failed to load" });
    }
  };

  useEffect(() => {
    void load(tab);
  }, [tab]);

  return (
    <div style={{ padding: 16, color: "#f7f0df", background: "#0b1220", minHeight: "100dvh" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 14 }}>
        <div style={{ fontWeight: 900, fontSize: 20 }}>{title}</div>
        <button
          onClick={() => load(tab)}
          style={{ padding: "8px 12px", borderRadius: 10, border: "1px solid #caa24d", background: "#caa24d", color: "#1b1b1b", fontWeight: 900, cursor: "pointer" }}
        >
          Refresh
        </button>
      </div>

      <div style={{ display: "flex", gap: 8, marginBottom: 14, flexWrap: "wrap" }}>
        {(["ACTIVE", "COMPLETED", "EXPIRED", "CANCELLED"] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            style={{
              padding: "8px 12px",
              borderRadius: 12,
              border: "1px solid rgba(255,255,255,0.18)",
              background: tab === t ? "rgba(202,162,77,0.20)" : "rgba(255,255,255,0.06)",
              color: "#f7f0df",
              fontWeight: 900,
              cursor: "pointer",
            }}
          >
            {t}
          </button>
        ))}
      </div>

      {state.status === "loading" && <div style={{ opacity: 0.85 }}>Loading…</div>}
      {state.status === "error" && <div style={{ color: "#ffb4b4" }}>{state.message}</div>}

      {state.status === "ok" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {state.items.length === 0 ? (
            <div style={{ opacity: 0.8 }}>(пусто)</div>
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
                    border: "1px solid rgba(202,162,77,0.35)",
                    background: "rgba(255,255,255,0.04)",
                    boxShadow: "0 12px 30px rgba(0,0,0,0.35)",
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                      <div style={{ fontWeight: 900 }}>{challenger} → {target}</div>
                      <div style={{ opacity: 0.85, fontSize: 12 }}>
                        created: {fmt(ch.createdAt)} | expires: {fmt(ch.expiresAt)} | status: <span style={{ fontWeight: 900 }}>{String(ch.status)}</span>
                      </div>
                      {ch.result ? (
                        <div style={{ opacity: 0.85, fontSize: 12 }}>
                          result: <span style={{ fontWeight: 900 }}>{String(ch.result)}</span> | resolved: {fmt(ch.resolvedAt)}
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
                          style={{ padding: "8px 10px", borderRadius: 10, border: "1px solid #caa24d", background: "#caa24d", color: "#1b1b1b", fontWeight: 900, cursor: busy ? "not-allowed" : "pointer", opacity: busy ? 0.7 : 1 }}
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
                          style={{ padding: "8px 10px", borderRadius: 10, border: "1px solid rgba(255,255,255,0.22)", background: "rgba(255,255,255,0.06)", color: "#f7f0df", fontWeight: 900, cursor: busy ? "not-allowed" : "pointer", opacity: busy ? 0.7 : 1 }}
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
                          style={{ padding: "8px 10px", borderRadius: 10, border: "1px solid rgba(255,80,80,0.5)", background: "rgba(255,80,80,0.12)", color: "#ffb4b4", fontWeight: 900, cursor: busy ? "not-allowed" : "pointer", opacity: busy ? 0.7 : 1 }}
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
  );
}
