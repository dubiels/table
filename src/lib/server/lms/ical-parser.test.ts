import { describe, it, expect } from 'vitest';
import { parseLmsIcal } from './ical-parser';

const NOW = new Date('2026-08-09T12:00:00Z');

/** Formats a Date as local YYYY-MM-DD, matching the parser's own convention. */
function localDateString(date: Date): string {
	const year = date.getFullYear();
	const month = String(date.getMonth() + 1).padStart(2, '0');
	const day = String(date.getDate()).padStart(2, '0');
	return `${year}-${month}-${day}`;
}

function ics(events: string[]): string {
	return ['BEGIN:VCALENDAR', ...events, 'END:VCALENDAR'].join('\r\n');
}

function vevent(props: { uid?: string; dtstart: string; summary?: string }): string {
	const lines = ['BEGIN:VEVENT'];
	if (props.uid) lines.push(`UID:${props.uid}`);
	lines.push(props.dtstart);
	if (props.summary !== undefined) lines.push(`SUMMARY:${props.summary}`);
	lines.push('END:VEVENT');
	return lines.join('\r\n');
}

describe('parseLmsIcal', () => {
	it('parses a timed event inside the window', () => {
		const dt = new Date('2026-08-15T23:59:00Z');
		const text = ics([
			vevent({
				uid: 'event-assignment-12345',
				dtstart: 'DTSTART:20260815T235900Z',
				summary: 'Problem Set 3 [CS 4641]'
			})
		]);

		const result = parseLmsIcal(text, NOW);

		expect(result).toHaveLength(1);
		expect(result[0].dueDate).toBe(localDateString(dt));
	});

	it('parses an all-day event without a UTC shift', () => {
		const text = ics([
			vevent({
				uid: 'event-assignment-allday',
				dtstart: 'DTSTART;VALUE=DATE:20260815',
				summary: 'Reading Due [CS 4641]'
			})
		]);

		const result = parseLmsIcal(text, NOW);

		expect(result).toHaveLength(1);
		expect(result[0].dueDate).toBe('2026-08-15');
	});

	it('extracts course name from a trailing bracket group and strips it from the title', () => {
		const text = ics([
			vevent({
				uid: 'event-assignment-12345',
				dtstart: 'DTSTART:20260815T235900Z',
				summary: 'Problem Set 3 [CS 4641]'
			})
		]);

		const result = parseLmsIcal(text, NOW);

		expect(result[0].title).toBe('Problem Set 3');
		expect(result[0].courseName).toBe('CS 4641');
		expect(result[0].courseId).toBe('CS 4641');
	});

	it('falls back to the full summary and Unknown course when there is no bracket group', () => {
		const text = ics([
			vevent({
				uid: 'event-assignment-12345',
				dtstart: 'DTSTART:20260815T235900Z',
				summary: 'Problem Set 3'
			})
		]);

		const result = parseLmsIcal(text, NOW);

		expect(result[0].title).toBe('Problem Set 3');
		expect(result[0].courseName).toBe('Unknown');
	});

	it('drops an event with no uid rather than importing an undedupable one', () => {
		const text = ics([vevent({ dtstart: 'DTSTART:20260815T235900Z' })]);

		const result = parseLmsIcal(text, NOW);

		expect(result).toHaveLength(0);
	});

	it('falls back to Untitled when the summary is missing', () => {
		const text = ics([vevent({ uid: 'no-summary', dtstart: 'DTSTART:20260815T235900Z' })]);

		const result = parseLmsIcal(text, NOW);

		expect(result[0].title).toBe('Untitled');
		expect(result[0].eventId).toBe('no-summary');
	});

	it('excludes an event 90 days in the future', () => {
		const text = ics([
			vevent({
				uid: 'far-future',
				dtstart: 'DTSTART:20261107T235900Z', // ~90 days after NOW
				summary: 'Far Future [CS 4641]'
			})
		]);

		const result = parseLmsIcal(text, NOW);

		expect(result).toHaveLength(0);
	});

	it('excludes an event 30 days in the past', () => {
		const text = ics([
			vevent({
				uid: 'old-past',
				dtstart: 'DTSTART:20260710T235900Z', // 30 days before NOW
				summary: 'Old Past [CS 4641]'
			})
		]);

		const result = parseLmsIcal(text, NOW);

		expect(result).toHaveLength(0);
	});

	it('excludes an event due yesterday', () => {
		const text = ics([
			vevent({
				uid: 'yesterday',
				dtstart: 'DTSTART:20260808T235900Z', // the evening before NOW's local day
				summary: 'Yesterday [CS 4641]'
			})
		]);

		const result = parseLmsIcal(text, NOW);

		expect(result).toHaveLength(0);
	});

	it('falls back to Untitled when the summary is only a bracket group', () => {
		const text = ics([
			vevent({
				uid: 'event-assignment-12345',
				dtstart: 'DTSTART:20260815T235900Z',
				summary: '[CS 101]'
			})
		]);

		const result = parseLmsIcal(text, NOW);

		expect(result[0].title).toBe('Untitled');
		expect(result[0].courseName).toBe('CS 101');
	});

	it('includes an event due earlier today (window starts at local midnight, not now)', () => {
		const text = ics([
			vevent({
				uid: 'early-today',
				dtstart: 'DTSTART:20260809T060000Z', // 2am local on NOW's own day
				summary: 'Early Today [CS 4641]'
			})
		]);

		const result = parseLmsIcal(text, NOW);

		expect(result).toHaveLength(1);
	});

	it('includes an event 14 days ahead (window upper boundary)', () => {
		const text = ics([
			vevent({
				uid: 'upper-boundary',
				dtstart: 'DTSTART:20260823T235900Z', // late on the 14th day ahead
				summary: 'Upper Boundary [CS 4641]'
			})
		]);

		const result = parseLmsIcal(text, NOW);

		expect(result).toHaveLength(1);
	});

	it('excludes an event 15 days ahead (just past the upper boundary)', () => {
		const text = ics([
			vevent({
				uid: 'above-upper-boundary',
				dtstart: 'DTSTART:20260824T120000Z', // morning of the 15th day ahead
				summary: 'Above Upper Boundary [CS 4641]'
			})
		]);

		const result = parseLmsIcal(text, NOW);

		expect(result).toHaveLength(0);
	});

	it('skips non-VEVENT entries', () => {
		const text = ics([
			'BEGIN:VTIMEZONE',
			'TZID:America/New_York',
			'END:VTIMEZONE',
			vevent({
				uid: 'event-assignment-12345',
				dtstart: 'DTSTART:20260815T235900Z',
				summary: 'Problem Set 3 [CS 4641]'
			})
		]);

		const result = parseLmsIcal(text, NOW);

		expect(result).toHaveLength(1);
	});
});
