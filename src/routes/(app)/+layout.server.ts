import type { LayoutServerLoad } from './$types';
import { isGoogleTasksEnabled } from '$lib/server/gtasks/sync';

export const load: LayoutServerLoad = async ({ locals }) => {
	// On the layout rather than the board's own load: the composer, the task
	// modal and the user menu all need it, at three different depths.
	return { user: locals.user, gtasksConfigured: isGoogleTasksEnabled() };
};
