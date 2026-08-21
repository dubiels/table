import { eq } from 'drizzle-orm';
import { db } from '../db';
import { agentIdempotency } from '../db/schema';

/**
 * How long a claim may sit unfinished before another attempt may take it over.
 *
 * A process killed between claiming a key and storing its result leaves a row
 * that says "in flight" with nothing ever coming to finish it. Without a
 * takeover window that key answers 409 forever, and the agent — which retries
 * with the same key by design — could never complete that write again.
 *
 * A minute is far longer than any write here takes (a service call and at most
 * one bounded Google push) while still being short enough that a crashed
 * request recovers on the next retry rather than the next deploy.
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

/**
 * Runs a write at most once per idempotency key.
 *
 * The key is claimed by inserting its row *before* the work starts. Two retries
 * that arrive together interleave across the first `await` inside `run`, so a
 * check-then-write would let both of them through and create two rows — which
 * is the entire failure this exists to prevent. `onConflictDoNothing` plus the
 * primary key makes the claim atomic, and `changes` says which caller won it.
 *
 * Only a 2xx is stored. A cached 400 would be permanent: the agent would fix
 * its payload, retry under the same key it already used, and be handed the old
 * rejection forever. A failed attempt releases the claim instead, so the retry
 * is a fresh one.
 */
export async function withIdempotency(
	key: string | null | undefined,
	route: string,
	run: () => Promise<WriteResult>
): Promise<IdempotentOutcome> {
	if (!key) {
		const result = await run();
		return { kind: 'fresh', ...result };
	}

	const now = new Date().toISOString();
	// Synchronous on better-sqlite3, which is what makes the claim indivisible:
	// there is no await between the insert and reading whether it landed.
	const claim = db
		.insert(agentIdempotency)
		.values({ key, route, status: null, response: null, createdAt: now })
		.onConflictDoNothing()
		.run();

	if (claim.changes === 0) {
		const existing = await db.query.agentIdempotency.findFirst({
			where: eq(agentIdempotency.key, key)
		});

		// Gone between the failed insert and this read — another attempt released
		// it. Nothing is recorded under this key any more, so this attempt is
		// entitled to try for it again.
		if (!existing) return withIdempotency(key, route, run);

		if (existing.route !== route) return { kind: 'conflict', code: 'idempotency_key_reused' };

		if (existing.status !== null && existing.response !== null) {
			return { kind: 'replay', status: existing.status, body: JSON.parse(existing.response) };
		}

		const age = Date.now() - Date.parse(existing.createdAt);
		if (age < IN_FLIGHT_TIMEOUT_MS) {
			return { kind: 'conflict', code: 'idempotency_key_in_flight' };
		}
		// Stale: whoever claimed this never came back. Re-stamp it so this attempt
		// owns the claim and a third one waits behind it rather than joining in.
		await db.update(agentIdempotency).set({ createdAt: now }).where(eq(agentIdempotency.key, key));
	}

	let result: WriteResult;
	try {
		result = await run();
	} catch (err) {
		await release(key);
		throw err;
	}

	if (!isSuccess(result.status)) {
		await release(key);
		return { kind: 'fresh', ...result };
	}

	await db
		.update(agentIdempotency)
		.set({ status: result.status, response: JSON.stringify(result.body) })
		.where(eq(agentIdempotency.key, key));

	return { kind: 'fresh', ...result };
}

function release(key: string): Promise<unknown> {
	return db.delete(agentIdempotency).where(eq(agentIdempotency.key, key));
}
