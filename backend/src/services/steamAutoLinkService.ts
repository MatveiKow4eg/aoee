import { prisma } from '../db/prisma';
import { aoe2InsightsSearchByNickname, normalizeNickname } from './aoe2insightsService';

export type AutoLinkResult =
  | { ok: true; linked: true; aoeProfileId: string }
  | { ok: true; linked: false; reason: string }
  | { ok: false; linked: false; reason: string };

/**
 * Best-effort, fail-safe auto-linking Steam -> AoE2 Insights -> internal AoePlayer.
 *
 * Strict rules:
 * - AoE2Insights search resultsCount must be exactly 1
 * - exactName must match steamNickname after normalization
 * - aoeProfileId must exist in internal AoePlayer table
 * - aoeProfileId must not be claimed by another user
 * - user must not have already claimed another player
 * - claim must be atomic (same semantics as manual claim flow)
 *
 * This MUST NOT throw and MUST NOT block Steam login.
 */
export async function tryAutoLinkSteamToAoe(params: {
  userId: string;
  steamId: string;
  steamNickname: string;
}): Promise<AutoLinkResult> {
  const { userId, steamId, steamNickname } = params;

  // Small helper for consistent diagnostics.
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

    const parsed = await aoe2InsightsSearchByNickname(steamNickname);
    if (!parsed) {
      log('skip', { reason: 'aoe_search_failed' });
      return { ok: true, linked: false, reason: 'aoe_search_failed' };
    }

    log('aoe_search_parsed', parsed as any);

    if (parsed.resultsCount !== 1) {
      const reason = `results_count_${parsed.resultsCount}`;
      log('skip', { reason });
      return { ok: true, linked: false, reason };
    }

    if (!parsed.exactName || !parsed.profileId || !parsed.profileUrl) {
      log('skip', { reason: 'missing_parsed_fields' });
      return { ok: true, linked: false, reason: 'missing_parsed_fields' };
    }

    const isExactMatch = normalizeNickname(parsed.exactName) === normalizeNickname(steamNickname);
    if (!isExactMatch) {
      log('skip', {
        reason: 'nickname_not_exact_match',
        exactName: parsed.exactName,
        normalizedExactName: normalizeNickname(parsed.exactName),
        normalizedSteamNickname: normalizeNickname(steamNickname),
      });
      return { ok: true, linked: false, reason: 'nickname_not_exact_match' };
    }

    // Internal roster existence check (strict requirement).
    const aoePlayer = await prisma.aoePlayer.findUnique({
      where: { aoeProfileId: parsed.profileId },
      select: { aoeProfileId: true, claimedByUserId: true },
    });

    if (!aoePlayer) {
      log('skip', { reason: 'aoe_profile_not_in_internal_db', aoeProfileId: parsed.profileId });
      return { ok: true, linked: false, reason: 'aoe_profile_not_in_internal_db' };
    }

    // Ensure target AoE profile is not claimed by another user.
    if (aoePlayer.claimedByUserId && aoePlayer.claimedByUserId !== userId) {
      log('skip', { reason: 'aoe_profile_already_claimed', aoeProfileId: parsed.profileId, claimedByUserId: aoePlayer.claimedByUserId });
      return { ok: true, linked: false, reason: 'aoe_profile_already_claimed' };
    }

    // Ensure current user didn't already claim some other profile (same semantics as manual flow).
    const alreadyClaimed = await prisma.aoePlayer.findUnique({
      where: { claimedByUserId: userId },
      select: { aoeProfileId: true },
    });

    if (alreadyClaimed && alreadyClaimed.aoeProfileId !== parsed.profileId) {
      log('skip', { reason: 'user_already_claimed', alreadyClaimed: alreadyClaimed.aoeProfileId, candidate: parsed.profileId });
      return { ok: true, linked: false, reason: 'user_already_claimed' };
    }

    // Steam uniqueness is enforced in Account table.
    // Still check explicitly to return a stable reason and avoid Prisma unique errors.
    const existingAccountBySteam = await prisma.account.findUnique({
      where: { provider_providerAccountId: { provider: 'steam', providerAccountId: steamId } },
      select: { userId: true },
    });

    if (existingAccountBySteam && existingAccountBySteam.userId !== userId) {
      log('skip', { reason: 'steam_already_linked', linkedUserId: existingAccountBySteam.userId });
      return { ok: true, linked: false, reason: 'steam_already_linked' };
    }

    // Atomic claim (same pattern as manual claim: only claim if currently unclaimed).
    // If already claimed by this same user (race / retry), treat it as OK.
    if (!aoePlayer.claimedByUserId) {
      const updated = await prisma.aoePlayer.updateMany({
        where: {
          aoeProfileId: parsed.profileId,
          claimedByUserId: null,
        },
        data: {
          claimedByUserId: userId,
          claimedAt: new Date(),
        },
      });

      if (updated.count !== 1) {
        // Someone else claimed in-between.
        log('skip', { reason: 'aoe_profile_already_claimed_race', aoeProfileId: parsed.profileId, updatedCount: updated.count });
        return { ok: true, linked: false, reason: 'aoe_profile_already_claimed' };
      }
    }

    // Update legacy User fields (compat).
    await prisma.user.update({
      where: { id: userId },
      data: {
        aoeProfileId: parsed.profileId,
        aoeProfileUrl: parsed.profileUrl,
        aoeNickname: parsed.exactName,
        aoeLinkedAt: new Date(),
      },
    });

    log('linked', { aoeProfileId: parsed.profileId });
    return { ok: true, linked: true, aoeProfileId: parsed.profileId };
  } catch (e: any) {
    log('error', { reason: 'unexpected_error', message: e?.message ? String(e.message) : undefined });
    return { ok: false, linked: false, reason: 'unexpected_error' };
  }
}
