// Centralized rating constants for challenge system.
// Keep as plain numbers to make them easy to tune later.

export const CHALLENGE_WIN_POINTS = 20;
export const CHALLENGE_LOSS_POINTS = -10;

export type UserRatingEventReason = 'CHALLENGE_WIN' | 'CHALLENGE_LOSS' | 'ADMIN_ADJUST';
