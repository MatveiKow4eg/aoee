import { prisma } from '../db/prisma';
import { HttpError } from '../utils/httpError';
import { CHALLENGE_LOSS_POINTS, CHALLENGE_WIN_POINTS } from '../config/rating';

export type MatchEventFormat = 'ONE_V_ONE' | 'TWO_V_TWO' | 'THREE_V_THREE' | 'FOUR_V_FOUR';
export type MatchEventStatus = 'OPEN' | 'COMPLETED' | 'CANCELLED';
export type MatchEventSide = 'A' | 'B';

export type CreateMatchEventParticipantInput = {
  side: MatchEventSide;
  slot: number;
  playerKey: string;
  userId?: string | null;
  aoeProfileId?: string | null;
  displayNameSnapshot: string;
  avatarUrlSnapshot?: string | null;
};

export type CreateMatchEventInput = {
  format: MatchEventFormat;
  notes?: string | null;
  participants: CreateMatchEventParticipantInput[];
};

const normalizePlayerKey = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

const formatToSlots = (format: MatchEventFormat): number => {
  switch (format) {
    case 'ONE_V_ONE':
      return 1;
    case 'TWO_V_TWO':
      return 2;
    case 'THREE_V_THREE':
      return 3;
    case 'FOUR_V_FOUR':
      return 4;
    default:
      return 1;
  }
};

export class MatchEventService {
  async adminCreate(createdByUserId: string, input: CreateMatchEventInput) {
    const format = (input?.format ?? '') as MatchEventFormat;
    const slots = formatToSlots(format);

    if (!format || !['ONE_V_ONE', 'TWO_V_TWO', 'THREE_V_THREE', 'FOUR_V_FOUR'].includes(format)) {
      throw new HttpError(400, 'INVALID_FORMAT', 'Invalid match format');
    }

    const participantsRaw = Array.isArray(input?.participants) ? input.participants : [];
    if (participantsRaw.length === 0) throw new HttpError(400, 'INVALID_PARTICIPANTS', 'participants is required');

    const participants = participantsRaw.map((p) => {
      const side = (p?.side ?? '') as MatchEventSide;
      const slot = typeof p?.slot === 'number' ? Math.trunc(p.slot) : NaN;
      const playerKey = normalizePlayerKey(p?.playerKey);
      const displayNameSnapshot = typeof p?.displayNameSnapshot === 'string' ? p.displayNameSnapshot.trim() : '';
      const avatarUrlSnapshot = typeof p?.avatarUrlSnapshot === 'string' ? p.avatarUrlSnapshot.trim() : null;
      const userId = typeof p?.userId === 'string' ? p.userId.trim() : null;
      const aoeProfileId = typeof p?.aoeProfileId === 'string' ? p.aoeProfileId.trim() : null;

      return { side, slot, playerKey, userId, aoeProfileId, displayNameSnapshot, avatarUrlSnapshot };
    });

    // Validate sides/slots
    for (const p of participants) {
      if (p.side !== 'A' && p.side !== 'B') throw new HttpError(400, 'INVALID_SIDE', 'Participant side must be A or B');
      if (!Number.isFinite(p.slot) || p.slot < 1 || p.slot > 4) throw new HttpError(400, 'INVALID_SLOT', 'Participant slot must be 1..4');
      if (!p.playerKey) throw new HttpError(400, 'INVALID_PLAYER_KEY', 'Participant playerKey is required');
      if (!p.displayNameSnapshot) throw new HttpError(400, 'INVALID_DISPLAY_NAME', 'Participant displayNameSnapshot is required');
    }

    // Ensure exact slots per side for the chosen format.
    const bySide = {
      A: participants.filter((p) => p.side === 'A'),
      B: participants.filter((p) => p.side === 'B'),
    };

    const validateSide = (side: 'A' | 'B') => {
      const arr = bySide[side];
      if (arr.length !== slots) {
        throw new HttpError(400, 'INVALID_TEAM_SIZE', `Team ${side} must have exactly ${slots} participants for format ${format}`);
      }
      const slotsSet = new Set(arr.map((x) => x.slot));
      if (slotsSet.size !== arr.length) throw new HttpError(400, 'DUPLICATE_SLOT', `Duplicate slot in team ${side}`);
      for (let s = 1; s <= slots; s++) {
        if (!slotsSet.has(s)) throw new HttpError(400, 'MISSING_SLOT', `Missing slot ${s} in team ${side}`);
      }
    };

    validateSide('A');
    validateSide('B');

    // Prevent duplicates across both teams (same playerKey twice)
    const keys = participants.map((p) => p.playerKey);
    const uniq = new Set(keys);
    if (uniq.size !== keys.length) throw new HttpError(400, 'DUPLICATE_PLAYER', 'Same playerKey cannot participate twice in one match');

    const notes = typeof input?.notes === 'string' ? input.notes : null;

    const created = await prisma.matchEvent.create({
      data: {
        format,
        status: 'OPEN',
        winnerSide: null,
        createdByUserId,
        notes,
        participants: {
          create: participants.map((p) => ({
            side: p.side,
            slot: p.slot,
            playerKey: p.playerKey,
            userId: p.userId,
            aoeProfileId: p.aoeProfileId,
            displayNameSnapshot: p.displayNameSnapshot,
            avatarUrlSnapshot: p.avatarUrlSnapshot,
          })),
        },
      },
      include: {
        createdByUser: { select: { id: true, displayName: true } },
        resolvedByUser: { select: { id: true, displayName: true } },
        participants: { orderBy: [{ side: 'asc' }, { slot: 'asc' }] },
      },
    });

    return created;
  }

