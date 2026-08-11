import { describe, it, expect } from 'vitest';
import { planGoogleTaskSync, type PlanTableTask, type PlanGoogleTask } from './plan';

function tableTask(over: Partial<PlanTableTask> = {}): PlanTableTask {
	return {
		id: 't1',
		title: 'Write the spec',
		notes: null,
		dueDate: '2026-08-20',
		done: false,
		completedAt: null,
		updatedAt: '2026-08-11T10:00:00.000Z',
		googleSync: true,
		googleTaskId: 'g1',
		googleSyncedAt: '2026-08-11T10:00:00.000Z',
		googleUpdatedAt: '2026-08-11T10:00:01.000Z',
		x: 60,
		y: 60,
		...over
	};
}

function googleTask(over: Partial<PlanGoogleTask> = {}): PlanGoogleTask {
	return {
		id: 'g1',
		title: 'Write the spec',
		notes: null,
		dueDate: '2026-08-20',
		done: false,
		completedAt: null,
		updated: '2026-08-11T10:00:01.000Z',
		deleted: false,
		...over
	};
}

function plan(over: {
	tableTasks?: PlanTableTask[];
	googleTasks?: PlanGoogleTask[];
	tombstones?: { googleTaskId: string }[];
	fullFetch?: boolean;
}) {
	return planGoogleTaskSync({
		tableTasks: over.tableTasks ?? [],
		googleTasks: over.googleTasks ?? [],
		tombstones: over.tombstones ?? [],
		fullFetch: over.fullFetch ?? true
	});
}

describe('inbound capture', () => {
	it('imports an unknown open google task', () => {
		const result = plan({ googleTasks: [googleTask({ id: 'new', title: 'Buy milk' })] });

		expect(result.createInTable).toHaveLength(1);
		expect(result.createInTable[0]).toMatchObject({
			googleTaskId: 'new',
			title: 'Buy milk',
			dueDate: '2026-08-20',
			googleUpdatedAt: '2026-08-11T10:00:01.000Z'
		});
	});

	it('never imports an unknown completed google task', () => {
		const result = plan({
			googleTasks: [googleTask({ id: 'new', done: true, completedAt: '2026-08-11T09:00:00.000Z' })]
		});
		expect(result.createInTable).toEqual([]);
	});

	it('imports an undated google task, since the due-date rule is outbound only', () => {
		const result = plan({ googleTasks: [googleTask({ id: 'new', dueDate: null })] });
		expect(result.createInTable[0].dueDate).toBeNull();
	});

	it('processes a google task once even if pagination returns it twice', () => {
		// listTasks paginates; a task edited between page fetches can be handed
		// back on two pages. Both copies are equally unknown to Table, so
		// without a dedupe guard this produces two createInTable entries for
		// one googleTaskId, and the unique index on google_task_id throws on
		// the second insert.
		const result = plan({
			googleTasks: [
				googleTask({ id: 'dup', title: 'Buy milk' }),
				googleTask({ id: 'dup', title: 'Buy milk' })
			]
		});

		expect(result.createInTable).toHaveLength(1);
	});

	it('gives each imported task its own free slot', () => {
		const result = plan({
			tableTasks: [tableTask({ googleSync: false, googleTaskId: null, x: 40, y: 40 })],
			googleTasks: [googleTask({ id: 'a' }), googleTask({ id: 'b' })]
		});

		const slots = result.createInTable.map((c) => `${c.x},${c.y}`);
		expect(new Set(slots).size).toBe(2);
		// The seeded table task sits at looseBounds()'s first grid anchor
		// (40,40) on purpose: if `occupied` were not seeded from tableTasks,
		// the first import would land right on top of it and only the
		// mutual-distinctness assertion above would still pass.
		for (const c of result.createInTable) {
			expect(`${c.x},${c.y}`).not.toBe('40,40');
		}
	});
});

