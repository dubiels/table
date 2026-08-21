import type { RequestHandler } from './$types';
import * as tasksService from '$lib/server/tasks/service';
import * as zonesService from '$lib/server/zones/service';
import { pushTaskNow, pushDeletionNow } from '$lib/server/gtasks/push';
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
