import type { Reroute } from '@sveltejs/kit';

/**
 * Serves Dinner Table from its own subdomain while it lives inside Table.
 *
 * Only the root path is remapped. Rerouting everything would send `/login`,
 * `/api/*` and the service worker to `/dinner/...`, where nothing answers — and
 * there are no deep links into Dinner Table to preserve, because the open person
 * is component state rather than a URL.
 *
 * Doing this now means that if the module is ever extracted into its own
 * deployment, the change is a DNS record and no bookmark breaks.
 */
export const reroute: Reroute = ({ url }) => {
	if (!url.hostname.startsWith('dinner.')) return;
	if (url.pathname !== '/') return;
	return '/dinner';
};
