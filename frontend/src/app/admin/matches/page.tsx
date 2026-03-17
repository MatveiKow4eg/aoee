"use client";

import React, { useEffect, useMemo, useState } from "react";
import { adminCancelMatchEvent, adminCreateMatchEvent, adminListMatchEvents, adminResolveMatchEvent, type CreateMatchEventParticipantInput, type MatchEventFormat, type MatchEventSide, type MatchEventStatus } from "../../../lib/api/matchEvents";

const formatToSlots = (format: MatchEventFormat): number => {
  switch (format) {
    case "ONE_V_ONE":
      return 1;
    case "TWO_V_TWO":
      return 2;
    case "THREE_V_THREE":
      return 3;
    case "FOUR_V_FOUR":
      return 4;
    default:
      return 1;
  }
};

const fmtSigned = (v: unknown) => {
  if (v == null) return "—";
  if (typeof v !== "number" || !Number.isFinite(v)) return "—";
  if (v > 0) return `+${v}`;
  if (v < 0) return `${v}`;
  return "0";
};

export default function AdminMatchesPage() {
  const [statusFilter, setStatusFilter] = useState<MatchEventStatus | "ALL">("ALL");
  const [state, setState] = useState<{ status: "idle" | "loading" | "ok" | "error"; items: any[]; message?: string }>({ status: "idle", items: [] });

  const [createOpen, setCreateOpen] = useState(false);
  const [createFormat, setCreateFormat] = useState<MatchEventFormat>("ONE_V_ONE");
  const [createNotes, setCreateNotes] = useState<string>("");

  const slots = useMemo(() => formatToSlots(createFormat), [createFormat]);

  const emptyParticipant = (side: MatchEventSide, slot: number): CreateMatchEventParticipantInput => ({
    side,
    slot,
    playerKey: "",
    displayNameSnapshot: "",
    avatarUrlSnapshot: null,
    userId: null,
    aoeProfileId: null,
  });

  const [teamA, setTeamA] = useState<CreateMatchEventParticipantInput[]>([emptyParticipant("A", 1)]);
  const [teamB, setTeamB] = useState<CreateMatchEventParticipantInput[]>([emptyParticipant("B", 1)]);

  useEffect(() => {
    setTeamA(Array.from({ length: slots }, (_, i) => emptyParticipant("A", i + 1)));
    setTeamB(Array.from({ length: slots }, (_, i) => emptyParticipant("B", i + 1)));
  }, [slots]);

  const load = async () => {
    setState((s) => ({ ...s, status: "loading" }));
    try {
      const r = await adminListMatchEvents({ status: statusFilter === "ALL" ? undefined : statusFilter, limit: 100 });
      const items = Array.isArray((r as any)?.events) ? (r as any).events : [];
      setState({ status: "ok", items });
    } catch (e: any) {
      setState({ status: "error", items: [], message: e?.message ? String(e.message) : "Failed to load" });
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter]);

  const onCreate = async () => {
    const participants = [...teamA, ...teamB].map((p) => ({
      ...p,
      playerKey: (p.playerKey || "").trim(),
      displayNameSnapshot: (p.displayNameSnapshot || "").trim(),
    }));

    await adminCreateMatchEvent({
      format: createFormat,
      notes: createNotes.trim() || null,
      participants,
    });

    setCreateOpen(false);
    setCreateNotes("");
    await load();
  };

  const cardStyle: React.CSSProperties = {
    border: "1px solid rgba(255,255,255,0.12)",
    borderRadius: 12,
    padding: 12,
    background: "rgba(255,255,255,0.04)",
    color: "#f7f0df",
  };

  return (
    <div style={{ padding: 16, color: "#f7f0df" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 12 }}>
        <div style={{ fontWeight: 900, fontSize: 18 }}>Match events</div>
        <button
          onClick={() => setCreateOpen(true)}
          style={{ padding: "8px 10px", borderRadius: 10, border: "1px solid #caa24d", background: "#caa24d", color: "#1b1b1b", fontWeight: 900, cursor: "pointer" }}
        >
          Create match
        </button>
      </div>

      <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 12, flexWrap: "wrap" }}>
        <div style={{ opacity: 0.8, fontWeight: 800 }}>Status:</div>
        {(["ALL", "OPEN", "COMPLETED", "CANCELLED"] as const).map((s) => (
          <button
            key={s}
            onClick={() => setStatusFilter(s as any)}
            style={{
              padding: "6px 10px",
              borderRadius: 999,
              border: "1px solid rgba(202,162,77,0.55)",
              background: statusFilter === s ? "rgba(202,162,77,0.22)" : "rgba(255,255,255,0.04)",
              color: "#f7f0df",
              fontWeight: 900,
              cursor: "pointer",
            }}
          >
            {s}
          </button>
        ))}

        <button
          onClick={() => load()}
          style={{ padding: "6px 10px", borderRadius: 10, border: "1px solid rgba(255,255,255,0.18)", background: "rgba(255,255,255,0.06)", color: "#f7f0df", fontWeight: 900, cursor: "pointer" }}
        >
          Refresh
        </button>
      </div>

      {state.status === "loading" ? <div style={{ opacity: 0.85 }}>Loading…</div> : null}
      {state.status === "error" ? <div style={{ opacity: 0.9, color: "#ffb4b4" }}>{state.message}</div> : null}

      {state.status === "ok" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {state.items.length === 0 ? <div style={{ opacity: 0.8 }}>Empty</div> : null}
          {state.items.map((ev: any) => {
            const parts = Array.isArray(ev?.participants) ? ev.participants : [];
            const a = parts.filter((p: any) => p.side === "A").sort((x: any, y: any) => (x.slot ?? 0) - (y.slot ?? 0));
            const b = parts.filter((p: any) => p.side === "B").sort((x: any, y: any) => (x.slot ?? 0) - (y.slot ?? 0));

            return (
              <div key={String(ev.id)} style={cardStyle}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                  <div style={{ fontWeight: 950 }}>
                    {String(ev.format)} · <span style={{ opacity: 0.85 }}>{String(ev.status)}</span>
                    {ev.winnerSide ? <span style={{ marginLeft: 8, opacity: 0.9 }}>winner: {String(ev.winnerSide)}</span> : null}
                  </div>
                  <div style={{ opacity: 0.75, fontSize: 12 }}>{ev.createdAt ? new Date(String(ev.createdAt)).toLocaleString() : ""}</div>
                </div>

                {ev.notes ? <div style={{ marginTop: 6, opacity: 0.85 }}>{String(ev.notes)}</div> : null}

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 10 }}>
                  <div>
                    <div style={{ fontWeight: 950, marginBottom: 6 }}>Team A</div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      {a.map((p: any) => (
                        <div key={p.id} style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                          <div style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {p.displayNameSnapshot || p.playerKey}
                            <span style={{ opacity: 0.6, marginLeft: 8 }}>({p.playerKey})</span>
                          </div>
                          <div style={{ fontWeight: 950, opacity: 0.9 }}>{p.ratingDelta != null ? fmtSigned(p.ratingDelta) : ""}</div>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div>
                    <div style={{ fontWeight: 950, marginBottom: 6 }}>Team B</div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      {b.map((p: any) => (
                        <div key={p.id} style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                          <div style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {p.displayNameSnapshot || p.playerKey}
                            <span style={{ opacity: 0.6, marginLeft: 8 }}>({p.playerKey})</span>
                          </div>
                          <div style={{ fontWeight: 950, opacity: 0.9 }}>{p.ratingDelta != null ? fmtSigned(p.ratingDelta) : ""}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                <div style={{ display: "flex", gap: 10, marginTop: 12, flexWrap: "wrap" }}>
                  <button
                    disabled={String(ev.status) !== "OPEN"}
                    onClick={async () => {
                      await adminResolveMatchEvent(String(ev.id), { winnerSide: "A" });
                      await load();
                    }}
                    style={{ padding: "8px 10px", borderRadius: 10, border: "1px solid rgba(43,187,115,0.7)", background: "rgba(43,187,115,0.12)", color: "#f7f0df", fontWeight: 900, cursor: "pointer", opacity: String(ev.status) !== "OPEN" ? 0.5 : 1 }}
                  >
                    Team A won
                  </button>

                  <button
                    disabled={String(ev.status) !== "OPEN"}
                    onClick={async () => {
                      await adminResolveMatchEvent(String(ev.id), { winnerSide: "B" });
                      await load();
                    }}
                    style={{ padding: "8px 10px", borderRadius: 10, border: "1px solid rgba(43,187,115,0.7)", background: "rgba(43,187,115,0.12)", color: "#f7f0df", fontWeight: 900, cursor: "pointer", opacity: String(ev.status) !== "OPEN" ? 0.5 : 1 }}
                  >
                    Team B won
                  </button>

                  <button
                    disabled={String(ev.status) !== "OPEN"}
                    onClick={async () => {
                      if (!confirm("Cancel this match?") ) return;
                      await adminCancelMatchEvent(String(ev.id), {});
                      await load();
                    }}
                    style={{ padding: "8px 10px", borderRadius: 10, border: "1px solid rgba(232,76,61,0.7)", background: "rgba(232,76,61,0.10)", color: "#f7f0df", fontWeight: 900, cursor: "pointer", opacity: String(ev.status) !== "OPEN" ? 0.5 : 1 }}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {createOpen ? (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.55)",
            zIndex: 100000,
            display: "grid",
            placeItems: "center",
            padding: 16,
          }}
          onMouseDown={() => setCreateOpen(false)}
        >
          <div
            onMouseDown={(e) => e.stopPropagation()}
            style={{
              width: "min(820px, 100%)",
              borderRadius: 12,
              border: "1px solid rgba(202,162,77,0.65)",
              background: "rgba(20, 14, 10, 0.97)",
              boxShadow: "0 18px 44px rgba(0,0,0,0.70)",
              padding: 14,
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12, marginBottom: 10 }}>
              <div style={{ fontWeight: 950 }}>Create match</div>
              <button
                onClick={() => setCreateOpen(false)}
                style={{ background: "transparent", border: 0, color: "rgba(247,240,223,0.9)", cursor: "pointer", fontSize: 18, lineHeight: 1 }}
              >
                ×
              </button>
            </div>

            <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center", marginBottom: 10 }}>
              <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <span style={{ opacity: 0.85, fontWeight: 900 }}>Format</span>
                <select
                  value={createFormat}
                  onChange={(e) => setCreateFormat(e.target.value as MatchEventFormat)}
                  style={{ padding: "8px 10px", borderRadius: 10, border: "1px solid rgba(255,255,255,0.18)", background: "rgba(255,255,255,0.06)", color: "#f7f0df", fontWeight: 900 }}
                >
                  <option value="ONE_V_ONE">1v1</option>
                  <option value="TWO_V_TWO">2v2</option>
                  <option value="THREE_V_THREE">3v3</option>
                  <option value="FOUR_V_FOUR">4v4</option>
                </select>
              </label>

              <label style={{ display: "flex", gap: 8, alignItems: "center", flex: 1, minWidth: 240 }}>
                <span style={{ opacity: 0.85, fontWeight: 900 }}>Notes</span>
                <input
                  value={createNotes}
                  onChange={(e) => setCreateNotes(e.target.value)}
                  placeholder="optional"
                  style={{ flex: 1, padding: "8px 10px", borderRadius: 10, border: "1px solid rgba(255,255,255,0.18)", background: "rgba(255,255,255,0.06)", color: "#f7f0df" }}
                />
              </label>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <div>
                <div style={{ fontWeight: 950, marginBottom: 8 }}>Team A</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {teamA.map((p, idx) => (
                    <div key={idx} style={{ display: "grid", gridTemplateColumns: "70px 1fr 1fr", gap: 8 }}>
                      <div style={{ opacity: 0.8, fontWeight: 900, alignSelf: "center" }}>Slot {p.slot}</div>
                      <input
                        value={p.playerKey}
                        onChange={(e) => {
                          const v = e.target.value;
                          setTeamA((prev) => prev.map((x, i) => (i === idx ? { ...x, playerKey: v } : x)));
                        }}
                        placeholder="playerKey (u001)"
                        style={{ padding: "8px 10px", borderRadius: 10, border: "1px solid rgba(255,255,255,0.18)", background: "rgba(255,255,255,0.06)", color: "#f7f0df" }}
                      />
                      <input
                        value={p.displayNameSnapshot}
                        onChange={(e) => {
                          const v = e.target.value;
                          setTeamA((prev) => prev.map((x, i) => (i === idx ? { ...x, displayNameSnapshot: v } : x)));
                        }}
                        placeholder="display name"
                        style={{ padding: "8px 10px", borderRadius: 10, border: "1px solid rgba(255,255,255,0.18)", background: "rgba(255,255,255,0.06)", color: "#f7f0df" }}
                      />
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <div style={{ fontWeight: 950, marginBottom: 8 }}>Team B</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {teamB.map((p, idx) => (
                    <div key={idx} style={{ display: "grid", gridTemplateColumns: "70px 1fr 1fr", gap: 8 }}>
                      <div style={{ opacity: 0.8, fontWeight: 900, alignSelf: "center" }}>Slot {p.slot}</div>
                      <input
                        value={p.playerKey}
                        onChange={(e) => {
                          const v = e.target.value;
                          setTeamB((prev) => prev.map((x, i) => (i === idx ? { ...x, playerKey: v } : x)));
                        }}
                        placeholder="playerKey (u005)"
                        style={{ padding: "8px 10px", borderRadius: 10, border: "1px solid rgba(255,255,255,0.18)", background: "rgba(255,255,255,0.06)", color: "#f7f0df" }}
                      />
                      <input
                        value={p.displayNameSnapshot}
                        onChange={(e) => {
                          const v = e.target.value;
                          setTeamB((prev) => prev.map((x, i) => (i === idx ? { ...x, displayNameSnapshot: v } : x)));
                        }}
                        placeholder="display name"
                        style={{ padding: "8px 10px", borderRadius: 10, border: "1px solid rgba(255,255,255,0.18)", background: "rgba(255,255,255,0.06)", color: "#f7f0df" }}
                      />
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 14 }}>
              <button
                onClick={() => setCreateOpen(false)}
                style={{ padding: "8px 10px", borderRadius: 10, border: "1px solid rgba(255,255,255,0.18)", background: "rgba(255,255,255,0.06)", color: "#f7f0df", fontWeight: 900, cursor: "pointer" }}
              >
                Close
              </button>
              <button
                onClick={async () => {
                  try {
                    await onCreate();
                  } catch (e: any) {
                    alert(e?.message ? String(e.message) : "Failed to create");
                  }
                }}
                style={{ padding: "8px 10px", borderRadius: 10, border: "1px solid #caa24d", background: "#caa24d", color: "#1b1b1b", fontWeight: 900, cursor: "pointer" }}
              >
                Create
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
