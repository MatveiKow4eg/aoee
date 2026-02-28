"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as PIXI from "pixi.js";
import { Viewport } from "pixi-viewport";
import { debounce, loadMapState, saveMapState } from "../../lib/mapStateStore";

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

type PlayerRec = { name?: string; tier?: TierKey | ""; title?: string; desc?: string; avatar?: string };

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
const MAP_URL = "/map/map_aoe.png";

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

const uid = (): string => {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `id_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
};

const avatarUrlFor = (name?: string): string => {
  const n = (name ?? "").trim();
  if (!n) return "";
  // Placeholder: no avatar source configured
  return "";
};

// ========== Component ==========

export default function AdminMapPage() {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const appRef = useRef<PIXI.Application | null>(null);
  const viewportRef = useRef<Viewport | null>(null);

  const payloadRef = useRef<MapStatePayloadV1 | null>(null);

  const [metaVersion, setMetaVersion] = useState(0);
  const [isLoading, setIsLoading] = useState(true);

  const tierDisplayName = useCallback(
    (tier: TierKey) => {
      const custom = payloadRef.current?.meta?.tierNames?.[tier];
      const v = typeof custom === "string" ? custom.trim() : "";
      return v || tier;
    },
    // meta is stored in a ref; bumping metaVersion forces React to re-render and re-read it
    [metaVersion]
  );

  // Resolve player's tier to canonical TierKey, accepting both canonical keys and custom display names from meta
  const normalizeTierKey = useCallback((p?: PlayerRec | null): TierKey | "" => {
    const raw = (p?.tier ?? "").toString().trim();
    if (!raw) return "";
    // Direct hit by canonical key
    if ((TIERS as readonly string[]).includes(raw)) return raw as TierKey;

    // Case-insensitive match against canonical keys and custom display names
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
  }, [metaVersion]);

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
  const [renamePlayerId, setRenamePlayerId] = useState<string | null>(null);
  const [renamePlayerValue, setRenamePlayerValue] = useState("");
  const [editBioPlayerId, setEditBioPlayerId] = useState<string | null>(null);
  const [editTitleValue, setEditTitleValue] = useState("");
  const [editDescValue, setEditDescValue] = useState("");
  const [stagedPlayers, setStagedPlayers] = useState<Record<string, PlayerRec> | null>(null);
  const [isSavingAssignments, setIsSavingAssignments] = useState(false);
  const [selectedPlayerId, setSelectedPlayerId] = useState<string | null>(null);
  const [previewTier, setPreviewTier] = useState<TierKey | null>(null);
  const [previewAvatar, setPreviewAvatar] = useState<string | null>(null);
  const previewTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const previewOpenedRef = useRef(false);
  const [isRosterOpen, setIsRosterOpen] = useState(false);
  const [canEditTierName, setCanEditTierName] = useState(false);

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

    // When Drag mode is turned OFF, clear selected building highlight
    if (!dragBuildings) {
      setSelectedBuilding(null);
      // Force immediate visual update so no selection highlight remains
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

    // Re-apply selection highlight immediately when selection changes
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
      "Внимание! Reset перезапишет карту и очистит локальные изменения. Игроки не удаляются, но действие необратимо. Продолжить?"
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
    setSelectedPlayerId(null);
    setRenamePlayerId(null);
    setRenamePlayerValue("");
    setEditBioPlayerId(null);
    setEditTitleValue("");
    setEditDescValue("");

    // seed staged players
    setStagedPlayers({ ...((payloadRef.current?.players ?? {}) as any) });

    // seed tier rename input
    const cur = payloadRef.current?.meta?.tierNames?.[tier];
    setTierRename(typeof cur === "string" && cur.trim() ? cur : tier);
  }, []);

  const openGlobalAssignments = useCallback(() => {
    const fallbackTier = TIERS[0];
    if (!fallbackTier) return;
    openAssignModalFor(fallbackTier);
  }, [openAssignModalFor]);

  const closeAssignModal = useCallback(() => {
    setIsAssignModalOpen(false);
    setStagedPlayers(null);
    setSelectedPlayerId(null);
    setRenamePlayerId(null);
    setRenamePlayerValue("");
    setEditBioPlayerId(null);
    setEditTitleValue("");
    setEditDescValue("");
    previewOpenedRef.current = false;
    setPreviewTier(null);
    if (previewTimerRef.current) {
      clearTimeout(previewTimerRef.current);
      previewTimerRef.current = null;
    }
  }, []);

  const openBuildingCard = useCallback((tier: TierKey) => {
    setCardTier(tier);
    setIsBuildingCardOpen(true);
  }, []);

  const closeBuildingCard = useCallback(() => {
    setIsBuildingCardOpen(false);
    setCardTier(null);
  }, []);

  const exportPlayers = useCallback(() => {
    try {
      const players = (payloadRef.current?.players ?? {}) as Record<string, PlayerRec>;
      const data = JSON.stringify(players, null, 2);
      const blob = new Blob([data], { type: "application/json" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      const ts = new Date().toISOString().replace(/[:]/g, "-").replace(/\..+$/, "");
      a.download = `players-backup-${ts}.json`;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
      document.body.removeChild(a);
    } catch (e) {
      alert("Export failed: " + (e as any)?.message);
    }
  }, []);

  const importPlayers = useCallback(async () => {
    const input = prompt("Вставьте JSON объекта players { id: { name, tier, ... }, ... }");
    if (!input) return;
    try {
      const obj = JSON.parse(input);
      if (!obj || typeof obj !== "object" || Array.isArray(obj)) {
        alert("Ожидается объект {id: {...}} (не массив)");
        return;
      }
      const pl = payloadRef.current;
      if (!pl) return;
      const next = { ...pl, players: obj } as any;
      payloadRef.current = next;
      await saveMapState(next);
      setMetaVersion((v) => v + 1);
      alert("Игроки импортированы и сохранены в БД");
    } catch (e) {
      alert("Импорт не удался: " + (e as any)?.message);
    }
  }, []);

  const effectivePlayers = stagedPlayers ?? ((payloadRef.current?.players ?? {}) as Record<string, PlayerRec>);

  const playersInSelected = useMemo(() => {
    const tier = selectedBuilding;
    if (!tier) return [] as Array<{ id: string; name: string }>;

    const res = Object.entries(effectivePlayers)
      .filter(([, p]) => normalizeTier(p) === tier)
      .map(([id, p]) => ({ id, name: normalizeName(id, p) }));

    res.sort((a, b) => (a.name || "").localeCompare(b.name || "", "ru"));
    return res;
  }, [selectedBuilding, effectivePlayers]);

  const allPlayers = useMemo(() => {
    const res = Object.entries(effectivePlayers).map(([id, p]) => ({
      id,
      name: normalizeName(id, p),
      tier: normalizeTier(p),
      title: (p?.title ?? "").toString().trim(),
    }));

    // Custom order
    const TITLE_ORDER = ["Король", "Герцог", "Граф", "Барон"] as const;
    const TIER_ORDER: TierKey[] = [
      "Крепости",
      "Донжоны",
      "Башня",
      "Халупа",
      // variants fall under their base by prefix match below
    ];

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
      // 1) By title order
      const ta = titleRank(a.title);
      const tb = titleRank(b.title);
      if (ta !== tb) return ta - tb;

      // 2) If no prioritized title, sort by tier group order
      const ga = tierRank(a.tier);
      const gb = tierRank(b.tier);
      if (ga !== gb) return ga - gb;

      // 3) Within same group, original tier variants come before (base before v2/v3...)
      if (a.tier && b.tier) {
        const ba = baseTierKey(a.tier);
        const bb = baseTierKey(b.tier);
        if (ba === bb) return (a.tier || "").localeCompare(b.tier || "", "ru");
      }

      // 4) Finally by name
      return (a.name || "").localeCompare(b.name || "", "ru");
    });

    return res;
  }, [effectivePlayers]);

  const rosterPlayers = useMemo(() => {
    const src = (isAssignModalOpen ? stagedPlayers : payloadRef.current?.players) ?? {};
    const res = Object.entries(src).map(([id, p]) => ({
      id,
      name: normalizeName(id, p),
      tier: normalizeTier(p),
      title: (p?.title ?? "").toString().trim(),
    }));

    // Custom priority order:
    // 1) Король Кирилл
    // 2) Герцог
    // 3) Граф
    // 4) Барон
    // 5) Крепости
    // 6) Донжоны
    // 7) Башни
    // 8) Халупа
    const isKingKirill = (p: { name: string; title: string }) => p.title === "Король" && p.name.toLocaleLowerCase("ru") === "кирилл";

    const TITLE_ORDER = ["Король", "Герцог", "Граф", "Барон"] as const;
    const titleRank = (t?: string) => {
      const idx = TITLE_ORDER.indexOf((t ?? "") as any);
      return idx === -1 ? Number.POSITIVE_INFINITY : idx;
    };

    const tierGroup = (t: TierKey | ""): string => {
      if (!t) return "";
      if (t.startsWith("Крепости")) return "Крепости";
      if (t.startsWith("Донжоны")) return "Донжоны";
      if (t.startsWith("Башня")) return "Башни";
      if (t.startsWith("Халупа")) return "Халупа";
      return t;
    };

    const GROUP_ORDER = ["Крепости", "Донжоны", "Башни", "Халупа"] as const;
    const groupRank = (t: TierKey | "") => {
      const g = tierGroup(t);
      const idx = (GROUP_ORDER as readonly string[]).indexOf(g);
      return idx === -1 ? Number.POSITIVE_INFINITY : idx;
    };

    res.sort((a, b) => {
      // абсолютный топ
      const ak = isKingKirill(a);
      const bk = isKingKirill(b);
      if (ak !== bk) return ak ? -1 : 1;

      // 2-4) титулы
      const ta = titleRank(a.title);
      const tb = titleRank(b.title);
      if (ta !== tb) return ta - tb;

      // 5-8) группы с��роений
      const ga = groupRank(a.tier);
      const gb = groupRank(b.tier);
      if (ga !== gb) return ga - gb;

      // внутри группы: базовая/варианты и затем имя
      if (a.tier && b.tier) {
        const ag = tierGroup(a.tier);
        const bg = tierGroup(b.tier);
        if (ag === bg) {
          const tierCmp = (a.tier || "").localeCompare(b.tier || "", "ru");
          if (tierCmp !== 0) return tierCmp;
        }
      }

      return (a.name || "").localeCompare(b.name || "", "ru");
    });

    return res;
  }, [isAssignModalOpen, stagedPlayers, isRosterOpen]);

  
  const movePlayer = useCallback((playerId: string, tier: TierKey | "") => {
    setStagedPlayers((cur) => {
      const base = cur ?? ({ ...((payloadRef.current?.players ?? {}) as any) } as any);
      const prev = (base as any)[playerId];
      if (!prev) return base;
      return { ...base, [playerId]: { ...prev, tier } };
    });
    setIsDirty(true);
  }, []);

  const renamePlayer = useCallback((playerId: string, nextName: string) => {
    const name = nextName.trim();
    if (!name) return;

    setStagedPlayers((cur) => {
      const base = cur ?? ({ ...((payloadRef.current?.players ?? {}) as any) } as any);
      const prev = (base as any)[playerId];
      if (!prev) return base;
      return { ...base, [playerId]: { ...prev, name } };
    });

    setIsDirty(true);
  }, []);

  const updatePlayerBio = useCallback((playerId: string, nextTitle: string, nextDesc: string) => {
    setStagedPlayers((cur) => {
      const base = cur ?? ({ ...((payloadRef.current?.players ?? {}) as any) } as any);
      const prev = (base as any)[playerId];
      if (!prev) return base;
      return { ...base, [playerId]: { ...prev, title: nextTitle, desc: nextDesc } };
    });

    setIsDirty(true);
  }, []);

  // НЕ удаляем игрока из БД полностью — только снимаем со строения
  const unassignPlayer = useCallback(
    (playerId: string) => {
      movePlayer(playerId, "");
    },
    [movePlayer]
  );

  const saveAssignments = useCallback(async () => {
    const pl = payloadRef.current;
    if (!pl) return;

    // Confirm save
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

      // If bio editor is open, apply current input values automatically on Save.
      const basePlayers: Record<string, PlayerRec> = (stagedPlayers ?? (pl.players ?? {})) as any;
      const nextPlayers: Record<string, PlayerRec> = Object.fromEntries(
        Object.entries(basePlayers).map(([id, p]) => {
          const cloned = { ...(p as any) } as PlayerRec;
          if (editBioPlayerId && id === editBioPlayerId) {
            cloned.title = editTitleValue;
            cloned.desc = editDescValue;
          }
          return [id, cloned];
        })
      ) as any;

      // Safety: detect suspicious player shrink (>20%)
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
      // Save with a timeout guard to avoid indefinite spinner if network stalls
      try {
        await Promise.race([
          saveMapState(next as any),
          new Promise((_, rej) => setTimeout(() => rej(new Error("save-timeout")), 10000)),
        ]);
      } catch (e) {
        console.warn("[Admin] save error/timeout", e);
      }
      // Background refresh (non-blocking) to reconcile from DB when ready
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
    } finally {
      setIsSavingAssignments(false);
    }
  }, [stagedPlayers, tierRename, editBioPlayerId, editTitleValue, editDescValue]);

  useEffect(() => {
    const hostEl = hostRef.current;
    if (!hostEl) return;

    setIsLoading(true);

    const app = new PIXI.Application();
    appRef.current = app;

    let destroyed = false;

    (async () => {
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

      const mapTexture = await PIXI.Assets.load(MAP_URL);
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
        const remote = await loadMapState();
        if (destroyed) return;

        if (remote && (remote as any).buildings) {
          // IMPORTANT: loadMapState() returns the actual payload (not the wrapper doc)
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
            players: (remotePayload.players ?? {}) as any,
            meta: (remotePayload.meta ?? {}) as any,
          };
          payloadRef.current = payload;
          setIsDirty(false);
          setMetaVersion((v) => v + 1);

          // Do NOT rewrite the doc here. The admin UI can save explicitly.
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

      // Sprite factory
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
        const hoverTint = 0xfff1c8; // warm slight highlight

        sprite.alpha = normalAlpha;
        sprite.tint = normalTint;

        const applyHover = (next: boolean) => {
          isHovered = next;
          const isSelected = dragBuildingsRef.current && selectedBuildingRef.current === tier;
          const active = isHovered || isSelected;
          sprite.alpha = active ? hoverAlpha : normalAlpha;
          sprite.tint = active ? hoverTint : normalTint;
        };

        // Allow React to re-apply highlight when selectedBuilding changes
        (sprite as any).__applyHighlight = () => applyHover(isHovered);

        const onOver = () => applyHover(true);
        const onOut = () => applyHover(false);
        sprite.on("pointerover", onOver);
        sprite.on("pointerout", onOut);
        container.on("pointerover", onOver);
        container.on("pointerout", onOut);

        // Click:
        // - Drag OFF: open the building card (player info)
        // - Drag ON: select building for editing (keep sticky highlight)
        (sprite as any).on("pointertap", () => {
          if (!dragBuildingsRef.current) {
            openBuildingCard(tier);
            return;
          }

          setSelectedBuilding(tier);
          const currentScale = (payloadRef.current?.buildings[tier] as any)?.scale;
          setBuildingScale(typeof currentScale === "number" ? currentScale : 1);
          const currentRotation = (payloadRef.current?.buildings[tier] as any)?.rotation;
          setBuildingRotation(typeof currentRotation === "number" ? currentRotation : 0);
        });

        // Dragging (admin too)
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

      // Load textures and add sprites
      const CASTLE_V2_URL = "/buildings/castle/castle_v2.png?v=2";
      try {
        (PIXI.Assets as any).cache?.remove?.("/buildings/castle/castle_v1.png");
        (PIXI.Assets as any).cache?.remove?.("/buildings/castle/castle_v2.png");
        (PIXI.Assets as any).cache?.remove?.(CASTLE_V2_URL);
      } catch {}

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

      // Everything needed for displaying the map is loaded
      setIsLoading(false);

      const ro = new ResizeObserver(() => {
        if (destroyed) return;
        if (!hostEl.isConnected) return;
        viewport.resize(hostEl.clientWidth, hostEl.clientHeight);
        const nextFit = Math.min(viewport.screenWidth / mapW, viewport.screenHeight / mapH);
        viewport.clampZoom({ minScale: nextFit, maxScale: 2.2 });
        if (viewport.scale.x < nextFit) viewport.setZoom(nextFit, true);
      });
      ro.observe(hostEl);

      return () => ro.disconnect();
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
  }, [center, openAssignModalFor, scheduleAutosave]);

  // ESC closes modal / preview
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      previewOpenedRef.current = false;
      setPreviewTier(null);
      setPreviewAvatar(null);
      setIsAssignModalOpen(false);
      if (previewTimerRef.current) {
        clearTimeout(previewTimerRef.current);
        previewTimerRef.current = null;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div style={{ height: "100dvh", display: "flex", flexDirection: "column" }}>
      {/* Loader overlay */}
      {isLoading && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "#0b1220",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 5000,
          }}
          aria-busy="true"
          aria-live="polite"
        >
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 16 }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/loader/load.png"
              alt="loading"
              style={{
                width: 220,
                height: "auto",
                display: "block",
                filter: "drop-shadow(0 10px 26px rgba(0,0,0,0.55))",
              }}
            />

            <div
              style={{
                width: 54,
                height: 54,
                borderRadius: "50%",
                border: "6px solid rgba(247,240,223,0.22)",
                borderTopColor: "rgba(202,162,77,0.95)",
                animation: "aoeSpin 0.9s linear infinite",
              }}
            />
          </div>
        </div>
      )}

      {/* Global keyframes once */}
      <style jsx global>{`
        @keyframes aoeSpin {
          from {
            transform: rotate(0deg);
          }
          to {
            transform: rotate(360deg);
          }
        }
      `}</style>

      <div ref={hostRef} className="aoe-canvasHost" />

      {/* Roster button (bottom-right) */}
      <button
        onClick={() => setIsRosterOpen(true)}
        style={{
          position: "fixed",
          right: 16,
          bottom: 88,
          zIndex: 1200,
          padding: "10px 14px",
          borderRadius: 12,
          border: "2px solid #caa24d",
          background: "rgba(43,26,18,0.92)",
          color: "#f7f0df",
          fontWeight: 900,
          cursor: "pointer",
          boxShadow: "0 6px 18px rgba(0,0,0,0.35)",
        }}
        title="Показать список игроков"
      >
        Roster
      </button>

      {/* Floating admin panel */}
      <button
        onClick={() => {
          const panel = document.querySelector("#aoe-admin-panel");
          if (!panel) return;
          const open = panel.getAttribute("data-open") === "true";
          panel.setAttribute("data-open", (!open).toString());
        }}
        style={{
          position: "fixed",
          right: 16,
          bottom: 16,
          zIndex: 1000,
          width: 56,
          height: 56,
          borderRadius: 28,
          border: "2px solid #caa24d",
          background: "#2b1a12",
          color: "#f7f0df",
          fontWeight: 800,
          cursor: "pointer",
          boxShadow: "0 4px 16px rgba(0,0,0,0.35)",
        }}
        title="Admin панель"
      >
        ⚙
      </button>

      <div
        id="aoe-admin-panel"
        data-open="false"
        style={{
          position: "fixed",
          right: 16,
          bottom: 84,
          zIndex: 999,
          width: 520,
          maxWidth: "calc(100vw - 32px)",
          background: "rgba(11,18,32,0.96)",
          border: "1px solid #3a2a1a",
          borderRadius: 12,
          padding: 12,
          display: "flex",
          flexDirection: "column",
          gap: 8,
          transform: "translateY(8px)",
          opacity: 0,
          pointerEvents: "none",
          transition: "opacity 120ms ease, transform 120ms ease",
          color: "#f7f0df",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ fontSize: 16, fontWeight: 800 }}>AOE Estonia — Admin</div>
          <button
            onClick={exportPlayers}
            style={{
              padding: "4px 8px",
              borderRadius: 8,
              border: "1px solid #3a2a1a",
              background: "#2b1a12",
              color: "#f7f0df",
              cursor: "pointer",
              fontWeight: 700,
              fontSize: 12,
            }}
            title="Экспорт players в JSON"
          >
            Export players
          </button>
          <button
            onClick={importPlayers}
            style={{
              padding: "4px 8px",
              borderRadius: 8,
              border: "1px solid #3a2a1a",
              background: "#2b1a12",
              color: "#f7f0df",
              cursor: "pointer",
              fontWeight: 700,
              fontSize: 12,
            }}
            title="Импорт players из JSON и запись в БД"
          >
            Import players
          </button>
          <div style={{ flex: 1 }} />
          <a href="/" style={{ color: "#caa24d", textDecoration: "none", fontWeight: 800 }}>
            На карту
          </a>
        </div>

        <button
          onClick={() => setDragBuildings((v) => !v)}
          style={{
            padding: "6px 10px",
            borderRadius: 8,
            border: "1px solid #3a2a1a",
            background: "#2b1a12",
            color: "#f7f0df",
            cursor: "pointer",
          }}
          title="Перетаскивание зданий"
        >
          {dragBuildings ? "Drag building: ON" : "Drag building: OFF"}
        </button>

        {selectedBuilding && (
          <>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <div style={{ fontWeight: 800, flex: 1 }}>{tierDisplayName(selectedBuilding)}</div>
              <button
                onClick={() => {
                  if (!selectedBuilding) return;
                  setCanEditTierName(true);
                  openAssignModalFor(selectedBuilding);
                }}
                style={{
                  padding: "6px 10px",
                  borderRadius: 8,
                  border: "1px solid #caa24d",
                  background: "#2b1a12",
                  color: "#f7f0df",
                  cursor: "pointer",
                  fontWeight: 800,
                }}
              >
                Назначения
              </button>
            </div>

            {/* Size/Rot controls */}
            <>
              <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span>Size</span>
                <input
                  type="range"
                  min={0.1}
                  max={4}
                  step={0.05}
                  value={buildingScale}
                  onChange={(e) => setBuildingScale(Number(e.target.value))}
                  style={{ width: 220 }}
                />
                <span style={{ width: 60, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                  {buildingScale.toFixed(2)}
                </span>
              </label>

              <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span>Rot</span>
                <input
                  type="range"
                  min={-3.1416}
                  max={3.1416}
                  step={0.01}
                  value={buildingRotation}
                  onChange={(e) => setBuildingRotation(Number(e.target.value))}
                  style={{ width: 220 }}
                />
                <span style={{ width: 60, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                  {buildingRotation.toFixed(2)}
                </span>
              </label>
            </>
          </>
        )}

        <div style={{ display: "flex", gap: 8 }}>
          <button
            onClick={center}
            style={{
              padding: "6px 10px",
              borderRadius: 8,
              border: "1px solid #3a2a1a",
              background: "#2b1a12",
              color: "#f7f0df",
              cursor: "pointer",
            }}
          >
            Center
          </button>
          <button
            onClick={save}
            style={{
              padding: "6px 10px",
              borderRadius: 8,
              border: "1px solid #3a2a1a",
              background: "#2b1a12",
              color: "#f7f0df",
              cursor: "pointer",
            }}
            title="Сохранить карту в Firebase"
          >
            Save{isDirty ? "*" : ""}
          </button>
          <button
            onClick={reset}
            style={{
              padding: "6px 10px",
              borderRadius: 8,
              border: "1px solid #3a2a1a",
              background: "#2b1a12",
              color: "#f7f0df",
              cursor: "pointer",
            }}
            title="Сбросить и пересохранить в Firebase"
          >
            Reset
          </button>
        </div>
      </div>

      {/* Building card modal */}
      {isBuildingCardOpen && cardTier && (
        <div
          onClick={closeBuildingCard}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.35)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 3400,
            padding: 16,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: "min(760px, calc(100vw - 32px))",
              background: "#0b1220",
              color: "#f7f0df",
              border: "1px solid #3a2a1a",
              borderRadius: 12,
              boxShadow: "0 12px 48px rgba(0,0,0,0.45)",
              padding: 14,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
              <div
                style={{
                  fontWeight: 900,
                  fontSize: 16,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
                title={tierDisplayName(cardTier)}
              >
                {tierDisplayName(cardTier)}
              </div>
              <div style={{ flex: 1 }} />
              <button
                onClick={closeBuildingCard}
                style={{ background: "transparent", border: 0, color: "#f7f0df", cursor: "pointer", fontSize: 18 }}
              >
                ×
              </button>
            </div>

            {(() => {
              const players = (payloadRef.current?.players ?? {}) as Record<string, PlayerRec>;
              const inBuilding = Object.entries(players)
                .filter(([, p]) => normalizeTier(p) === cardTier)
                .map(([id, p]) => ({ id, name: normalizeName(id, p), title: p?.title, desc: p?.desc, avatar: (p as any)?.avatar }));

              if (inBuilding.length === 0) {
                return <div style={{ opacity: 0.85 }}>Никого нет в этом строении</div>;
              }

              const p = inBuilding[0];
              const avatar = avatarByPlayerId(p.id, p as any);

              return (
                <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
                  {avatar ? (
                    <div
                      role="button"
                      tabIndex={0}
                      onClick={() => setPreviewAvatar(avatar)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          setPreviewAvatar(avatar);
                        }
                      }}
                      title="Открыть аватар на весь экран"
                      style={{
                        flex: "0 0 auto",
                        border: "2px solid rgba(202,162,77,0.9)",
                        borderRadius: 28,
                        boxShadow: "0 10px 30px rgba(0,0,0,0.45)",
                        overflow: "hidden",
                      }}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={avatar}
                        alt="avatar"
                        style={{
                          width: "min(240px, 42vw)",
                          height: "min(240px, 42vw)",
                          objectFit: "cover",
                          display: "block",
                        }}
                      />
                    </div>
                  ) : (
                    <div
                      style={{
                        width: "min(240px, 42vw)",
                        height: "min(240px, 42vw)",
                        borderRadius: 28,
                        background: "rgba(255,255,255,0.06)",
                        border: "2px solid rgba(255,255,255,0.14)",
                        boxShadow: "0 10px 30px rgba(0,0,0,0.35)",
                      }}
                    />
                  )}

                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div
                      style={{
                        fontWeight: 900,
                        fontSize: 16,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                      title={p.title ? `${p.name} — ${p.title}` : p.name}
                    >
                      {p.title ? `${p.name} — ${p.title}` : p.name}
                    </div>
                    {/* Титул показываем рядом с ником; отдельной строкой не дублируем */}
                    {p.desc ? (
                      <div style={{ marginTop: 8, opacity: 0.9, lineHeight: 1.35, whiteSpace: "pre-wrap" }}>
                        {p.desc}
                      </div>
                    ) : (
                      <div style={{ marginTop: 8, opacity: 0.65 }}>(без описания)</div>
                    )}

                    {inBuilding.length > 1 && (
                      <div style={{ marginTop: 10, opacity: 0.7, fontSize: 12 }}>
                        В этом строении записано игроков: {inBuilding.length} (показан первый)
                      </div>
                    )}

                    <div style={{ marginTop: 12, display: "flex", justifyContent: "flex-end" }}>
                      <button
                        onClick={() => {
                          closeBuildingCard();
                          setCanEditTierName(true);
                          openAssignModalFor(cardTier);
                        }}
                        style={{
                          padding: "8px 10px",
                          borderRadius: 10,
                          border: "1px solid #caa24d",
                          background: "#2b1a12",
                          color: "#f7f0df",
                          cursor: "pointer",
                          fontWeight: 900,
                        }}
                        title="Открыть назначения для этого строения"
                      >
                        Открыть назначения
                      </button>
                    </div>
                  </div>
                </div>
              );
            })()}
          </div>
        </div>
      )}

      {/* Roster modal */}
      {isRosterOpen && (
        <div
          onClick={() => setIsRosterOpen(false)}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.55)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 3500,
            padding: 16,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: "min(980px, calc(100vw - 32px))",
              maxHeight: "90vh",
              overflowY: "auto",
              overflowX: "hidden",
              background: "#0b1220",
              color: "#f7f0df",
              border: "1px solid #3a2a1a",
              borderRadius: 12,
              boxShadow: "0 12px 48px rgba(0,0,0,0.45)",
              padding: 14,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
              <div style={{ fontWeight: 900, fontSize: 16 }}>Список игроков</div>
              <div style={{ opacity: 0.8, fontSize: 12 }}>({rosterPlayers.length})</div>
              <div style={{ flex: 1 }} />
              <button
                onClick={() => {
                  setCanEditTierName(false);
                  openGlobalAssignments();
                  setIsRosterOpen(false);
                }}
                style={{
                  padding: "8px 10px",
                  borderRadius: 10,
                  border: "1px solid #caa24d",
                  background: "#2b1a12",
                  color: "#f7f0df",
                  cursor: "pointer",
                  fontWeight: 900,
                }}
                title="Открыть окно назначений (все игроки)"
              >
                Назначения
              </button>
              <button
                onClick={() => setIsRosterOpen(false)}
                style={{ background: "transparent", border: 0, color: "#f7f0df", cursor: "pointer", fontSize: 18 }}
              >
                ×
              </button>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {rosterPlayers.map((p) => (
                <div
                  key={p.id}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "minmax(0,1fr) 56px minmax(0, 220px)",
                    gap: 12,
                    alignItems: "center",
                    padding: 10,
                    borderRadius: 12,
                    border: "1px solid #1f2a40",
                    background: "rgba(0,0,0,0.15)",
                  }}
                >
                  <div style={{ minWidth: 0 }}>
                    <div
                      style={{ fontWeight: 900, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                      title={p.title ? `${p.name} — ${p.title}` : p.name}
                    >
                      {p.title ? `${p.name} — ${p.title}` : p.name}
                    </div>
                    {/* id hidden */}
                  </div>

                  <div
                    style={{
                      width: 56,
                      height: 56,
                      borderRadius: 12,
                      border: "1px solid #3a2a1a",
                      background: "#1a2438",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      overflow: "hidden",
                    }}
                    title={p.tier || "(не назначен)"}
                  >
                    {p.tier ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={TIER_ICON_URL[p.tier]}
                        alt={p.tier}
                        style={{ width: "100%", height: "100%", objectFit: "contain", display: "block" }}
                      />
                    ) : (
                      <span style={{ fontWeight: 900, fontSize: 18, opacity: 0.85 }}>×</span>
                    )}
                  </div>

                  <div
                    style={{
                      opacity: 0.9,
                      fontWeight: 800,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                    title={p.tier ? tierDisplayName(p.tier) : "(не назначен)"}
                  >
                    {p.tier ? tierDisplayName(p.tier) : "(не назначен)"}
                  </div>
                </div>
              ))}
              {rosterPlayers.length === 0 && <div style={{ opacity: 0.8 }}>Список пуст</div>}
            </div>
          </div>
        </div>
      )}

      {/* Fullscreen tier preview (hold) */}
      {previewTier && (
        <div
          onPointerUp={() => {
            previewOpenedRef.current = false;
            setPreviewTier(null);
          }}
          onPointerCancel={() => {
            previewOpenedRef.current = false;
            setPreviewTier(null);
          }}
          onClick={() => {
            previewOpenedRef.current = false;
            setPreviewTier(null);
          }}
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 4000,
            background: "rgba(0,0,0,0.85)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 16,
          }}
        >
          <div style={{ position: "absolute", top: 12, left: 12, color: "#f7f0df", fontWeight: 800, fontSize: 14 }}>
            {previewTier}
          </div>
          <div style={{ position: "absolute", top: 12, right: 12, color: "#f7f0df", opacity: 0.85, fontSize: 12 }}>
            отпустите, чтобы закрыть
          </div>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={TIER_ICON_URL[previewTier]}
            alt={previewTier}
            style={{
              maxWidth: "96vw",
              maxHeight: "92dvh",
              width: "auto",
              height: "auto",
              objectFit: "contain",
              display: "block",
              filter: "drop-shadow(0 12px 40px rgba(0,0,0,0.55))",
            }}
          />
        </div>
      )}

      {/* Fullscreen avatar preview */}
      {previewAvatar && (
        <div
          onClick={() => setPreviewAvatar(null)}
          onPointerUp={() => setPreviewAvatar(null)}
          onPointerCancel={() => setPreviewAvatar(null)}
          style={{
          position: "fixed",
          inset: 0,
          zIndex: 4001,
          background: "rgba(0,0,0,0.85)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 16,
          }}
          >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
          src={previewAvatar}
          alt="avatar"
          style={{
          maxWidth: "96vw",
          maxHeight: "92dvh",
          width: "auto",
          height: "auto",
          objectFit: "contain",
          display: "block",
          filter: "drop-shadow(0 12px 40px rgba(0,0,0,0.55))",
          }}
          />
          </div>
          )}

      {/* Assignment modal */}
      {isAssignModalOpen && selectedBuilding && (
        <div
          onClick={closeAssignModal}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.5)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 2000,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: "min(1280px, calc(100vw - 32px))",
              maxWidth: "calc(100vw - 32px)",
              maxHeight: "90vh",
              overflowY: "auto",
              overflowX: "hidden",
              background: "#0b1220",
              color: "#f7f0df",
              border: "1px solid #3a2a1a",
              borderRadius: 12,
              boxShadow: "0 12px 48px rgba(0,0,0,0.45)",
              padding: 16,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
              <div style={{ fontWeight: 800, fontSize: 16 }}>Назначения: {tierDisplayName(selectedBuilding)}</div>
              <div style={{ flex: 1 }} />
              <button
                onClick={saveAssignments}
                disabled={isSavingAssignments}
                style={{
                  padding: "6px 10px",
                  borderRadius: 8,
                  border: "1px solid #caa24d",
                  background: "#2b1a12",
                  color: "#f7f0df",
                  cursor: "pointer",
                  fontWeight: 800,
                }}
                title="Сохранить изменения в БД"
              >
                {isSavingAssignments ? "Saving..." : "Сохранить"}
              </button>
              <button
                onClick={closeAssignModal}
                style={{ background: "transparent", border: 0, color: "#f7f0df", cursor: "pointer", fontSize: 18 }}
              >
                ×
              </button>
            </div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "minmax(0, 1fr)",
                gap: 14,
                alignItems: "start",
              }}
            >
              {canEditTierName && selectedBuilding && (
                <div
                  style={{
                    border: "1px solid #23304a",
                    borderRadius: 12,
                    padding: 12,
                    background: "rgba(26,36,56,0.25)",
                  }}
                >
                  <div style={{ fontWeight: 900, marginBottom: 6 }}>Название строения</div>
                  <input
                    value={tierRename}
                    onChange={(e) => {
                      setTierRename(e.target.value);
                      setIsDirty(true);
                    }}
                    placeholder="Название строения"
                    style={{
                      width: "100%",
                      padding: 8,
                      borderRadius: 8,
                      border: "1px solid #3a2a1a",
                      background: "#1a2438",
                      color: "#f7f0df",
                    }}
                  />
                  <div style={{ marginTop: 10, opacity: 0.8, fontSize: 12, lineHeight: 1.35 }}>
                    Название строения сохраняется в БД после кнопки <b>Сохранить</b>.
                  </div>
                </div>
              )}

              {/* Lists */}
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                <div
                  style={{
                    border: "1px solid #23304a",
                    borderRadius: 12,
                    padding: 12,
                    background: "rgba(26,36,56,0.25)",
                  }}
                >
                  <div style={{ display: "flex", gap: 10, alignItems: "baseline", marginBottom: 8 }}>
                    <div style={{ fontWeight: 800 }}>Игроки в строении</div>
                    <div style={{ opacity: 0.8, fontSize: 12 }}>({playersInSelected.length})</div>
                  </div>

                  {playersInSelected.length === 0 ? (
                    <div style={{ opacity: 0.8 }}>Никого нет</div>
                  ) : (
                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                      {playersInSelected.map((p) => (
                        <div
                          key={p.id}
                          style={{
                            display: "flex",
                            gap: 10,
                            alignItems: "center",
                            padding: 10,
                            borderRadius: 10,
                            border: "1px solid #1f2a40",
                            background: "rgba(0,0,0,0.15)",
                          }}
                        >
                          {/* avatar + name + building icon */}
                          <div style={{ display: "flex", alignItems: "center", gap: 8, flex: 1, minWidth: 0 }}>
                            {/* avatar */}
                            {(() => {
                              const rec = (effectivePlayers as any)[p.id] as any;
                              const av = avatarByPlayerId(p.id, rec);
                              return av ? (
                                <div
                                  role="button"
                                  tabIndex={0}
                                  onClick={() => setPreviewAvatar(av)}
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter" || e.key === " ") {
                                      e.preventDefault();
                                      setPreviewAvatar(av);
                                    }
                                  }}
                                  style={{ width: 28, height: 28, borderRadius: 8, overflow: "hidden", flex: "0 0 auto", cursor: "pointer" }}
                                  title="Открыть аватар на весь экран"
                                >
                                  {/* eslint-disable-next-line @next/next/no-img-element */}
                                  <img src={av} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
                                </div>
                              ) : (
                                <div style={{ width: 28, height: 28, borderRadius: 8, background: "rgba(255,255,255,0.08)", flex: "0 0 auto" }} />
                              );
                            })()}
                            <div
                              style={{
                                fontWeight: 800,
                                minWidth: 0,
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                                whiteSpace: "nowrap",
                              }}
                              title={p.name}
                            >
                              {p.name}
                            </div>
                            <div style={{ flex: 1 }} />
                            {/* building icon (current list is for selected building) */}
                            <button
                              onClick={() => setPreviewTier(selectedBuilding!)}
                              style={{
                                width: 24,
                                height: 24,
                                padding: 0,
                                margin: 0,
                                border: "1px solid rgba(255,255,255,0.12)",
                                borderRadius: 6,
                                background: "rgba(0,0,0,0.15)",
                                cursor: "pointer",
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                              }}
                              title="Открыть иконку строения на весь экран"
                            >
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img
                                src={TIER_ICON_URL[selectedBuilding!]}
                                alt={selectedBuilding!}
                                style={{ width: 20, height: 20, objectFit: "contain", opacity: 0.95, display: "block" }}
                              />
                            </button>
                          </div>
                          <button
                            onClick={() => unassignPlayer(p.id)}
                            style={{
                              padding: "6px 10px",
                              borderRadius: 8,
                              border: "1px solid #7a2a2a",
                              background: "rgba(122,42,42,0.25)",
                              color: "#f7f0df",
                              cursor: "pointer",
                              fontWeight: 800,
                            }}
                            title="Убрать игрока из этого строения (не удаляя из БД)"
                          >
                            Убрать
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div
                  style={{
                    border: "1px solid #23304a",
                    borderRadius: 12,
                    padding: 12,
                    background: "rgba(26,36,56,0.25)",
                  }}
                >
                  <div style={{ display: "flex", gap: 10, alignItems: "baseline", marginBottom: 8 }}>
                    <div style={{ fontWeight: 800 }}>Все игроки</div>
                    <div style={{ opacity: 0.8, fontSize: 12 }}>({allPlayers.length})</div>
                  </div>

                  {allPlayers.length === 0 ? (
                    <div style={{ opacity: 0.8 }}>Список пуст</div>
                  ) : (
                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: "minmax(320px, 1fr) minmax(320px, 520px)",
                        gap: 12,
                        alignItems: "start",
                      }}
                    >
                      {/* player picker */}
                      <div
                        style={{
                          display: "flex",
                          flexDirection: "column",
                          gap: 8,
                          maxHeight: 420,
                          overflowY: "auto",
                          overflowX: "hidden",
                        }}
                      >
                        {allPlayers.map((p) => {
                          const active = selectedPlayerId === p.id;
                          const isRenaming = renamePlayerId === p.id;
                          return (
                            <div key={p.id} style={{ display: "flex", gap: 8, alignItems: "stretch" }}>
                              <button
                                onClick={() => setSelectedPlayerId(p.id)}
                                style={{
                                  textAlign: "left",
                                  width: "100%",
                                  display: "flex",
                                  gap: 10,
                                  alignItems: "center",
                                  padding: 10,
                                  borderRadius: 10,
                                  border: active ? "2px solid #caa24d" : "1px solid #1f2a40",
                                  background: active ? "rgba(202,162,77,0.12)" : "rgba(0,0,0,0.15)",
                                  color: "#f7f0df",
                                  cursor: "pointer",
                                }}
                                title="Выбрать игрока"
                              >
                                {/* avatar */}
                                {(() => {
                                  const rec = (effectivePlayers as any)[p.id] as any;
                                  const av = avatarByPlayerId(p.id, rec);
                                  return av ? (
                                    <div
                                      role="button"
                                      tabIndex={0}
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setPreviewAvatar(av);
                                      }}
                                      onKeyDown={(e) => {
                                        if (e.key === "Enter" || e.key === " ") {
                                          e.preventDefault();
                                          e.stopPropagation();
                                          setPreviewAvatar(av);
                                        }
                                      }}
                                      style={{ width: 28, height: 28, borderRadius: 8, overflow: "hidden", flex: "0 0 auto", cursor: "pointer" }}
                                      title="Открыть аватар на весь экран"
                                    >
                                      {/* eslint-disable-next-line @next/next/no-img-element */}
                                      <img src={av} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
                                    </div>
                                  ) : (
                                    <div style={{ width: 28, height: 28, borderRadius: 8, background: "rgba(255,255,255,0.08)", flex: "0 0 auto" }} />
                                  );
                                })()}
                                <span style={{ minWidth: 0, flex: 1 }}>
                                  <div style={{ fontWeight: 800, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={p.name}>
                                    {p.name}
                                  </div>
                                  <div style={{ opacity: 0.7, fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={p.id}>
                                    id: {p.id}
                                  </div>
                                </span>
                                {/* building icon */}
                                {p.tier ? (
                                  <div
                                    role="button"
                                    tabIndex={0}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      if (p.tier) setPreviewTier(p.tier);
                                    }}
                                    onKeyDown={(e) => {
                                      if (e.key === "Enter" || e.key === " ") {
                                        e.preventDefault();
                                        e.stopPropagation();
                                        if (p.tier) setPreviewTier(p.tier);
                                      }
                                    }}
                                    style={{
                                      width: 26,
                                      height: 26,
                                      padding: 0,
                                      margin: 0,
                                      border: "1px solid rgba(255,255,255,0.12)",
                                      borderRadius: 6,
                                      background: "rgba(0,0,0,0.15)",
                                      cursor: "pointer",
                                      display: "flex",
                                      alignItems: "center",
                                      justifyContent: "center",
                                      flex: "0 0 auto",
                                    }}
                                    title="Открыть иконку строения на весь экран"
                                  >
                                    {/* eslint-disable-next-line @next/next/no-img-element */}
                                    <img src={TIER_ICON_URL[p.tier]} alt={p.tier} style={{ width: 20, height: 20, objectFit: "contain", display: "block" }} />
                                  </div>
                                ) : (
                                  <div style={{ width: 24, height: 24, flex: "0 0 auto", opacity: 0.6, display: "flex", alignItems: "center", justifyContent: "center" }}>
                                    <span style={{ fontWeight: 900, fontSize: 14 }}>×</span>
                                  </div>
                                )}
                              </button>

                              {isRenaming ? (
                                <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                                  <input
                                    value={renamePlayerValue}
                                    onChange={(e) => setRenamePlayerValue(e.target.value)}
                                    style={{
                                      width: 180,
                                      padding: "0 10px",
                                      borderRadius: 10,
                                      border: "1px solid #3a2a1a",
                                      background: "#1a2438",
                                      color: "#f7f0df",
                                    }}
                                    placeholder="Новое имя"
                                  />
                                  <button
                                    onClick={() => {
                                      renamePlayer(p.id, renamePlayerValue);
                                      setRenamePlayerId(null);
                                      setRenamePlayerValue("");
                                    }}
                                    style={{
                                      width: 40,
                                      borderRadius: 10,
                                      border: "1px solid #caa24d",
                                      background: "#2b1a12",
                                      color: "#f7f0df",
                                      cursor: "pointer",
                                      fontWeight: 900,
                                    }}
                                    title="Сохранить имя"
                                  >
                                    ✓
                                  </button>
                                  <button
                                    onClick={() => {
                                      setRenamePlayerId(null);
                                      setRenamePlayerValue("");
                                    }}
                                    style={{
                                      width: 40,
                                      borderRadius: 10,
                                      border: "1px solid #3a2a1a",
                                      background: "rgba(0,0,0,0.1)",
                                      color: "#f7f0df",
                                      cursor: "pointer",
                                      fontWeight: 900,
                                    }}
                                    title="Отмена"
                                  >
                                    ×
                                  </button>
                                </div>
                              ) : editBioPlayerId === p.id ? (
                                <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                                  <button
                                    onClick={() => {
                                      // No explicit apply needed; bio is applied on main Save.
                                      setEditBioPlayerId(null);
                                      setEditTitleValue("");
                                      setEditDescValue("");
                                    }}
                                    style={{
                                      width: 40,
                                      borderRadius: 10,
                                      border: "1px solid #3a2a1a",
                                      background: "rgba(0,0,0,0.1)",
                                      color: "#f7f0df",
                                      cursor: "pointer",
                                      fontWeight: 900,
                                    }}
                                    title="Закрыть"
                                  >
                                    ×
                                  </button>
                                </div>
                              ) : (
                                <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                                  <button
                                    onClick={() => {
                                      setRenamePlayerId(p.id);
                                      setRenamePlayerValue(p.name);
                                    }}
                                    style={{
                                      width: 44,
                                      borderRadius: 10,
                                      border: "1px solid #3a2a1a",
                                      background: "rgba(26,36,56,0.45)",
                                      color: "#f7f0df",
                                      cursor: "pointer",
                                      fontWeight: 900,
                                    }}
                                    title="Пер��именовать игрока"
                                  >
                                    ✎
                                  </button>
                                                                  </div>
                              )}
                            </div>
                          );
                        })}
                      </div>

                      {/* building picker for selected player */}
                      <div
                        style={{
                          border: "1px solid #1f2a40",
                          borderRadius: 12,
                          padding: 10,
                          background: "rgba(0,0,0,0.15)",
                          minWidth: 0,
                        }}
                      >
                                                {!selectedPlayerId ? (
                          <div style={{ opacity: 0.85, lineHeight: 1.35 }}>
                            Сначала выберите игрока слева —
                            <br />
                            затем назначьте ему строение.
                          </div>
                        ) : (
                          (() => {
                            const p = allPlayers.find((x) => x.id === selectedPlayerId);
                            const currentTier = p?.tier ?? "";

                            return (
                              <>
                                <div
                                  style={{
                                    fontWeight: 800,
                                    marginBottom: 8,
                                    overflow: "hidden",
                                    textOverflow: "ellipsis",
                                    whiteSpace: "nowrap",
                                  }}
                                >
                                  Назначить: {p?.name ?? selectedPlayerId}
                                </div>

                                {/* Title and description editor for selected player */}
                                <div style={{
                                  marginBottom: 8,
                                  border: "1px solid #23304a",
                                  borderRadius: 12,
                                  padding: 10,
                                  background: "rgba(26,36,56,0.25)",
                                }}>
                                  <div style={{ fontWeight: 800, marginBottom: 6 }}>Титул</div>
                                  <select
                                    value={editBioPlayerId === selectedPlayerId ? editTitleValue : ((effectivePlayers as any)[selectedPlayerId!]?.title ?? "")}
                                    onChange={(e) => {
                                      const val = e.target.value;

                                      // If we start editing bio for this player, initialize edit buffers from current state
                                      if (editBioPlayerId !== selectedPlayerId) {
                                        const cur = (effectivePlayers as any)[selectedPlayerId!] ?? {};
                                        setEditTitleValue((cur?.title ?? "").toString());
                                        setEditDescValue((cur?.desc ?? "").toString());
                                      }

                                      setEditBioPlayerId(selectedPlayerId);
                                      setEditTitleValue(val);

                                      const curDesc =
                                        editBioPlayerId === selectedPlayerId
                                          ? editDescValue
                                          : (((effectivePlayers as any)[selectedPlayerId!]?.desc ?? "") as any);

                                      updatePlayerBio(selectedPlayerId!, val, String(curDesc));
                                    }}
                                    style={{ width: "100%", padding: 8, borderRadius: 8, border: "1px solid #3a2a1a", background: "#1a2438", color: "#f7f0df" }}
                                  >
                                    <option value="">(без титула)</option>
                                    <option value="Король">Король</option>
                                    <option value="Герцог">Герцог</option>
                                    <option value="Граф">Граф</option>
                                    <option value="Барон">Барон</option>
                                    <option value="Крестьянин">Крестьянин</option>
                                  </select>
                                  <div style={{ height: 10 }} />
                                  <div style={{ fontWeight: 800, marginBottom: 6 }}>Описание</div>
                                  <textarea
                                    value={editBioPlayerId === selectedPlayerId ? editDescValue : ((effectivePlayers as any)[selectedPlayerId!]?.desc ?? "")}
                                    onChange={(e) => {
                                      const val = e.target.value;

                                      // If we start editing bio for this player, initialize edit buffers from current state
                                      if (editBioPlayerId !== selectedPlayerId) {
                                        const cur = (effectivePlayers as any)[selectedPlayerId!] ?? {};
                                        setEditTitleValue((cur?.title ?? "").toString());
                                        setEditDescValue((cur?.desc ?? "").toString());
                                      }

                                      setEditBioPlayerId(selectedPlayerId);
                                      setEditDescValue(val);

                                      const curTitle =
                                        editBioPlayerId === selectedPlayerId
                                          ? editTitleValue
                                          : (((effectivePlayers as any)[selectedPlayerId!]?.title ?? "") as any);

                                      updatePlayerBio(selectedPlayerId!, String(curTitle), val);
                                    }}
                                    placeholder="Описание"
                                    rows={4}
                                    style={{ width: "100%", padding: 8, borderRadius: 8, border: "1px solid #3a2a1a", background: "#1a2438", color: "#f7f0df", resize: "vertical" }}
                                  />
                                  <div style={{ marginTop: 6, opacity: 0.7, fontSize: 12 }}>Будет сохранено с основной кнопкой «Сохранить».</div>
                                </div>

                                <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                                  <button
                                    onClick={() => movePlayer(selectedPlayerId, "")}
                                    style={{
                                      width: 56,
                                      height: 56,
                                      borderRadius: 12,
                                      border: currentTier === "" ? "2px solid #caa24d" : "1px solid #3a2a1a",
                                      background: currentTier === "" ? "rgba(202,162,77,0.18)" : "#1a2438",
                                      color: "#f7f0df",
                                      cursor: "pointer",
                                      fontWeight: 800,
                                      fontSize: 18,
                                    }}
                                    title="Не назначен"
                                  >
                                    ×
                                  </button>

                                  {TIERS.map((t) => {
                                    const active = currentTier === t;
                                    return (
                                      <button
                                        key={t}
                                        onClick={() => movePlayer(selectedPlayerId, t)}
                                        style={{
                                          width: 56,
                                          height: 56,
                                          borderRadius: 12,
                                          border: active ? "2px solid #caa24d" : "1px solid #3a2a1a",
                                          background: active ? "rgba(202,162,77,0.18)" : "#1a2438",
                                          padding: 4,
                                          overflow: "hidden",
                                          cursor: "pointer",
                                        }}
                                        title={t}
                                        onPointerDown={(e) => {
                                          // Open fullscreen preview only on LONG press
                                          e.preventDefault();
                                          previewOpenedRef.current = false;
                                          if (previewTimerRef.current) clearTimeout(previewTimerRef.current);
                                          previewTimerRef.current = setTimeout(() => {
                                            previewOpenedRef.current = true;
                                            setPreviewTier(t);
                                          }, 280);
                                        }}
                                        onPointerUp={() => {
                                          if (previewTimerRef.current) {
                                            clearTimeout(previewTimerRef.current);
                                            previewTimerRef.current = null;
                                          }
                                          // If preview was opened - do NOT close it here (overlay will close)
                                          if (!previewOpenedRef.current) setPreviewTier(null);
                                        }}
                                        onPointerLeave={() => {
                                          if (previewTimerRef.current) {
                                            clearTimeout(previewTimerRef.current);
                                            previewTimerRef.current = null;
                                          }
                                          if (!previewOpenedRef.current) setPreviewTier(null);
                                        }}
                                        onPointerCancel={() => {
                                          if (previewTimerRef.current) {
                                            clearTimeout(previewTimerRef.current);
                                            previewTimerRef.current = null;
                                          }
                                          if (!previewOpenedRef.current) setPreviewTier(null);
                                        }}
                                      >
                                        {/* eslint-disable-next-line @next/next/no-img-element */}
                                        <img
                                          src={TIER_ICON_URL[t]}
                                          alt={t}
                                          style={{ width: "100%", height: "100%", objectFit: "contain", display: "block" }}
                                        />
                                      </button>
                                    );
                                  })}
                                </div>

                                <div style={{ marginTop: 10 }}>
                                  <button
                                    onClick={() => unassignPlayer(selectedPlayerId)}
                                    style={{
                                      width: "100%",
                                      padding: "8px 10px",
                                      borderRadius: 10,
                                      border: "1px solid #7a2a2a",
                                      background: "rgba(122,42,42,0.25)",
                                      color: "#f7f0df",
                                      cursor: "pointer",
                                      fontWeight: 800,
                                    }}
                                    title="Снять назначение (не удаляя игро��а из БД)"
                                  >
                                    Убрать из строения
                                  </button>
                                </div>
                              </>
                            );
                          })()
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      <style>{`
        #aoe-admin-panel[data-open="true"] {
          opacity: 1 !important;
          transform: translateY(0) !important;
          pointer-events: auto !important;
        }
      `}</style>
    </div>
  );
}
