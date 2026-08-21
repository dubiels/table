import { describe, it, expect, beforeEach, vi } from 'vitest';

const { testDb, testSqlite } = await vi.hoisted(async () => {
	const { createTestDb } = await import('$lib/server/agent/test-db');
	return createTestDb();
});

vi.mock('$lib/server/db', () => ({ db: testDb, sqliteClient: testSqlite }));
// Stubbed, not exercised: what these do with Google is the sync module's
// business and is already tested there. What matters here is that the write
// routes call them at all, which is what keeps an agent edit and a UI edit on
// the same path.
const { pushTaskNow, pushDeletionNow } = vi.hoisted(() => ({
	pushTaskNow: vi.fn().mockResolvedValue(undefined),
	pushDeletionNow: vi.fn().mockResolvedValue(undefined)
}));
vi.mock('$lib/server/gtasks/push', () => ({ pushTaskNow, pushDeletionNow }));

const { resetTestDb } = await import('$lib/server/agent/test-db');
const zonesService = await import('$lib/server/zones/service');
const tasksService = await import('$lib/server/tasks/service');

const tasksRoute = await import('./tasks/+server');
const taskRoute = await import('./tasks/[id]/+server');
const doneRoute = await import('./tasks/[id]/done/+server');
const peopleRoute = await import('./people/+server');
const personRoute = await import('./people/[id]/+server');
const archiveRoute = await import('./people/[id]/archive/+server');
const touchpointsRoute = await import('./people/[id]/touchpoints/+server');
const personFlagsRoute = await import('./people/[id]/flags/+server');
const personFlagRoute = await import('./people/[id]/flags/[flagId]/+server');
const flagsRoute = await import('./flags/+server');
const metaRoute = await import('./meta/+server');

beforeEach(() => {
	resetTestDb(testSqlite);
	pushTaskNow.mockClear();
	pushDeletionNow.mockClear();
});

/* eslint-disable @typescript-eslint/no-explicit-any */
const post = (body: unknown, headers: Record<string, string> = {}) =>
	new Request('http://t/', { method: 'POST', body: JSON.stringify(body), headers });

const call = async (handler: any, args: Record<string, unknown>) => {
	const response = await handler(args as any);
	return { status: response.status, body: await response.json(), response };
};

const read = (handler: any, query = '') => call(handler, { url: new URL(`http://t/${query}`) });

const write = (handler: any, body: unknown, extra: Record<string, unknown> = {}, headers = {}) =>
	call(handler, { request: post(body, headers), ...extra });

describe('GET /api/agent/tasks', () => {
	it('returns every task with its derived zone', async () => {
		const zone = await zonesService.createZone({
			name: 'Work',
			x: 0,
			y: 0,
			width: 600,
			height: 600
		});
		const inside = await tasksService.createTask({ title: 'In the zone', x: 100, y: 100 });
		await tasksService.createTask({ title: 'Loose', x: 5000, y: 5000 });

		const { status, body } = await read(tasksRoute.GET);

		expect(status).toBe(200);
		expect(body.tasks).toHaveLength(2);
		const found = body.tasks.find((t: any) => t.id === inside.id);
		expect(found.zone).toEqual({ id: zone.id, name: 'Work', color: 'sage' });
		expect(body.tasks.find((t: any) => t.title === 'Loose').zone).toBeNull();
	});

	it('includes completed tasks by default and drops them on request', async () => {
		const task = await tasksService.createTask({ title: 'Done thing' });
		await tasksService.setTaskDone(task.id, true);

		expect((await read(tasksRoute.GET)).body.tasks).toHaveLength(1);
		expect((await read(tasksRoute.GET, '?includeCompleted=false')).body.tasks).toHaveLength(0);
	});

	it('rejects a non-boolean filter rather than guessing', async () => {
		const { status, body } = await read(tasksRoute.GET, '?includeCompleted=maybe');
		expect(status).toBe(400);
		expect(body.error.code).toBe('invalid_query');
	});
});

