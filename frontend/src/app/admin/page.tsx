"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import * as PIXI from "pixi.js";
import { Viewport } from "pixi-viewport";
import { debounce, loadMapState, saveMapState } from "../../store/mapStateStore";
import { me } from "../../lib/api/auth";

// Disable createImageBitmap globally to avoid Chromium decode flakiness
try {
  (PIXI as any).settings.CREATE_IMAGE_BITMAP = false;
} catch {}

// ========== Types ==========

type TierKey =
  | "Замки"
  | "Замки v2"
  | "Замки v3"
  | "Замки v4"
  | "Крепости"
  | "Крепости v2"
  | "Крепости v3"
  | "Крепости v4"
  | "Донжоны"
  | "Донжоны v2"
  | "Донжоны v3"
  | "Донжоны v4"
  | "Халупа"
  | "Халупа v2"
  | "Халупа v3"
  | "Халупа v4"
  | "Халупа v5"
  | "Халупа v6"
  | "Башня"
  | "Башня v2"
  | "Башня v3"
  | "Башня v4";

type Rect = { x: number; y: number; w: number; h: number };

type PlayerRec = {
  name?: string;
  tier?: TierKey | "";
  title?: string;
  desc?: string;
  avatar?: string;

  /**
   * Canonical identity reference used by the map payload.
   * Must match `AoePlayer.aoeProfileId`.
   */
  aoeProfileId?: string;

  /**
   * Optional helper for backend stats sync.
   * If provided, backend can sync stats via World’s Edge profile_name = /steam/<steamId>.
   */
  steamId?: string;

  /**
   * @deprecated legacy field; may exist in old stored payloads.
   * Admin/editor must NOT produce it on save.
   */
  insightsUserId?: string;
};

const avatarByPlayerId = (playerId?: string, rec?: PlayerRec | null): string => {
  if (!playerId) return "";
  // 1) explicit override from DB
  const fromDb = (rec as any)?.avatar;
  if (typeof fromDb === "string" && fromDb.trim()) return fromDb.trim();
  // 2) convention: /public/people/{id}.png
  return `/people/${encodeURIComponent(playerId)}.png`;
};

type MapStatePayloadV1 = {
  world: { w: number; h: number; mapTextureVersion: number };
  buildings: Record<
    TierKey,
    {
      x: number;
      y: number;
      zone: Rect;
      scale?: number;
      rotation?: number;
    }
  >;
  players?: Record<string, PlayerRec>;
  meta?: {
    tierNames?: Partial<Record<TierKey, string>>;
  };
};

type FirestoreMapStateV1 = {
  world: { w: number; h: number; mapTextureVersion: number };
  buildings: Record<string, any>;
  players?: Record<string, PlayerRec>;
  meta?: { tierNames?: Partial<Record<string, string>> };
};

// ========== Constants ==========

const AUTOSAVE_MS = 800;
const ENABLE_AUTOSAVE = false;
const WORLD = { w: 3000, h: 1800, mapTextureVersion: 1 } as const;
const MAP_URL = "/map/map_aoe.webp";

const TIERS: TierKey[] = [
  "Замки",
  "Замки v2",
  "Замки v3",
  "Замки v4",
  "Крепости",
  "Крепости v2",
  "Крепости v3",
  "Крепости v4",
  "Донжоны",
  "Донжоны v2",
  "Донжоны v3",
  "Донжоны v4",
  "Халупа",
  "Халупа v2",
  "Халупа v3",
  "Халупа v4",
  "Халупа v5",
  "Халупа v6",
  "Башня",
  "Башня v2",
  "Башня v3",
  "Башня v4",
];

const DEFAULT_BUILDINGS: MapStatePayloadV1["buildings"] = {
  "Замки": { x: 2100, y: 260, zone: { x: 1950, y: 320, w: 720, h: 330 } },
  "Замки v2": { x: 2320, y: 260, zone: { x: 1950, y: 320, w: 720, h: 330 } },
  "Замки v3": { x: 2540, y: 260, zone: { x: 1950, y: 320, w: 720, h: 330 } },
  "Замки v4": { x: 2760, y: 260, zone: { x: 1950, y: 320, w: 720, h: 330 } },

  "Крепости": { x: 620, y: 360, zone: { x: 420, y: 420, w: 720, h: 330 } },
  "Крепости v2": { x: 840, y: 360, zone: { x: 420, y: 420, w: 720, h: 330 } },
  "Крепости v3": { x: 1060, y: 360, zone: { x: 420, y: 420, w: 720, h: 330 } },
  "Крепости v4": { x: 1280, y: 360, zone: { x: 420, y: 420, w: 720, h: 330 } },

  "Донжоны": { x: 2140, y: 860, zone: { x: 1950, y: 930, w: 720, h: 330 } },
  "Донжоны v2": { x: 2360, y: 860, zone: { x: 1950, y: 930, w: 720, h: 330 } },
  "Донжоны v3": { x: 2580, y: 860, zone: { x: 1950, y: 930, w: 720, h: 330 } },
  "Донжоны v4": { x: 2800, y: 860, zone: { x: 1950, y: 930, w: 720, h: 330 } },

  "Халупа": { x: 760, y: 1500, zone: { x: 420, y: 1540, w: 720, h: 260 } },
  "Халупа v2": { x: 540, y: 1500, zone: { x: 420, y: 1540, w: 720, h: 260 } },
  "Халупа v3": { x: 980, y: 1500, zone: { x: 420, y: 1540, w: 720, h: 260 } },
  "Халупа v4": { x: 1200, y: 1500, zone: { x: 420, y: 1540, w: 720, h: 260 } },
  "Халупа v5": { x: 1420, y: 1500, zone: { x: 420, y: 1540, w: 720, h: 260 } },
  "Халупа v6": { x: 1640, y: 1500, zone: { x: 420, y: 1540, w: 720, h: 260 } },

  "Башня": { x: 1760, y: 700, zone: { x: 1580, y: 760, w: 820, h: 260 } },
  "Башня v2": { x: 1980, y: 700, zone: { x: 1580, y: 760, w: 820, h: 260 } },
  "Башня v3": { x: 2200, y: 700, zone: { x: 1580, y: 760, w: 820, h: 260 } },
  "Башня v4": { x: 2420, y: 700, zone: { x: 1580, y: 760, w: 820, h: 260 } },
};

