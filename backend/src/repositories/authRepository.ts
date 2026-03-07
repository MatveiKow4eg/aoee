import { prisma } from '../db/prisma';

export class AuthRepository {
  async findUserByEmail(email: string) {
    return prisma.user.findUnique({ where: { email } });
  }

  async updateUserAoe2InsightsLink(userId: string, args: { aoeProfileId: string; aoeProfileUrl: string; aoeNickname: string; aoeLinkedAt?: Date }) {
    return prisma.user.update({
      where: { id: userId },
      data: {
        aoeProfileId: args.aoeProfileId,
        aoeProfileUrl: args.aoeProfileUrl,
        aoeNickname: args.aoeNickname,
        aoeLinkedAt: args.aoeLinkedAt ?? new Date(),
      },
    });
  }

  async createUser(args: { email: string; passwordHash: string }) {
    return prisma.user.create({
      data: {
        email: args.email,
        passwordHash: args.passwordHash,
        isActive: true,
        role: 'USER',
      },
    });
  }

  async createSession(args: {
    userId: string;
    tokenHash: string;
    expiresAt: Date;
    ip?: string;
    userAgent?: string;
  }) {
    return prisma.session.create({
      data: {
        userId: args.userId,
        tokenHash: args.tokenHash,
        expiresAt: args.expiresAt,
        ip: args.ip,
        userAgent: args.userAgent,
      },
    });
  }

  async findSessionWithUserByTokenHash(tokenHash: string) {
    return prisma.session.findUnique({
      where: { tokenHash },
      include: { user: true },
    });
  }

  async findAoePlayerClaimedByUserId(userId: string) {
    return prisma.aoePlayer.findUnique({
      where: { claimedByUserId: userId },
      select: {
        aoeProfileId: true,
        aoeProfileUrl: true,
        nickname: true,
        claimedAt: true,
      },
    });
  }

  async revokeSession(tokenHash: string) {
    return prisma.session.update({
      where: { tokenHash },
      data: { revokedAt: new Date() },
    });
  }

  async deleteExpiredSessions(now = new Date()) {
    return prisma.session.deleteMany({
      where: {
        expiresAt: { lt: now },
      },
    });
  }

  // Accounts (Steam, etc.)
  async findUserBySteamId(steamId: string) {
    const account = await prisma.account.findUnique({
      where: { provider_providerAccountId: { provider: 'steam', providerAccountId: steamId } },
      include: { user: true },
    });
    return account?.user ?? null;
  }

  async createUserWithSteam(args: { steamId: string; displayName?: string | null }) {
    return prisma.user.create({
      data: {
        displayName: args.displayName ?? null,
        isActive: true,
        role: 'USER',
        accounts: {
          create: {
            provider: 'steam',
            providerAccountId: args.steamId,
          },
        },
      },
    });
  }

  async linkSteamToUser(userId: string, steamId: string) {
    // Ensure not already linked to someone else
    const existing = await prisma.account.findUnique({
      where: { provider_providerAccountId: { provider: 'steam', providerAccountId: steamId } },
    });
    if (existing && existing.userId !== userId) {
      throw new Error('STEAM_ID_ALREADY_LINKED');
    }
    return prisma.account.upsert({
      where: { provider_providerAccountId: { provider: 'steam', providerAccountId: steamId } },
      update: { userId },
      create: { userId, provider: 'steam', providerAccountId: steamId },
    });
  }

  async unlinkSteamFromUser(userId: string) {
    // Prevent removing last auth method
    const accounts = await prisma.account.findMany({ where: { userId } });
    const user = await prisma.user.findUnique({ where: { id: userId } });
    const hasPassword = !!user?.passwordHash;
    if (accounts.length <= 1 && !hasPassword) {
      throw new Error('CANNOT_REMOVE_LAST_LOGIN_METHOD');
    }
    return prisma.account.deleteMany({ where: { userId, provider: 'steam' } });
  }
}