describe('tasks round trip', () => {
	it('creates, reads back, patches, completes and deletes', async () => {
		const zone = await zonesService.createZone({
			name: 'Work',
			x: 0,
			y: 0,
			width: 600,
			height: 600
		});

		const created = await write(tasksRoute.POST, {
			title: 'Draft the memo',
			notes: 'for Tuesday',
			dueDate: '2026-09-01',
			priority: 'high',
			zoneId: zone.id
		});
		expect(created.status).toBe(201);
		expect(created.body.task.title).toBe('Draft the memo');
		// Placed into the zone, so it is categorised in every view at once.
		expect(created.body.task.zone.id).toBe(zone.id);
		expect(pushTaskNow).toHaveBeenCalledWith(created.body.task.id);

		const id = created.body.task.id;
		expect((await read(tasksRoute.GET)).body.tasks[0].notes).toBe('for Tuesday');

		const patched = await write(
			taskRoute.PATCH,
			{ priority: 'low', notes: null },
			{ params: { id } }
		);
		expect(patched.status).toBe(200);
		expect(patched.body.task.priority).toBe('low');
		expect(patched.body.task.notes).toBeNull();

		const completed = await call(doneRoute.PUT, {
			request: new Request('http://t/', { method: 'PUT', body: JSON.stringify({ done: true }) }),
			params: { id }
		});
		expect(completed.body.task.done).toBe(true);
		expect(completed.body.task.completedAt).not.toBeNull();

		const deleted = await write(taskRoute.DELETE, {}, { params: { id } });
		expect(deleted.status).toBe(200);
		expect(await tasksService.listTasks()).toHaveLength(0);
	});

	it('setting done is replay-safe without a key, where a toggle would not be', async () => {
		const task = await tasksService.createTask({ title: 'x' });
		const put = () =>
			call(doneRoute.PUT, {
				request: new Request('http://t/', { method: 'PUT', body: JSON.stringify({ done: true }) }),
				params: { id: task.id }
			});

		await put();
		const second = await put();

		expect(second.body.task.done).toBe(true);
	});

	it('opts a task into Google sync only alongside a planned date', async () => {
		// A due date alone is the last-possible day and never reaches Google, so
		// asking to sync without a plan is honoured as a no-op rather than an error.
		const dueOnly = await write(tasksRoute.POST, {
			title: 'Deadline only',
			dueDate: '2026-09-01',
			googleSync: true
		});
		expect(dueOnly.body.task.google.sync).toBe(false);

		const planned = await write(tasksRoute.POST, {
			title: 'Planned',
			dueDate: '2026-09-01',
			plannedDate: '2026-08-25',
			googleSync: true
		});
		expect(planned.body.task.google.sync).toBe(true);
		expect(planned.body.task.plannedDate).toBe('2026-08-25');
		expect(planned.body.task.dueDate).toBe('2026-09-01');
	});

	it('updates the planned date through PATCH', async () => {
		const task = await tasksService.createTask({ title: 'Reschedule me' });

		const patched = await write(
			taskRoute.PATCH,
			{ plannedDate: '2026-08-22' },
			{ params: { id: task.id } }
		);

		expect(patched.status).toBe(200);
		expect(patched.body.task.plannedDate).toBe('2026-08-22');
		expect((await tasksService.getTask(task.id)).plannedDate).toBe('2026-08-22');
	});

	it('replays a repeated idempotency key instead of creating a second task', async () => {
		const headers = { 'idempotency-key': 'agent-retry-1' };
		const first = await write(tasksRoute.POST, { title: 'Only once' }, {}, headers);
		const second = await write(tasksRoute.POST, { title: 'Only once' }, {}, headers);

		expect(await tasksService.listTasks()).toHaveLength(1);
		expect(second.body.task.id).toBe(first.body.task.id);
		expect(second.response.headers.get('idempotency-replayed')).toBe('true');
	});

	it('rejects an unknown task, an unknown zone and an empty patch', async () => {
		const missing = await write(taskRoute.PATCH, { title: 'x' }, { params: { id: 'nope' } });
		expect(missing.status).toBe(404);
		expect(missing.body.error.code).toBe('not_found');

		const badZone = await write(tasksRoute.POST, { title: 'x', zoneId: 'nope' });
		expect(badZone.status).toBe(404);

		const task = await tasksService.createTask({ title: 'x' });
		const empty = await write(taskRoute.PATCH, {}, { params: { id: task.id } });
		expect(empty.status).toBe(400);
		expect(empty.body.error.code).toBe('invalid_body');
	});

	it('does not bump updatedAt when only the person link changes', async () => {
		// Google cannot see personId, so linking must not mark the task dirty —
		// otherwise the link would win a conflict against a real edit from a phone.
		const person = await write(peopleRoute.POST, { name: 'Devon Reyes' });
		const task = await tasksService.createTask({ title: 'Follow up' });
		const before = (await tasksService.getTask(task.id)).updatedAt;

		await write(taskRoute.PATCH, { personId: person.body.person.id }, { params: { id: task.id } });

		const after = await tasksService.getTask(task.id);
		expect(after.personId).toBe(person.body.person.id);
		expect(after.updatedAt).toBe(before);
	});

	it('clears the person link when sent null', async () => {
		const person = await write(peopleRoute.POST, { name: 'Devon Reyes' });
		const task = await tasksService.createTask({
			title: 'Follow up',
			personId: person.body.person.id
		});

		const cleared = await write(taskRoute.PATCH, { personId: null }, { params: { id: task.id } });

		expect(cleared.body.task.personId).toBeNull();
	});
});

