import { prisma } from '../db/prisma';

export type StatSnapshot = {
  id: string;
  aoePlayerId: string;
  leaderboardId: string | null;
  rating: number | null;
  rank: number | null;
  rankTotal: number | null;
  wins: number | null;
  losses: number | null;
  streak: number | null;
  syncedAt: Date;
};

export class AoePlayerStatSnapshotRepository {
  async upsertByAoePlayerId(args: {
    aoePlayerId: string;
    leaderboardId?: string | null;
    rating?: number | null;
    rank?: number | null;
    rankTotal?: number | null;
    wins?: number | null;
    losses?: number | null;
    streak?: number | null;
    syncedAt?: Date;
  }): Promise<StatSnapshot> {
    const syncedAt = args.syncedAt ?? new Date();

    return (prisma as any).aoePlayerStatSnapshot.upsert({
      where: { aoePlayerId: args.aoePlayerId },
      create: {
        aoePlayerId: args.aoePlayerId,
        leaderboardId: args.leaderboardId ?? null,
        rating: args.rating ?? null,
        rank: args.rank ?? null,
        rankTotal: args.rankTotal ?? null,
        wins: args.wins ?? null,
        losses: args.losses ?? null,
        streak: args.streak ?? null,
        syncedAt,
      },
      update: {
        leaderboardId: args.leaderboardId ?? null,
        rating: args.rating ?? null,
        rank: args.rank ?? null,
        rankTotal: args.rankTotal ?? null,
        wins: args.wins ?? null,
        losses: args.losses ?? null,
        streak: args.streak ?? null,
        syncedAt,
      },
      select: {
        id: true,
        aoePlayerId: true,
        leaderboardId: true,
        rating: true,
        rank: true,
        rankTotal: true,
        wins: true,
        losses: true,
        streak: true,
        syncedAt: true,
      },
    });
  }

  async findByAoeProfileId(aoeProfileId: string) {
    return (prisma as any).aoePlayerStatSnapshot.findFirst({
      where: {
        aoePlayer: {
          aoeProfileId,
        },
      },
      select: {
        id: true,
        aoePlayerId: true,
        leaderboardId: true,
        rating: true,
        rank: true,
        rankTotal: true,
        wins: true,
        losses: true,
        streak: true,
        syncedAt: true,
        aoePlayer: {
          select: { aoeProfileId: true },
        },
      },
    });
  }
}
