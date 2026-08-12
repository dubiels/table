import { env } from '$env/dynamic/private';
import { db } from '../db';
import { tasks, zones } from '../db/schema';
import { eq } from 'drizzle-orm';
import { parseLmsIcal } from './ical-parser';
import { planLmsSync, zoneInnerBounds, looseBounds } from './plan';
import { randomUUID } from 'node:crypto';

export interface LmsSyncResult {
	created: number;
	updated: number;
	placedLoose: boolean;
}

export async function syncLmsAssignments(): Promise<LmsSyncResult> {
	const url = env.LMS_ICAL_URL ?? env.CANVAS_ICAL_URL;
	if (!url) {
		console.warn('LMS sync: LMS_ICAL_URL not set, skipping');
		return { created: 0, updated: 0, placedLoose: false };
	}

	const response = await fetch(url, { signal: AbortSignal.timeout(8000) });
	if (!response.ok) throw new Error(`LMS feed fetch failed: HTTP ${response.status}`);
	const events = parseLmsIcal(await response.text());

	// Zone by id — ids survive renames. Missing/unset zone is never an error:
	// tasks go loose on bare table (a first-class state) with a warning.
	const zoneId = env.LMS_ZONE_ID;
	const zone = zoneId ? await db.query.zones.findFirst({ where: eq(zones.id, zoneId) }) : undefined;
	if (zoneId && !zone) {
		console.warn(`LMS sync: LMS_ZONE_ID "${zoneId}" matches no zone; placing tasks loose`);
	} else if (!zoneId) {
		console.warn('LMS sync: LMS_ZONE_ID not set; placing tasks loose');
	}

	const [activeTasks, existingLms] = await Promise.all([
		db.query.tasks.findMany({ where: eq(tasks.done, false) }),
		db.query.tasks.findMany({ where: eq(tasks.source, 'canvas') })
	]);

	const bounds = zone ? zoneInnerBounds(zone) : looseBounds();
	const occupied = activeTasks.map((t) => ({ x: t.x, y: t.y }));
	const plan = planLmsSync(events, existingLms, bounds, occupied);

	for (const create of plan.creates) {
		await db.insert(tasks).values({
			id: randomUUID(),
			title: create.title,
			notes: null,
			dueDate: create.dueDate,
			priority: null,
			done: false,
			completedAt: null,
			source: 'canvas',
			externalId: create.externalId,
			courseName: create.courseName,
			x: create.x,
			y: create.y,
			sortOrder: 0,
			updatedAt: new Date().toISOString(),
			googleSync: false,
			createdAt: new Date().toISOString()
		});
	}
	for (const update of plan.dueDateUpdates) {
		// `updatedAt` is not decoration here: Google-visible fields (title, notes,
		// dueDate, done) must bump it on every write, because dirtiness is
		// `updatedAt !== googleSyncedAt` and that is the only thing that tells the
		// Google reconciler it owes Google a write. Writing the row directly
		// bypasses tasks/service, which is where that rule normally lives — so it
		// has to be honoured by hand, as on the insert above.
		//
		// Without it a Canvas deadline change on a task the user sent to Google is
		// lost in both directions and silently: the card shows the new date and
		// reads clean forever, so no round ever pushes it, while Google keeps the
		// old date — and the first time Google touches that task the planner
		// patches Table back to Google's stale one.
		await db
			.update(tasks)
			.set({ dueDate: update.dueDate, updatedAt: new Date().toISOString() })
			.where(eq(tasks.id, update.id));
	}

	const result = {
		created: plan.creates.length,
		updated: plan.dueDateUpdates.length,
		placedLoose: !zone && plan.creates.length > 0
	};
	console.log(
		`LMS sync complete: ${result.created} created, ${result.updated} updated, placedLoose=${result.placedLoose}`
	);
	return result;
}
