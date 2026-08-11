import type { LayoutServerLoad } from './$types';
import { countUnreadNotifications } from '$lib/server/notifications/log';
import { isGoogleTasksEnabled } from '$lib/server/gtasks/sync';

export const load: LayoutServerLoad = async ({ locals, depends }) => {
	// This load reads only `locals`, so SvelteKit has nothing to invalidate it on
	// during client-side navigation. The inbox marks notifications read and then
	// invalidates this key so the topbar badge clears without a full reload.
	depends('app:notifications');
	const unreadCount = locals.user ? await countUnreadNotifications(locals.user.id) : 0;
	// On the layout rather than the board's own load: the composer, the task
	// modal and the user menu all need it, at three different depths.
	return { user: locals.user, unreadCount, gtasksConfigured: isGoogleTasksEnabled() };
};
