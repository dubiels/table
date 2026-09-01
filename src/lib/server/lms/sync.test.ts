import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('$env/dynamic/private', () => ({
	env: { LMS_ICAL_URL: 'https://canvas.example/feed.ics' }
}));

vi.mock('./ical-parser', () => ({
	// The feed's own parsing is covered by ical-parser.test.ts; this test only
	// needs one event whose due date has moved since the prior sync.
	parseLmsIcal: () => [
		{ eventId: 'ext-1', title: 'Problem set 3', dueDate: '2026-09-01', courseName: 'CS 101' }
	]
}));

const existingLmsTask = {
	id: 't1',
	externalId: 'ext-1',
	dueDate: '2026-08-20'
};

// Still in the table, no longer in the feed: a past-due assignment, or one of
// the course calendar events stored before the uid filter existed.
const staleLmsTask = {
	id: 't-stale',
	externalId: 'event-calendar-event-5188899',
	dueDate: '2026-08-27'
};

const updateSetMock = vi.fn();
const deleteTaskMock = vi.fn<(id: string) => Promise<void>>(() => Promise.resolve());

vi.mock('../tasks/service', () => ({
	deleteTask: (id: string) => deleteTaskMock(id)
}));

// Referenced lazily from inside the closures below (never eagerly, at
// factory-definition time) so it survives vi.mock's hoisting above the
// `const existingLmsTask` declaration.
let findManyCall = 0;

vi.mock('../db', () => ({
	db: {
		query: {
			zones: { findFirst: () => Promise.resolve(undefined) },
			tasks: {
				findMany: () => {
					findManyCall++;
					// First call: activeTasks (open tasks, for placement). Empty is fine —
					// this test drives an update, not a create.
					if (findManyCall === 1) return Promise.resolve([]);
					// Second call: existingLms (source: 'canvas'), the rows the planner
					// matches the feed events against by externalId.
					return Promise.resolve([{ ...existingLmsTask }, { ...staleLmsTask }]);
				}
			}
		},
		insert: () => ({ values: () => Promise.resolve() }),
		update: () => ({
			set: (patch: Record<string, unknown>) => {
				updateSetMock(patch);
				return { where: () => Promise.resolve() };
			}
		})
	}
}));

import { syncLmsAssignments } from './sync';

describe('syncLmsAssignments', () => {
	beforeEach(() => {
		updateSetMock.mockClear();
		deleteTaskMock.mockClear();
		findManyCall = 0;
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue({ ok: true, text: () => Promise.resolve('') })
		);
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it('writes a Canvas due-date change without marking the task dirty', async () => {
		// dueDate is Table-only as of the plannedDate split: Google never sees it,
		// so a Canvas deadline moving must not bump updatedAt — that would fire a
		// pointless push and could win a both-dirty conflict against a genuine
		// edit made on the phone.
		await syncLmsAssignments();

		expect(updateSetMock).toHaveBeenCalledWith({ dueDate: '2026-09-01' });
		expect(updateSetMock).not.toHaveBeenCalledWith(
			expect.objectContaining({ updatedAt: expect.anything() })
		);
	});

	it('sweeps a task the feed has dropped, and spares the one it still lists', () => {
		// Routed through deleteTask rather than a bare db.delete because that is
		// the only path that writes a tombstone: a canvas task the user had opted
		// into Google sync would otherwise be deleted here and live on in Google
		// with nothing left recording which task to remove.
		return syncLmsAssignments().then(() => {
			expect(deleteTaskMock).toHaveBeenCalledWith('t-stale');
			expect(deleteTaskMock).toHaveBeenCalledTimes(1);
		});
	});

	it('reports the sweep in its result', () => {
		return syncLmsAssignments().then((result) => {
			expect(result.deleted).toBe(1);
		});
	});
});
