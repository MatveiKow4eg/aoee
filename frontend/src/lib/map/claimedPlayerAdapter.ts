import type { MeResponse } from "../api/auth";

/**
 * Transitional adapter layer.
 *
 * Current map payload still contains legacy `players[*].insightsUserId` field.
 * We keep ALL knowledge about that legacy field inside this adapter, so UI
 * components do not depend on the legacy naming.
 */

export type MapPlayerRec = {
  name?: string;
  tier?: string;
  title?: string;
  desc?: string;
  avatar?: string;

  /**
   * Canonical map payload reference to an AoE profile.
   * This should match AoePlayer.aoeProfileId.
   */
  aoeProfileId?: string;

  /**
   * @deprecated Legacy field that came historically from AoE2Insights.
   * Kept only for backward compatibility with old map payloads.
   */
  insightsUserId?: string;
};

export type MapPlayersIndex = Record<string, MapPlayerRec>;

export type MapPlayerRef = {
  /** map payload internal player id (e.g. u001) */
  mapPlayerId: string;
  rec: MapPlayerRec;
};

export function resolveMapPlayerForClaimedAoeProfileId(args: {
  players?: MapPlayersIndex | null;
  claimedAoeProfileId?: string | null;
}): MapPlayerRef | null {
  const claimed = (args.claimedAoeProfileId ?? "").toString().trim();
  const players = args.players ?? undefined;
  if (!claimed || !players) return null;

  // 1) Canonical matching by aoeProfileId
  for (const [mapPlayerId, rec] of Object.entries(players)) {
    const aoeProfileId = (rec?.aoeProfileId ?? "").toString().trim();
    if (aoeProfileId && aoeProfileId === claimed) {
      return { mapPlayerId, rec };
    }
  }

  // 2) Deprecated fallback for old payloads: insightsUserId
  for (const [mapPlayerId, rec] of Object.entries(players)) {
    const legacyId = (rec?.insightsUserId ?? "").toString().trim();
    if (legacyId && legacyId === claimed) {
      return { mapPlayerId, rec };
    }
  }

  return null;
}

export type ClaimedPlayerViewModel = {
  claimStatus: "claimed" | "unclaimed";

  aoeProfileId?: string | null;
  steamId?: string | null;

  nickname: string;
  title?: string | null;
  tierLabel?: string | null;
  avatarUrl?: string | null;

  /** debug/diagnostics: the internal map player id if resolved */
  mapPlayerId?: string | null;
};

export function buildClaimedPlayerViewModel(args: {
  meUser?: MeResponse["user"] | null;
  mapPlayers?: MapPlayersIndex | null;
  fallbackAvatarUrl?: string;
}): ClaimedPlayerViewModel {
  const user = args.meUser ?? null;
  const claimed = user?.aoePlayer ?? null;

  if (!claimed) {
    return {
      claimStatus: "unclaimed",
      nickname: (user?.displayName ?? user?.email ?? "Игрок").toString(),
      title: user?.role ? String(user.role) : null,
      avatarUrl: args.fallbackAvatarUrl ?? "/people/u001.png",
    };
  }

  const mapHit = resolveMapPlayerForClaimedAoeProfileId({
    players: args.mapPlayers ?? undefined,
    claimedAoeProfileId: claimed.aoeProfileId,
  });

  const nickname =
    (mapHit?.rec?.name ?? claimed.nickname ?? user?.displayName ?? user?.email ?? "Игрок").toString();

  const title = (mapHit?.rec?.title ?? user?.role ?? "").toString().trim() || null;

  const tierLabel =
    ((mapHit?.rec as any)?.tierLabel ?? mapHit?.rec?.tier ?? "").toString().trim() || null;

  const avatarUrl = mapHit?.mapPlayerId
    ? `/people/${encodeURIComponent(mapHit.mapPlayerId)}.png`
    : (args.fallbackAvatarUrl ?? "/people/u001.png");

  return {
    claimStatus: "claimed",
    aoeProfileId: claimed.aoeProfileId,
    steamId: claimed.steamId ?? null,
    nickname,
    title,
    tierLabel,
    avatarUrl,
    mapPlayerId: mapHit?.mapPlayerId ?? null,
  };
}
