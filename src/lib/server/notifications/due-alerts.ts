import { localDateString } from '$lib/listView';
import { formatDueDate, type NotificationContent } from './digest';

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

export function buildDueSoonContent(
	tasks: { id: string; title: string; dueDate: string | null }[]
): NotificationContent {
	const summary = `${tasks.length} task${tasks.length === 1 ? '' : 's'} due soon.`;
	const lines = tasks.map(
		(t) => `• ${t.title}${t.dueDate ? ` — due ${formatDueDate(t.dueDate)}` : ''}`
	);
	return { text: [summary, ...lines].join('\n'), summary, taskIds: tasks.map((t) => t.id) };
}

// Generic so callers passing full task rows get full rows back — the alert
// content needs titles, which DueAlertTask itself doesn't require.
export function findTasksNeedingDueAlert<T extends DueAlertTask>(
	tasks: T[],
	sentNotifications: SentNotification[],
	now: Date,
	leadWindowHours: number
): T[] {
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
		// No Z: a date-time without an offset parses as local time, so the task
		// comes due at local midnight. The Z form anchored it at UTC midnight,
		// which is the small hours of the previous evening here — every alert
		// fired up to a whole timezone offset early.
		const due = new Date(`${t.dueDate}T00:00:00`);
		return due <= windowEnd;
	});
}
