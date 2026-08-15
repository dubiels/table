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
	if (toasts.some((t) => t.message === message && t.tone === tone)) return;
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
