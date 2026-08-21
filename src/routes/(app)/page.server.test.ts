import { describe, it, expect, beforeEach, vi } from 'vitest';

const { testDb, testSqlite } = await vi.hoisted(async () => {
	const { createTestDb } = await import('$lib/server/agent/test-db');
	return createTestDb();
});

vi.mock('$lib/server/db', () => ({ db: testDb, sqliteClient: testSqlite }));

// Both gated actions below call isGoogleTasksEnabled(), which reads straight
// from this module — mocking it is what lets the badge and detail-panel
// branches run at all in a test process.
vi.mock('$env/dynamic/private', () => ({
	env: { GTASKS_ENABLED: 'true', GCAL_REFRESH_TOKEN: 'refresh-token' }
}));

// Stubbed, not exercised: what these do with Google is the sync module's own
// business. What matters here is only that the gate around them is correct.
const { pushTaskNow, pushDeletionNow } = vi.hoisted(() => ({
	pushTaskNow: vi.fn().mockResolvedValue(undefined),
	pushDeletionNow: vi.fn().mockResolvedValue(undefined)
}));
vi.mock('$lib/server/gtasks/push', () => ({ pushTaskNow, pushDeletionNow }));

const { resetTestDb } = await import('$lib/server/agent/test-db');
const tasksService = await import('$lib/server/tasks/service');
const { NEEDS_PLANNED_DATE_MESSAGE } = await import('$lib/googleSync');

const { actions } = await import('./+page.server');

beforeEach(() => {
	resetTestDb(testSqlite);
	pushTaskNow.mockClear();
	pushDeletionNow.mockClear();
});

/* eslint-disable @typescript-eslint/no-explicit-any */
const formData = (fields: Record<string, string>) => {
	const fd = new FormData();
	for (const [key, value] of Object.entries(fields)) fd.set(key, value);
	return fd;
};

const submit = (action: any, fields: Record<string, string>) =>
	action({ request: new Request('http://t/', { method: 'POST', body: formData(fields) }) });

describe('createTask action', () => {
	it('opts in only alongside a planned date, not a due date alone', async () => {
		// A due date is the last-possible day and never reaches Google, so a
		// planless composer submission must not slip through the gate.
		await submit(actions.createTask, {
			title: 'Deadline only',
			dueDate: '2026-09-01',
			googleSync: 'on'
		});

		const [task] = await tasksService.listTasks();
		expect(task.googleSync).toBe(false);
	});
});

describe('updateTask action', () => {
	it('opts in and chooses the day in the same Save', async () => {
		// This is the exact case 517edb4 fixed: ticking the box and typing the
		// planned date in one Save must not be refused for arriving "too late" to
		// see the day it was submitted alongside.
		const task = await tasksService.createTask({ title: 'Reschedule me' });

		await submit(actions.updateTask, {
			id: task.id,
			plannedDate: '2026-08-25',
			googleSync: 'on'
		});

		const updated = await tasksService.getTask(task.id);
		expect(updated.plannedDate).toBe('2026-08-25');
		expect(updated.googleSync).toBe(true);
	});

	it('changes the planned date from the detail panel', async () => {
		const task = await tasksService.createTask({
			title: 'Reschedule me',
			plannedDate: '2026-08-20'
		});

		await submit(actions.updateTask, { id: task.id, plannedDate: '2026-09-01' });

		const updated = await tasksService.getTask(task.id);
		expect(updated.plannedDate).toBe('2026-09-01');
	});
});

describe('enableGoogleSync action', () => {
	it('refuses to opt a planless task in from the badge', async () => {
		const task = await tasksService.createTask({ title: 'No plan yet' });

		const result: any = await submit(actions.setTaskGoogleSync, { id: task.id, on: 'true' });

		expect(result?.status).toBe(400);
		expect(result?.data?.error).toBe(NEEDS_PLANNED_DATE_MESSAGE);
		expect((await tasksService.getTask(task.id)).googleSync).toBe(false);
	});
});