describe('the four-case matrix', () => {
	it('does nothing when neither side changed', () => {
		const result = plan({ tableTasks: [tableTask()], googleTasks: [googleTask()] });
		expect(result.patchInTable).toEqual([]);
		expect(result.patchInGoogle).toEqual([]);
	});

	it('pulls google changes down when only google changed', () => {
		const result = plan({
			tableTasks: [tableTask()],
			googleTasks: [
				googleTask({ title: 'Renamed on the phone', updated: '2026-08-11T12:00:00.000Z' })
			]
		});

		expect(result.patchInTable).toHaveLength(1);
		expect(result.patchInTable[0]).toMatchObject({
			taskId: 't1',
			title: 'Renamed on the phone',
			googleUpdatedAt: '2026-08-11T12:00:00.000Z'
		});
	});

	it('pushes table changes up when only table changed', () => {
		const result = plan({
			tableTasks: [tableTask({ title: 'Renamed in Table', updatedAt: '2026-08-11T12:00:00.000Z' })],
			googleTasks: [googleTask()]
		});

		expect(result.patchInGoogle).toHaveLength(1);
		expect(result.patchInGoogle[0]).toMatchObject({
			googleTaskId: 'g1',
			title: 'Renamed in Table'
		});
	});

	it('gives the later edit the whole task when both changed', () => {
		const result = plan({
			tableTasks: [tableTask({ title: 'Table wins', updatedAt: '2026-08-11T13:00:00.000Z' })],
			googleTasks: [googleTask({ title: 'Google loses', updated: '2026-08-11T12:00:00.000Z' })]
		});

		expect(result.patchInGoogle[0].title).toBe('Table wins');
		expect(result.patchInTable).toEqual([]);
	});

	it('resolves an exact tie to google', () => {
		const result = plan({
			tableTasks: [tableTask({ title: 'Table', updatedAt: '2026-08-11T12:00:00.000Z' })],
			googleTasks: [googleTask({ title: 'Google', updated: '2026-08-11T12:00:00.000Z' })]
		});

		expect(result.patchInTable[0].title).toBe('Google');
		expect(result.patchInGoogle).toEqual([]);
	});

	it('takes completion from google for a task it already knows', () => {
		const result = plan({
			tableTasks: [tableTask()],
			googleTasks: [
				googleTask({
					done: true,
					completedAt: '2026-08-11T12:00:00.000Z',
					updated: '2026-08-11T12:00:00.000Z'
				})
			]
		});

		expect(result.patchInTable[0]).toMatchObject({
			done: true,
			completedAt: '2026-08-11T12:00:00.000Z'
		});
	});
});

describe('deletion', () => {
	it('mirrors an explicit google deletion into table', () => {
		const result = plan({
			tableTasks: [tableTask()],
			googleTasks: [googleTask({ deleted: true })]
		});
		expect(result.deleteInTable).toEqual([{ taskId: 't1' }]);
	});

	it('plans a google delete for each tombstone', () => {
		const result = plan({ tombstones: [{ googleTaskId: 'gone' }] });
		expect(result.deleteInGoogle).toEqual([{ googleTaskId: 'gone', taskId: null }]);
	});

	it('does not resurrect a tombstoned task when its google row is still live', () => {
		const result = plan({
			tombstones: [{ googleTaskId: 'gone' }],
			googleTasks: [googleTask({ id: 'gone' })]
		});

		expect(result.deleteInGoogle).toEqual([{ googleTaskId: 'gone', taskId: null }]);
		expect(result.createInTable).toEqual([]);
	});

	it('deletes in google and unlinks when the toggle is turned off', () => {
		const result = plan({
			tableTasks: [tableTask({ googleSync: false })],
			// Google's copy changed too, so without the `!t.googleSync` guard
			// this would also land in patchInTable — a contradictory pair with
			// deleteInGoogle for the same task. The changed `updated` stamp is
			// what makes the empty-patch assertions below load-bearing rather
			// than trivially true because nothing changed on either side.
			googleTasks: [googleTask({ updated: '2026-08-11T12:00:00.000Z' })]
		});

		expect(result.deleteInGoogle).toEqual([{ googleTaskId: 'g1', taskId: 't1' }]);
		expect(result.patchInTable).toEqual([]);
		expect(result.patchInGoogle).toEqual([]);
	});

	it('unlinks rather than deletes when a linked task vanishes from a full fetch', () => {
		const result = plan({ tableTasks: [tableTask()], googleTasks: [], fullFetch: true });

		expect(result.deleteInTable).toEqual([]);
		expect(result.unlinkInTable).toHaveLength(1);
		expect(result.unlinkInTable[0].taskId).toBe('t1');
	});

	it('ignores absence on an incremental fetch, where it only means unchanged', () => {
		const result = plan({ tableTasks: [tableTask()], googleTasks: [], fullFetch: false });
		expect(result.unlinkInTable).toEqual([]);
	});
});