const TIER_ICON_URL: Record<TierKey, string> = {
  "Замки": "/buildings/castle/castle_v1.png",
  "Замки v2": "/buildings/castle/castle_v2.png",
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

// ========== Helpers ==========

const normalizeTier = (p?: PlayerRec | null): TierKey | "" => {
  const t = p?.tier;
  return typeof t === "string" && (TIERS as readonly string[]).includes(t) ? (t as TierKey) : "";
};

const normalizeName = (id: string, p?: PlayerRec | null): string => {
  const raw = (p?.name ?? id ?? "").toString();
  return raw.trim();
};

function canonicalizePlayersForEditor(players: Record<string, any> | null | undefined): Record<string, PlayerRec> {
  const src = (players ?? {}) as Record<string, any>;
  const next: Record<string, PlayerRec> = {};

  // Producer-side compatibility layer:
  // - read old `insightsUserId` as initial `aoeProfileId`
  // - drop `insightsUserId` from the editor state so it never gets written back
  for (const [id, p] of Object.entries(src)) {
    const aoe = typeof p?.aoeProfileId === "string" ? p.aoeProfileId.trim() : "";
    const legacy = typeof p?.insightsUserId === "string" ? p.insightsUserId.trim() : "";
    const aoeProfileId = (aoe || legacy) || undefined;

    const { insightsUserId: _drop, ...rest } = p ?? {};

    next[id] = {
      ...(rest as any),
      ...(aoeProfileId ? { aoeProfileId } : {}),
    } as PlayerRec;
  }

  return next;
}

// ========== Component ==========

export default function AdminMapPage() {
  const router = useRouter();
  const hostRef = useRef<HTMLDivElement | null>(null);
  const appRef = useRef<PIXI.Application | null>(null);
  const viewportRef = useRef<Viewport | null>(null);

  const payloadRef = useRef<MapStatePayloadV1 | null>(null);

  const [authChecked, setAuthChecked] = useState(false);
  const [isAuthed, setIsAuthed] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);

  const [metaVersion, setMetaVersion] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [debugStage, setDebugStage] = useState<string>("init");
  const [debugError, setDebugError] = useState<string | null>(null);

  // Resolve player's tier to canonical TierKey, accepting both canonical keys and custom display names from meta
  const normalizeTierKey = useCallback(
    (p?: PlayerRec | null): TierKey | "" => {
      const rawTier = (p?.tier ?? "").toString().trim();
      const rawLabel = (((p as any)?.tierLabel) ?? "").toString().trim();
      const raw = rawTier || rawLabel;
      if (!raw) return "";
      if ((TIERS as readonly string[]).includes(raw)) return raw as TierKey;

      const rawLC = raw.toLocaleLowerCase("ru");
      for (const key of TIERS) {
        if (key.toLocaleLowerCase("ru") === rawLC) return key;
      }
      const names = payloadRef.current?.meta?.tierNames ?? {};
      for (const key of TIERS) {
        const disp = (names as any)[key];
        if (typeof disp === "string" && disp.trim().toLocaleLowerCase("ru") === rawLC) return key;
      }
      return "";
    },
    [metaVersion]
  );

  const [isDirty, setIsDirty] = useState(false);
  const isDirtyRef = useRef(false);
  useEffect(() => {
    isDirtyRef.current = isDirty;
  }, [isDirty]);

  const [dragBuildings, setDragBuildings] = useState(false);
  const dragBuildingsRef = useRef(false);

  const [selectedBuilding, setSelectedBuilding] = useState<TierKey | null>(null);
  const selectedBuildingRef = useRef<TierKey | null>(null);

  const [buildingScale, setBuildingScale] = useState(1);
  const [buildingRotation, setBuildingRotation] = useState(0);

  // Admin modal for assignments
  const [isAssignModalOpen, setIsAssignModalOpen] = useState(false);
  const [tierRename, setTierRename] = useState("");
  const [stagedPlayers, setStagedPlayers] = useState<Record<string, PlayerRec> | null>(null);
  const [isSavingAssignments, setIsSavingAssignments] = useState(false);

  // Single-player card inside Assignments
  const [playerCardId, setPlayerCardId] = useState<string | null>(null);
  const [isPlayerCardOpen, setIsPlayerCardOpen] = useState(false);

  // Player form fields (re-using existing editor state)
  const [renamePlayerValue, setRenamePlayerValue] = useState("");
  const [editTitleValue, setEditTitleValue] = useState("");
  const [editDescValue, setEditDescValue] = useState("");
  const [editAoeProfileIdValue, setEditAoeProfileIdValue] = useState("");
  const [editSteamIdValue, setEditSteamIdValue] = useState("");
  const [previewTier, setPreviewTier] = useState<TierKey | null>(null);

  // Building card (show player in building)
  const [isBuildingCardOpen, setIsBuildingCardOpen] = useState(false);
  const [cardTier, setCardTier] = useState<TierKey | null>(null);

  const scheduleAutosave = useMemo(
    () =>
      debounce(() => {
        if (!ENABLE_AUTOSAVE) return;
        const pl = payloadRef.current;
        if (!pl) return;
        if (!isDirtyRef.current) return;
        void saveMapState(pl as any);
      }, AUTOSAVE_MS),
    []
  );
  useEffect(() => () => scheduleAutosave.cancel(), [scheduleAutosave]);

  useEffect(() => {
    dragBuildingsRef.current = dragBuildings;
    const viewport = viewportRef.current;
    if (viewport) {
      if (dragBuildings) viewport.plugins.pause("drag");
      else viewport.plugins.resume("drag");
    }

    if (!dragBuildings) {
      setSelectedBuilding(null);
      const spritesByTier = (appRef.current as any)?.__buildingSpritesByTier as
        | Partial<Record<TierKey, PIXI.Sprite>>
        | undefined;
      if (spritesByTier) {
        for (const t of TIERS) {
          const s = (spritesByTier as any)[t] as any;
          const apply = s?.__applyHighlight;
          if (typeof apply === "function") apply();
        }
      }
    }
  }, [dragBuildings]);

  useEffect(() => {
    selectedBuildingRef.current = selectedBuilding;

    const spritesByTier = (appRef.current as any)?.__buildingSpritesByTier as
      | Partial<Record<TierKey, PIXI.Sprite>>
      | undefined;

    if (spritesByTier) {
      for (const t of TIERS) {
        const s = (spritesByTier as any)[t] as any;
        const apply = s?.__applyHighlight;
        if (typeof apply === "function") apply();
      }
    }
  }, [selectedBuilding]);

  const center = useCallback(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    viewport.setZoom(0.7, true);
    viewport.moveCenter(viewport.worldWidth / 2, viewport.worldHeight / 2);
  }, []);

  const reset = useCallback(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;

    const ok = window.confirm(
      "Внимание! Reset перезапишет карту и очистит локальные и��менения. Игроки не удаляются, но действие необратимо. Продолжить?"
    );
    if (!ok) return;

    const payload: MapStatePayloadV1 = {
      world: { ...WORLD },
      buildings: { ...DEFAULT_BUILDINGS },
      players: (payloadRef.current?.players ?? {}) as any,
    };
    payloadRef.current = payload;
    setIsDirty(true);
    void saveMapState(payload as any);
    center();
  }, [center]);

  const save = useCallback(() => {
    const pl = payloadRef.current;
    if (!pl) return;
    const ok = window.confirm("Сохранить текущие изменения карты в БД?");
    if (!ok) return;
    void saveMapState(pl as any);
    setIsDirty(false);
  }, []);

  // Update scale live
  useEffect(() => {
    const tier = selectedBuildingRef.current;
    if (!tier) return;

    const pl = payloadRef.current;
    if (pl) {
      if (!pl.buildings[tier]) pl.buildings[tier] = { ...(DEFAULT_BUILDINGS as any)[tier] } as any;
      (pl.buildings[tier] as any).scale = buildingScale;
      setIsDirty(true);
      scheduleAutosave();
    }

    const spritesByTier = (appRef.current as any)?.__buildingSpritesByTier as
      | Partial<Record<TierKey, PIXI.Sprite>>
      | undefined;
    const sprite = spritesByTier?.[tier];
    if (sprite) {
      const baseScale = (sprite as any).__baseScale ?? 1;
      const nextScale = baseScale * buildingScale;
      sprite.scale.set(nextScale);
    }
  }, [buildingScale, scheduleAutosave]);

  // Update rotation live
  useEffect(() => {
    const tier = selectedBuildingRef.current;
    if (!tier) return;

    const pl = payloadRef.current;
    if (pl) {
      if (!pl.buildings[tier]) pl.buildings[tier] = { ...(DEFAULT_BUILDINGS as any)[tier] } as any;
      (pl.buildings[tier] as any).rotation = buildingRotation;
      setIsDirty(true);
      scheduleAutosave();
    }

    const spritesByTier = (appRef.current as any)?.__buildingSpritesByTier as
      | Partial<Record<TierKey, PIXI.Sprite>>
      | undefined;
    const sprite = spritesByTier?.[tier];
    if (sprite) sprite.rotation = buildingRotation;
  }, [buildingRotation, scheduleAutosave]);

  const openAssignModalFor = useCallback((tier: TierKey) => {
    setSelectedBuilding(tier);
    setIsAssignModalOpen(true);
    setIsPlayerCardOpen(false);
    setPlayerCardId(null);

    setRenamePlayerValue("");
    setEditTitleValue("");
    setEditDescValue("");
    setEditAoeProfileIdValue("");
    setPreviewTier(null);

    setStagedPlayers(canonicalizePlayersForEditor(payloadRef.current?.players as any));

    const cur = payloadRef.current?.meta?.tierNames?.[tier];
    setTierRename(typeof cur === "string" && cur.trim() ? cur : tier);
  }, []);

  const openGlobalAssignments = useCallback(() => {
    const fallbackTier = TIERS[0];
    if (!fallbackTier) return;
    openAssignModalFor(fallbackTier);
  }, [openAssignModalFor]);

  const closePlayerCard = useCallback(() => {
    setIsPlayerCardOpen(false);
    setPlayerCardId(null);
  }, []);

  const closeAssignModal = useCallback(() => {
    setIsAssignModalOpen(false);
    setStagedPlayers(null);
    closePlayerCard();
  }, [closePlayerCard]);

  const effectivePlayers = useMemo(
    () => canonicalizePlayersForEditor(stagedPlayers ?? (payloadRef.current?.players as any)),
    [stagedPlayers]
  );

  const allPlayers = useMemo(() => {
    const res = Object.entries(effectivePlayers).map(([id, p]) => ({
      id,
      name: normalizeName(id, p),
      tier: normalizeTierKey(p),
      title: (p?.title ?? "").toString().trim(),
    }));

    const TITLE_ORDER = ["Король", "Герцог", "Граф", "Барон"] as const;
    const TIER_ORDER: TierKey[] = ["Крепости", "Донжоны", "Башня", "Халупа"];

    const titleRank = (t?: string) => {
      const idx = TITLE_ORDER.indexOf((t ?? "") as any);
      return idx === -1 ? Number.POSITIVE_INFINITY : idx;
    };

    const baseTierKey = (t: TierKey | ""): string => {
      if (!t) return "zzz";
      if (t.startsWith("Крепости")) return "Крепости";
      if (t.startsWith("Донжоны")) return "Донжоны";
      if (t.startsWith("Башня")) return "Башня";
      if (t.startsWith("Халупа")) return "Халупа";
      return t;
    };

    const tierRank = (t: TierKey | "") => {
      const base = baseTierKey(t) as TierKey | string;
      const idx = TIER_ORDER.indexOf(base as any);
      return idx === -1 ? Number.POSITIVE_INFINITY : idx;
    };

    res.sort((a, b) => {
      const ta = titleRank(a.title);
      const tb = titleRank(b.title);
      if (ta !== tb) return ta - tb;

      const ga = tierRank(a.tier);
      const gb = tierRank(b.tier);
      if (ga !== gb) return ga - gb;

      if (a.tier && b.tier) {
        const ba = baseTierKey(a.tier);
        const bb = baseTierKey(b.tier);
        if (ba === bb) return (a.tier || "").localeCompare(b.tier || "", "ru");
      }

      return (a.name || "").localeCompare(b.name || "", "ru");
    });

    return res;
  }, [effectivePlayers, normalizeTierKey]);

  const movePlayer = useCallback(
    (playerId: string, tier: TierKey | "") => {
      setStagedPlayers((cur) => {
        const base = canonicalizePlayersForEditor(cur ?? (payloadRef.current?.players as any));
        const prev = (base as any)[playerId];
        if (!prev) return base;
        return { ...base, [playerId]: { ...prev, tier } };
      });
      setIsDirty(true);
    },
    []
  );

  const renamePlayer = useCallback((playerId: string, nextName: string) => {
    const name = nextName.trim();
    if (!name) return;

    setStagedPlayers((cur) => {
      const base = canonicalizePlayersForEditor(cur ?? (payloadRef.current?.players as any));
      const prev = (base as any)[playerId];
      if (!prev) return base;
      return { ...base, [playerId]: { ...prev, name } };
    });

    setIsDirty(true);
  }, []);

  const updatePlayerBio = useCallback((playerId: string, nextTitle: string, nextDesc: string) => {
    setStagedPlayers((cur) => {
      const base = canonicalizePlayersForEditor(cur ?? (payloadRef.current?.players as any));
      const prev = (base as any)[playerId];
      if (!prev) return base;
      return { ...base, [playerId]: { ...prev, title: nextTitle, desc: nextDesc } };
    });

    setIsDirty(true);
  }, []);

  const updatePlayerAoeProfileId = useCallback((playerId: string, nextAoeProfileId: string) => {
    setStagedPlayers((cur) => {
      const base = canonicalizePlayersForEditor(cur ?? (payloadRef.current?.players as any));
      const prev = (base as any)[playerId];
      if (!prev) return base;
      const v = nextAoeProfileId.trim();
      const aoeProfileId = v ? v : undefined;
      return { ...base, [playerId]: { ...prev, ...(aoeProfileId ? { aoeProfileId } : {}) } };
    });

    setIsDirty(true);
  }, []);

  const updatePlayerSteamId = useCallback((playerId: string, nextSteamId: string) => {
    setStagedPlayers((cur) => {
      const base = canonicalizePlayersForEditor(cur ?? (payloadRef.current?.players as any));
      const prev = (base as any)[playerId];
      if (!prev) return base;
      const v = nextSteamId.trim();
      const steamId = v ? v : undefined;
      return { ...base, [playerId]: { ...prev, ...(steamId ? { steamId } : {}) } };
    });

    setIsDirty(true);
  }, []);

  const openPlayerCard = useCallback(
    (playerId: string) => {
      setPlayerCardId(playerId);
      setIsPlayerCardOpen(true);

      const p = (effectivePlayers as any)?.[playerId] as PlayerRec | undefined;
      setRenamePlayerValue(normalizeName(playerId, p));
      setEditTitleValue((p?.title ?? "").toString());
      setEditDescValue((p?.desc ?? "").toString());
      setEditAoeProfileIdValue((p?.aoeProfileId ?? "").toString());
      setEditSteamIdValue((p as any)?.steamId ? String((p as any).steamId) : "");

      const t = normalizeTierKey(p);
      setPreviewTier((t || "") ? (t as TierKey) : null);
    },
    [effectivePlayers, normalizeTierKey]
  );

  const applyPlayerCardChanges = useCallback(() => {
    if (!playerCardId) return;
    const name = renamePlayerValue.trim();
    if (name) renamePlayer(playerCardId, name);
    updatePlayerBio(playerCardId, editTitleValue, editDescValue);
    updatePlayerAoeProfileId(playerCardId, editAoeProfileIdValue);
    updatePlayerSteamId(playerCardId, editSteamIdValue);
    closePlayerCard();
  }, [playerCardId, renamePlayerValue, editTitleValue, editDescValue, editAoeProfileIdValue, editSteamIdValue, renamePlayer, updatePlayerBio, updatePlayerAoeProfileId, updatePlayerSteamId, closePlayerCard]);

  const saveAssignments = useCallback(async () => {
    const pl = payloadRef.current;
    if (!pl) return;

    const ok = window.confirm("Сохранить изменения назначений в БД?");
    if (!ok) return;

    setIsSavingAssignments(true);
    try {
      const tier = selectedBuildingRef.current;
      const tierName = tier ? tierRename.trim() : "";

      const nextMeta = {
        ...(pl.meta ?? {}),
        tierNames: {
          ...((pl.meta?.tierNames ?? {}) as any),
          ...(tier && tierName ? { [tier]: tierName } : {}),
        },
      };

      const basePlayers: Record<string, PlayerRec> = effectivePlayers as any;
      const nextPlayers: Record<string, PlayerRec> = Object.fromEntries(
        Object.entries(basePlayers).map(([id, p]) => {
          const cloned = { ...(p as any) } as PlayerRec;
          delete (cloned as any).insightsUserId;
          return [id, cloned];
        })
      ) as any;

      const prevCount = Object.keys(pl.players ?? {}).length;
      const nextCount = Object.keys(nextPlayers ?? {}).length;
      if (prevCount > 0 && nextCount < prevCount * 0.8) {
        const sure = window.confirm(
          `Внимание! Кол-во игроков уменьшится с ${prevCount} до ${nextCount}. Подтвердить сохранение?`
        );
        if (!sure) return;
      }

      const next: MapStatePayloadV1 = {
        ...pl,
        players: nextPlayers as any,
        meta: nextMeta,
      };

      payloadRef.current = next;
      try {
        await Promise.race([
          saveMapState(next as any),
          new Promise((_, rej) => setTimeout(() => rej(new Error("save-timeout")), 10000)),
        ]);
      } catch (e) {
        console.warn("[Admin] save error/timeout", e);
      }

      void (async () => {
        try {
          const reloaded = (await loadMapState()) as any;
          if (reloaded && reloaded.buildings) {
            payloadRef.current = reloaded as any;
            setMetaVersion((v) => v + 1);
          }
        } catch (e) {
          console.warn("[Admin] background reload failed", e);
        }
      })();

      setIsDirty(false);
      setIsAssignModalOpen(false);
      setStagedPlayers(null);
      closePlayerCard();
    } finally {
      setIsSavingAssignments(false);
    }
  }, [effectivePlayers, tierRename, closePlayerCard]);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const r = await me();
        if (cancelled) return;
        const user = r?.user;
        const ok = !!user;
        setIsAuthed(ok);
        setIsAdmin(ok && user?.role === "ADMIN");
        setAuthChecked(true);
        if (!ok) {
          router.replace(`/login?next=${encodeURIComponent("/admin")}`);
        }
      } catch {
        if (cancelled) return;
        setIsAuthed(false);
        setIsAdmin(false);
        setAuthChecked(true);
        router.replace(`/login?next=${encodeURIComponent("/admin")}`);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [router]);

  useEffect(() => {
    const hostEl = hostRef.current;
    if (!hostEl) {
      setDebugStage("wait:host");
      return;
    }
    if (!authChecked || !isAuthed || !isAdmin) {
      setDebugStage("wait:auth");
      return;
    }

    setIsLoading(true);
    setDebugError(null);
    setDebugStage("pixi:init");

    const app = new PIXI.Application();
    appRef.current = app;

    let destroyed = false;

    (async () => {
      try {
        await app.init({
          background: "#0b1220",
          resizeTo: hostEl,
          antialias: true,
          resolution: Math.min(2, window.devicePixelRatio || 1),
        });
        if (destroyed) return;

        hostEl.appendChild(app.canvas);

        const viewport = new Viewport({
          screenWidth: hostEl.clientWidth,
          screenHeight: hostEl.clientHeight,
          worldWidth: WORLD.w,
          worldHeight: WORLD.h,
          events: app.renderer.events,
        });
        viewportRef.current = viewport;

        viewport.drag({ mouseButtons: "left" }).pinch().wheel().decelerate({ friction: 0.92 });
        viewport.clampZoom({ minScale: 0.35, maxScale: 2.2 });

        app.stage.addChild(viewport);

        try {
          await (PIXI.Assets as any).init?.({ preferCreateImageBitmap: false });
        } catch {}

        const loadTextureWithImage = async (urls: string[]): Promise<PIXI.Texture> => {
          let lastErr: any = null;
          for (const u of urls) {
            try {
              const res = await fetch(u, { cache: "no-store" });
              if (!res.ok) throw new Error(`http ${res.status}`);
              const blob = await res.blob();
              const url = URL.createObjectURL(blob);
              const img: HTMLImageElement = await new Promise((resolve, reject) => {
                const i = new Image();
                i.onload = () => resolve(i);
                i.onerror = () => reject(new Error("img-decode-failed"));
                i.src = url;
              });
              const tex = PIXI.Texture.from(img as any);
              return tex;
            } catch (e) {
              lastErr = e;
              continue;
            }
          }
          throw lastErr ?? new Error("texture-load-failed");
        };

        const mapCandidates = [MAP_URL, `${MAP_URL}?v=${WORLD.mapTextureVersion}`, `${MAP_URL}?ts=${Date.now()}`];
        setDebugStage("assets:map");
        const mapTexture = await loadTextureWithImage(mapCandidates);
        if (destroyed) return;
        const mapSprite = new PIXI.Sprite(mapTexture);
        mapSprite.x = 0;
        mapSprite.y = 0;

        const mapW = mapTexture.width;
        const mapH = mapTexture.height;
        viewport.worldWidth = mapW;
        viewport.worldHeight = mapH;

        const fitScale = Math.min(viewport.screenWidth / mapW, viewport.screenHeight / mapH);
        viewport.clampZoom({ minScale: fitScale, maxScale: 2.2 });

        viewport.clamp({ left: 0, top: 0, right: mapW, bottom: mapH, direction: "all", underflow: "center" });

        mapSprite.width = mapW;
        mapSprite.height = mapH;
        viewport.addChild(mapSprite);

        const buildingsLayer = new PIXI.Container();
        buildingsLayer.eventMode = "passive";
        viewport.addChild(buildingsLayer);

        // Load or seed payload
        let payload: MapStatePayloadV1;
        try {
          setDebugStage("api:loadMapState");
          const remote = await loadMapState();
          if (destroyed) return;

          if (remote && (remote as any).buildings) {
            const remotePayload = remote as unknown as FirestoreMapStateV1;

            const incoming = (remotePayload as any).buildings as Record<string, any>;
            const cleaned: Partial<MapStatePayloadV1["buildings"]> = {};
            for (const t of TIERS) {
              const v = incoming[t];
              if (v && typeof v === "object") (cleaned as any)[t] = { ...(DEFAULT_BUILDINGS as any)[t], ...v };
            }

            payload = {
              world: { ...WORLD },
              buildings: { ...DEFAULT_BUILDINGS, ...(cleaned as any) },
              players: canonicalizePlayersForEditor(remotePayload.players as any),
              meta: (remotePayload.meta ?? {}) as any,
            };
            payloadRef.current = payload;
            setIsDirty(false);
            setMetaVersion((v) => v + 1);
          } else {
            payload = { world: { ...WORLD }, buildings: { ...DEFAULT_BUILDINGS }, players: {}, meta: {} };
            payloadRef.current = payload;
            setIsDirty(false);
            setMetaVersion((v) => v + 1);
          }
        } catch {
          payload = { world: { ...WORLD }, buildings: { ...DEFAULT_BUILDINGS }, players: {}, meta: {} };
          payloadRef.current = payload;
          setMetaVersion((v) => v + 1);
        }

        (appRef.current as any).__buildingSpritesByTier = {} as Partial<Record<TierKey, PIXI.Sprite>>;

        const setupBuildingSprite = (tier: TierKey, texture: PIXI.Texture) => {
          const container = new PIXI.Container();
          container.eventMode = "static";
          container.cursor = "pointer";

          const sprite = new PIXI.Sprite(texture);
          sprite.anchor.set(0.5, 1);
          sprite.eventMode = "static";
          sprite.cursor = "pointer";

          const tw = texture.width;
          const TARGET_W_BY_TIER: Partial<Record<TierKey, number>> = {
            "Замки": 260,
            "Донжоны": 220,
            "Донжоны v2": 220,
            "Донжоны v3": 220,
            "Донжоны v4": 220,
            "Халупа": 160,
            "Халупа v2": 160,
            "Халупа v3": 160,
            "Халупа v4": 160,
            "Халупа v5": 160,
            "Халупа v6": 160,
            "Башня": 180,
            "Башня v2": 180,
            "Башня v3": 180,
            "Башня v4": 180,
          };
          const targetW = TARGET_W_BY_TIER[tier] ?? 200;
          const baseScale = tw > 0 ? targetW / tw : 1;
          (sprite as any).__baseScale = baseScale;

          const fb = (DEFAULT_BUILDINGS as any)[tier] as any;
          const b = (payloadRef.current as any)?.buildings?.[tier] ?? fb;
          const x = typeof b?.x === "number" ? b.x : 0;
          const y = typeof b?.y === "number" ? b.y : 0;
          container.position.set(x, y);

          const userScale =
            typeof ((payloadRef.current?.buildings?.[tier] as any)?.scale) === "number"
              ? (payloadRef.current!.buildings as any)[tier].scale
              : 1;
          sprite.scale.set(baseScale * userScale);
          const userRot =
            typeof ((payloadRef.current?.buildings?.[tier] as any)?.rotation) === "number"
              ? (payloadRef.current!.buildings as any)[tier].rotation
              : 0;
          sprite.rotation = userRot;

          ((appRef.current as any).__buildingSpritesByTier as any)[tier] = sprite;

          // Hover highlight
          let isHovered = false;
          const normalAlpha = 0.92;
          const hoverAlpha = 1.0;
          const normalTint = 0xffffff;
          const hoverTint = 0xfff1c8;

          sprite.alpha = normalAlpha;
          sprite.tint = normalTint;

          const applyHover = (next: boolean) => {
            isHovered = next;
            const isSelected = dragBuildingsRef.current && selectedBuildingRef.current === tier;
            const active = isHovered || isSelected;
            sprite.alpha = active ? hoverAlpha : normalAlpha;
            sprite.tint = active ? hoverTint : normalTint;
          };

          (sprite as any).__applyHighlight = () => applyHover(isHovered);

          const onOver = () => applyHover(true);
          const onOut = () => applyHover(false);
          sprite.on("pointerover", onOver);
          sprite.on("pointerout", onOut);
          container.on("pointerover", onOver);
          container.on("pointerout", onOut);

          (sprite as any).on("pointertap", () => {
            if (!dragBuildingsRef.current) return;

            setSelectedBuilding(tier);
            const currentScale = (payloadRef.current?.buildings[tier] as any)?.scale;
            setBuildingScale(typeof currentScale === "number" ? currentScale : 1);
            const currentRotation = (payloadRef.current?.buildings[tier] as any)?.rotation;
            setBuildingRotation(typeof currentRotation === "number" ? currentRotation : 0);
          });

          let isDragging = false;
          let dragOffsetLocal = { x: 0, y: 0 };
          container.on("pointerdown", (e: PIXI.FederatedPointerEvent) => {
            if (!dragBuildingsRef.current) return;
            isDragging = true;
            container.cursor = "grabbing";
            (e as any).stopPropagation?.();
            const world = viewport.toWorld(e.global.x, e.global.y);
            dragOffsetLocal = { x: container.x - world.x, y: container.y - world.y };
          });
          container.on("pointerup", () => {
            if (!isDragging) return;
            isDragging = false;
            container.cursor = "pointer";
            const pl = payloadRef.current;
            if (pl) {
              pl.buildings[tier] = { ...pl.buildings[tier], x: container.x, y: container.y } as any;
              setIsDirty(true);
              scheduleAutosave();
            }
          });
          container.on("pointermove", (e: PIXI.FederatedPointerEvent) => {
            if (!isDragging) return;
            const world = viewport.toWorld(e.global.x, e.global.y);
            container.position.set(world.x + dragOffsetLocal.x, world.y + dragOffsetLocal.y);
          });

          container.addChild(sprite);
          return container;
        };

        const CASTLE_V2_URL = "/buildings/castle/castle_v2.png?v=2";
        try {
          (PIXI.Assets as any).cache?.remove?.("/buildings/castle/castle_v1.png");
          (PIXI.Assets as any).cache?.remove?.("/buildings/castle/castle_v2.png");
          (PIXI.Assets as any).cache?.remove?.(CASTLE_V2_URL);
        } catch {}

        setDebugStage("assets:buildings");
        const castlesTexture = await PIXI.Assets.load("/buildings/castle/castle_v1.png");
        buildingsLayer.addChild(setupBuildingSprite("Замки", castlesTexture));
        const castlesV2Texture = await PIXI.Assets.load(CASTLE_V2_URL);
        buildingsLayer.addChild(setupBuildingSprite("Замки v2", castlesV2Texture));
        const castlesV3Texture = await PIXI.Assets.load("/buildings/castle/castle_v3.png");
        buildingsLayer.addChild(setupBuildingSprite("Замки v3", castlesV3Texture));
        const castlesV4Texture = await PIXI.Assets.load("/buildings/castle/castle_v4.png");
        buildingsLayer.addChild(setupBuildingSprite("Замки v4", castlesV4Texture));

        const krepostTexture = await PIXI.Assets.load("/buildings/krepost/krepost.png");
        buildingsLayer.addChild(setupBuildingSprite("Крепости", krepostTexture));
        const krepostV2Texture = await PIXI.Assets.load("/buildings/krepost/krepost_v2.png");
        buildingsLayer.addChild(setupBuildingSprite("Крепости v2", krepostV2Texture));
        const krepostV3Texture = await PIXI.Assets.load("/buildings/krepost/krepost_v3.png");
        buildingsLayer.addChild(setupBuildingSprite("Крепости v3", krepostV3Texture));
        const krepostV4Texture = await PIXI.Assets.load("/buildings/krepost/krepost_v4.png");
        buildingsLayer.addChild(setupBuildingSprite("Крепости v4", krepostV4Texture));

        const halupaTexture = await PIXI.Assets.load("/buildings/halupa/halupa.png");
        buildingsLayer.addChild(setupBuildingSprite("Халупа", halupaTexture));
        const halupaV2Texture = await PIXI.Assets.load("/buildings/halupa/halupa_v2.png");
        buildingsLayer.addChild(setupBuildingSprite("Халупа v2", halupaV2Texture));
        const halupaV3Texture = await PIXI.Assets.load("/buildings/halupa/halupa_v3.png");
        buildingsLayer.addChild(setupBuildingSprite("Халупа v3", halupaV3Texture));
        const halupaV4Texture = await PIXI.Assets.load("/buildings/halupa/halupa_v4.png");
        buildingsLayer.addChild(setupBuildingSprite("Халупа v4", halupaV4Texture));
        const halupaV5Texture = await PIXI.Assets.load("/buildings/halupa/halupa_v5.png");
        buildingsLayer.addChild(setupBuildingSprite("Халупа v5", halupaV5Texture));
        const halupaV6Texture = await PIXI.Assets.load("/buildings/halupa/halupa_v6.png");
        buildingsLayer.addChild(setupBuildingSprite("Халупа v6", halupaV6Texture));

        const donzonTexture = await PIXI.Assets.load("/buildings/donzon/donzon.png");
        buildingsLayer.addChild(setupBuildingSprite("Донжоны", donzonTexture));
        const donzonV2Texture = await PIXI.Assets.load("/buildings/donzon/donzon%20v2.png");
        buildingsLayer.addChild(setupBuildingSprite("Донжоны v2", donzonV2Texture));
        const donzonV3Texture = await PIXI.Assets.load("/buildings/donzon/donzon%20v3.png");
        buildingsLayer.addChild(setupBuildingSprite("Донжоны v3", donzonV3Texture));
        const donzonV4Texture = await PIXI.Assets.load("/buildings/donzon/donzon%20v4.png");
        buildingsLayer.addChild(setupBuildingSprite("Донжоны v4", donzonV4Texture));

        const basnjaTexture = await PIXI.Assets.load("/buildings/basnja/basnja.png");
        buildingsLayer.addChild(setupBuildingSprite("Башня", basnjaTexture));
        const basnjaV2Texture = await PIXI.Assets.load("/buildings/basnja/basnja%20v2.png");
        buildingsLayer.addChild(setupBuildingSprite("Башня v2", basnjaV2Texture));
        const basnjaV3Texture = await PIXI.Assets.load("/buildings/basnja/basnja%20v3.png");
        buildingsLayer.addChild(setupBuildingSprite("Башня v3", basnjaV3Texture));
        const basnjaV4Texture = await PIXI.Assets.load("/buildings/basnja/basnja%20v4.png");
        if (destroyed) return;
        buildingsLayer.addChild(setupBuildingSprite("Башня v4", basnjaV4Texture));

        center();
        setDebugStage("ready");
        setIsLoading(false);
      } catch (e: any) {
        console.error("[Admin] init/load failed", e);
        if (!destroyed) {
          setDebugError(e?.message ? String(e.message) : String(e));
          setDebugStage("error");
          setIsLoading(false);
        }
      }
    })();

    return () => {
      destroyed = true;
      payloadRef.current = null;
      setIsLoading(true);
      try {
        const canvas = app.canvas;
        canvas?.parentElement?.removeChild(canvas);
      } catch {}
      app.destroy(true);
      appRef.current = null;
      viewportRef.current = null;
    };
  }, [authChecked, isAuthed, isAdmin, center, openAssignModalFor, scheduleAutosave]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      closePlayerCard();
      setIsAssignModalOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [closePlayerCard]);

  if (!authChecked) {
    return (
      <div
        style={{
          minHeight: "100dvh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 16,
          background: "#0b1220",
          color: "#f7f0df",
        }}
      >
        <div style={{ opacity: 0.85, fontWeight: 800 }}>Checking session…</div>
      </div>
    );
  }

  if (!isAuthed) {
    return (
      <div
        style={{
          minHeight: "100dvh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 16,
          background: "#0b1220",
          color: "#f7f0df",
        }}
      />
    );
  }

  if (!isAdmin) {
    return (
      <div
        style={{
          minHeight: "100dvh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 16,
          background: "#0b1220",
          color: "#f7f0df",
        }}
      >
        <div
          style={{
            width: "min(640px, 100%)",
            border: "1px solid #3a2a1a",
            borderRadius: 12,
            padding: 16,
            background: "rgba(0,0,0,0.25)",
          }}
        >
          <div style={{ fontWeight: 900, fontSize: 18, marginBottom: 10 }}>Access denied</div>
          <div style={{ opacity: 0.9, lineHeight: 1.4 }}>
            Your account is authenticated but does not have the ADMIN role.
          </div>
          <div style={{ marginTop: 12, display: "flex", gap: 10, flexWrap: "wrap" }}>
            <a href="/" style={{ color: "#caa24d", fontWeight: 900, textDecoration: "none" }}>
              Back to map
            </a>
            <a href="/login?next=%2Fadmin" style={{ color: "#caa24d", fontWeight: 900, textDecoration: "none" }}>
              Login as another user
            </a>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ height: "100dvh", display: "flex", flexDirection: "column" }}>
      <div
        style={{
          position: "fixed",
          left: 8,
          bottom: 8,
          zIndex: 99999,
          fontSize: 12,
          fontFamily:
            "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
          padding: "6px 8px",
          borderRadius: 8,
          background: "rgba(0,0,0,0.55)",
          border: "1px solid rgba(255,255,255,0.15)",
          color: "rgba(255,255,255,0.9)",
          pointerEvents: "none",
        }}
      >
        stage={debugStage}
        {debugError ? ` error=${debugError}` : ""}
      </div>

      <div ref={hostRef} className="aoe-canvasHost" />

      {/* Admin top-left toolbar */}
      <div
        style={{
          position: "fixed",
          left: 12,
          top: 12,
          zIndex: 100000,
          display: "flex",
          gap: 8,
          alignItems: "center",
          background: "rgba(0,0,0,0.55)",
          border: "1px solid rgba(255,255,255,0.15)",
          borderRadius: 12,
          padding: 8,
          boxShadow: "0 6px 24px rgba(0,0,0,0.35)",
        }}
      >
        <button
          onClick={() => setDragBuildings((v) => !v)}
          style={{
            appearance: "none",
            border: dragBuildings ? "1px solid #caa24d" : "1px solid rgba(255,255,255,0.25)",
            background: dragBuildings ? "#caa24d" : "rgba(0,0,0,0.35)",
            color: dragBuildings ? "#1b1b1b" : "rgba(255,255,255,0.9)",
            fontWeight: 900,
            borderRadius: 10,
            padding: "8px 12px",
            cursor: "pointer",
          }}
          title="Режим перемещения строений"
        >
          {dragBuildings ? "Перемещение: ��кл" : "Перемещение: Выкл"}
        </button>

        <button
          onClick={center}
          style={{
            appearance: "none",
            border: "1px solid rgba(255,255,255,0.25)",
            background: "rgba(0,0,0,0.35)",
            color: "rgba(255,255,255,0.9)",
            fontWeight: 800,
            borderRadius: 10,
            padding: "8px 12px",
            cursor: "pointer",
          }}
          title="Центрировать карту"
        >
          Center
        </button>

        <button
          onClick={save}
          style={{
            appearance: "none",
            border: "1px solid #2bb673",
            background: "#2bb673",
            color: "#0b1220",
            fontWeight: 900,
            borderRadius: 10,
            padding: "8px 12px",
            cursor: "pointer",
            opacity: isDirty ? 1 : 0.7,
          }}
          title="Сохранить изменения карты"
        >
          Save
        </button>

        <button
          onClick={reset}
          style={{
            appearance: "none",
            border: "1px solid #b62b2b",
            background: "#b62b2b",
            color: "#fff",
            fontWeight: 900,
            borderRadius: 10,
            padding: "8px 12px",
            cursor: "pointer",
          }}
          title="Сбросить позиционирование строений к значениям по умолчанию"
        >
          Reset
        </button>
      </div>

      {/* Admin bottom-right controls */}
      <div
        style={{
          position: "fixed",
          right: 12,
          bottom: 12,
          zIndex: 100000,
          display: "flex",
          gap: 8,
          alignItems: "center",
          background: "rgba(0,0,0,0.55)",
          border: "1px solid rgba(255,255,255,0.15)",
          borderRadius: 12,
          padding: 8,
          boxShadow: "0 6px 24px rgba(0,0,0,0.35)",
        }}
      >
        <button
          onClick={openGlobalAssignments}
          style={{
            appearance: "none",
            border: "1px solid #caa24d",
            background: "#caa24d",
            color: "#1b1b1b",
            fontWeight: 900,
            borderRadius: 10,
            padding: "8px 12px",
            cursor: "pointer",
          }}
          title="Открыть назначения игроков по строениям"
        >
          Назначения
        </button>
      </div>

      {/* Building transform panel */}
      {dragBuildings && selectedBuilding && (
        <div
          style={{
            position: "fixed",
            right: 12,
            top: 72,
            zIndex: 100001,
            width: 320,
            background: "rgba(0,0,0,0.7)",
            border: "1px solid rgba(255,255,255,0.15)",
            borderRadius: 12,
            padding: 12,
            color: "#f7f0df",
          }}
        >
          <div style={{ fontWeight: 900, marginBottom: 8 }}>Трансформация строения</div>
          <div style={{ display: "grid", gridTemplateColumns: "auto 1fr auto", gap: 8, alignItems: "center" }}>
            <div style={{ opacity: 0.85 }}>Scale</div>
            <input
              type="range"
              min={0.2}
              max={3}
              step={0.01}
              value={buildingScale}
              onChange={(e) => setBuildingScale(parseFloat(e.target.value))}
            />
            <input
              type="number"
              step={0.01}
              min={0.2}
              max={3}
              value={buildingScale}
              onChange={(e) => setBuildingScale(parseFloat(e.target.value || "1"))}
              style={{
                width: 72,
                padding: 4,
                borderRadius: 6,
                background: "rgba(255,255,255,0.06)",
                border: "1px solid rgba(255,255,255,0.2)",
                color: "#f7f0df",
              }}
            />

            <div style={{ opacity: 0.85 }}>Rotation (rad)</div>
            <input
              type="range"
              min={-3.14}
              max={3.14}
              step={0.01}
              value={buildingRotation}
              onChange={(e) => setBuildingRotation(parseFloat(e.target.value))}
            />
            <input
              type="number"
              step={0.01}
              min={-3.14}
              max={3.14}
              value={buildingRotation}
              onChange={(e) => setBuildingRotation(parseFloat(e.target.value || "0"))}
              style={{
                width: 72,
                padding: 4,
                borderRadius: 6,
                background: "rgba(255,255,255,0.06)",
                border: "1px solid rgba(255,255,255,0.2)",
                color: "#f7f0df",
              }}
            />
          </div>
        </div>
      )}

      {/* Assignments modal */}
      {isAssignModalOpen && (
        <div
          onClick={closeAssignModal}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.55)",
            backdropFilter: "blur(2px)",
            zIndex: 100002,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 20,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: "min(1200px, 100%)",
              maxHeight: "92dvh",
              display: "flex",
              flexDirection: "column",
              background: "#0f1626",
              border: "1px solid rgba(255,255,255,0.12)",
              borderRadius: 14,
              padding: 16,
              color: "#f6efe3",
              boxShadow: "0 18px 48px rgba(0,0,0,0.55)",
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: 12,
                marginBottom: 14,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
                <div style={{ fontWeight: 900, fontSize: 20, letterSpacing: 0.2 }}>Назначения</div>
              </div>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                <button
                  onClick={saveAssignments}
                  disabled={isSavingAssignments}
                  style={{
                    appearance: "none",
                    border: "1px solid #2bb673",
                    background: "#2bb673",
                    color: "#0b1220",
                    fontWeight: 900,
                    borderRadius: 10,
                    padding: "10px 14px",
                    cursor: "pointer",
                  }}
                >
                  Сохранить
                </button>
                <button
                  onClick={closeAssignModal}
                  style={{
                    appearance: "none",
                    border: "1px solid rgba(255,255,255,0.25)",
                    background: "rgba(0,0,0,0.35)",
                    color: "rgba(255,255,255,0.95)",
                    fontWeight: 800,
                    borderRadius: 10,
                    padding: "10px 14px",
                    cursor: "pointer",
                  }}
                >
                  Отмена
                </button>
              </div>
            </div>

            <div style={{ marginBottom: 14 }}>
              <div style={{ opacity: 0.85, fontSize: 12, marginBottom: 6 }}>Название тира (отображение)</div>
              <input
                value={tierRename}
                onChange={(e) => setTierRename(e.target.value)}
                style={{
                  width: "100%",
                  padding: "10px 12px",
                  borderRadius: 10,
                  border: "1px solid rgba(255,255,255,0.18)",
                  background: "rgba(255,255,255,0.05)",
                  color: "#f6efe3",
                  outline: "none",
                }}
              />
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 10, overflow: "auto", maxHeight: "70vh", paddingRight: 6 }}>
              {allPlayers.map((p) => (
                <div
                  key={p.id}
                  onClick={() => openPlayerCard(p.id)}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "auto minmax(0,1fr) auto",
                    alignItems: "center",
                    gap: 14,
                    padding: 12,
                    borderRadius: 12,
                    background: "rgba(255,255,255,0.05)",
                    border: "1px solid rgba(255,255,255,0.1)",
                    cursor: "pointer",
                  }}
                  title="Открыть карточку игрока"
                >
                  <div style={{ display: "flex", alignItems: "center" }}>
                    <img
                      src={avatarByPlayerId(p.id, (stagedPlayers ?? (payloadRef.current?.players as any))?.[p.id] as any)}
                      alt={p.name}
                      style={{
                        width: 56,
                        height: 56,
                        borderRadius: "50%",
                        objectFit: "cover",
                        border: "1px solid rgba(255,255,255,0.25)",
                      }}
                    />
                  </div>

                  <div style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
                    <div
                      style={{
                        fontWeight: 900,
                        fontSize: 16,
                        whiteSpace: "nowrap",
                        textOverflow: "ellipsis",
                        overflow: "hidden",
                      }}
                    >
                      {p.name}
                    </div>
                    <div style={{ opacity: 0.75, fontSize: 12 }}>{p.tier || "Без строения"}</div>
                  </div>

                  <div style={{ opacity: 0.8, fontSize: 12, justifySelf: "end" }}>▶</div>
                </div>
              ))}
            </div>
          </div>

          {/* Player card modal */}
          {isPlayerCardOpen && playerCardId && (
            <div
              onClick={closePlayerCard}
              style={{
                position: "fixed",
                inset: 0,
                background: "rgba(0,0,0,0.55)",
                backdropFilter: "blur(2px)",
                zIndex: 100003,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                padding: 20,
              }}
            >
              <div
                onClick={(e) => e.stopPropagation()}
                style={{
                  width: "min(760px, 100%)",
                  maxHeight: "92dvh",
                  overflow: "auto",
                  background: "#0f1626",
                  border: "1px solid rgba(255,255,255,0.12)",
                  borderRadius: 14,
                  padding: 16,
                  color: "#f6efe3",
                  boxShadow: "0 18px 48px rgba(0,0,0,0.55)",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, marginBottom: 14 }}>
                  <div style={{ fontWeight: 900, fontSize: 18 }}>Карточка игрока</div>
                  <button
                    onClick={closePlayerCard}
                    style={{
                      appearance: "none",
                      border: "1px solid rgba(255,255,255,0.25)",
                      background: "rgba(0,0,0,0.35)",
                      color: "rgba(255,255,255,0.95)",
                      fontWeight: 800,
                      borderRadius: 10,
                      padding: "8px 12px",
                      cursor: "pointer",
                    }}
                  >
                    Закрыть
                  </button>
                </div>

                <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 14 }}>
                  <img
                    src={avatarByPlayerId(playerCardId, (stagedPlayers ?? (payloadRef.current?.players as any))?.[playerCardId] as any)}
                    alt={renamePlayerValue || playerCardId}
                    style={{
                      width: 72,
                      height: 72,
                      borderRadius: "50%",
                      objectFit: "cover",
                      border: "1px solid rgba(255,255,255,0.25)",
                    }}
                  />
                  <div style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 0, flex: 1 }}>
                    <div style={{ opacity: 0.85, fontSize: 12 }}>Имя</div>
                    <input
                      value={renamePlayerValue}
                      onChange={(e) => setRenamePlayerValue(e.target.value)}
                      placeholder="Имя игрока"
                      style={{
                        width: "100%",
                        padding: "10px 12px",
                        borderRadius: 10,
                        border: "1px solid rgba(255,255,255,0.18)",
                        background: "rgba(255,255,255,0.05)",
                        color: "#f6efe3",
                        outline: "none",
                      }}
                    />
                  </div>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 }}>
                  <div>
                    <div style={{ opacity: 0.85, fontSize: 12, marginBottom: 6 }}>Титул</div>
                    <select
                      value={editTitleValue}
                      onChange={(e) => setEditTitleValue(e.target.value)}
                      style={{
                        width: "100%",
                        padding: "10px 12px",
                        borderRadius: 10,
                        border: "1px solid rgba(255,255,255,0.18)",
                        background: "rgba(255,255,255,0.05)",
                        color: "#f6efe3",
                      }}
                    >
                      <option value="">Без титула</option>
                      <option value="Король">Король</option>
                      <option value="Герцог">Герцог</option>
                      <option value="Граф">Граф</option>
                      <option value="Барон">Барон</option>
                      <option value="Рыцарь">Рыцарь</option>
                      <option value="Воевода">Воевода</option>
                      <option value="Маршал">Маршал</option>
                      <option value="Баронет">Баронет</option>
                      <option value="Лорд">Лорд</option>
                      <option value="Сквайр">Сквайр</option>
                    </select>
                  </div>
                  <div>
                    <div style={{ opacity: 0.85, fontSize: 12, marginBottom: 6 }}>aoeProfileId</div>
                    <input
                      value={editAoeProfileIdValue}
                      onChange={(e) => setEditAoeProfileIdValue(e.target.value)}
                      placeholder="aoeProfileId"
                      style={{
                        width: "100%",
                        padding: "10px 12px",
                        borderRadius: 10,
                        border: "1px solid rgba(255,255,255,0.18)",
                        background: "rgba(255,255,255,0.05)",
                        color: "#f6efe3",
                      }}
                    />
                  </div>
                </div>

                <div style={{ marginBottom: 10 }}>
                  <div style={{ opacity: 0.85, fontSize: 12, marginBottom: 6 }}>Steam ID (опционально)</div>
                  <input
                    value={editSteamIdValue}
                    onChange={(e) => setEditSteamIdValue(e.target.value)}
                    placeholder="7656119..."
                    style={{
                      width: "100%",
                      padding: "10px 12px",
                      borderRadius: 10,
                      border: "1px solid rgba(255,255,255,0.18)",
                      background: "rgba(255,255,255,0.05)",
                      color: "#f6efe3",
                    }}
                  />
                  <div style={{ marginTop: 6, opacity: 0.65, fontSize: 12, lineHeight: 1.35 }}>
                    Если указан Steam ID, сервер сможет синкать статистику через профиль <code>/steam/&lt;id&gt;</code>.
                  </div>
                </div>

                <div style={{ marginBottom: 10 }}>
                  <div style={{ opacity: 0.85, fontSize: 12, marginBottom: 6 }}>Описание</div>
                  <textarea
                    value={editDescValue}
                    onChange={(e) => setEditDescValue(e.target.value)}
                    placeholder="Описание"
                    rows={5}
                    style={{
                      width: "100%",
                      padding: "10px 12px",
                      borderRadius: 10,
                      border: "1px solid rgba(255,255,255,0.18)",
                      background: "rgba(255,255,255,0.05)",
                      color: "#f6efe3",
                    }}
                  />
                </div>

                <div style={{ marginBottom: 14 }}>
                  <div style={{ opacity: 0.85, fontSize: 12, marginBottom: 6 }}>Строение</div>
                  <select
                    value={(previewTier ?? "") as any}
                    onChange={(e) => {
                      const next = (e.target.value || "") as any;
                      setPreviewTier((next || null) as any);
                      movePlayer(playerCardId, next as any);
                    }}
                    style={{
                      width: "100%",
                      padding: "10px 12px",
                      borderRadius: 10,
                      border: "1px solid rgba(255,255,255,0.18)",
                      background: "rgba(255,255,255,0.05)",
                      color: "#f6efe3",
                    }}
                  >
                    <option value="">Без строения</option>
                    {TIERS.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                </div>

                <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                  <button
                    onClick={applyPlayerCardChanges}
                    style={{
                      appearance: "none",
                      border: "1px solid #2bb673",
                      background: "#2bb673",
                      color: "#0b1220",
                      fontWeight: 900,
                      borderRadius: 10,
                      padding: "10px 14px",
                      cursor: "pointer",
                    }}
                  >
                    Применить (локально)
                  </button>
                </div>

                <div style={{ opacity: 0.65, fontSize: 12, marginTop: 12 }}>
                  Изменения применяются к локальному состоянию. Чтобы записать в БД — нажмите «Сохранить» в окне «Назначения».
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
