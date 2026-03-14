"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import PlayerHud from "./components/PlayerHud";
import PlayerStatsModal from "./components/PlayerStatsModal";
import { buildClaimedPlayerViewModel } from "../lib/map/claimedPlayerAdapter";
import { useRouter } from "next/navigation";
import * as PIXI from "pixi.js";
import { Viewport } from "pixi-viewport";
import { loadMapState } from "../store/mapStateStore";
import { logout, me, steamLinkUrl } from "../lib/api/auth";
import type { MeResponse } from "../lib/api/auth";

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

type Owner = { name: string; clan?: string; note?: string };

type PlayerRec = {
  name?: string;
  tier?: TierKey | "";
  title?: string;
  desc?: string;
  avatar?: string;

  /** Canonical map player reference to AoePlayer.aoeProfileId */
  aoeProfileId?: string;

  /** Enriched by backend via claim: used to enable challenges */
  userId?: string;

  /** @deprecated legacy */
  insightsUserId?: string;
};

// Normalize player's tier to canonical TierKey taking into account custom display names in meta
const normalizeTierKey = (p: PlayerRec | undefined | null, meta?: MapStatePayloadV1["meta"]): TierKey | "" => {
  const rawTier = (p?.tier ?? "").toString().trim();
  const rawLabel = (((p as any)?.tierLabel) ?? "").toString().trim();
  const raw = rawTier || rawLabel;
  if (!raw) return "";
  // direct match
  if ((TIERS as readonly string[]).includes(raw)) return raw as TierKey;
  const rawLC = raw.toLocaleLowerCase("ru");
  // case-insensitive against canonical keys
  for (const key of TIERS) {
    if (key.toLocaleLowerCase("ru") === rawLC) return key;
  }
  // check custom display names in meta.tierNames
  const names = meta?.tierNames ?? {};
  for (const key of TIERS) {
    const disp = (names as any)[key];
    if (typeof disp === "string" && disp.trim().toLocaleLowerCase("ru") === rawLC) return key;
  }
  return "";
};

// Loose matching by base group (ignores v2/v3 suffix and accepts common synonyms)
const stripVariant = (s: string) => s.replace(/\s+v\d+$/i, "").trim();
const toBaseKey = (s: string) => {
  const lc = stripVariant(s).toLocaleLowerCase("ru");
  // common synonyms mapping to canonical bases
  if (lc === "крепость") return "крепости";
  if (lc === "донжон") return "донжоны";
  if (lc === "башни") return "башня";
  return lc;
};
const matchesTier = (p: PlayerRec | undefined | null, tier: TierKey, meta?: MapStatePayloadV1["meta"]) => {
  const canon = normalizeTierKey(p, meta);
  if (canon) return toBaseKey(canon) === toBaseKey(tier);
  const raw = (p?.tier ?? "").toString();
  if (!raw) return false;
  return toBaseKey(raw) === toBaseKey(tier);
};

const avatarUrlFor = (name?: string): string => {
  const n = (name ?? "").trim();
  if (!n) return "";
  // Placeholder: no avatar source configured
  return "";
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
      owner?: Owner;
    }
  >;
  players?: Record<string, PlayerRec>;
  meta?: {
    tierNames?: Partial<Record<TierKey, string>>;
  };
};

// ========== Constants ==========

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

// ========== Component ==========

