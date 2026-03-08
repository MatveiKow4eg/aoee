import type { RequestHandler } from 'express';
import { URLSearchParams } from 'url';
import { AuthService } from '../services/authService';
import { AuthRepository } from '../repositories/authRepository';
import { getAuthConfig } from '../config/auth';
import { randomUUID } from 'crypto';
import { randomToken, sha256Base64Url } from '../utils/crypto';
import { getSteamPersonaName } from '../services/steamService';
import { tryAutoLinkSteamToAoe } from '../services/steamAutoLinkService';

const OPENID_NS = 'http://specs.openid.net/auth/2.0';
const OPENID_IDENTITY = 'http://specs.openid.net/auth/2.0/identifier_select';
const STEAM_OPENID = 'https://steamcommunity.com/openid/login';

const repo = new AuthRepository();
const auth = new AuthService(repo);

// Simple in-memory nonce store to mitigate replay (for demo; replace with Redis/DB in prod)
const nonces = new Map<string, number>();

function frontendRedirectUrl() {
  const { frontendBaseUrl } = getAuthConfig();
  return frontendBaseUrl || 'http://localhost:3000/login';
}

function extractSteamId(claimedId: string | undefined | null): string | null {
  if (!claimedId) return null;
  // Format: https://steamcommunity.com/openid/id/76561197960435530
  const m = claimedId.match(/\/openid\/id\/(\d+)/);
  return m ? m[1] : null;
}

export const steamAuthStart: RequestHandler = async (req, res, next) => {
  try {
    const returnTo = 'https://api.aoeestonia.ee/api/auth/steam/callback';

    const nonce = randomUUID();
    nonces.set(nonce, Date.now());

    const params = new URLSearchParams({
      'openid.ns': OPENID_NS,
      'openid.mode': 'checkid_setup',
      'openid.return_to': returnTo + `?state=${nonce}`,
      'openid.realm': `${req.protocol}://${req.get('host')}`,
      'openid.identity': OPENID_IDENTITY,
      'openid.claimed_id': OPENID_IDENTITY,
    });

    const redirectUrl = `${STEAM_OPENID}?${params.toString()}`;
    res.redirect(302, redirectUrl);
  } catch (err) {
    next(err);
  }
};

export const steamAuthCallback: RequestHandler = async (req, res, next) => {
  try {
    // Validate state (nonce)
    const state = String(req.query.state || '');
    const ts = nonces.get(state);
    if (!ts || Date.now() - ts > 5 * 60 * 1000) {
      return res.status(400).send('Invalid state');
    }
    nonces.delete(state);

    // Perform OpenID check_authentication
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(req.query)) {
      if (typeof v === 'string') params.append(k, v);
    }
    // Express may coerce parameters into arrays in some cases; take the first value.
    for (const [k, v] of Object.entries(req.query)) {
      if (Array.isArray(v) && typeof v[0] === 'string') params.append(k, v[0]);
    }
    params.set('openid.mode', 'check_authentication');

    const verifyRes = await fetch(STEAM_OPENID, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    });
    const text = await verifyRes.text();
    if (!/is_valid\s*:\s*true/i.test(text)) {
      return res.status(400).send('OpenID validation failed');
    }

    const claimedId = typeof req.query['openid.claimed_id'] === 'string' ? (req.query['openid.claimed_id'] as string) : null;
    const steamId = extractSteamId(claimedId);
    if (!steamId) return res.status(400).send('Missing steamId');

    // Find or create user by steamId
    let user = await repo.findUserBySteamId(steamId);
    if (!user) {
      user = await repo.createUserWithSteam({ steamId });
    }

    // Resolve Steam nickname (best-effort).
    const steamNickname = await getSteamPersonaName(steamId);

    // Store some human-readable name on user (best-effort; never fail login).
    // We don't store steamId on User directly (it lives in Account).
    try {
      if (steamNickname && !user.displayName) {
        user = await repo.updateUserDisplayName(user.id, steamNickname);
      }
    } catch {
      // ignore
    }

    // Best-effort: strict auto-linking by Steam nickname -> AoE2 Insights -> internal DB.
    // This must never break Steam login.
    try {
      const needsLink = !user.aoeProfileId;
      if (needsLink && steamNickname) {
        const result = await tryAutoLinkSteamToAoe({
          userId: user.id,
          steamId,
          steamNickname,
        });
        if (result.ok && result.linked) {
          user = (await repo.findUserById(user.id)) ?? user;
        }
      }
    } catch {
      // ignore
    }

    // Create session
    const { sessionTtlDays, tokenPepper } = getAuthConfig();
    const token = randomToken(32);
    const tokenHash = sha256Base64Url(token + tokenPepper);
    const expiresAt = new Date(Date.now() + sessionTtlDays * 24 * 60 * 60 * 1000);

    await repo.createSession({ userId: user.id, tokenHash, expiresAt, ip: req.ip, userAgent: req.headers['user-agent'] });

    // Set cookie
    const isProd = process.env.NODE_ENV === 'production';
    const { cookieName } = getAuthConfig();
    const parts = [
      `${cookieName}=${encodeURIComponent(token)}`,
      'Path=/',
      'HttpOnly',
      'SameSite=Lax',
      `Expires=${expiresAt.toUTCString()}`,
    ];
    if (isProd) parts.push('Secure');
    res.setHeader('Set-Cookie', parts.join('; '));

    res.redirect(302, frontendRedirectUrl());
  } catch (err) {
    next(err);
  }
};
