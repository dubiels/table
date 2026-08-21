import { createHash, timingSafeEqual } from 'node:crypto';

const digest = (value: string) => createHash('sha256').update(value).digest();

/** Hashes both sides then compares timing-safely, so lengths always match. */
export function tokensMatch(a: string, b: string): boolean {
	return timingSafeEqual(digest(a), digest(b));
}

/**
 * The credential out of an `Authorization: Bearer <token>` header, or null.
 *
 * Deliberately strict about the scheme: a header carrying the bare token with
 * no `Bearer ` prefix is a malformed request, not a near-miss to be salvaged.
 */
export function bearerToken(authorizationHeader: string | null): string | null {
	return authorizationHeader?.match(/^Bearer (.+)$/)?.[1] ?? null;
}

/**
 * Whether the header presents the configured token.
 *
 * The single implementation of the comparison, shared by every bearer-guarded
 * route. Two copies of a security check are two chances for one of them to
 * drift into a `===` some day.
 */
export function bearerMatches(
	configuredToken: string,
	authorizationHeader: string | null
): boolean {
	const presented = bearerToken(authorizationHeader);
	return presented !== null && tokensMatch(configuredToken, presented);
}