  async adminList(params?: { status?: MatchEventStatus; limit?: number }) {
    const status = params?.status;
    const limit = typeof params?.limit === 'number' && params.limit > 0 ? Math.min(200, Math.trunc(params.limit)) : 50;

    return prisma.matchEvent.findMany({
      where: status ? { status } : undefined,
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: {
        createdByUser: { select: { id: true, displayName: true } },
        resolvedByUser: { select: { id: true, displayName: true } },
        participants: { orderBy: [{ side: 'asc' }, { slot: 'asc' }] },
      },
    });
  }

  async getById(id: string) {
    const eventId = typeof id === 'string' ? id.trim() : '';
    if (!eventId) throw new HttpError(400, 'INVALID_ID', 'id is required');

    const ev = await prisma.matchEvent.findUnique({
      where: { id: eventId },
      include: {
        createdByUser: { select: { id: true, displayName: true } },
        resolvedByUser: { select: { id: true, displayName: true } },
        participants: { orderBy: [{ side: 'asc' }, { slot: 'asc' }] },
      },
    });

    if (!ev) throw new HttpError(404, 'NOT_FOUND', 'Match event not found');
    return ev;
  }

  private async applyRatingIfNeeded(tx: any, eventId: string, now: Date) {
    const ev = await tx.matchEvent.findUnique({
      where: { id: eventId },
      include: { participants: true },
    });

    if (!ev) throw new HttpError(404, 'NOT_FOUND', 'Match event not found');

    if (ev.status !== 'COMPLETED') {
      return { applied: false, reason: `SKIP_STATUS_${String(ev.status)}` };
    }

    if (!ev.winnerSide) {
      return { applied: false, reason: 'SKIP_NO_WINNER' };
    }

    if (ev.ratingAppliedAt) {
      return { applied: false, reason: 'ALREADY_APPLIED' };
    }

    const winnerSide: MatchEventSide = ev.winnerSide as any;
    const loserSide: MatchEventSide = winnerSide === 'A' ? 'B' : 'A';

    const winners = (ev.participants ?? []).filter((p: any) => p.side === winnerSide);
    const losers = (ev.participants ?? []).filter((p: any) => p.side === loserSide);

    if (winners.length === 0 || losers.length === 0) {
      return { applied: false, reason: 'MISSING_PARTICIPANTS' };
    }

    // Ensure PlayerProfile exists for all participants
    const allKeys = Array.from(new Set((ev.participants ?? []).map((p: any) => normalizePlayerKey(p.playerKey)).filter(Boolean)));
    for (const k of allKeys) {
      await tx.playerProfile.upsert({
        where: { playerKey: k },
        create: { playerKey: k },
        update: {},
      });
    }

    // Apply rating points
    for (const p of winners) {
      await tx.playerProfile.update({
        where: { playerKey: normalizePlayerKey(p.playerKey) },
        data: { ratingPoints: { increment: CHALLENGE_WIN_POINTS } },
      });
    }

    for (const p of losers) {
      await tx.playerProfile.update({
        where: { playerKey: normalizePlayerKey(p.playerKey) },
        data: { ratingPoints: { increment: CHALLENGE_LOSS_POINTS } },
      });
    }

    // Create rating events (reuse existing PlayerRatingEvent ledger)
    await tx.playerRatingEvent.createMany({
      data: [
        ...winners.map((p: any) => ({
          playerKey: normalizePlayerKey(p.playerKey),
          challengeId: null,
          delta: CHALLENGE_WIN_POINTS,
          reason: 'CHALLENGE_WIN',
          createdAt: now,
        })),
        ...losers.map((p: any) => ({
          playerKey: normalizePlayerKey(p.playerKey),
          challengeId: null,
          delta: CHALLENGE_LOSS_POINTS,
          reason: 'CHALLENGE_LOSS',
          createdAt: now,
        })),
      ],
    });

    // Update participants snapshot result/delta
    await tx.matchEventParticipant.updateMany({
      where: { eventId, side: winnerSide },
      data: { result: 'WIN', ratingDelta: CHALLENGE_WIN_POINTS },
    });

    await tx.matchEventParticipant.updateMany({
      where: { eventId, side: loserSide },
      data: { result: 'LOSS', ratingDelta: CHALLENGE_LOSS_POINTS },
    });

    // Mark event as applied
    await tx.matchEvent.update({
      where: { id: eventId },
      data: { ratingAppliedAt: now },
    });

    return { applied: true, reason: 'APPLIED' };
  }

