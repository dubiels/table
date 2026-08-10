import type { LayoutServerLoad } from './$types';
import { countUnreadNotifications } from '$lib/server/notifications/log';

export const load: LayoutServerLoad = async ({ locals, depends }) => {
	// This load reads only `locals`, so SvelteKit has nothing to invalidate it on
	// during client-side navigation. The inbox marks notifications read and then
	// invalidates this key so the topbar badge clears without a full reload.
	depends('app:notifications');
	const unreadCount = locals.user ? await countUnreadNotifications(locals.user.id) : 0;
	return { user: locals.user, unreadCount };
};
