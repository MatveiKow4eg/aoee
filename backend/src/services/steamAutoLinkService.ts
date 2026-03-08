import { prisma } from '../db/prisma';
import { normalizeNickname } from './aoe2insightsService';
import { MapService } from './mapService';

export type AutoLinkResult =
  | { ok: true; linked: true; aoeProfileId: string }
  | { ok: true; linked: false; reason: string }
  | { ok: false; linked: false; reason: string };

/**
 * Best-effort, fail-safe auto-linking Steam -> internal map payload (maps/default) -> AoePlayer claim.
 *
 * Strict rules:
 * - Load maps/default payload and look at payload.players
 * - Find players with exact nickname match after normalization
 * - Auto-link only if exactly one match and it has insightsUserId
 * - Claim that aoeProfileId for the current user (atomic claim)
 * - Update legacy User fields for compatibility
 *
 * This MUST NOT throw and MUST NOT block Steam login.
 */
export async function tryAutoLinkSteamToAoe(params: {
  userId: string;
  steamId: string;
  steamNickname: string;
}): Promise<AutoLinkResult> {
  const { userId, steamId, steamNickname } = params;

  const log = (event: string, extra?: Record<string, unknown>) => {
    try {
      // eslint-disable-next-line no-console
      console.log(`[steam-auto-link] ${event}`, {
        userId,
        steamId,
        steamNickname,
        ...(extra ?? {}),
      });
    } catch {
      // ignore
    }
  };

  try {
    log('start');

    const normalizedSteam = normalizeNickname(steamNickname);
    if (!normalizedSteam) {
      log('skip', { reason: 'empty_steam_nickname' });
      return { ok: true, linked: false, reason: 'empty_steam_nickname' };
    }

    // Load map payload.
    const map = new MapService();
    const payload = await map.getMapPayload('default');
    const players = payload?.players ?? {};

    const matched = Object.values(players)
      .map((p: any) => ({
        name: typeof p?.name === 'string' ? p.name.trim() : '',
        insightsUserId: typeof p?.insightsUserId === 'string' ? p.insightsUserId.trim() : '',
      }))
      .filter((p) => p.name && normalizeNickname(p.name) === normalizedSteam);

    log('map_match', {
      matchedPlayersCount: matched.length,
      matchedPlayerName: matched.length === 1 ? matched[0]!.name : null,
      matchedInsightsUserId: matched.length === 1 ? matched[0]!.insightsUserId : null,
    });

    if (matched.length === 0) {
      log('skip', { reason: 'map_nickname_not_found' });
      return { ok: true, linked: false, reason: 'map_nickname_not_found' };
    }

    if (matched.length > 1) {
      log('skip', { reason: 'map_nickname_ambiguous', matchedPlayersCount: matched.length });
      return { ok: true, linked: false, reason: 'map_nickname_ambiguous' };
    }

    const match = matched[0]!;
    const aoeProfileId = String(match.insightsUserId || '').trim();
    const matchedName = String(match.name || '').trim();

    if (!aoeProfileId) {
      log('skip', { reason: 'matched_player_missing_insightsUserId', matchedPlayerName: matchedName });
      return { ok: true, linked: false, reason: 'matched_player_missing_insightsUserId' };
    }

    const aoeProfileUrl = `https://www.aoe2insights.com/user/${encodeURIComponent(aoeProfileId)}/`;

    // Ensure current user didn't already claim some other profile (same semantics as manual flow).
    const alreadyClaimed = await prisma.aoePlayer.findUnique({
      where: { claimedByUserId: userId },
      select: { aoeProfileId: true },
    });

    if (alreadyClaimed && alreadyClaimed.aoeProfileId !== aoeProfileId) {
      log('skip', { reason: 'user_already_claimed', alreadyClaimed: alreadyClaimed.aoeProfileId, candidate: aoeProfileId });
      return { ok: true, linked: false, reason: 'user_already_claimed' };
    }

    // Steam uniqueness is enforced in Account table.
    const existingAccountBySteam = await prisma.account.findUnique({
      where: { provider_providerAccountId: { provider: 'steam', providerAccountId: steamId } },
      select: { userId: true },
    });

    if (existingAccountBySteam && existingAccountBySteam.userId !== userId) {
      log('skip', { reason: 'steam_already_linked', linkedUserId: existingAccountBySteam.userId });
      return { ok: true, linked: false, reason: 'steam_already_linked' };
    }

    // Find or create AoePlayer row.
    let aoePlayer = await prisma.aoePlayer.findUnique({
      where: { aoeProfileId },
      select: { aoeProfileId: true, claimedByUserId: true },
    });

    let createdAoePlayer = false;
    if (!aoePlayer) {
      try {
        await prisma.aoePlayer.create({
          data: {
            aoeProfileId,
            aoeProfileUrl,
            nickname: matchedName,
          },
        });
        createdAoePlayer = true;
      } catch {
        // ignore (race/unique)
      }

      aoePlayer = await prisma.aoePlayer.findUnique({
        where: { aoeProfileId },
        select: { aoeProfileId: true, claimedByUserId: true },
      });

      if (!aoePlayer) {
        log('skip', { reason: 'aoe_player_create_failed', aoeProfileId });
        return { ok: true, linked: false, reason: 'aoe_player_create_failed' };
      }
    }

    log('aoe_player_ready', { aoeProfileId, createdAoePlayer, claimedByUserId: aoePlayer.claimedByUserId ?? null });

    // Ensure target AoE profile is not claimed by another user.
    if (aoePlayer.claimedByUserId && aoePlayer.claimedByUserId !== userId) {
      log('skip', { reason: 'aoe_profile_already_claimed', aoeProfileId, claimedByUserId: aoePlayer.claimedByUserId });
      return { ok: true, linked: false, reason: 'aoe_profile_already_claimed' };
    }

    // Atomic claim (same pattern as manual claim: only claim if currently unclaimed).
    log('claim_attempt', { aoeProfileId, alreadyClaimedBy: aoePlayer.claimedByUserId ?? null });

    let claimUpdatedCount = 0;
    if (!aoePlayer.claimedByUserId) {
      const updated = await prisma.aoePlayer.updateMany({
        where: { aoeProfileId, claimedByUserId: null },
        data: { claimedByUserId: userId, claimedAt: new Date() },
      });
      claimUpdatedCount = updated.count;

      log('claim_result', { aoeProfileId, updatedCount: updated.count });

      if (updated.count !== 1) {
        log('skip', { reason: 'aoe_profile_already_claimed_race', aoeProfileId, updatedCount: updated.count });
        return { ok: true, linked: false, reason: 'aoe_profile_already_claimed' };
      }
    } else {
      log('claim_skipped_already_claimed', { aoeProfileId, claimedByUserId: aoePlayer.claimedByUserId });
    }

    // Update legacy User fields (compat).
    const legacyUpdate = await prisma.user.update({
      where: { id: userId },
      data: {
        aoeProfileId,
        aoeProfileUrl,
        aoeNickname: matchedName,
        aoeLinkedAt: new Date(),
      },
      select: { id: true, aoeProfileId: true, aoeNickname: true, aoeLinkedAt: true },
    });

    log('legacy_user_updated', legacyUpdate as any);

    log('linked', { aoeProfileId, claimUpdatedCount, createdAoePlayer });
    return { ok: true, linked: true, aoeProfileId };
  } catch (e: any) {
    log('error', { reason: 'unexpected_error', message: e?.message ? String(e.message) : undefined });
    return { ok: false, linked: false, reason: 'unexpected_error' };
  }
}
