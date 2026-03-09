import { prisma } from '../db/prisma';

export type AutoLinkResult =
  | { ok: true; linked: true; reason: 'linked_by_steam_id' | 'already_linked'; aoePlayerId: string }
  | {
      ok: true;
      linked: false;
      reason: 'player_not_found_for_steam_id' | 'already_claimed_by_another_user' | 'user_already_claimed_other_player';
    }
  | { ok: false; linked: false; reason: 'unexpected_error' };

/**
 * Best-effort, fail-safe auto-linking Steam -> existing AoePlayer (by steamId) -> claim.
 *
 * Strict rules:
 * - Find AoePlayer by steamId
 * - If not found: return linked=false
 * - If found but claimed by another user: linked=false
 * - If found and already claimed by current user: linked=true (already_linked)
 * - If found and unclaimed: atomic claim
 *
 * This MUST NOT throw and MUST NOT block Steam login.
 */
export async function tryAutoLinkSteamToAoe(params: {
  userId: string;
  steamId: string;
}): Promise<AutoLinkResult> {
  const { userId, steamId } = params;

  const log = (event: string, extra?: Record<string, unknown>) => {
    try {
      // eslint-disable-next-line no-console
      console.log(`[steam-auto-link] ${event}`, {
        userId,
        steamId,
        ...(extra ?? {}),
      });
    } catch {
      // ignore
    }
  };

  try {
    log('start');

    const safeSteamId = String(steamId || '').trim();
    if (!safeSteamId) {
      // should never happen, but do not throw
      log('skip', { reason: 'empty_steam_id' });
      return { ok: true, linked: false, reason: 'player_not_found_for_steam_id' };
    }

    // Ensure current user didn't already claim some other profile.
    const alreadyClaimed = await prisma.aoePlayer.findUnique({
      where: { claimedByUserId: userId },
      select: { id: true, aoeProfileId: true },
    });

    // Find existing roster/profile by steamId.
    const player = await prisma.aoePlayer.findUnique({
      where: { steamId: safeSteamId },
      select: { id: true, claimedByUserId: true },
    });

    if (!player) {
      log('not_found', { reason: 'player_not_found_for_steam_id' });
      return { ok: true, linked: false, reason: 'player_not_found_for_steam_id' };
    }

    // If user already claimed a different player, do not auto-claim another.
    if (alreadyClaimed && alreadyClaimed.id !== player.id) {
      log('skip', {
        reason: 'user_already_claimed_other_player',
        alreadyClaimedAoePlayerId: alreadyClaimed.id,
        candidateAoePlayerId: player.id,
      });
      return { ok: true, linked: false, reason: 'user_already_claimed_other_player' };
    }

    if (player.claimedByUserId && player.claimedByUserId !== userId) {
      log('skip', { reason: 'already_claimed_by_another_user', claimedByUserId: player.claimedByUserId });
      return { ok: true, linked: false, reason: 'already_claimed_by_another_user' };
    }

    if (player.claimedByUserId === userId) {
      log('already_linked', { aoePlayerId: player.id });
      return { ok: true, linked: true, reason: 'already_linked', aoePlayerId: player.id };
    }

    // Atomic claim: only claim if currently unclaimed.
    const updated = await prisma.aoePlayer.updateMany({
      where: { id: player.id, claimedByUserId: null },
      data: { claimedByUserId: userId, claimedAt: new Date() },
    });

    if (updated.count !== 1) {
      // race: someone else claimed
      log('skip', { reason: 'already_claimed_by_another_user', updatedCount: updated.count });
      return { ok: true, linked: false, reason: 'already_claimed_by_another_user' };
    }

    log('linked', { aoePlayerId: player.id, reason: 'linked_by_steam_id' });
    return { ok: true, linked: true, reason: 'linked_by_steam_id', aoePlayerId: player.id };
  } catch (e: any) {
    log('error', { reason: 'unexpected_error', message: e?.message ? String(e.message) : undefined });
    return { ok: false, linked: false, reason: 'unexpected_error' };
  }
}
