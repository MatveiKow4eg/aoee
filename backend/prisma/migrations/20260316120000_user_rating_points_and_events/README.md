This migration adds:
- users.rating_points (default 0)
- user_challenges.rating_applied_at (nullable)
- user_rating_events table + UserRatingEventReason enum

Generated manually because DB was unreachable during `prisma migrate dev` (P1001).
Once DB is available, you can run `npx prisma migrate dev` to reconcile or apply.