describe('people round trip', () => {
	it('creates, patches, logs a touchpoint, archives and restores', async () => {
		const created = await write(peopleRoute.POST, {
			name: 'Devon Reyes',
			company: 'Cadence',
			role: 'Founder',
			metOn: '2026-08-01'
		});
		expect(created.status).toBe(201);
		const id = created.body.person.id;
		expect(created.body.person.archived).toBe(false);

		const patched = await write(personRoute.PATCH, { role: 'CTO' }, { params: { id } });
		expect(patched.body.person.role).toBe('CTO');
		expect(patched.body.person.company).toBe('Cadence');

		const logged = await write(
			touchpointsRoute.POST,
			{ occurredOn: '2026-08-20', note: 'coffee' },
			{ params: { id } }
		);
		expect(logged.status).toBe(201);
		expect(logged.body.touchpoint.occurredOn).toBe('2026-08-20');

		const listed = await read(peopleRoute.GET);
		expect(listed.body.people[0].touchpoints).toHaveLength(1);
		// The denormalised column moved forward with the log.
		expect(listed.body.people[0].lastSpokeAt).toBe('2026-08-20');

		const archived = await write(archiveRoute.POST, {}, { params: { id } });
		expect(archived.body.archived).toBe(true);
		expect((await read(peopleRoute.GET, '?includeArchived=false')).body.people).toHaveLength(0);

		const restored = await write(archiveRoute.DELETE, {}, { params: { id } });
		expect(restored.body.archived).toBe(false);
		expect((await read(peopleRoute.GET, '?includeArchived=false')).body.people).toHaveLength(1);
	});

	it('rejects an unknown person and a touchpoint with no date', async () => {
		const missing = await write(personRoute.PATCH, { name: 'x' }, { params: { id: 'nope' } });
		expect(missing.status).toBe(404);

		const person = await write(peopleRoute.POST, { name: 'Devon Reyes' });
		const undated = await write(
			touchpointsRoute.POST,
			{ note: 'coffee' },
			{ params: { id: person.body.person.id } }
		);
		expect(undated.status).toBe(400);
		expect(undated.body.error.details[0].path).toBe('occurredOn');
	});
});

describe('flags round trip', () => {
	it('creates, attaches, reads back on the person, and detaches', async () => {
		const person = await write(peopleRoute.POST, { name: 'Devon Reyes' });
		const id = person.body.person.id;

		const flag = await write(flagsRoute.POST, { name: 'SF', color: 'sky' });
		expect(flag.status).toBe(201);

		// Case-insensitive reuse, so a retry under a different spelling cannot
		// mint a near-duplicate.
		const again = await write(flagsRoute.POST, { name: 'sf' });
		expect(again.body.flag.id).toBe(flag.body.flag.id);

		await write(personFlagsRoute.POST, { flagId: flag.body.flag.id }, { params: { id } });
		const withFlag = await read(peopleRoute.GET);
		expect(withFlag.body.people[0].flags).toEqual([
			{ id: flag.body.flag.id, name: 'SF', color: 'sky' }
		]);

		await write(personFlagRoute.DELETE, {}, { params: { id, flagId: flag.body.flag.id } });
		expect((await read(peopleRoute.GET)).body.people[0].flags).toEqual([]);
	});

	it('refuses to attach a flag that does not exist', async () => {
		const person = await write(peopleRoute.POST, { name: 'Devon Reyes' });
		const attached = await write(
			personFlagsRoute.POST,
			{ flagId: 'nope' },
			{ params: { id: person.body.person.id } }
		);
		expect(attached.status).toBe(404);
	});
});

describe('GET /api/agent/meta', () => {
	it('returns zones with their bounds, and flags', async () => {
		const zone = await zonesService.createZone({ name: 'Work', color: 'sky' });
		await write(flagsRoute.POST, { name: 'SF' });

		const { status, body } = await call(metaRoute.GET, {});

		expect(status).toBe(200);
		expect(body.zones).toEqual([
			{ id: zone.id, name: 'Work', color: 'sky', bounds: { x: 60, y: 60, width: 320, height: 320 } }
		]);
		expect(body.flags[0].name).toBe('SF');
	});
});
