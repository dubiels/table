import { nextFreeSlot } from '$lib/placement';
import { looseBounds } from '../lms/plan';

export interface PlanTableTask {
	id: string;
	title: string;
	notes: string | null;
	/**
	 * The only date the mirror carries. The deadline is deliberately absent from
	 * this type: a field the planner cannot see is a field an inbound Google edit
	 * can never overwrite, which is the guarantee the split exists to give.
	 */
	plannedDate: string | null;
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
	/** Table's vocabulary — `YYYY-MM-DD`. sync.ts maps it from `due` before calling. */
	plannedDate: string | null;
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
	/**
	 * `done` rides along because a create is the only chance to state it: the
	 * task is clean the moment it is pushed, so nothing would ever follow up
	 * with a patch and a task completed before its first push would read as open
	 * in Google forever.
	 */
	createInGoogle: {
		taskId: string;
		title: string;
		notes: string | null;
		plannedDate: string;
		done: boolean;
	}[];
	patchInGoogle: {
		taskId: string;
		googleTaskId: string;
		title: string;
		notes: string | null;
		plannedDate: string | null;
		done: boolean;
	}[];
	createInTable: {
		googleTaskId: string;
		title: string;
		notes: string | null;
		plannedDate: string | null;
		googleUpdatedAt: string;
		x: number;
		y: number;
	}[];
	patchInTable: {
		taskId: string;
		title: string;
		notes: string | null;
		plannedDate: string | null;
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

	// Order doesn't matter for correctness here — deleteInGoogle and
	// createInTable are independent arrays and the runner applies them in
	// whatever order it chooses — but building the tombstone set first lets
	// the inbound loop below consult it before deciding what to do with each
	// Google row.
	const tombstonedGoogleIds = new Set<string>();
	for (const tombstone of input.tombstones) {
		plan.deleteInGoogle.push({ googleTaskId: tombstone.googleTaskId, taskId: null });
		tombstonedGoogleIds.add(tombstone.googleTaskId);
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
		// listTasks paginates, and a task edited between page fetches can be
		// handed back on two pages with the same id. Both copies are equally
		// unknown to Table (or equally linked to the same row), so without
		// this guard the second copy would be planned again — two
		// createInTable entries for one googleTaskId, which then trips the
		// unique index on google_task_id after the pushes have already run.
		if (seenGoogleIds.has(g.id)) continue;
		seenGoogleIds.add(g.id);

		// A tombstone means the Table task is already gone locally and this
		// round already queued the matching deleteInGoogle above. The row's
		// Table counterpart never exists (byGoogleId can't find it, since the
		// Table task was deleted), so without this guard it falls into the
		// unknown-task import branch below and comes back to life as a fresh
		// createInTable — the exact delete-then-resurrect this plan must not
		// produce for the same googleTaskId.
		if (tombstonedGoogleIds.has(g.id)) continue;

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
				plannedDate: g.plannedDate,
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

		// Change detection above is a plain !== on the raw strings — any
		// difference means "something changed", so precision doesn't matter.
		// Picking the winner is different: it needs an actual ordering, so
		// timestamps are parsed here rather than compared as strings — that
		// way the result doesn't depend on both sides formatting to the same
		// precision.
		const googleWins =
			!tableDirty || (googleChanged && Date.parse(t.updatedAt) <= Date.parse(g.updated));

		if (googleWins) {
			plan.patchInTable.push({
				taskId: t.id,
				title: g.title,
				notes: g.notes,
				plannedDate: g.plannedDate,
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
				plannedDate: t.plannedDate,
				done: t.done
			});
		}
	}

	for (const t of input.tableTasks) {
		if (t.googleSync && !t.googleTaskId) {
			// The rule gates creation only. With no plan the intent is simply held:
			// the badge stays in its outline state and the create happens the moment
			// a day is chosen.
			if (t.plannedDate) {
				plan.createInGoogle.push({
					taskId: t.id,
					title: t.title,
					notes: t.notes,
					plannedDate: t.plannedDate,
					done: t.done
				});
			}
			continue;
		}

		if (!t.googleSync && t.googleTaskId) {
			plan.deleteInGoogle.push({ googleTaskId: t.googleTaskId, taskId: t.id });
			continue;
		}

		if (t.googleSync && t.googleTaskId && !seenGoogleIds.has(t.googleTaskId)) {
			// "Linked but absent" means two opposite things depending on the fetch,
			// so `fullFetch` picks the branch and the two can never both fire for
			// one task.
			//
			// Full fetch: the response is every task Google holds, so absence means
			// the row really is gone. Deliberately not a deletion — Google purges
			// deleted tasks after a retention window, so for a Table that was down
			// across it, absence is indistinguishable from "never existed".
			// Unlinking preserves the task; deleting would destroy it on a guess.
			// Patching is not an option either: there is no row left to patch, and
			// the attempt would just 404 every round.
			//
			// Incremental fetch: the response is only what Google touched since the
			// cursor, so absence means "Google has not changed it" and the row is
			// still there. A task that is dirty is then dirty on Table's side alone
			// — the write-through push failed, or Table changed while offline — and
			// this is the only place that push can be retried. Without it the task
			// stays dirty forever, because the cursor advances past its window and
			// only a manual full refresh would ever look at it again.
			if (input.fullFetch) {
				plan.unlinkInTable.push({ taskId: t.id, reason: 'no longer in Google Tasks' });
			} else if (t.updatedAt !== t.googleSyncedAt) {
				plan.patchInGoogle.push({
					taskId: t.id,
					googleTaskId: t.googleTaskId,
					title: t.title,
					notes: t.notes,
					plannedDate: t.plannedDate,
					done: t.done
				});
			}
		}
	}

	return plan;
}
