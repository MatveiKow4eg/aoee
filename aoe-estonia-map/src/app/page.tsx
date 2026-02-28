"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as PIXI from "pixi.js";
import { Viewport } from "pixi-viewport";
import { debounce, loadMapState, saveMapState } from "../lib/mapStateStore";

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
};

// ========== Constants ==========

const AUTOSAVE_MS = 800;
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

// ========== Helpers ==========

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

// ========== Component ==========

export default function Home() {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const appRef = useRef<PIXI.Application | null>(null);
  const viewportRef = useRef<Viewport | null>(null);

  const payloadRef = useRef<MapStatePayloadV1 | null>(null);

  const [isDirty, setIsDirty] = useState(false);
  const [dragBuildings, setDragBuildings] = useState(false);
  const dragBuildingsRef = useRef(false);

  const [selectedBuilding, setSelectedBuilding] = useState<TierKey | null>(null);
  const selectedBuildingRef = useRef<TierKey | null>(null);

  const [buildingScale, setBuildingScale] = useState(1);
  const [buildingRotation, setBuildingRotation] = useState(0);

  // Owner modal state
  const [isOwnerModalOpen, setIsOwnerModalOpen] = useState(false);
  const [ownerName, setOwnerName] = useState("");
  const [ownerClan, setOwnerClan] = useState("");
  const [ownerNote, setOwnerNote] = useState("");

  const scheduleAutosave = useMemo(
    () =>
      debounce(() => {
        const pl = payloadRef.current;
        if (!pl) return;
        if (!isDirty) return;
        void saveMapState(pl as any);
      }, AUTOSAVE_MS),
    [isDirty]
  );

  useEffect(() => () => scheduleAutosave.cancel(), [scheduleAutosave]);

  useEffect(() => {
    dragBuildingsRef.current = dragBuildings;
    const viewport = viewportRef.current;
    if (viewport) {
      if (dragBuildings) viewport.plugins.pause("drag");
      else viewport.plugins.resume("drag");
    }
  }, [dragBuildings]);

  useEffect(() => {
    selectedBuildingRef.current = selectedBuilding;
  }, [selectedBuilding]);

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

  const center = useCallback(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    viewport.setZoom(0.7, true);
    viewport.moveCenter(viewport.worldWidth / 2, viewport.worldHeight / 2);
  }, []);

  const reset = useCallback(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;

    const payload: MapStatePayloadV1 = {
      world: { ...WORLD },
      buildings: { ...DEFAULT_BUILDINGS },
    };
    payloadRef.current = payload;
    setIsDirty(true);
    void saveMapState(payload as any);
    center();
  }, [center]);

  const save = useCallback(() => {
    const pl = payloadRef.current;
    if (!pl) return;
    void saveMapState(pl as any);
    setIsDirty(false);
  }, []);

  // Owner modal helpers
  const openOwnerModalFor = useCallback((tier: TierKey) => {
    const pl = payloadRef.current;
    const current = pl?.buildings?.[tier]?.owner;
    setOwnerName(current?.name ?? "");
    setOwnerClan(current?.clan ?? "");
    setOwnerNote(current?.note ?? "");
    setIsOwnerModalOpen(true);
  }, []);

  const closeOwnerModal = useCallback(() => setIsOwnerModalOpen(false), []);

  const saveOwner = useCallback(async () => {
    const tier = selectedBuildingRef.current;
    if (!tier) return;
    const pl = payloadRef.current;
    if (!pl) return;

    const prev = pl.buildings[tier] ?? (DEFAULT_BUILDINGS as any)[tier];
    pl.buildings[tier] = {
      ...prev,
      owner: {
        name: ownerName.trim(),
        clan: ownerClan.trim() || undefined,
        note: ownerNote.trim() || undefined,
      },
    } as any;

    setIsDirty(true);
    await saveMapState(pl as any);
    setIsDirty(false);
    setIsOwnerModalOpen(false);
  }, [ownerName, ownerClan, ownerNote]);

  useEffect(() => {
    const hostEl = hostRef.current;
    if (!hostEl) return;

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

        if (remote && remote.buildings) {
          // Normalize: keep only known tiers, ensure defaults exist
          const incoming = remote.buildings as Record<string, any>;
          const cleaned: Partial<MapStatePayloadV1["buildings"]> = {};
          for (const t of TIERS) {
            const v = incoming[t];
            if (v && typeof v === "object") (cleaned as any)[t] = { ...(DEFAULT_BUILDINGS as any)[t], ...v };
          }
          payload = { world: { ...WORLD }, buildings: { ...DEFAULT_BUILDINGS, ...(cleaned as any) } };
          payloadRef.current = payload;
          setIsDirty(false);
          try { await saveMapState(payload as any); } catch {}
        } else {
          payload = { world: { ...WORLD }, buildings: { ...DEFAULT_BUILDINGS } };
          payloadRef.current = payload;
          setIsDirty(false);
          await saveMapState(payload as any);
        }
      } catch {
        payload = { world: { ...WORLD }, buildings: { ...DEFAULT_BUILDINGS } };
        payloadRef.current = payload;
      }

      // Sprite factory
      (appRef.current as any).__buildingSpritesByTier = {} as Partial<Record<TierKey, PIXI.Sprite>>;

      const setupBuildingSprite = (tier: TierKey, texture: PIXI.Texture) => {
        const container = new PIXI.Container();
        container.eventMode = "static";
        container.cursor = "grab";

        const sprite = new PIXI.Sprite(texture);
        sprite.anchor.set(0.5, 1);
        sprite.eventMode = "static";
        sprite.cursor = "grab";

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

        const userScale = typeof ((payloadRef.current?.buildings?.[tier] as any)?.scale) === "number" ? (payloadRef.current!.buildings as any)[tier].scale : 1;
        sprite.scale.set(baseScale * userScale);
        const userRot = typeof ((payloadRef.current?.buildings?.[tier] as any)?.rotation) === "number" ? (payloadRef.current!.buildings as any)[tier].rotation : 0;
        sprite.rotation = userRot;

        ((appRef.current as any).__buildingSpritesByTier as any)[tier] = sprite;

        // Hover/selection highlight (subtle)
        let isSelected = false;
        let isHovered = false;

        const normalAlpha = 0.98;
        const hoverAlpha = 1.0;

        // Initialize
        sprite.alpha = normalAlpha;

        const applyHighlight = () => {
          sprite.alpha = isSelected ? 1.0 : isHovered ? hoverAlpha : normalAlpha;
        };

        // Bind hover events on both sprite and container (more reliable)
        const onOver = () => {
          isHovered = true;
          applyHighlight();
        };
        const onOut = () => {
          isHovered = false;
          applyHighlight();
        };

        sprite.on("pointerover", onOver);
        sprite.on("pointerout", onOut);
        container.on("pointerover", onOver);
        container.on("pointerout", onOut);

        (sprite as any).on("pointertap", () => {
          const prev = selectedBuildingRef.current;
          if (prev === tier) {
            isSelected = false;
            setSelectedBuilding(null);
            applyHighlight();
            // Повторный клик по выбранному — откроем модалку для владельца
            openOwnerModalFor(tier);
            return;
          }
          isSelected = true;
          setSelectedBuilding(tier);
          applyHighlight();

          const currentScale = (payloadRef.current?.buildings[tier] as any)?.scale;
          setBuildingScale(typeof currentScale === "number" ? currentScale : 1);
          const currentRotation = (payloadRef.current?.buildings[tier] as any)?.rotation;
          setBuildingRotation(typeof currentRotation === "number" ? currentRotation : 0);

          // Откр��ем модалку владельца на первичный клик
          openOwnerModalFor(tier);
        });

        // Dragging
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
          container.cursor = "grab";
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

        container.sortableChildren = true;
        sprite.zIndex = 1;
        container.addChild(sprite);
        container.hitArea = null;

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
      buildingsLayer.addChild(setupBuildingSprite("Башня v4", basnjaV4Texture));

      center();

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
      try {
        const canvas = app.canvas;
        canvas?.parentElement?.removeChild(canvas);
      } catch {}
      app.destroy(true);
      appRef.current = null;
      viewportRef.current = null;
    };
  }, [center, openOwnerModalFor]);

  // Handle ESC to close owner modal
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setIsOwnerModalOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div style={{ height: "100vh", display: "flex", flexDirection: "column" }}>
      {/* Canvas host */}
      <div ref={hostRef} style={{ flex: 1 }} />

      {/* Floating control button & panel */}
      <button
        onClick={() => {
          const panel = document.querySelector("#aoe-fly-panel");
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
        title="Панель управления"
      >
        ☰
      </button>

      <div
        id="aoe-fly-panel"
        data-open="false"
        style={{
          position: "fixed",
          right: 16,
          bottom: 84,
          zIndex: 999,
          maxWidth: 520,
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
          <div style={{ fontSize: 16, fontWeight: 800 }}>AOE Estonia — Карта</div>
          <div style={{ opacity: 0.85, fontWeight: 800, fontSize: 12 }}>(buildings)</div>
          <div style={{ flex: 1 }} />
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
            <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span>Size</span>
              <input
                type="range"
                min={0.1}
                max={4}
                step={0.05}
                value={buildingScale}
                onChange={(e) => setBuildingScale(Number(e.target.value))}
                style={{ width: 200 }}
              />
              <span style={{ width: 140, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                {selectedBuilding} {buildingScale.toFixed(2)}
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
                style={{ width: 200 }}
              />
              <span style={{ width: 80, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                {buildingRotation.toFixed(2)}
              </span>
            </label>

            <button
              onClick={() => selectedBuilding && openOwnerModalFor(selectedBuilding)}
              style={{
                padding: "6px 10px",
                borderRadius: 8,
                border: "1px solid #3a2a1a",
                background: "#2b1a12",
                color: "#f7f0df",
                cursor: "pointer",
              }}
              title="Редактировать владельца"
            >
              Owner
            </button>
          </>
        )}

        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={center} style={{ padding: "6px 10px", borderRadius: 8, border: "1px solid #3a2a1a", background: "#2b1a12", color: "#f7f0df", cursor: "pointer" }}>
            Center
          </button>
          <button onClick={save} style={{ padding: "6px 10px", borderRadius: 8, border: "1px solid #3a2a1a", background: "#2b1a12", color: "#f7f0df", cursor: "pointer" }} title="Со��ранить в Firebase">
            Save{isDirty ? "*" : ""}
          </button>
          <button onClick={reset} style={{ padding: "6px 10px", borderRadius: 8, border: "1px solid #3a2a1a", background: "#2b1a12", color: "#f7f0df", cursor: "pointer" }} title="Сбросить и пересохранить в Firebase">
            Reset
          </button>
        </div>
      </div>

      {/* Owner modal */}
      {isOwnerModalOpen && (
        <div
          onClick={closeOwnerModal}
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
              width: 420,
              maxWidth: "90vw",
              background: "#0b1220",
              color: "#f7f0df",
              border: "1px solid #3a2a1a",
              borderRadius: 12,
              boxShadow: "0 12px 48px rgba(0,0,0,0.45)",
              padding: 16,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
              <div style={{ fontWeight: 800, fontSize: 16 }}>Владелец здания</div>
              <div style={{ flex: 1 }} />
              <button onClick={closeOwnerModal} style={{ background: "transparent", border: 0, color: "#f7f0df", cursor: "pointer", fontSize: 18 }}>×</button>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <span style={{ opacity: 0.8 }}>Имя владельца</span>
                <input value={ownerName} onChange={(e) => setOwnerName(e.target.value)} placeholder="Имя" style={{ padding: 8, borderRadius: 8, border: "1px solid #3a2a1a", background: "#1a2438", color: "#f7f0df" }} />
              </label>
              <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <span style={{ opacity: 0.8 }}>Клан / фракция (необязательно)</span>
                <input value={ownerClan} onChange={(e) => setOwnerClan(e.target.value)} placeholder="Клан" style={{ padding: 8, borderRadius: 8, border: "1px solid #3a2a1a", background: "#1a2438", color: "#f7f0df" }} />
              </label>
              <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <span style={{ opacity: 0.8 }}>Заметка (необязательно)</span>
                <textarea value={ownerNote} onChange={(e) => setOwnerNote(e.target.value)} placeholder="Комментарий" rows={3} style={{ padding: 8, borderRadius: 8, border: "1px solid #3a2a1a", background: "#1a2438", color: "#f7f0df", resize: "vertical" }} />
              </label>
            </div>

            <div style={{ display: "flex", gap: 8, marginTop: 14, justifyContent: "flex-end" }}>
              <button onClick={closeOwnerModal} style={{ padding: "6px 12px", borderRadius: 8, border: "1px solid #3a2a1a", background: "#1a2438", color: "#f7f0df", cursor: "pointer" }}>Отмена</button>
              <button onClick={saveOwner} style={{ padding: "6px 12px", borderRadius: 8, border: "1px solid #caa24d", background: "#2b1a12", color: "#f7f0df", cursor: "pointer", fontWeight: 700 }}>Сохранить</button>
            </div>
          </div>
        </div>
      )}

      <style>{`
        #aoe-fly-panel[data-open="true"] {
          opacity: 1 !important;
          transform: translateY(0) !important;
          pointer-events: auto !important;
        }
      `}</style>
    </div>
  );
}
