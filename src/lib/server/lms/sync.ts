import { env } from '$env/dynamic/private';
import { db } from '../db';
import { tasks, zones } from '../db/schema';
import { eq } from 'drizzle-orm';
import { parseLmsIcal } from './ical-parser';
import { planLmsSync, zoneInnerBounds, looseBounds } from './plan';
import { deleteTask } from '../tasks/service';
import { randomUUID } from 'node:crypto';

export interface LmsSyncResult {
	created: number;
	updated: number;
	deleted: number;
	placedLoose: boolean;
}

export async function syncLmsAssignments(): Promise<LmsSyncResult> {
	const url = env.LMS_ICAL_URL ?? env.CANVAS_ICAL_URL;
	if (!url) {
		console.warn('LMS sync: LMS_ICAL_URL not set, skipping');
		return { created: 0, updated: 0, deleted: 0, placedLoose: false };
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
		// `dueDate` is Table-only as of the plannedDate split: Google has no field
		// to carry it, so a Canvas deadline change is invisible to Google and must
		// not bump `updatedAt`. Dirtiness is `updatedAt !== googleSyncedAt`, and
		// bumping it here would fire a pointless push and arm this task to win a
		// both-dirty conflict against a genuine edit made on the phone — exactly
		// the harm the dueDate/plannedDate split exists to prevent.
		await db.update(tasks).set({ dueDate: update.dueDate }).where(eq(tasks.id, update.id));
	}

	// Through deleteTask rather than a bare db.delete: it is the only path that
	// writes the Google tombstone, and a canvas assignment the user had opted
	// into Google sync would otherwise vanish here and survive in Google with
	// nothing left recording which task to remove.
	for (const id of plan.deletes) {
		await deleteTask(id);
	}

	const result = {
		created: plan.creates.length,
		updated: plan.dueDateUpdates.length,
		deleted: plan.deletes.length,
		placedLoose: !zone && plan.creates.length > 0
	};
	console.log(
		`LMS sync complete: ${result.created} created, ${result.updated} updated, ${result.deleted} deleted, placedLoose=${result.placedLoose}`
	);
	return result;
}
