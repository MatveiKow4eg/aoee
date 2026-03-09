import { prisma } from '../db/prisma';

export class AuthRepository {
  async findUserByEmail(email: string) {
    return prisma.user.findUnique({ where: { email } });
  }

  async hasSteamAccount(userId: string) {
    const acc = await prisma.account.findFirst({ where: { userId, provider: 'steam' }, select: { id: true } });
    return !!acc;
  }

  async listAccountProviders(userId: string): Promise<string[]> {
    const rows = await prisma.account.findMany({ where: { userId }, select: { provider: true } });
    return rows.map((r) => r.provider);
  }

  async findUserById(userId: string) {
    return prisma.user.findUnique({ where: { id: userId } });
  }

  async updateUserDisplayName(userId: string, displayName: string) {
    return prisma.user.update({
      where: { id: userId },
      data: { displayName },
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
        id: true,
        aoeProfileId: true,
        aoeProfileUrl: true,
        nickname: true,
        claimedAt: true,
        steamId: true,
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

  async getSteamAvatarUrlByUserId(userId: string): Promise<string | null> {
    // We store the SteamId only inside Account. Use it to fetch avatar via Steam Web API.
    const acc = await prisma.account.findFirst({
      where: { userId, provider: 'steam' },
      select: { providerAccountId: true },
    });
    const steamId = acc?.providerAccountId ?? null;
    if (!steamId) return null;

    const { getSteamPlayerSummary } = await import('../services/steamService');
    const summary = await getSteamPlayerSummary(steamId);
    return summary?.avatarMedium ?? summary?.avatarSmall ?? summary?.avatarFull ?? null;
  }
}
