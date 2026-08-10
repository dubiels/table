import { localDateString } from '$lib/listView';

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
	// "Today" is a local-calendar question here, matching the rest of the app.
	// Under UTC this rolled over during the evening, so a task alerted in the
	// morning looked unalerted again and got a second notification before
	// midnight. sentAt is stored as a UTC ISO instant, so convert rather than
	// slice it — both sides have to be on the same calendar.
	const todayStr = localDateString(now);
	const windowEnd = new Date(now.getTime() + leadWindowHours * 60 * 60 * 1000);

	const alertedTaskIdsToday = new Set<string>();
	for (const n of sentNotifications) {
		if (n.type !== 'due_alert') continue;
		if (localDateString(new Date(n.sentAt)) !== todayStr) continue;
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
