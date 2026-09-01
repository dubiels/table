import type { RequestHandler } from './$types';
import * as tasksService from '$lib/server/tasks/service';
import * as zonesService from '$lib/server/zones/service';
import { pushTaskNow } from '$lib/server/gtasks/push';
import { runRead, runWrite, parse, boolParam, timestampParam } from '$lib/server/agent/respond';
import { createTaskSchema } from '$lib/server/agent/schemas';
import { selectTasks, serializeTask } from '$lib/server/agent/serialize';
import { placementFor } from '$lib/server/agent/placement';
import { requirePerson } from '$lib/server/agent/resources';

export const GET: RequestHandler = ({ url }) =>
	runRead(async () => {
		// Read together so the zone a task reports is the one that existed when the
		// task's coordinates were read, not one a concurrent resize moved.
		const [tasks, zones] = await Promise.all([tasksService.listTasks(), zonesService.listZones()]);
		const selected = selectTasks(tasks, {
			includeCompleted: boolParam(url, 'includeCompleted'),
			since: timestampParam(url, 'since')
		});
		return { tasks: selected.map((task) => serializeTask(task, zones)) };
	});

export const POST: RequestHandler = ({ request }) =>
	runWrite(request, 'POST /api/agent/tasks', async (body) => {
		const input = parse(createTaskSchema, body);
		const [zones, tasks] = await Promise.all([zonesService.listZones(), tasksService.listTasks()]);

		if (input.personId) await requirePerson(input.personId);

		// Absent means "wherever new tasks go" — the same default anchor the board's
		// composer uses. Present, including explicitly null, is a placement.
		const placement =
			input.zoneId === undefined ? null : placementFor(input.zoneId, null, zones, tasks);

		const task = await tasksService.createTask({
			title: input.title,
			notes: input.notes ?? undefined,
			dueDate: input.dueDate ?? undefined,
			plannedDate: input.plannedDate ?? undefined,
			priority: input.priority ?? undefined,
			personId: input.personId ?? undefined,
			// The composer's rule, not a new one: an undated Google task never
			// reaches the calendar grid, which is the whole point of pushing it.
			googleSync: input.googleSync === true && Boolean(input.plannedDate),
			x: placement ? Math.round(placement.x) : undefined,
			y: placement ? Math.round(placement.y) : undefined
		});

		await pushTaskNow(task.id);
		// Re-read to pick up whatever the push wrote back, but never let that
		// failing lose the write: the row is already committed, and throwing here
		// would release the idempotency claim so the agent's retry created a
		// SECOND task. The in-memory row is a truthful, slightly staler answer.
		const created = await tasksService.getTask(task.id).catch(() => task);
		return { status: 201, body: { task: serializeTask(created, zones) } };
	});
