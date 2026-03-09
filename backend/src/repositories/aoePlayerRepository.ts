import { prisma } from '../db/prisma';

export class AoePlayerRepository {
  async listAvailable(args: { q?: string; limit: number; cursor?: string | null }) {
    const { q, limit, cursor } = args;

    const where: any = {
      claimedByUserId: null,
    };

    if (q && q.trim()) {
      where.nickname = { contains: q.trim(), mode: 'insensitive' };
    }

    const rows = await prisma.aoePlayer.findMany({
      where,
      orderBy: [{ nickname: 'asc' }, { aoeProfileId: 'asc' }],
      take: limit + 1,
      ...(cursor
        ? {
            cursor: { id: cursor },
            skip: 1,
          }
        : {}),
      select: {
        id: true,
        aoeProfileId: true,
        aoeProfileUrl: true,
        nickname: true,
      },
    });

    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;
    const nextCursor = hasMore ? items[items.length - 1]!.id : null;

    return { items, nextCursor };
  }

  async findClaimedByAoeProfileIds(aoeProfileIds: string[]) {
    if (aoeProfileIds.length === 0) return [] as { aoeProfileId: string }[];
    return prisma.aoePlayer.findMany({
      where: { aoeProfileId: { in: aoeProfileIds }, NOT: { claimedByUserId: null } },
      select: { aoeProfileId: true },
    });
  }

  async filterUnclaimedByProfileIds(aoeProfileIds: string[]) {
    const ids = Array.from(new Set(aoeProfileIds.map((s) => String(s || '').trim()).filter(Boolean)));
    if (ids.length === 0) return { unclaimedAoeProfileIds: new Set<string>() };

    const claimed = await this.findClaimedByAoeProfileIds(ids);
    const claimedSet = new Set(claimed.map((r) => r.aoeProfileId));
    const unclaimed = new Set(ids.filter((id) => !claimedSet.has(id)));
    return { unclaimedAoeProfileIds: unclaimed };
  }

  async listUnclaimedDirectoryCandidates(args: { limit: number }) {
    const limit = Math.max(1, Math.min(200, args.limit));
    const rows = await prisma.aoePlayer.findMany({
      where: {
        claimedByUserId: null,
        aoeProfileId: { not: '' },
        nickname: { not: '' },
      },
      orderBy: [{ nickname: 'asc' }, { aoeProfileId: 'asc' }],
      take: limit,
      select: {
        aoeProfileId: true,
        nickname: true,
        steamId: true,
      },
    });

    return { items: rows };
  }

  async claimByAoeProfileId(args: { userId: string; aoeProfileId: string }) {
    const { userId, aoeProfileId } = args;

    // Atomic claim: only claim if currently unclaimed.
    const updated = await prisma.aoePlayer.updateMany({
      where: {
        aoeProfileId,
        claimedByUserId: null,
      },
      data: {
        claimedByUserId: userId,
        claimedAt: new Date(),
      },
    });

    return updated.count;
  }

  async createIfMissing(args: { aoeProfileId: string; aoeProfileUrl: string; nickname: string }) {
    try {
      return await prisma.aoePlayer.create({
        data: {
          aoeProfileId: args.aoeProfileId,
          aoeProfileUrl: args.aoeProfileUrl,
          nickname: args.nickname,
        },
        select: {
          id: true,
          aoeProfileId: true,
          aoeProfileUrl: true,
          nickname: true,
          claimedByUserId: true,
          claimedAt: true,
        },
      });
    } catch {
      // assume unique violation
      return null;
    }
  }

  async findClaimedByUserId(userId: string) {
    return prisma.aoePlayer.findUnique({
      where: { claimedByUserId: userId },
      select: {
        id: true,
        aoeProfileId: true,
        aoeProfileUrl: true,
        nickname: true,
        claimedAt: true,
      },
    });
  }

  async updateDirectoryFieldsByAoeProfileId(args: {
    aoeProfileId: string;
    nickname?: string | null;
    steamId?: string | null;
  }) {
    const { aoeProfileId, nickname, steamId } = args;

    // Build patch defensively: never overwrite with empty string.
    const data: any = {};
    if (typeof nickname === 'string' && nickname.trim()) data.nickname = nickname.trim();
    if (steamId === null) {
      // explicit null not used for now
    } else if (typeof steamId === 'string' && steamId.trim()) {
      data.steamId = steamId.trim();
    }

    if (Object.keys(data).length === 0) return null;

    return prisma.aoePlayer.update({
      where: { aoeProfileId },
      data,
      select: {
        id: true,
        aoeProfileId: true,
        aoeProfileUrl: true,
        nickname: true,
        steamId: true,
        claimedByUserId: true,
        claimedAt: true,
      },
    });
  }

  async findByAoeProfileId(aoeProfileId: string) {
    return prisma.aoePlayer.findUnique({
      where: { aoeProfileId },
      select: {
        id: true,
        aoeProfileId: true,
        aoeProfileUrl: true,
        nickname: true,
        steamId: true,
        claimedByUserId: true,
        claimedAt: true,
      },
    });
  }
}
