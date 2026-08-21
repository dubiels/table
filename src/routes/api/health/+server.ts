import { json } from '@sveltejs/kit';

/**
 * Process liveness only — no database read, no dependency check.
 *
 * The deploy step gates a rollback on this, so it must answer 200 whenever the
 * server is accepting requests and must never fail for a reason unrelated to
 * the server being up.
 */
export const GET = async () => json({ ok: true }, { headers: { 'cache-control': 'no-store' } });