export default function Home() {
  const router = useRouter();

  const hostRef = useRef<HTMLDivElement | null>(null);
  const [hostReady, setHostReady] = useState(false);
  const appRef = useRef<PIXI.Application | null>(null);
  const viewportRef = useRef<Viewport | null>(null);
  const payloadRef = useRef<MapStatePayloadV1 | null>(null);

  const [isBuildingCardOpen, setIsBuildingCardOpen] = useState(false);
  const [cardTier, setCardTier] = useState<TierKey | null>(null);
  const [dataVersion, setDataVersion] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoaded, setIsLoaded] = useState(false);
  const [hasEntered, setHasEntered] = useState(false);
  const [debugStage, setDebugStage] = useState<string>("init");
  const [debugError, setDebugError] = useState<string | null>(null);

  // Auth gate
  const [authChecked, setAuthChecked] = useState(false);
  const [isAuthed, setIsAuthed] = useState(false);
  const [steamConnected, setSteamConnected] = useState<boolean>(false);
  const [meUser, setMeUser] = useState<MeResponse["user"] | null>(null);
  const nextUrl = useMemo(() => "/", []);
  const [isDetailsOpen, setIsDetailsOpen] = useState(false);
  const [statsModalOpen, setStatsModalOpen] = useState(false);
  const [statsModalProfileId, setStatsModalProfileId] = useState<string | null>(null);
  const [statsModalTitle, setStatsModalTitle] = useState<string | null>(null);

  // Challenges UI state (user)
  const [challengeCheck, setChallengeCheck] = useState<{ status: 'idle' } | { status: 'loading' } | { status: 'ok'; data: any } | { status: 'error'; message: string }>({ status: 'idle' });
  const [isCreatingChallenge, setIsCreatingChallenge] = useState(false);

  // HUD tools: search/filter (visual only)
  const [hudSearchQuery, setHudSearchQuery] = useState<string>("");
  const [hudFilterGroups, setHudFilterGroups] = useState<Record<string, boolean>>({
    "Замки": true,
    "Крепости": true,
    "Донжоны": true,
    "Башня": true,
    "Халупа": true,
  });

  const openBuildingCard = useCallback((tier: TierKey) => {
    setCardTier(tier);
    setIsBuildingCardOpen(true);
    setIsDetailsOpen(false);
    setChallengeCheck({ status: 'idle' });
  }, []);

  const closeBuildingCard = useCallback(() => {
    setIsBuildingCardOpen(false);
    setCardTier(null);
    setIsDetailsOpen(false);
    setStatsModalOpen(false);
    setStatsModalProfileId(null);
    setStatsModalTitle(null);
  }, []);

  const center = useCallback(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    viewport.setZoom(0.7, true);
    viewport.moveCenter(viewport.worldWidth / 2, viewport.worldHeight / 2);
  }, []);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const r = await me();
        if (cancelled) return;
        const ok = !!r?.user;
        setIsAuthed(ok);
        setMeUser(r?.user ?? null);
        const providers = ((r as any)?.user?.providers ?? []) as string[];
        setSteamConnected(providers.includes("steam") || !!(r as any)?.user?.steamConnected);
        setAuthChecked(true);
        if (!ok) {
          router.replace(`/login?next=${encodeURIComponent(nextUrl)}`);
          return;
        }

        // If user is authenticated but has not claimed an AoE player yet, redirect to onboarding.
        const hasClaim = !!(r as any)?.user?.aoePlayer;
        if (!hasClaim) {
          router.replace("/claim-player");
        }
      } catch {
        if (cancelled) return;
        setIsAuthed(false);
        setAuthChecked(true);
        router.replace(`/login?next=${encodeURIComponent(nextUrl)}`);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [router, nextUrl]);

  useEffect(() => {
    const hostEl = hostRef.current;
    if (!hostEl) return;
    if (!hostReady) return;
    if (!authChecked || !isAuthed) return;

    const loadStartedAt = Date.now();
    setIsLoading(true);
    setIsLoaded(false);
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

      // user mode: only map navigation
      viewport.drag({ mouseButtons: "left" }).pinch().wheel().decelerate({ friction: 0.92 });
      viewport.clampZoom({ minScale: 0.35, maxScale: 2.2 });

      app.stage.addChild(viewport);

      setDebugStage("assets:map");
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

      // Load payload (view-only)
      let payload: MapStatePayloadV1;
      try {
        setDebugStage("api:loadMapState");
        const remoteRaw = await loadMapState();
        if (destroyed) return;

        // loadMapState() should return payload, but tolerate a wrapped Firestore doc shape
        const remote = (remoteRaw && (remoteRaw as any).payload ? (remoteRaw as any).payload : remoteRaw) as any;

        if (remote && (remote as any).buildings) {
          const incoming = (remote as any).buildings as Record<string, any>;
          const cleaned: Partial<MapStatePayloadV1["buildings"]> = {};
          for (const t of TIERS) {
            const v = incoming[t];
            if (v && typeof v === "object") (cleaned as any)[t] = { ...(DEFAULT_BUILDINGS as any)[t], ...v };
          }
          payload = {
            world: { ...WORLD },
            buildings: { ...DEFAULT_BUILDINGS, ...(cleaned as any) },
            players: ((remote as any).players ?? {}) as any,

            meta: ((remote as any).meta ?? {}) as any,
          };
        } else {
          payload = {
            world: { ...WORLD },
            buildings: { ...DEFAULT_BUILDINGS },
            players: ((remote as any)?.players ?? {}) as any,
            meta: ((remote as any)?.meta ?? {}) as any,
          };
        }
      } catch {
        payload = { world: { ...WORLD }, buildings: { ...DEFAULT_BUILDINGS } };
      }
      payloadRef.current = payload;
      setDataVersion((v) => v + 1);

      // Sprite factory (view-only)
      // expose sprites for HUD filters/search
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

        const fb = (DEFAULT_BUILDINGS as any)[tier] as any;
        const b = (payloadRef.current as any)?.buildings?.[tier] ?? fb;
        const x = typeof b?.x === "number" ? b.x : 0;
        const y = typeof b?.y === "number" ? b.y : 0;
        container.position.set(x, y);

        const userScale = typeof ((payloadRef.current?.buildings?.[tier] as any)?.scale) === "number" ? (payloadRef.current!.buildings as any)[tier].scale : 1;
        sprite.scale.set(baseScale * userScale);

        const userRot = typeof ((payloadRef.current?.buildings?.[tier] as any)?.rotation) === "number" ? (payloadRef.current!.buildings as any)[tier].rotation : 0;
        sprite.rotation = userRot;

        ((appRef.current as any).__buildingSpritesByTier as any)[tier] = sprite;

        // Hover highlight
        let isHovered = false;
        const normalAlpha = 0.98;
        const hoverAlpha = 1.0;
        sprite.alpha = normalAlpha;

        const onOver = () => {
          isHovered = true;
          sprite.alpha = isHovered ? hoverAlpha : normalAlpha;
        };
        const onOut = () => {
          isHovered = false;
          sprite.alpha = isHovered ? hoverAlpha : normalAlpha;
        };
        sprite.on("pointerover", onOver);
        sprite.on("pointerout", onOut);
        container.on("pointerover", onOver);
        container.on("pointerout", onOut);

        // Robust tap detection: open card on short tap regardless of zoom,
        // do not open when it is an actual drag gesture.
        let tapState: { down: boolean; sx: number; sy: number; t: number; moved: boolean } = {
          down: false,
          sx: 0,
          sy: 0,
          t: 0,
          moved: false,
        };

        const onDown = (e: PIXI.FederatedPointerEvent) => {
          tapState.down = true;
          tapState.t = (typeof performance !== "undefined" ? performance.now() : Date.now());
          tapState.sx = e.global.x;
          tapState.sy = e.global.y;
          tapState.moved = false;
          container.cursor = "pointer";
        };

        const onMove = (e: PIXI.FederatedPointerEvent) => {
          if (!tapState.down) return;
          const dx = e.global.x - tapState.sx;
          const dy = e.global.y - tapState.sy;
          // ~9px threshold in screen pixels (stable at any zoom)
          if (dx * dx + dy * dy > 81) tapState.moved = true;
        };

        const finishTap = (e: PIXI.FederatedPointerEvent) => {
          if (!tapState.down) return;
          const dt = (typeof performance !== "undefined" ? performance.now() : Date.now()) - tapState.t;
          const isTap = !tapState.moved && dt < 350;
          tapState.down = false;
          if (isTap) {
            openBuildingCard(tier);
          }
        };

        container.on("pointerdown", onDown);
        container.on("pointermove", onMove);
        container.on("pointerup", finishTap);
        container.on("pointerupoutside", finishTap);
        container.on("pointercancel", () => { tapState.down = false; });

        container.addChild(sprite);
        return container;
      };

      // Load textures and add sprites
      const CASTLE_V2_URL = "/buildings/castle/castle_v2.png?v=2";
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

      // Everything needed for displaying the map is loaded.
      // Keep loader for at least 2 seconds (even if everything is fast).
      const elapsed = Date.now() - loadStartedAt;
      const waitMs = Math.max(0, 2000 - elapsed);
      if (waitMs > 0) await new Promise((r) => setTimeout(r, waitMs));
      if (destroyed) return;
      setDebugStage("ready");
      setIsLoading(false);
      setIsLoaded(true);

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
      } catch (e: any) {
        console.error("[Map] init/load failed", e);
        if (!destroyed) {
          setDebugError(e?.message ? String(e.message) : String(e));
          setDebugStage("error");
          setIsLoading(false);
          setIsLoaded(true);
        }
      }
    })();

    return () => {
      destroyed = true;
      payloadRef.current = null;
      setIsLoading(false);
      try {
        const canvas = app.canvas;
        canvas?.parentElement?.removeChild(canvas);
      } catch {}
      app.destroy(true);
      appRef.current = null;
      viewportRef.current = null;
    };
  }, [authChecked, isAuthed, hostReady, center, openBuildingCard]);

  // Apply HUD search/filter to building sprites (visual only)
  useEffect(() => {
    const spritesByTier = (appRef.current as any)?.__buildingSpritesByTier as Partial<Record<TierKey, PIXI.Sprite>> | undefined;
    const pl = payloadRef.current;
    if (!spritesByTier || !pl) return;

    const q = (hudSearchQuery ?? "").toString().trim().toLocaleLowerCase("ru");

    const baseGroupOfTier = (t: TierKey): string => {
      if (t.startsWith("Замки")) return "Замки";
      if (t.startsWith("Крепости")) return "Крепости";
      if (t.startsWith("Донжоны")) return "Донжоны";
      if (t.startsWith("Башня")) return "Башня";
      if (t.startsWith("Халупа")) return "Халупа";
      return t;
    };

    const playerNicknameForTier = (tier: TierKey): string => {
      const players = (pl as any)?.players as Record<string, PlayerRec> | undefined;
      if (!players) return "";
      const found = Object.entries(players).find(([, p]) => normalizeTierKey(p, (pl as any)?.meta) === tier);
      const p = found?.[1];
      const nick = ((p as any)?.name ?? (p as any)?.nickname ?? "").toString().trim();
      return nick;
    };

    for (const t of TIERS) {
      const sprite = spritesByTier[t];
      if (!sprite) continue;

      const base = baseGroupOfTier(t);
      const groupOn = hudFilterGroups?.[base] !== false;

      let searchOn = true;
      if (q) {
        const nick = playerNicknameForTier(t).toLocaleLowerCase("ru");
        searchOn = nick.includes(q);
      }

      // Hide/Show visually
      sprite.visible = groupOn && searchOn;
    }
  }, [hudSearchQuery, hudFilterGroups, dataVersion]);

  // Handle ESC to close card
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeBuildingCard();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [closeBuildingCard]);

  const displayInfo = useCallback((tier: TierKey) => {
    const pl = payloadRef.current;

    // Prefer new model: players assigned to building (normalized by meta.tierNames)
    const players = (pl as any)?.players as Record<string, PlayerRec> | undefined;
    if (players) {
      const inBuilding = Object.entries(players)
        .filter(([, p]) => normalizeTierKey(p, (pl as any)?.meta) === tier)
        .map(([id, p]) => ({
          id,
          name: ((p?.name ?? id) as any)?.toString?.()?.trim?.() ?? String(p?.name ?? id),
          title: (p?.title ?? "").toString().trim(),
          desc: (p?.desc ?? "").toString().trim(),
        }));

      if (inBuilding.length > 0) {
        const p = inBuilding[0]!;
        return { name: p.name, title: p.title, note: p.desc };
      }
    }

    // Fallback to legacy model: buildings[tier].owner
    const owner = pl?.buildings?.[tier]?.owner;
    const name = (owner?.name ?? "").trim();
    const clan = (owner?.clan ?? "").trim();
    const note = (owner?.note ?? "").trim();
    return { name, title: clan, note };
  }, []);

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

  // If not authed we already triggered a redirect; keep UI minimal to avoid map flash
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

  return (
    <div style={{ height: "100dvh", display: "flex", flexDirection: "column", overflow: "hidden" }}>
      {/* MOBA-like HUD top-right */}
      {hasEntered && (() => {
        const vm = buildClaimedPlayerViewModel({
          meUser,
          mapPlayers: (payloadRef.current as any)?.players ?? null,
          fallbackAvatarUrl: "/people/u001.png",
        });

        const nicknameOptions = Object.values(((payloadRef.current as any)?.players ?? {}) as Record<string, any>)
          .map((p: any) => (p?.name ?? p?.nickname ?? "").toString().trim())
          .filter(Boolean);

        return (
          <PlayerHud
            nicknameOptions={nicknameOptions}
            onSearchNicknames={(q) => {
              setHudSearchQuery((q ?? "").toString());
            }}
            onFilterGroupsChange={(g) => {
              setHudFilterGroups(g || {});
            }}
            linkedPlayerName={(meUser as any)?.aoePlayer?.nickname ?? null}
            aoeProfileId={(meUser as any)?.aoePlayer?.aoeProfileId ?? null}
            steamConnected={steamConnected}
            steamLinkUrl={!steamConnected ? steamLinkUrl() : undefined}
            onLogout={async () => {
              try {
                await logout();
              } finally {
                router.replace(`/login?next=${encodeURIComponent(nextUrl)}`);
              }
            }}
            tierLabel={vm.tierLabel ?? undefined}
            nickname={vm.nickname}
            title={vm.title ?? ""}
            avatarUrl={vm.avatarUrl ?? "/people/u001.png"}
            online={true}
          />
        );
      })()}

      <div
        style={{
          position: "fixed",
          left: 8,
          bottom: 8,
          zIndex: 99999,
          fontSize: 12,
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
          padding: "6px 8px",
          borderRadius: 8,
          background: "rgba(0,0,0,0.55)",
          border: "1px solid rgba(255,255,255,0.15)",
          color: "rgba(255,255,255,0.9)",
          pointerEvents: "none",
        }}
      >
        authChecked={String(authChecked)} isAuthed={String(isAuthed)} steamConnected={String(steamConnected)} isLoading={String(isLoading)} isLoaded={String(isLoaded)} hasEntered={String(hasEntered)} hostReady={String(hostReady)} stage={debugStage}{debugError ? ` error=${debugError}` : ""}
      </div>

      {/* Steam connection status / link button (moved lower to avoid HUD overlap) */}
      <div
        style={{
          position: "fixed",
          right: 12,
          top: 86,
          zIndex: 99998,
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "8px 10px",
          borderRadius: 12,
          background: "rgba(0,0,0,0.45)",
          border: "1px solid rgba(255,255,255,0.15)",
          color: "rgba(255,255,255,0.92)",
          backdropFilter: "blur(6px)",
        }}
      >
        {/* Steam connection badge removed (was: "Steam: Connected") */}
        {!steamConnected && (
          <a
            href={steamLinkUrl()}
            style={{
              padding: "6px 10px",
              borderRadius: 10,
              border: "1px solid rgba(202,162,77,0.9)",
              background: "rgba(202,162,77,0.18)",
              color: "#f7f0df",
              fontWeight: 900,
              textDecoration: "none",
              whiteSpace: "nowrap",
            }}
            title="Link Steam to your current account"
          >
            Connect Steam
          </a>
        )}
      </div>
      {/* Loader / Enter overlay */}
      {!hasEntered && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "transparent",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 5000,
            padding: 16,
            pointerEvents: "none",
          }}
        >
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 18,
              width: "100%",
              pointerEvents: "auto",
            }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/loader/load.png"
              alt="loading"
              style={{
                width: "min(92vw, 980px)",
                maxHeight: "70vh",
                height: "auto",
                display: "block",
                objectFit: "contain",
                filter: "drop-shadow(0 14px 40px rgba(0,0,0,0.6))",
              }}
            />

            {isLoading && (
              <div
                style={{
                  width: 72,
                  height: 72,
                  borderRadius: "50%",
                  border: "8px solid rgba(247,240,223,0.22)",
                  borderTopColor: "rgba(202,162,77,0.95)",
                  animation: "aoeSpin 0.9s linear infinite",
                }}
              />
            )}

            {!isLoading && isLoaded && (
              <button
                onClick={() => setHasEntered(true)}
                style={{
                  padding: "14px 34px",
                  borderRadius: 0,
                  border: "2px solid rgba(202,162,77,0.95)",
                  background: "linear-gradient(180deg, rgba(202,162,77,0.22), rgba(43,26,18,0.12))",
                  color: "#f7f0df",
                  fontWeight: 900,
                  fontSize: 18,
                  letterSpacing: 0.6,
                  textTransform: "uppercase",
                  cursor: "pointer",
                  boxShadow: "0 14px 34px rgba(0,0,0,0.45)",
                  transition: "transform 120ms ease, filter 120ms ease",
                }}
                onMouseDown={(e) => {
                  (e.currentTarget as HTMLButtonElement).style.transform = "translateY(1px)";
                  (e.currentTarget as HTMLButtonElement).style.filter = "brightness(0.95)";
                }}
                onMouseUp={(e) => {
                  (e.currentTarget as HTMLButtonElement).style.transform = "translateY(0px)";
                  (e.currentTarget as HTMLButtonElement).style.filter = "none";
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLButtonElement).style.transform = "translateY(0px)";
                  (e.currentTarget as HTMLButtonElement).style.filter = "none";
                }}
              >
                Карта
              </button>
            )}

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
          </div>
        </div>
      )}

      {/* Canvas host */}
      <div
        ref={(el) => {
          hostRef.current = el;
          setHostReady(!!el);
        }}
        className="aoe-canvasHost"
        style={{ flex: 1, visibility: hasEntered ? "visible" : "hidden" }}
      />

      <PlayerStatsModal
        open={statsModalOpen}
        aoeProfileId={statsModalProfileId}
        title={statsModalTitle ?? undefined}
        onClose={() => setStatsModalOpen(false)}
      />

      {/* Building card modal (view-only) */}
      {isBuildingCardOpen && cardTier && (
        <div
          onPointerDown={closeBuildingCard}
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
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
          style={{
          width: "min(760px, calc(100vw - 32px))",
          maxHeight: "min(90dvh, calc(100dvh - 32px))",
          overflowY: "auto",
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
                  fontSize: 18,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
                title={(payloadRef.current as any)?.meta?.tierNames?.[cardTier] ?? cardTier}
              >
                {(payloadRef.current?.meta?.tierNames?.[cardTier] ?? "").toString().trim() || cardTier}
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
              void dataVersion;
              const info = displayInfo(cardTier);
              const name = (info?.name ?? "").trim();
              const title = (info?.title ?? "").trim();
              const note = (info?.note ?? "").trim();

              if (!name && !title && !note) return <div style={{ opacity: 0.85 }}>(нет информации)</div>;

              // Try to resolve avatar (same special-case as admin)
              const players = (payloadRef.current as any)?.players as Record<string, PlayerRec> | undefined;
              const found = players
                ? Object.entries(players)
                    .filter(([, p]) => normalizeTierKey(p, (payloadRef.current as any)?.meta) === cardTier)
                    // Make deterministic: prefer u001 if present, else u003, else first
                    .sort(([a], [b]) => (a === "u001" ? -1 : b === "u001" ? 1 : a === "u003" ? -1 : b === "u003" ? 1 : 0))[0]
                : undefined;
              const playerId = found?.[0];
              const playerRec = playerId ? (players as any)[playerId] : undefined;
              const avatar = avatarByPlayerId(playerId, playerRec);

              // Try to resolve aoeProfileId for the player in this building.
              // Prefer explicit aoeProfileId from playerRec, but fall back to other common shapes.
              const buildingAoeProfileId = (
                (playerRec as any)?.aoeProfileId ??
                (playerRec as any)?.aoe_profile_id ??
                (playerRec as any)?.profileId ??
                (playerRec as any)?.profile_id ??
                ""
              ).toString();

              // Fallback by nickname (name/alias) when no aoeProfileId is present in map payload.
              // We keep UI available but rely on a backend endpoint to resolve nickname -> aoeProfileId.
              const buildingNickname = (
                (playerRec as any)?.nickname ??
                (playerRec as any)?.name ??
                (playerRec as any)?.alias ??
                name ??
                ""
              ).toString();

              const canShowStats = !!buildingAoeProfileId.trim() || !!buildingNickname.trim();

              // Resolve target user id for challenges: requires map payload to include userId in playerRec.extra.
              const targetUserId = (
                (playerRec as any)?.userId ??
                (playerRec as any)?.extraJson?.userId ??
                (playerRec as any)?.extra?.userId ??
                ''
              ).toString().trim();

              const myUserId = (meUser as any)?.id ? String((meUser as any).id) : '';
              const isSelf = !!myUserId && !!targetUserId && myUserId === targetUserId;

              // Fetch canChallenge lazily when card opens and we know the target.
              if (targetUserId && !isSelf && challengeCheck.status === 'idle') {
                setChallengeCheck({ status: 'loading' });
                void (async () => {
                  try {
                    const { canChallenge } = await import('../lib/api/challenges');
                    const r = await canChallenge(targetUserId);
                    setChallengeCheck({ status: 'ok', data: r });
                  } catch (e: any) {
                    setChallengeCheck({ status: 'error', message: e?.message ? String(e.message) : 'Failed to check challenge' });
                  }
                })();
              }

              return (
                <div style={{ display: "flex", flexDirection: "column", gap: 12, alignItems: "center" }}>
                  {avatar ? (
                    <div
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
                        style={{ width: "min(240px, 42vw)", height: "min(240px, 42vw)", objectFit: "cover", display: "block" }}
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

                  <div
                    style={{
                      fontWeight: 900,
                      fontSize: 16,
                      textAlign: "center",
                      maxWidth: "100%",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                    title={name || title || ""}
                  >
                    {name || title || "(без имени)"}
                  </div>

                  <div style={{ display: "flex", gap: 10, flexWrap: "wrap", justifyContent: "center" }}>
                    {/* Challenge button (debug-friendly): always show for чужое строение.
                        If we cannot resolve targetUserId from map payload, we will still show the button and display a clear error.
                    */}
                    {!isSelf && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'center' }}>
                        <button
                          onClick={async () => {
                            try {
                              if (isCreatingChallenge) return;

                              setIsCreatingChallenge(true);
                              const { createChallenge, createChallengeByAoeProfileId, canChallenge } = await import('../lib/api/challenges');

                              let effectiveTargetUserId = targetUserId;
                              if (targetUserId) {
                                await createChallenge(targetUserId);
                              } else {
                                const aoe = String(buildingAoeProfileId || '').trim();
                                if (!aoe) {
                                  window.alert('TARGET_NOT_FOUND: no targetUserId and no aoeProfileId in payload');
                                  return;
                                }
                                const rr = await createChallengeByAoeProfileId(aoe);
                                effectiveTargetUserId = (rr as any)?.challenge?.targetUserId ? String((rr as any).challenge.targetUserId).trim() : '';
                              }

                              if (effectiveTargetUserId) {
                                const r = await canChallenge(effectiveTargetUserId);
                                setChallengeCheck({ status: 'ok', data: r });
                              }
                              window.alert('Вызов отправлен');
                            } catch (e: any) {
                              const code = e?.code ? String(e.code) : 'ERROR';
                              const msg = e?.message ? String(e.message) : 'Failed to create challenge';
                              window.alert(`${code}: ${msg}`);
                            } finally {
                              setIsCreatingChallenge(false);
                            }
                          }}
                          disabled={
                            isCreatingChallenge ||
                            !targetUserId ||
                            (challengeCheck.status === 'ok' && (challengeCheck as any).data?.canChallenge === false)
                          }
                          style={{
                            padding: '10px 14px',
                            borderRadius: 10,
                            border: '1px solid #caa24d',
                            background:
                              !targetUserId ||
                              (challengeCheck.status === 'ok' && (challengeCheck as any).data?.canChallenge === false)
                                ? 'rgba(255,255,255,0.06)'
                                : '#caa24d',
                            color:
                              !targetUserId ||
                              (challengeCheck.status === 'ok' && (challengeCheck as any).data?.canChallenge === false)
                                ? '#f7f0df'
                                : '#1b1b1b',
                            cursor:
                              isCreatingChallenge ||
                              !targetUserId ||
                              (challengeCheck.status === 'ok' && (challengeCheck as any).data?.canChallenge === false)
                                ? 'not-allowed'
                                : 'pointer',
                            fontWeight: 900,
                            opacity: isCreatingChallenge ? 0.7 : 1,
                          }}
                          title='Бросить вызов'
                        >
                          {!targetUserId
                            ? 'Бросить вызов (нет userId)'
                            : challengeCheck.status === 'loading'
                              ? 'Проверка…'
                              : challengeCheck.status === 'ok' && (challengeCheck as any).data?.canChallenge === false
                                ? 'Вызов недоступен'
                                : 'Бросить вызов'}
                        </button>

                        {(!targetUserId) && (
                          <div style={{ fontSize: 12, opacity: 0.85, textAlign: 'center', maxWidth: 340 }}>
                            Нет targetUserId в payload карты для этой цели. Нужно, чтобы игрок был заклеймен (claim) и /api/maps/default отдавал players[uXXX].userId.
                          </div>
                        )}

                        {targetUserId && challengeCheck.status === 'ok' && (challengeCheck as any).data?.canChallenge === false && (
                          <div style={{ fontSize: 12, opacity: 0.85, textAlign: 'center', maxWidth: 340 }}>
                            {(() => {
                              const d = (challengeCheck as any).data || {};
                              const reason = String(d.reason || '');
                              if (reason === 'COOLDOWN_ACTIVE') {
                                const until = d.cooldownUntil ? new Date(String(d.cooldownUntil)).toLocaleString() : '';
                                return until ? `Кулдаун активен до ${until}` : 'Кулдаун активен';
                              }
                              if (reason === 'ACTIVE_CHALLENGE_EXISTS') {
                                return 'У тебя уже есть активный исходящий вызов';
                              }
                              if (reason === 'SELF_CHALLENGE') return 'Нельзя бросить вызов самому себе';
                              if (reason === 'TARGET_NOT_FOUND') return 'Цель не найдена';
                              return `Недоступно: ${reason || 'UNKNOWN'}`;
                            })()}
                          </div>
                        )}

                        {challengeCheck.status === 'error' && (
                          <div style={{ fontSize: 12, color: '#ffb4b4', textAlign: 'center', maxWidth: 340 }}>
                            {(challengeCheck as any).message}
                          </div>
                        )}
                      </div>
                    )}
                    <button
                      onClick={() => {
                        setIsDetailsOpen((v) => !v);
                      }}
                      style={{
                        padding: "10px 14px",
                        borderRadius: 10,
                        border: "1px solid #caa24d",
                        background: "#2b1a12",
                        color: "#f7f0df",
                        cursor: "pointer",
                        fontWeight: 900,
                      }}
                      title={isDetailsOpen ? "Скрыть детали" : "Показать детали"}
                    >
                      {isDetailsOpen ? "Скрыть детали" : "Показать детали"}
                    </button>

                    <button
                      onClick={() => {
                        if (!canShowStats) return;
                        // Prefer aoeProfileId if present; fallback to nickname.
                        const id = buildingAoeProfileId.trim();
                        const nick = buildingNickname.trim();

                        if (id) {
                          setStatsModalProfileId(id);
                          setStatsModalTitle(`Statistics: ${name || id}`);
                          setStatsModalOpen(true);
                          return;
                        }

                        // Nickname fallback requires backend resolution.
                        window.alert("Stats by nickname is not supported yet on backend. Add backend endpoint to resolve nickname -> aoeProfileId.");
                      }}
                      disabled={!canShowStats}
                      style={{
                        padding: "10px 14px",
                        borderRadius: 10,
                        border: "1px solid rgba(202,162,77,0.9)",
                        background: canShowStats ? "rgba(202,162,77,0.18)" : "rgba(255,255,255,0.06)",
                        color: "#f7f0df",
                        cursor: canShowStats ? "pointer" : "not-allowed",
                        fontWeight: 900,
                        opacity: canShowStats ? 1 : 0.55,
                      }}
                      title={
                        buildingAoeProfileId.trim()
                          ? `Statistics (${buildingAoeProfileId.trim()})`
                          : buildingNickname.trim()
                            ? `Statistics (nickname: ${buildingNickname.trim()})`
                            : "No aoeProfileId/nickname in payload"
                      }
                    >
                      Statistics
                    </button>
                  </div>

                  
                  {isDetailsOpen && (
                    <div style={{ width: "100%" }}>
                      {title && (
                        <div style={{ fontWeight: 800, fontSize: 14, opacity: 0.95, textAlign: "center", marginBottom: 8 }}>{title}</div>
                      )}
                      {note ? (
                        <div style={{ opacity: 0.9, lineHeight: 1.45, whiteSpace: "pre-wrap", wordBreak: "break-word", overflowWrap: "anywhere" }}>{note}</div>
                      ) : (
                        <div style={{ opacity: 0.75, textAlign: "center" }}>(без описания)</div>
                      )}
                    </div>
                  )}
                </div>
              );
            })()}
          </div>
        </div>
      )}
    </div>
  );
}