describe('outbound retry for a task the fetch could not show', () => {
	it('pushes a dirty linked task that an incremental fetch left out', () => {
		const result = plan({
			tableTasks: [tableTask({ title: 'Renamed in Table', updatedAt: '2026-08-11T12:00:00.000Z' })],
			googleTasks: [],
			fullFetch: false
		});

		expect(result.patchInGoogle).toHaveLength(1);
		expect(result.patchInGoogle[0]).toMatchObject({
			taskId: 't1',
			googleTaskId: 'g1',
			title: 'Renamed in Table',
			dueDate: '2026-08-20',
			done: false
		});
		expect(result.unlinkInTable).toEqual([]);
	});

	it('leaves a clean linked task alone when an incremental fetch leaves it out', () => {
		const result = plan({ tableTasks: [tableTask()], googleTasks: [], fullFetch: false });

		expect(result.patchInGoogle).toEqual([]);
		expect(result.unlinkInTable).toEqual([]);
		expect(result.deleteInGoogle).toEqual([]);
	});

	it('unlinks rather than pushes when a dirty linked task is absent from a full fetch', () => {
		const result = plan({
			tableTasks: [tableTask({ title: 'Renamed in Table', updatedAt: '2026-08-11T12:00:00.000Z' })],
			googleTasks: [],
			fullFetch: true
		});

		// Absence is authoritative here, so there is no row left to patch.
		expect(result.patchInGoogle).toEqual([]);
		expect(result.unlinkInTable).toEqual([{ taskId: 't1', reason: 'no longer in Google Tasks' }]);
	});
});

describe('outbound creation', () => {
	it('creates in google once intent is set and a due date exists', () => {
		const result = plan({
			tableTasks: [tableTask({ googleTaskId: null, googleSyncedAt: null, googleUpdatedAt: null })]
		});

		expect(result.createInGoogle).toEqual([
			{ taskId: 't1', title: 'Write the spec', notes: null, dueDate: '2026-08-20', done: false }
		]);
	});

	it('carries completion on the create, since no patch would ever follow', () => {
		const result = plan({
			tableTasks: [
				tableTask({
					googleTaskId: null,
					googleSyncedAt: null,
					googleUpdatedAt: null,
					done: true,
					completedAt: '2026-08-11T09:00:00.000Z'
				})
			]
		});

		expect(result.createInGoogle).toHaveLength(1);
		expect(result.createInGoogle[0].done).toBe(true);
	});

	it('holds the intent, creating nothing, while there is no due date', () => {
		const result = plan({
			tableTasks: [
				tableTask({
					googleTaskId: null,
					googleSyncedAt: null,
					googleUpdatedAt: null,
					dueDate: null
				})
			]
		});

		expect(result.createInGoogle).toEqual([]);
		expect(result.unlinkInTable).toEqual([]);
	});

	it('patches a linked task that lost its due date instead of deleting it', () => {
		const result = plan({
			tableTasks: [tableTask({ dueDate: null, updatedAt: '2026-08-11T13:00:00.000Z' })],
			googleTasks: [googleTask()]
		});

		expect(result.deleteInGoogle).toEqual([]);
		expect(result.patchInGoogle[0].dueDate).toBeNull();
	});

	it('ignores a task that was never opted in', () => {
		const result = plan({
			tableTasks: [tableTask({ googleSync: false, googleTaskId: null })]
		});

		expect(result.createInGoogle).toEqual([]);
		expect(result.deleteInGoogle).toEqual([]);
	});
});
