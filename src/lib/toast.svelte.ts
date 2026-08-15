export interface ToastAction {
	label: string;
	run: () => void;
}

export interface Toast {
	id: number;
	message: string;
	tone: 'info' | 'success' | 'error';
	action?: ToastAction;
}

// Client-only: this is module-level state, so on the server it would be shared
// by every request. Nothing here may be imported into server code.
let nextId = 1;
export const toasts = $state<Toast[]>([]);

export function toast(
	message: string,
	tone: Toast['tone'] = 'info',
	timeoutMs = 4000,
	action?: ToastAction
) {
	// One failed drag can call this once per moved card — a zone with fifteen
	// tasks would stack sixteen identical pills. The first one already said it.
	// Actioned toasts are exempt from this guard: an action closes over
	// caller-specific state (e.g. the id an "Undo" restores), so two actioned
	// toasts that share a message and tone are not "the same event twice" the
	// way two identical failures are. Archive person A, then archive person B
	// within A's toast lifetime: both toasts read "Archived" — collapsing B's
	// would silently keep A's toast (and its closure over A's id) on screen,
	// so clicking Undo for what the user just did to B would restore A instead.
	if (!action && toasts.some((t) => t.message === message && t.tone === tone)) return;
	// At most one actioned toast may be live per (message, tone): drop any
	// earlier one before pushing this one, so exactly one undo is ever on
	// screen, and it is always the newest — and correctly targeted — one.
	if (action) {
		for (let i = toasts.length - 1; i >= 0; i--) {
			const t = toasts[i];
			if (t.action && t.message === message && t.tone === tone) toasts.splice(i, 1);
		}
	}
	const id = nextId++;
	toasts.push({ id, message, tone, action });
	setTimeout(() => {
		const i = toasts.findIndex((t) => t.id === id);
		if (i !== -1) toasts.splice(i, 1);
	}, timeoutMs);
}

/** Removes a toast early — an action that has been taken should not linger. */
export function dismissToast(id: number) {
	const i = toasts.findIndex((t) => t.id === id);
	if (i !== -1) toasts.splice(i, 1);
}
