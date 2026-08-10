import { describe, it, expect } from 'vitest';
import { buildTasksIcs } from './export';

const now = new Date('2026-08-09T12:00:00Z');

function task(overrides: Record<string, unknown> = {}) {
	return {
		id: 'abc-123',
		title: 'problem set 3',
		dueDate: '2026-08-20',
		done: false,
		courseName: null,
		notes: null,
		...overrides
	};
}

describe('buildTasksIcs', () => {
	it('emits an all-day VEVENT per active task with a due date', () => {
		const ics = buildTasksIcs([task()], now);
		expect(ics).toContain('BEGIN:VCALENDAR');
		expect(ics).toContain('BEGIN:VEVENT');
		expect(ics).toContain('UID:table-abc-123');
		expect(ics).toContain('DTSTART;VALUE=DATE:20260820');
		expect(ics).toContain('SUMMARY:problem set 3');
		expect(ics).toContain('END:VCALENDAR');
	});

	it('skips tasks without a due date and done tasks', () => {
		const ics = buildTasksIcs(
			[task({ id: 'no-due', dueDate: null }), task({ id: 'is-done', done: true })],
			now
		);
		expect(ics).not.toContain('no-due');
		expect(ics).not.toContain('is-done');
	});

	it('prefixes the course name into the summary when present', () => {
		const ics = buildTasksIcs([task({ courseName: 'CS 4641' })], now);
		expect(ics).toContain('SUMMARY:[CS 4641] problem set 3');
	});

	it('escapes ICS special characters in text fields', () => {
		const ics = buildTasksIcs([task({ title: 'a, b; c\nnewline' })], now);
		expect(ics).toContain('SUMMARY:a\\, b\\; c\\nnewline');
	});

	it('uses CRLF line endings and folds nothing shorter than 75 octets', () => {
		const ics = buildTasksIcs([task()], now);
		expect(ics).toContain('\r\n');
		expect(ics.split('\r\n').every((l) => Buffer.byteLength(l) <= 75)).toBe(true);
	});

	it('skips tasks whose dueDate is not a well-formed YYYY-MM-DD', () => {
		const ics = buildTasksIcs(
			[task({ id: 'bad-1', dueDate: '2026-8-2' }), task({ id: 'bad-2', dueDate: 'garbage' })],
			now
		);
		expect(ics).not.toContain('bad-1');
		expect(ics).not.toContain('bad-2');
	});

	it('folds a long multi-byte SUMMARY on octet boundaries and round-trips losslessly', () => {
		const title = 'é'.repeat(60);
		const ics = buildTasksIcs([task({ title })], now);

		const lines = ics.split('\r\n');
		expect(lines.every((l) => Buffer.byteLength(l) <= 75)).toBe(true);
		// Folding must actually have happened for this case to be a meaningful regression test.
		expect(lines.some((l) => l.startsWith(' '))).toBe(true);

		const unfolded = ics.replace(/\r\n /g, '');
		const summaryLine = unfolded.split('\r\n').find((l) => l.startsWith('SUMMARY:'));
		expect(summaryLine).toBe(`SUMMARY:${title}`);
	});
});
