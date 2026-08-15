import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Person } from './service';

const rows: Person[] = [];
const joins: { personId: string; flagId: string; createdAt: string }[] = [];

// Mirrors the mock in `zones/service.test.ts`: drizzle's `where()` receives an
// SQL object a mock cannot interpret, so these fakes operate on the whole array.
// Tests therefore keep to one or two rows, and the rules worth asserting in
// bulk live in the pure `search.ts` instead.
vi.mock('../db', () => ({
	db: {
		insert: () => ({
			// A COPY, never the object the service returned. Pushing `r` itself
			// makes `rows[0] === createPerson(...)`, so assertions comparing the
			// two compare a property with itself and pass under the very
			// regression they exist to catch. This repo has been bitten by that.
			values: (r: Person) => {
				rows.push({ ...r });
				return Promise.resolve();
			}
		}),
		query: {
			people: { findMany: () => Promise.resolve([...rows]) },
			peopleFlags: { findMany: () => Promise.resolve([...joins]) }
		},
		update: () => ({
			set: (patch: Partial<Person>) => ({
				where: () => {
					Object.assign(rows[0], patch);
					return Promise.resolve();
				}
			})
		})
	}
}));

import * as peopleService from './service';

describe('people service', () => {
	beforeEach(() => {
		rows.length = 0;
		joins.length = 0;
	});

	it('creates a person from a name alone', async () => {
		const p = await peopleService.createPerson({ name: 'Devon Reyes' });
		expect(p.name).toBe('Devon Reyes');
		expect(p.id).toBeTruthy();
	});

	it('stores the optional quick-add note', async () => {
		const p = await peopleService.createPerson({ name: 'Devon Reyes', notes: 'builds infra' });
		expect(p.notes).toBe('builds infra');
	});

	// You add someone right after meeting them, so today is the right default.
	// These pin an exact instant rather than deriving the expected value from
	// `Date`, so a UTC-vs-local bug (like `toISOString().slice(0, 10)`) can
	// actually make the test fail instead of agreeing with itself. The vitest
	// config pins TZ to America/New_York for this project.
	it('defaults metOn to today, in local time, when UTC has already rolled to tomorrow', async () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2026-08-15T02:30:00Z')); // 10:30pm Eastern on Aug 14
		try {
			const p = await peopleService.createPerson({ name: 'Devon Reyes' });
			expect(p.metOn).toBe('2026-08-14');
		} finally {
			vi.useRealTimers();
		}
	});

	it('defaults metOn to today, in local time, when UTC and local agree', async () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2026-08-14T16:30:00Z')); // 12:30pm Eastern on Aug 14
		try {
			const p = await peopleService.createPerson({ name: 'Devon Reyes' });
			expect(p.metOn).toBe('2026-08-14');
		} finally {
			vi.useRealTimers();
		}
	});

	it('honours an explicit metOn', async () => {
		const p = await peopleService.createPerson({ name: 'Devon Reyes', metOn: '2026-01-14' });
		expect(p.metOn).toBe('2026-01-14');
	});

	// Meeting someone is the first time you spoke to them, so the two agree until
	// the form says otherwise.
	it('seeds lastSpokeAt from the explicit metOn', async () => {
		const p = await peopleService.createPerson({ name: 'Devon Reyes', metOn: '2026-01-14' });
		expect(p.lastSpokeAt).toBe('2026-01-14');
	});

	it('seeds lastSpokeAt from the defaulted metOn when no date is given', async () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2026-08-15T02:30:00Z')); // 10:30pm Eastern on Aug 14
		try {
			const p = await peopleService.createPerson({ name: 'Devon Reyes' });
			expect(p.lastSpokeAt).toBe('2026-08-14');
		} finally {
			vi.useRealTimers();
		}
	});

	it('honours an explicit lastSpokeAt later than the meeting', async () => {
		const p = await peopleService.createPerson({
			name: 'Devon Reyes',
			metOn: '2026-01-14',
			lastSpokeAt: '2026-03-02'
		});
		expect(p.lastSpokeAt).toBe('2026-03-02');
		expect(p.metOn).toBe('2026-01-14');
	});

	it('stores the contact fields the add dialog collects', async () => {
		const p = await peopleService.createPerson({
			name: 'Devon Reyes',
			linkedinUrl: 'https://linkedin.com/in/devonreyes',
			email: 'devon@cadence.dev',
			phone: '+1 917 555 0148',
			company: 'Cadence',
			role: 'Founder',
			city: 'New York',
			metAt: "Ana's dinner party"
		});
		expect(p).toMatchObject({
			linkedinUrl: 'https://linkedin.com/in/devonreyes',
			email: 'devon@cadence.dev',
			phone: '+1 917 555 0148',
			company: 'Cadence',
			role: 'Founder',
			city: 'New York',
			metAt: "Ana's dinner party"
		});
	});

	it('creates a person unarchived', async () => {
		const p = await peopleService.createPerson({ name: 'Devon Reyes' });
		expect(p.archivedAt).toBeNull();
	});

	it('lists people with their flag ids attached', async () => {
		const p = await peopleService.createPerson({ name: 'Devon Reyes' });
		joins.push({ personId: p.id, flagId: 'nyc', createdAt: '2026-01-14' });
		joins.push({ personId: p.id, flagId: 'founders', createdAt: '2026-01-14' });

		const listed = await peopleService.listPeople();
		expect(listed[0].flagIds.sort()).toEqual(['founders', 'nyc']);
	});

	it('gives a person with no flags an empty array rather than undefined', async () => {
		await peopleService.createPerson({ name: 'Devon Reyes' });
		const listed = await peopleService.listPeople();
		expect(listed[0].flagIds).toEqual([]);
	});

	it('updates a field and bumps updatedAt', async () => {
		const p = await peopleService.createPerson({ name: 'Devon Reyes' });
		const before = p.updatedAt;
		await new Promise((r) => setTimeout(r, 2));
		await peopleService.updatePerson(p.id, { company: 'Cadence' });
		expect(rows[0].company).toBe('Cadence');
		expect(rows[0].updatedAt).not.toBe(before);
	});

	it('archives a person by stamping archivedAt', async () => {
		const p = await peopleService.createPerson({ name: 'Devon Reyes' });
		await peopleService.archivePerson(p.id);
		expect(rows[0].archivedAt).toBeTruthy();
	});

	it('restores a person by clearing archivedAt', async () => {
		const p = await peopleService.createPerson({ name: 'Devon Reyes' });
		await peopleService.archivePerson(p.id);
		await peopleService.restorePerson(p.id);
		expect(rows[0].archivedAt).toBeNull();
	});
});
