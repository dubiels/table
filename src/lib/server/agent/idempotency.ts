import { createHash, randomUUID } from 'node:crypto';
import { and, eq, isNull } from 'drizzle-orm';
import { db } from '../db';
import { agentIdempotency } from '../db/schema';

/**
 * How long a claim may sit unfinished before another attempt may take it over.
 *
 * A process killed between claiming a key and storing its result leaves a row
 * that says "in flight" with nothing ever coming to finish it. Without a
 * takeover window that key answers 409 forever, and the agent — which retries
 * with the same key by design — could never complete that write again.
 */
const IN_FLIGHT_TIMEOUT_MS = 60_000;

export interface WriteResult {
	status: number;
	body: unknown;
}

export type IdempotentOutcome =
	| { kind: 'fresh'; status: number; body: unknown }
	| { kind: 'replay'; status: number; body: unknown }
	| { kind: 'conflict'; code: 'idempotency_key_reused' | 'idempotency_key_in_flight' };

const isSuccess = (status: number) => status >= 200 && status < 300;

/** A stable hash of the body a key was used with, so a reuse can be spotted. */
export function fingerprintOf(body: unknown): string {
	return createHash('sha256')
		.update(JSON.stringify(body ?? null))
		.digest('hex');
}

/**
 * Runs a write at most once per idempotency key.
 *
 * Two mechanisms, and they solve different problems.
 *
 * The **claim** makes the write happen once. It is taken by inserting the row
 * before the work starts: two retries that arrive together interleave across
 * the first `await` inside `run`, so a check-then-write would let both through.
 * `onConflictDoNothing` plus the primary key makes that indivisible.
 *
 * The **claim token** makes ownership unambiguous once a claim has been taken
 * over. Everything after the initial insert — the takeover itself, storing the
 * result, releasing on failure — is conditioned on still holding the token we
 * wrote. Without that fence a request that stalled past the takeover window and
 * then woke up would happily delete or overwrite the result of the attempt that
 * replaced it, and two attempts could each decide the same claim was stale and
 * both run the write.
 *
 * Only a 2xx is stored. A cached 400 would be permanent: the agent would fix
 * its payload, retry under the same key, and be handed the old rejection
 * forever. A failed attempt releases its own claim instead.
 */
export async function withIdempotency(
	key: string | null | undefined,
	route: string,
	run: () => Promise<WriteResult>,
	fingerprint?: string
): Promise<IdempotentOutcome> {
	if (!key) {
		const result = await run();
		return { kind: 'fresh', ...result };
	}

	const token = randomUUID();
	const now = new Date().toISOString();

	// Synchronous on better-sqlite3, which is what makes the claim indivisible:
	// there is no await between the insert and reading whether it landed.
	const claimed = db
		.insert(agentIdempotency)
		.values({ key, route, claim: token, fingerprint: fingerprint ?? null, createdAt: now })
		.onConflictDoNothing()
		.run();

	if (claimed.changes === 0) {
		const taken = await takeOver(key, route, token, fingerprint);
		if (taken !== 'owned') return taken;
	}

	let result: WriteResult;
	try {
		result = await run();
	} catch (err) {
		await release(key, token);
		throw err;
	}

	if (!isSuccess(result.status)) {
		await release(key, token);
		return { kind: 'fresh', ...result };
	}

	// Serialised before the write and never allowed to throw: the work has
	// already committed by this point, so a body that will not stringify must not
	// leave the row claimed-but-incomplete — that state answers 409 until the
	// takeover window passes and then runs the write a second time.
	let response = 'null';
	try {
		response = JSON.stringify(result.body) ?? 'null';
	} catch (err) {
		console.error('agent api: could not serialise a response for replay', err);
	}

	// Fenced on the token: if this attempt was taken over while `run` was in
	// flight, the row now belongs to someone else and this write must not land.
	await db
		.update(agentIdempotency)
		.set({ status: result.status, response })
		.where(and(eq(agentIdempotency.key, key), eq(agentIdempotency.claim, token)));

	return { kind: 'fresh', ...result };
}

/**
 * Resolves a key that is already claimed: replay it, refuse it, or seize it.
 *
 * Returns `'owned'` only when this attempt now holds the claim under `token`.
 */
async function takeOver(
	key: string,
	route: string,
	token: string,
	fingerprint?: string
): Promise<IdempotentOutcome | 'owned'> {
	const existing = await db.query.agentIdempotency.findFirst({
		where: eq(agentIdempotency.key, key)
	});

	// Gone between the failed insert and this read — the attempt that held it
	// released it. Nothing is recorded under this key, so try for it again.
	if (!existing) {
		const retaken = db
			.insert(agentIdempotency)
			.values({
				key,
				route,
				claim: token,
				fingerprint: fingerprint ?? null,
				createdAt: new Date().toISOString()
			})
			.onConflictDoNothing()
			.run();
		// Lost the second race too. Refusing beats recursing: the caller retries,
		// and an unbounded self-call on a request path is not worth the tidiness.
		return retaken.changes === 1
			? 'owned'
			: { kind: 'conflict', code: 'idempotency_key_in_flight' };
	}

	if (existing.route !== route) return { kind: 'conflict', code: 'idempotency_key_reused' };

	// A key names one intended write. The same key with a different body is a
	// client bug, and replaying the first result would silently drop the second
	// write while reporting success.
	if (fingerprint && existing.fingerprint && existing.fingerprint !== fingerprint) {
		return { kind: 'conflict', code: 'idempotency_key_reused' };
	}

	// `status` alone decides completeness. `response` can legitimately be the
	// string "null", and requiring both non-null would read a finished write as
	// still running.
	if (existing.status !== null) {
		return {
			kind: 'replay',
			status: existing.status,
			body: existing.response === null ? null : JSON.parse(existing.response)
		};
	}

	const age = Date.now() - Date.parse(existing.createdAt);
	if (age < IN_FLIGHT_TIMEOUT_MS) return { kind: 'conflict', code: 'idempotency_key_in_flight' };

	// Stale. Seize it by swapping the token, conditioned on the token that was
	// read — so of two attempts that both judge it stale, exactly one wins and
	// the other is told to wait rather than running the write alongside it.
	const seized = db
		.update(agentIdempotency)
		.set({ claim: token, createdAt: new Date().toISOString() })
		.where(
			and(
				eq(agentIdempotency.key, key),
				// A row claimed before this column existed carries null, and `= NULL`
				// matches nothing in SQL — so it needs IS NULL or such a row could
				// never be seized and its key would answer 409 forever.
				existing.claim === null
					? isNull(agentIdempotency.claim)
					: eq(agentIdempotency.claim, existing.claim)
			)
		)
		.run();

	return seized.changes === 1 ? 'owned' : { kind: 'conflict', code: 'idempotency_key_in_flight' };
}

/** Drops this attempt's claim, and only this attempt's. */
function release(key: string, token: string): Promise<unknown> {
	return db
		.delete(agentIdempotency)
		.where(and(eq(agentIdempotency.key, key), eq(agentIdempotency.claim, token)));
}
