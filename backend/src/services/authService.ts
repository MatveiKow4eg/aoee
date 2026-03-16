import argon2 from 'argon2';
import { AuthRepository } from '../repositories/authRepository';
import { HttpError } from '../utils/httpError';
import { randomToken, sha256Base64Url } from '../utils/crypto';
import { getAuthConfig } from '../config/auth';

export type PublicUser = {
  id: string;
  email?: string | null;
  displayName?: string | null;
  role?: string | null;

  ratingPoints?: number;

  steamConnected?: boolean;
  providers?: string[];

  // Optional: UI avatar (e.g. Steam avatar when linked)
  avatarUrl?: string | null;

  // New roster claim model
  aoePlayer?: {
    id: string;
    aoeProfileId: string;
    aoeProfileUrl: string;
    nickname: string;
    steamId?: string | null;
    claimedAt?: string | null;
  } | null;
};

export class AuthService {
  constructor(private readonly repo = new AuthRepository()) {}

  private normalizeEmail(email: string) {
    return email.trim().toLowerCase();
  }

  async register(emailRaw: string, password: string) {
    const email = this.normalizeEmail(emailRaw);

    if (!email || !email.includes('@')) throw new HttpError(400, 'INVALID_EMAIL', 'Invalid email');
    if (typeof password !== 'string' || password.length < 8) throw new HttpError(400, 'WEAK_PASSWORD', 'Password too short');

    const existing = await this.repo.findUserByEmail(email);
    if (existing) {
      // avoid enumeration: still return 200-ish semantic? Here we use 409 but generic message.
      throw new HttpError(409, 'EMAIL_IN_USE', 'Unable to register');
    }

    const passwordHash = await argon2.hash(password, {
      type: argon2.argon2id,
      memoryCost: 19456,
      timeCost: 2,
      parallelism: 1,
    });

    const user = await this.repo.createUser({ email, passwordHash });
    return this.toPublicUser(user);
  }

  async login(emailRaw: string, password: string, ctx: { ip?: string; userAgent?: string }) {
    const email = this.normalizeEmail(emailRaw);

    if (!email || !email.includes('@')) throw new HttpError(400, 'INVALID_CREDENTIALS', 'Invalid credentials');

    const user = await this.repo.findUserByEmail(email);
    if (!user || !user.passwordHash || !user.isActive) {
      throw new HttpError(401, 'INVALID_CREDENTIALS', 'Invalid credentials');
    }

    const ok = await argon2.verify(user.passwordHash, password);
    if (!ok) throw new HttpError(401, 'INVALID_CREDENTIALS', 'Invalid credentials');

    const { sessionTtlDays, tokenPepper } = getAuthConfig();
    const token = randomToken(32);
    const tokenHash = sha256Base64Url(token + tokenPepper);
    const expiresAt = new Date(Date.now() + sessionTtlDays * 24 * 60 * 60 * 1000);

    await this.repo.createSession({
      userId: user.id,
      tokenHash,
      expiresAt,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    });

    return { token, user: this.toPublicUser(user), expiresAt };
  }

  async me(token: string | null) {
    if (!token) return { user: null as PublicUser | null };

    const { tokenPepper } = getAuthConfig();
    const tokenHash = sha256Base64Url(token + tokenPepper);

    const session = await this.repo.findSessionWithUserByTokenHash(tokenHash);
    if (!session) return { user: null as PublicUser | null };

    if (session.revokedAt) return { user: null as PublicUser | null };
    if (session.expiresAt.getTime() < Date.now()) return { user: null as PublicUser | null };
    if (!session.user.isActive) return { user: null as PublicUser | null };

    const claimed = await this.repo.findAoePlayerClaimedByUserId(session.user.id);
    const providers = await this.repo.listAccountProviders(session.user.id);
    const steamConnected = providers.includes('steam');

    const steamAvatarUrl = await this.repo.getSteamAvatarUrlByUserId(session.user.id);

    return {
      user: this.toPublicUser(session.user, claimed, {
        steamConnected,
        providers,
        avatarUrl: steamAvatarUrl,
      }),
    };
  }

  async logout(token: string | null) {
    if (!token) return;
    const { tokenPepper } = getAuthConfig();
    const tokenHash = sha256Base64Url(token + tokenPepper);

    try {
      await this.repo.revokeSession(tokenHash);
    } catch {
      // ignore if session not found
    }
  }

  private toPublicUser(
    user: any,
    claimed?: any | null,
    extra?: { steamConnected?: boolean; providers?: string[]; avatarUrl?: string | null },
  ): PublicUser {
    return {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      role: user.role,

      ratingPoints: typeof user?.ratingPoints === 'number' ? user.ratingPoints : 0,

      steamConnected: extra?.steamConnected ?? false,
      providers: extra?.providers ?? [],

      avatarUrl: extra?.avatarUrl ?? null,

      aoePlayer: claimed
        ? {
            id: claimed.id,
            aoeProfileId: claimed.aoeProfileId,
            aoeProfileUrl: claimed.aoeProfileUrl,
            nickname: claimed.nickname,
            steamId: claimed.steamId ?? null,
            claimedAt: claimed.claimedAt ? new Date(claimed.claimedAt).toISOString() : null,
          }
        : null,
    };
  }
}
