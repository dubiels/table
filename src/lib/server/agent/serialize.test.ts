import { describe, it, expect } from 'vitest';
import { selectTasks, serializeTask, serializePeople } from './serialize';
import type { Task } from '../tasks/service';
import type { Zone } from '../zones/service';
import type { PersonWithFlags } from '../people/service';

const task = (over: Partial<Task> = {}): Task =>
	({
		id: 'task-1',
		title: 'A task',
		notes: null,
		dueDate: null,
		plannedDate: null,
		priority: null,
		done: false,
		completedAt: null,
		source: 'manual',
		externalId: null,
		courseName: null,
		personId: null,
		x: 0,
		y: 0,
		sortOrder: 0,
		updatedAt: '2026-08-01T00:00:00.000Z',
		googleSync: false,
		googleTaskId: null,
		googleSyncedAt: null,
		googleUpdatedAt: null,
		googleError: null,
		createdAt: '2026-08-01T00:00:00.000Z',
		...over
	}) as Task;

const zone = (over: Partial<Zone> = {}): Zone =>
	({
		id: 'zone-1',
		name: 'Work',
		color: 'sage',
		x: 0,
		y: 0,
		width: 600,
		height: 600,
		createdAt: '2026-01-01T00:00:00.000Z',
		...over
	}) as Zone;

describe('serializeTask', () => {
	it('derives the zone from the card centre, not its anchor', () => {
		// A card anchored just outside a zone still belongs to it when its centre
		// falls inside — the same rule the canvas and bento views apply.
		const zones = [zone({ x: 100, y: 100, width: 200, height: 200 })];
		expect(serializeTask(task({ x: 60, y: 80 }), zones).zone?.id).toBe('zone-1');
		expect(serializeTask(task({ x: 5000, y: 5000 }), zones).zone).toBeNull();
	});

	it('picks the smallest zone when they overlap', () => {
		const zones = [
			zone({ id: 'big', width: 900, height: 900 }),
			zone({ id: 'small', width: 400, height: 400 })
		];
		expect(serializeTask(task({ x: 0, y: 0 }), zones).zone?.id).toBe('small');
	});
});

describe('selectTasks', () => {
	it('returns everything by default, newest activity first', () => {
		const older = task({ id: 'older', updatedAt: '2026-08-01T00:00:00.000Z' });
		const newer = task({ id: 'newer', updatedAt: '2026-08-20T00:00:00.000Z' });

		expect(selectTasks([older, newer]).map((t) => t.id)).toEqual(['newer', 'older']);
	});

	it('filters on the latest stamp a task carries, not on updatedAt alone', () => {
		// updatedAt deliberately does not move for a completion-only change on
		// legacy rows, so completedAt has to count too or a task ticked off after
		// the cursor would never be handed over.
		const completed = task({
			id: 'completed',
			done: true,
			updatedAt: '2026-07-01T00:00:00.000Z',
			createdAt: '2026-07-01T00:00:00.000Z',
			completedAt: '2026-08-20T00:00:00.000Z'
		});
		const stale = task({
			id: 'stale',
			updatedAt: '2026-07-01T00:00:00.000Z',
			createdAt: '2026-07-01T00:00:00.000Z'
		});

		const since = selectTasks([completed, stale], { since: '2026-08-01T00:00:00.000Z' });

		expect(since.map((t) => t.id)).toEqual(['completed']);
	});

	it('tolerates the empty updatedAt on rows predating the column', () => {
		const legacy = task({ id: 'legacy', updatedAt: '', createdAt: '2026-08-20T00:00:00.000Z' });

		expect(selectTasks([legacy], { since: '2026-08-01T00:00:00.000Z' })).toHaveLength(1);
	});

	it('drops completed tasks only when asked', () => {
		const rows = [task({ id: 'open' }), task({ id: 'shut', done: true })];

		expect(selectTasks(rows, { includeCompleted: false }).map((t) => t.id)).toEqual(['open']);
		expect(selectTasks(rows)).toHaveLength(2);
	});
});

describe('serializePeople', () => {
	const person = (over: Partial<PersonWithFlags> = {}): PersonWithFlags =>
		({
			id: 'p1',
			name: 'Devon Reyes',
			status: 'met',
			linkedinUrl: null,
			email: null,
			phone: null,
			company: null,
			role: null,
			city: null,
			cityId: null,
			metAt: null,
			metOn: null,
			lastSpokeAt: null,
			notes: null,
			archivedAt: null,
			createdAt: '2026-08-01T00:00:00.000Z',
			updatedAt: '2026-08-01T00:00:00.000Z',
			flagIds: [],
			...over
		}) as PersonWithFlags;

	const flag = { id: 'f1', name: 'SF', color: 'sky', createdAt: '2026-01-01T00:00:00.000Z' };

	it('resolves flag ids to names so no second call is needed', () => {
		const [out] = serializePeople([person({ flagIds: ['f1'] })], [flag], []);

		expect(out.flags).toEqual([{ id: 'f1', name: 'SF', color: 'sky' }]);
	});

	it('drops a flag id whose flag has been deleted rather than emitting a hole', () => {
		const [out] = serializePeople([person({ flagIds: ['f1', 'gone'] })], [flag], []);

		expect(out.flags).toHaveLength(1);
	});

	it('reports archived state as a boolean beside the timestamp', () => {
		const [out] = serializePeople([person({ archivedAt: '2026-08-10T00:00:00.000Z' })], [], []);

		expect(out.archived).toBe(true);
		expect(serializePeople([person()], [], [])[0].archived).toBe(false);
	});

	it('excludes archived people only when asked', () => {
		const rows = [person({ id: 'live' }), person({ id: 'gone', archivedAt: '2026-08-10' })];

		expect(serializePeople(rows, [], [], { includeArchived: false }).map((p) => p.id)).toEqual([
			'live'
		]);
		expect(serializePeople(rows, [], [])).toHaveLength(2);
	});

	it('attaches each person only their own touchpoints', () => {
		const touchpoints = [
			{ id: 't1', personId: 'p1', occurredOn: '2026-08-20', note: null, createdAt: 'x' },
			{ id: 't2', personId: 'other', occurredOn: '2026-08-21', note: null, createdAt: 'x' }
		];

		const [out] = serializePeople([person()], [], touchpoints);

		expect(out.touchpoints.map((t) => t.id)).toEqual(['t1']);
	});
});
