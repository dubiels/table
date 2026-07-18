export interface DigestTask {
	id: string;
	title: string;
	topicName: string;
	dueDate: string | null;
	done: boolean;
}

export function buildMorningDigestContent(
	tasks: DigestTask[],
	today: Date
): { text: string; taskIds: string[] } {
	const open = tasks.filter((t) => !t.done);
	if (open.length === 0) {
		return { text: "There's nothing on the table today.", taskIds: [] };
	}

	const todayStr = today.toISOString().slice(0, 10);
	const overdue = open.filter((t) => t.dueDate && t.dueDate < todayStr);
	const dueToday = open.filter((t) => t.dueDate === todayStr);

	const parts = [`${open.length} open task${open.length === 1 ? '' : 's'} on the table.`];
	if (overdue.length) parts.push(`${overdue.length} overdue.`);
	if (dueToday.length) parts.push(`${dueToday.length} due today.`);

	return { text: parts.join(' '), taskIds: open.map((t) => t.id) };
}
