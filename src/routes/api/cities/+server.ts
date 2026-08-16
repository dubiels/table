import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { citySearch } from '$lib/server/cities';

/**
 * Typeahead for the city field.
 *
 * No auth code here on purpose: `hooks.server.ts` redirects anything outside
 * `PUBLIC_PATHS` that arrives without a session, and this route is not in that
 * list. Adding a second check would be a second thing to keep right.
 *
 * The dataset is a read-only 69k-row table, so this is a cheap indexed lookup
 * and needs no caching beyond what the browser does with the response.
 */
export const GET: RequestHandler = async ({ url }) => {
	const q = url.searchParams.get('q') ?? '';
	return json({ cities: citySearch.search(q) });
};
