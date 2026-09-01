import { z } from 'zod';
import { withIdempotency, fingerprintOf, type WriteResult } from './idempotency';

export type ErrorCode =
	| 'invalid_body'
	| 'invalid_query'
	| 'unauthorized'
	| 'not_found'
	| 'method_not_allowed'
	| 'idempotency_key_reused'
	| 'idempotency_key_in_flight'
	| 'internal';

/**
 * A failure with a status and a machine-readable code already decided.
 *
 * Thrown rather than returned so a route reads as its happy path — `const task
 * = await requireTask(id)` — while still producing a structured error. The
 * alternative, threading a result union through every step, buys nothing here:
 * every failure ends the request.
 */
export class ApiError extends Error {
	constructor(
		readonly status: number,
		readonly code: ErrorCode,
		message: string,
		readonly details?: unknown
	) {
		super(message);
		this.name = 'ApiError';
	}
}

export const notFound = (what: string) => new ApiError(404, 'not_found', `${what} not found`);

function jsonResponse(
	status: number,
	body: unknown,
	headers: Record<string, string> = {}
): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...headers }
	});
}

export function errorBody(code: ErrorCode, message: string, details?: unknown) {
	return { error: details === undefined ? { code, message } : { code, message, details } };
}

function errorResponse(err: unknown): Response {
	if (err instanceof ApiError) {
		return jsonResponse(err.status, errorBody(err.code, err.message, err.details));
	}
	// Deliberately opaque. The agent can do nothing with a stack trace, and the
	// message may name a database column or a Google response.
	console.error('agent api: unhandled failure', err);
	return jsonResponse(500, errorBody('internal', 'Unexpected server error'));
}

/** Validates against a schema, turning a failure into a 400 the agent can read. */
export function parse<T>(
	schema: z.ZodType<T>,
	value: unknown,
	code: ErrorCode = 'invalid_body'
): T {
	const result = schema.safeParse(value);
	if (result.success) return result.data;
	throw new ApiError(
		400,
		code,
		'Request failed validation',
		// Flattened to path + message: the agent needs to know which field it got
		// wrong, not how Zod represents that internally.
		result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message }))
	);
}

async function readJsonBody(request: Request): Promise<Record<string, unknown>> {
	const raw = await request.text();
	// DELETE and the archive toggles carry no body, and an absent body is not a
	// malformed one — it is an empty patch, which the schemas judge on their own.
	if (raw.trim() === '') return {};
	try {
		const parsed: unknown = JSON.parse(raw);
		if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
			throw new ApiError(400, 'invalid_body', 'Body must be a JSON object');
		}
		return parsed as Record<string, unknown>;
	} catch (err) {
		if (err instanceof ApiError) throw err;
		throw new ApiError(400, 'invalid_body', 'Body must be valid JSON');
	}
}

/** A `?flag=` query parameter. Absent means the caller expressed no preference. */
export function boolParam(url: URL, key: string): boolean | undefined {
	const raw = url.searchParams.get(key);
	if (raw === null) return undefined;
	// Case-folded: `True` and `TRUE` are unambiguous, and a client that sends one
	// should not have its whole read rejected over the spelling. Genuinely
	// ambiguous values still fail rather than being guessed at.
	const value = raw.trim().toLowerCase();
	if (['true', '1', 'yes', 'on', ''].includes(value)) return true;
	if (['false', '0', 'no', 'off'].includes(value)) return false;
	throw new ApiError(400, 'invalid_query', `${key} must be true or false`);
}

/**
 * An instant from a query parameter, as epoch milliseconds.
 *
 * Validated rather than passed through, because the filter that consumes it
 * used to compare strings: `?since=yesterday` sorts below every ISO stamp, so
 * it silently matched nothing and returned `200 {"tasks":[]}` — an empty board,
 * indistinguishable from a real one, to a client with no way to tell. The same
 * went for any well-formed cursor whose spelling differed from the stored one
 * (no milliseconds, or a `+02:00` offset instead of `Z`).
 */
export function timestampParam(url: URL, key: string): number | undefined {
	const raw = url.searchParams.get(key);
	if (raw === null || raw.trim() === '') return undefined;
	const parsed = Date.parse(raw);
	if (Number.isNaN(parsed)) {
		throw new ApiError(
			400,
			'invalid_query',
			`${key} must be an ISO 8601 timestamp, e.g. 2026-09-01T00:00:00.000Z`
		);
	}
	return parsed;
}

export async function runRead(build: () => Promise<unknown>): Promise<Response> {
	try {
		return jsonResponse(200, await build());
	} catch (err) {
		return errorResponse(err);
	}
}

/**
 * Runs a write once per idempotency key and renders the outcome.
 *
 * The key is taken from the `Idempotency-Key` header, falling back to an
 * `idempotencyKey` field in the body — the header is the convention, the field
 * is there because a client that finds setting headers awkward should not have
 * to give up replay safety to avoid it.
 */
export async function runWrite(
	request: Request,
	route: string,
	run: (body: Record<string, unknown>) => Promise<WriteResult>
): Promise<Response> {
	try {
		const body = await readJsonBody(request);
		const headerKey = request.headers.get('idempotency-key');
		const bodyKey = typeof body.idempotencyKey === 'string' ? body.idempotencyKey : null;
		// The key is part of the envelope, not the intent, so it is excluded — a
		// client that sends the same key by header one time and in the body the
		// next must not read as having changed its request.
		const intent = { ...body };
		delete intent.idempotencyKey;
		const outcome = await withIdempotency(
			headerKey ?? bodyKey,
			route,
			() => run(body),
			fingerprintOf(intent)
		);

		if (outcome.kind === 'conflict') {
			const message =
				outcome.code === 'idempotency_key_reused'
					? 'This idempotency key was already used for a different operation or a different request body'
					: 'A request with this idempotency key is still in flight';
			return jsonResponse(409, errorBody(outcome.code, message));
		}

		return jsonResponse(
			outcome.status,
			outcome.body,
			// So a retrying client can tell "I created this" from "this already
			// existed" without diffing timestamps.
			outcome.kind === 'replay' ? { 'idempotency-replayed': 'true' } : {}
		);
	} catch (err) {
		return errorResponse(err);
	}
}
