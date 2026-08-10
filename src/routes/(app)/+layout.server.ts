import type { LayoutServerLoad } from './$types';
import { countUnreadNotifications } from '$lib/server/notifications/log';

export const load: LayoutServerLoad = async ({ locals }) => {
	const unreadCount = locals.user ? await countUnreadNotifications(locals.user.id) : 0;
	return { user: locals.user, unreadCount };
};
