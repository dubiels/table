import { nextFreeSlot } from '$lib/placement';
import { looseBounds } from '../lms/plan';

export interface PlanTableTask {
	id: string;
	title: string;
	notes: string | null;
	dueDate: string | null;
	done: boolean;
	completedAt: string | null;
	updatedAt: string;
	googleSync: boolean;
	googleTaskId: string | null;
	googleSyncedAt: string | null;
	googleUpdatedAt: string | null;
	x: number;
	y: number;
}

export interface PlanGoogleTask {
	id: string;
	title: string;
	notes: string | null;
	/** Table's vocabulary — `YYYY-MM-DD`. sync.ts maps it before calling. */
	dueDate: string | null;
	done: boolean;
	completedAt: string | null;
	updated: string;
	deleted: boolean;
}

export interface SyncPlan {
	/**
	 * `taskId` non-null means "clear that task's link once Google confirms";
	 * null means the entry came from a tombstone, dropped on confirmation.
	 * Pairing the delete with its consequence is what stops a failed delete
	 * from unlinking a task whose Google copy still exists.
	 */
	deleteInGoogle: { googleTaskId: string; taskId: string | null }[];
	createInGoogle: { taskId: string; title: string; notes: string | null; dueDate: string }[];
	patchInGoogle: {
		taskId: string;
		googleTaskId: string;
		title: string;
		notes: string | null;
		dueDate: string | null;
		done: boolean;
	}[];
	createInTable: {
		googleTaskId: string;
		title: string;
		notes: string | null;
		dueDate: string | null;
		googleUpdatedAt: string;
		x: number;
		y: number;
	}[];
	patchInTable: {
		taskId: string;
		title: string;
		notes: string | null;
		dueDate: string | null;
		done: boolean;
		completedAt: string | null;
		googleUpdatedAt: string;
	}[];
	deleteInTable: { taskId: string }[];
	unlinkInTable: { taskId: string; reason: string }[];
}

/**
 * Decides what one reconcile round does, given both sides and nothing else.
 *
 * Pure by construction: no database, no network, no clock. Every rule the
 * mirror has is expressed here and covered by plan.test.ts, which is the point
 * of the split — the cases most likely to silently eat data are the ones that
 * would otherwise only be reachable through a mocked Google API.
 */
export function planGoogleTaskSync(input: {
	tableTasks: PlanTableTask[];
	googleTasks: PlanGoogleTask[];
	tombstones: { googleTaskId: string }[];
	/**
	 * False when the fetch was filtered by `updatedMin`. Absence of a task then
	 * means "unchanged" rather than "gone", so the unlink-on-absence rule must
	 * not fire.
	 */
	fullFetch: boolean;
}): SyncPlan {
	const plan: SyncPlan = {
		deleteInGoogle: [],
		createInGoogle: [],
		patchInGoogle: [],
		createInTable: [],
		patchInTable: [],
		deleteInTable: [],
		unlinkInTable: []
	};

	// First, so a delete never races a create that could reuse its slot.
	for (const tombstone of input.tombstones) {
		plan.deleteInGoogle.push({ googleTaskId: tombstone.googleTaskId, taskId: null });
	}

	const byGoogleId = new Map<string, PlanTableTask>();
	for (const t of input.tableTasks) {
		if (t.googleTaskId) byGoogleId.set(t.googleTaskId, t);
	}

	const seenGoogleIds = new Set<string>();
	// Grows as tasks are placed, so a batch import lays out as a tidy column
	// instead of stacking every new card on the same anchor.
	const occupied = input.tableTasks.map((t) => ({ x: t.x, y: t.y }));

	for (const g of input.googleTasks) {
		seenGoogleIds.add(g.id);
		const t = byGoogleId.get(g.id);

		if (g.deleted) {
			// Guarded on googleSync: if the user has already opted out, the Google
			// row being gone is the consequence of that, not a reason to destroy
			// the Table task they kept.
			if (t && t.googleSync) plan.deleteInTable.push({ taskId: t.id });
			continue;
		}

		if (!t) {
			// Google ⊆ Table, with one exception: a completed task Table has never
			// seen is never imported, so connecting to a long-lived list does not
			// drag years of someone's archive into Table's history.
			if (g.done) continue;
			const slot = nextFreeSlot(occupied, looseBounds());
			occupied.push(slot);
			plan.createInTable.push({
				googleTaskId: g.id,
				title: g.title,
				notes: g.notes,
				dueDate: g.dueDate,
				googleUpdatedAt: g.updated,
				x: Math.round(slot.x),
				y: Math.round(slot.y)
			});
			continue;
		}

		// Opted out: the table pass below deletes it in Google. Patching either
		// side first would fight that.
		if (!t.googleSync) continue;

		const googleChanged = g.updated !== t.googleUpdatedAt;
		const tableDirty = t.updatedAt !== t.googleSyncedAt;
		if (!googleChanged && !tableDirty) continue;

		// Parsed rather than compared as strings, so the result does not depend on
		// both sides formatting their timestamps to the same precision.
		const googleWins =
			!tableDirty || (googleChanged && Date.parse(t.updatedAt) <= Date.parse(g.updated));

		if (googleWins) {
			plan.patchInTable.push({
				taskId: t.id,
				title: g.title,
				notes: g.notes,
				dueDate: g.dueDate,
				done: g.done,
				completedAt: g.completedAt,
				googleUpdatedAt: g.updated
			});
		} else {
			plan.patchInGoogle.push({
				taskId: t.id,
				googleTaskId: g.id,
				title: t.title,
				notes: t.notes,
				dueDate: t.dueDate,
				done: t.done
			});
		}
	}

	for (const t of input.tableTasks) {
		if (t.googleSync && !t.googleTaskId) {
			// The due-date rule gates creation only. With no date the intent is
			// simply held: the badge stays in its outline state and the create
			// happens the moment a date is set.
			if (t.dueDate) {
				plan.createInGoogle.push({
					taskId: t.id,
					title: t.title,
					notes: t.notes,
					dueDate: t.dueDate
				});
			}
			continue;
		}

		if (!t.googleSync && t.googleTaskId) {
			plan.deleteInGoogle.push({ googleTaskId: t.googleTaskId, taskId: t.id });
			continue;
		}

		if (t.googleSync && t.googleTaskId && !seenGoogleIds.has(t.googleTaskId) && input.fullFetch) {
			// Deliberately not a deletion. Google purges deleted tasks after a
			// retention window, so for a Table that was down across it, absence is
			// indistinguishable from "never existed". Unlinking preserves the task;
			// deleting would destroy it on a guess.
			plan.unlinkInTable.push({ taskId: t.id, reason: 'no longer in Google Tasks' });
		}
	}

	return plan;
}
