import type { RequestHandler } from './$types';
import * as tasksService from '$lib/server/tasks/service';
import * as zonesService from '$lib/server/zones/service';
import { pushTaskNow, pushDeletionNow } from '$lib/server/gtasks/push';
import { isGoogleTasksEnabled } from '$lib/server/gtasks/sync';
import { canSendToGoogle } from '$lib/googleSync';
import { runWrite, parse } from '$lib/server/agent/respond';
import { updateTaskSchema } from '$lib/server/agent/schemas';
import { serializeTask } from '$lib/server/agent/serialize';
import { placementFor } from '$lib/server/agent/placement';
import { requirePerson, requireTask } from '$lib/server/agent/resources';

export const PATCH: RequestHandler = ({ request, params }) =>
	runWrite(request, `PATCH /api/agent/tasks/${params.id}`, async (body) => {
		const existing = await requireTask(params.id);
		const input = parse(updateTaskSchema, body);
		const [zones, tasks] = await Promise.all([zonesService.listZones(), tasksService.listTasks()]);

		// A key goes into the patch only when it was sent *and* differs from what
		// the row holds — the same rule the detail modal's Save follows, and for
		// the same reason: `updateTask` marks a task dirty on key presence, so
		// re-sending an unchanged title would fire a pointless Google push and arm
		// that task to win a both-dirty conflict against a real edit made on the
		// phone. An agent that echoes back the whole record must not cost that.
		const patch: Parameters<typeof tasksService.updateTask>[1] = {};
		if (input.title !== undefined && input.title !== existing.title) patch.title = input.title;
		if (input.notes !== undefined && input.notes !== existing.notes) patch.notes = input.notes;
		if (input.dueDate !== undefined && input.dueDate !== existing.dueDate) {
			patch.dueDate = input.dueDate;
		}
		if (input.plannedDate !== undefined && input.plannedDate !== existing.plannedDate) {
			patch.plannedDate = input.plannedDate;
		}
		if (input.priority !== undefined && input.priority !== existing.priority) {
			patch.priority = input.priority;
		}
		if (input.personId !== undefined && input.personId !== existing.personId) {
			if (input.personId !== null) await requirePerson(input.personId);
			patch.personId = input.personId;
		}

		// Drizzle rejects an empty `set`, and a patch that changed nothing has
		// nothing to write — the placement and the push below still run.
		if (Object.keys(patch).length > 0) await tasksService.updateTask(params.id, patch);

		if (input.zoneId !== undefined) {
			// Null when the task already sits in that zone, which is not a failure —
			// the requested end state is simply already true.
			const point = placementFor(input.zoneId, existing, zones, tasks);
			if (point) {
				await tasksService.updateTaskPosition(params.id, Math.round(point.x), Math.round(point.y));
			}
		}

		// The counterpart of the detail modal's Google checkbox, and it has to
		// exist here for the same reason it exists there: clearing the planned day
		// leaves a task that opted in with no day to be filed under, which the
		// push skips and the reconciler skips, so it sits on the amber "waiting to
		// reach Google" badge forever with nothing that could ever clear it. The
		// modal handles this by unticking the box, which routes into
		// `unlinkFromGoogle`. Without this branch an agent could strand a task
		// there with a single `{"plannedDate": null}`.
		if (isGoogleTasksEnabled()) {
			const patched = await tasksService.getTask(params.id);
			const wantsSync = input.googleSync ?? patched.googleSync;

			if (wantsSync && canSendToGoogle(patched)) {
				if (!patched.googleSync) await tasksService.enableGoogleSync(params.id);
			} else if (patched.googleSync) {
				// Covers both an explicit opt-out and the implicit one above: an
				// opted-in task that can no longer reach Google is taken back out
				// rather than left stranded.
				const removed = await tasksService.unlinkFromGoogle(params.id);
				if (removed) await pushDeletionNow(removed);
			}
		}

		await pushTaskNow(params.id);
		const updated = await tasksService.getTask(params.id);
		return { status: 200, body: { task: serializeTask(updated, zones) } };
	});

export const DELETE: RequestHandler = ({ request, params }) =>
	runWrite(request, `DELETE /api/agent/tasks/${params.id}`, async () => {
		// Read before the delete: afterwards no row is left to say which Google
		// task it owned. deleteTask writes the tombstone that makes the call below
		// safe to fail — the next reconcile retries it.
		const existing = await requireTask(params.id);
		await tasksService.deleteTask(params.id);
		if (existing.googleTaskId) await pushDeletionNow(existing.googleTaskId);
		return { status: 200, body: { deleted: params.id } };
	});
