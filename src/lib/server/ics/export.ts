export interface IcsTask {
	id: string;
	title: string;
	dueDate: string | null;
	done: boolean;
	courseName: string | null;
	notes: string | null;
}

const CRLF = '\r\n';
const FOLD_LIMIT = 75;

/** Escapes RFC 5545 text: backslash, comma, semicolon, then literal newlines. */
function escapeText(value: string): string {
	return value
		.replace(/\\/g, '\\\\')
		.replace(/,/g, '\\,')
		.replace(/;/g, '\\;')
		.replace(/\r\n|\r|\n/g, '\\n');
}

/** Folds a content line to at most 75 octets per physical line (RFC 5545 §3.1), CRLF + leading space on continuations. */
function foldLine(line: string): string {
	const bytes = Buffer.from(line, 'utf8');
	if (bytes.length <= FOLD_LIMIT) return line;

	const chunks: string[] = [];
	let start = 0;
	let limit = FOLD_LIMIT;
	while (start < bytes.length) {
		let end = Math.min(start + limit, bytes.length);
		// Never split a multi-byte UTF-8 sequence: back off while the next byte is a continuation byte (10xxxxxx).
		while (end < bytes.length && (bytes[end] & 0xc0) === 0x80) {
			end--;
		}
		chunks.push(bytes.subarray(start, end).toString('utf8'));
		start = end;
		limit = FOLD_LIMIT - 1; // continuation lines are prefixed with one space
	}
	return chunks.join(CRLF + ' ');
}

function toBasicDate(dateStr: string): string {
	return dateStr.replace(/-/g, '');
}

function toUtcBasic(date: Date): string {
	return date
		.toISOString()
		.replace(/[-:]/g, '')
		.replace(/\.\d{3}Z$/, 'Z');
}

/** Builds a VCALENDAR of all-day VEVENTs, one per not-done task with a due date. */
export function buildTasksIcs(tasks: IcsTask[], now: Date): string {
	const dtstamp = toUtcBasic(now);
	const lines: string[] = [
		'BEGIN:VCALENDAR',
		'VERSION:2.0',
		'PRODID:-//Table//EN',
		'CALSCALE:GREGORIAN',
		'X-WR-CALNAME:Table tasks'
	];

	for (const task of tasks) {
		if (task.done || !task.dueDate) continue;

		const summary = task.courseName ? `[${task.courseName}] ${task.title}` : task.title;

		lines.push('BEGIN:VEVENT');
		lines.push(`UID:table-${task.id}`);
		lines.push(`DTSTAMP:${dtstamp}`);
		lines.push(`DTSTART;VALUE=DATE:${toBasicDate(task.dueDate)}`);
		lines.push(`SUMMARY:${escapeText(summary)}`);
		if (task.notes != null) {
			lines.push(`DESCRIPTION:${escapeText(task.notes)}`);
		}
		lines.push('END:VEVENT');
	}

	lines.push('END:VCALENDAR');

	return lines.map(foldLine).join(CRLF) + CRLF;
}
