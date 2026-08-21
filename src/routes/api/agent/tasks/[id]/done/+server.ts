import type { RequestHandler } from './$types';
import * as tasksService from '$lib/server/tasks/service';
import * as zonesService from '$lib/server/zones/service';
import { pushTaskNow } from '$lib/server/gtasks/push';
import { runWrite, parse } from '$lib/server/agent/respond';
import { setDoneSchema } from '$lib/server/agent/schemas';
import { serializeTask } from '$lib/server/agent/serialize';
import { requireTask } from '$lib/server/agent/resources';

/**
 * PUT, and stating the target rather than toggling.
 *
 * A retried toggle undoes its first attempt, which is precisely the failure a
 * client that retries on ambiguous timeouts would hit. Naming the end state
 * makes the write safe to replay even without an idempotency key.
 */
export const PUT: RequestHandler = ({ request, params }) =>
	runWrite(request, `PUT /api/agent/tasks/${params.id}/done`, async (body) => {
		await requireTask(params.id);
		const { done } = parse(setDoneSchema, body);
		const task = await tasksService.setTaskDone(params.id, done);
		await pushTaskNow(params.id);
		return { status: 200, body: { task: serializeTask(task, await zonesService.listZones()) } };
	});
