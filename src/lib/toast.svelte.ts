export interface Toast {
	id: number;
	message: string;
	tone: 'info' | 'success' | 'error';
}

let nextId = 1;
export const toasts = $state<Toast[]>([]);

export function toast(message: string, tone: Toast['tone'] = 'info', timeoutMs = 4000) {
	const id = nextId++;
	toasts.push({ id, message, tone });
	setTimeout(() => {
		const i = toasts.findIndex((t) => t.id === id);
		if (i !== -1) toasts.splice(i, 1);
	}, timeoutMs);
}
