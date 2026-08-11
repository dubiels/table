import { localDateString } from '$lib/listView';

export interface DigestTask {
	id: string;
	title: string;
	dueDate: string | null;
	done: boolean;
}

export interface NotificationContent {
	text: string;
	summary: string;
	taskIds: string[];
}

// Due dates are local YYYY-MM-DD; parsing the parts keeps the day from
// shifting the way new Date('YYYY-MM-DD') (UTC midnight) would.
export function formatDueDate(dueDate: string): string {
	const [year, month, day] = dueDate.split('-').map(Number);
	return new Date(year, month - 1, day).toLocaleDateString('en-US', {
		month: 'short',
		day: 'numeric'
	});
}

export function buildMorningDigestContent(tasks: DigestTask[], today: Date): NotificationContent {
	const open = tasks.filter((t) => !t.done);
	if (open.length === 0) {
		const text = "There's nothing on the table today.";
		return { text, summary: text, taskIds: [] };
	}

	// Due dates are local YYYY-MM-DD; toISOString() would answer for the UTC
	// calendar and roll the digest over to tomorrow during the evening.
	const todayStr = localDateString(today);
	const overdue = open.filter((t) => t.dueDate && t.dueDate < todayStr);
	const dueToday = open.filter((t) => t.dueDate === todayStr);

	const parts = [`${open.length} open task${open.length === 1 ? '' : 's'} on the table.`];
	if (overdue.length) parts.push(`${overdue.length} overdue.`);
	if (dueToday.length) parts.push(`${dueToday.length} due today.`);
	const summary = parts.join(' ');

	const taskIds = open.map((t) => t.id);
	const urgent = overdue.length + dueToday.length;
	if (urgent === 0) {
		return { text: summary, summary, taskIds };
	}

	const sections: string[] = [];
	if (overdue.length) {
		sections.push(
			['Overdue:', ...overdue.map((t) => `• ${t.title} — due ${formatDueDate(t.dueDate!)}`)].join(
				'\n'
			)
		);
	}
	if (dueToday.length) {
		sections.push(['Due today:', ...dueToday.map((t) => `• ${t.title}`)].join('\n'));
	}
	const rest = open.length - urgent;
	if (rest > 0) {
		sections.push(`…and ${rest} more on the table.`);
	}

	return { text: sections.join('\n\n'), summary, taskIds };
}
