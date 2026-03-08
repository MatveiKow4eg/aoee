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

  async findByAoeProfileId(aoeProfileId: string) {
    return prisma.aoePlayer.findUnique({
      where: { aoeProfileId },
      select: {
        id: true,
        aoeProfileId: true,
        aoeProfileUrl: true,
        nickname: true,
        claimedByUserId: true,
        claimedAt: true,
      },
    });
  }
}
