export interface DueAlertTask {
	id: string;
	dueDate: string | null;
	done: boolean;
}

export interface SentNotification {
	type: string;
	sentAt: string;
	content: string;
}

export function findTasksNeedingDueAlert(
	tasks: DueAlertTask[],
	sentNotifications: SentNotification[],
	now: Date,
	leadWindowHours: number
): DueAlertTask[] {
	const todayStr = now.toISOString().slice(0, 10);
	const windowEnd = new Date(now.getTime() + leadWindowHours * 60 * 60 * 1000);

	const alertedTaskIdsToday = new Set<string>();
	for (const n of sentNotifications) {
		if (n.type !== 'due_alert') continue;
		if (n.sentAt.slice(0, 10) !== todayStr) continue;
		try {
			const parsed = JSON.parse(n.content) as { taskIds: string[] };
			for (const id of parsed.taskIds) alertedTaskIdsToday.add(id);
		} catch {
			// ignore malformed content
		}
	}

	return tasks.filter((t) => {
		if (t.done || !t.dueDate) return false;
		if (alertedTaskIdsToday.has(t.id)) return false;
		const due = new Date(`${t.dueDate}T00:00:00Z`);
		return due <= windowEnd;
	});
}
