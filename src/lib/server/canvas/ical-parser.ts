import ical from 'ical';

export interface CanvasEvent {
	title: string;
	dueDate: string;
	courseId: string;
	courseName: string;
	eventId: string;
}

export function parseCanvasIcal(icsText: string): CanvasEvent[] {
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const cal = ical.parseICS(icsText) as any;
	const events: CanvasEvent[] = [];
	const now = new Date();
	const sevenDaysOut = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

	for (const key in cal) {
		const comp = cal[key];
		if (!comp || comp.type !== 'VEVENT') continue;

		const dueData = comp.properties?.due?.[0];
		const dueDate = dueData ? new Date(dueData) : null;
		if (!dueDate || isNaN(dueDate.getTime()) || dueDate > sevenDaysOut) continue;

		// Parse course info from DESCRIPTION field
		const description = (comp.properties?.description?.[0] as string) || '';
		const courseMatch = description.match(/^([A-Z0-9]+)/);
		const courseId = courseMatch?.[1] || 'Unknown';
		const courseName = courseId;

		events.push({
			title: (comp.properties?.summary?.[0] as string) || 'Untitled',
			dueDate: dueDate.toISOString(),
			courseId,
			courseName,
			eventId: (comp.properties?.uid?.[0] as string) || ''
		});
	}

	return events;
}
