import { prisma } from '../db/prisma';
import { aoe2InsightsSearchByNickname, normalizeNickname } from './aoe2insightsService';

export type AutoLinkResult =
  | { ok: true; linked: true; aoeProfileId: string }
  | { ok: true; linked: false; reason: string }
  | { ok: false; linked: false; reason: string };

/**
 * Best-effort, fail-safe auto-linking Steam -> AoE2 Insights -> internal AoePlayer.
 *
 * This MUST NOT throw and MUST NOT block Steam login.
 */
export async function tryAutoLinkSteamToAoe(params: {
  userId: string;
  steamId: string;
  steamNickname: string;
}): Promise<AutoLinkResult> {
  const { userId, steamId, steamNickname } = params;

  try {
    const parsed = await aoe2InsightsSearchByNickname(steamNickname);
    if (!parsed) {
      return { ok: true, linked: false, reason: 'aoe_search_failed' };
    }

    if (parsed.resultsCount !== 1) {
      return { ok: true, linked: false, reason: `results_count_${parsed.resultsCount}` };
    }

    if (!parsed.exactName || !parsed.profileId || !parsed.profileUrl) {
      return { ok: true, linked: false, reason: 'missing_parsed_fields' };
    }

    const isExactMatch = normalizeNickname(parsed.exactName) === normalizeNickname(steamNickname);
    if (!isExactMatch) {
      return { ok: true, linked: false, reason: 'nickname_not_exact_match' };
    }

    const aoePlayer = await prisma.aoePlayer.findUnique({
      where: { aoeProfileId: parsed.profileId },
      select: { aoeProfileId: true },
    });

    if (!aoePlayer) {
      return { ok: true, linked: false, reason: 'aoe_profile_not_in_internal_db' };
    }

    // Conflict checks.
    const existingUserByAoe = await prisma.user.findFirst({
      where: {
        aoeProfileId: parsed.profileId,
        NOT: { id: userId },
      },
      select: { id: true },
    });

    if (existingUserByAoe) {
      return { ok: true, linked: false, reason: 'aoe_profile_already_linked' };
    }

    // Steam uniqueness is enforced in Account table.
    // Still check explicitly to return a stable reason and avoid Prisma unique errors.
    const existingAccountBySteam = await prisma.account.findUnique({
      where: { provider_providerAccountId: { provider: 'steam', providerAccountId: steamId } },
      select: { userId: true },
    });

    if (existingAccountBySteam && existingAccountBySteam.userId !== userId) {
      return { ok: true, linked: false, reason: 'steam_already_linked' };
    }

    await prisma.user.update({
      where: { id: userId },
      data: {
        aoeProfileId: parsed.profileId,
        aoeProfileUrl: parsed.profileUrl,
        aoeNickname: parsed.exactName,
        aoeLinkedAt: new Date(),
      },
    });

    return { ok: true, linked: true, aoeProfileId: parsed.profileId };
  } catch {
    return { ok: false, linked: false, reason: 'unexpected_error' };
  }
}