  async adminResolve(params: { eventId: string; adminUserId: string; winnerSide: MatchEventSide; notes?: string | null }, now = new Date()) {
    const eventId = typeof params.eventId === 'string' ? params.eventId.trim() : '';
    if (!eventId) throw new HttpError(400, 'INVALID_ID', 'eventId is required');

    const winnerSide = params.winnerSide;
    if (winnerSide !== 'A' && winnerSide !== 'B') throw new HttpError(400, 'INVALID_WINNER_SIDE', 'winnerSide must be A or B');

    const notes = typeof params.notes === 'string' ? params.notes : undefined;

    return prisma.$transaction(async (tx) => {
      const ev = await tx.matchEvent.findUnique({ where: { id: eventId } });
      if (!ev) throw new HttpError(404, 'NOT_FOUND', 'Match event not found');

      if (ev.status === 'CANCELLED') throw new HttpError(400, 'INVALID_STATUS', 'Cannot resolve a cancelled match');

      const updated = await tx.matchEvent.update({
        where: { id: eventId },
        data: {
          status: 'COMPLETED',
          winnerSide,
          resolvedAt: now,
          resolvedByUserId: params.adminUserId,
          notes: notes ?? ev.notes,
        },
      });

      await this.applyRatingIfNeeded(tx, eventId, now);

      const full = await tx.matchEvent.findUnique({
        where: { id: eventId },
        include: {
          createdByUser: { select: { id: true, displayName: true } },
          resolvedByUser: { select: { id: true, displayName: true } },
          participants: { orderBy: [{ side: 'asc' }, { slot: 'asc' }] },
        },
      });

      return full ?? updated;
    });
  }

  async adminCancel(params: { eventId: string; adminUserId: string; notes?: string | null }, now = new Date()) {
    const eventId = typeof params.eventId === 'string' ? params.eventId.trim() : '';
    if (!eventId) throw new HttpError(400, 'INVALID_ID', 'eventId is required');

    const notes = typeof params.notes === 'string' ? params.notes : undefined;

    const updated = await prisma.matchEvent.update({
      where: { id: eventId },
      data: {
        status: 'CANCELLED',
        winnerSide: null,
        resolvedAt: now,
        resolvedByUserId: params.adminUserId,
        notes,
      },
      include: {
        createdByUser: { select: { id: true, displayName: true } },
        resolvedByUser: { select: { id: true, displayName: true } },
        participants: { orderBy: [{ side: 'asc' }, { slot: 'asc' }] },
      },
    });

    return updated;
  }

  /**
   * Permanently delete a match event and all its participants.
   * Admin-only.
   */
  async adminDelete(params: { eventId: string; adminUserId: string }) {
    const eventId = typeof params.eventId === 'string' ? params.eventId.trim() : '';
    if (!eventId) throw new HttpError(400, 'INVALID_ID', 'eventId is required');

    // Note: rating events are not linked to match events (we reuse PlayerRatingEvent with challengeId=null),
    // so deleting a match event does NOT rollback rating history.
    // This is intentional for minimal design.

    return prisma.$transaction(async (tx) => {
      // Ensure exists
      const ev = await tx.matchEvent.findUnique({ where: { id: eventId }, select: { id: true } });
      if (!ev) throw new HttpError(404, 'NOT_FOUND', 'Match event not found');

      await tx.matchEventParticipant.deleteMany({ where: { eventId } });
      await tx.matchEvent.delete({ where: { id: eventId } });

      return { deleted: true };
    });
  }
}
