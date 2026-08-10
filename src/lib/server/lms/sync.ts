import { env } from '$env/dynamic/private';
import { db } from '../db';
import { tasks, zones } from '../db/schema';
import { eq, and } from 'drizzle-orm';
import { parseLmsIcal } from './ical-parser';
import { randomUUID } from 'node:crypto';

const CANVAS_ZONE_NAME = 'Canvas';

export async function syncLmsAssignments(): Promise<{ added: number; updated: number }> {
	const icalUrl = env.LMS_ICAL_URL ?? env.CANVAS_ICAL_URL;
	if (!icalUrl) {
		console.warn('LMS_ICAL_URL not set, skipping LMS sync');
		return { added: 0, updated: 0 };
	}

	// Fetch iCal
	let icsText: string;
	try {
		const response = await fetch(icalUrl);
		if (!response.ok) throw new Error(`HTTP ${response.status}`);
		icsText = await response.text();
	} catch (err) {
		console.error('Failed to fetch LMS iCal:', err);
		throw err;
	}

	// Parse events
	const events = parseLmsIcal(icsText);
	console.log(`LMS sync: parsed ${events.length} events`);

	let added = 0;
	let updated = 0;

	// Get Canvas zone
	const lmsZone = await db.query.zones.findFirst({
		where: (z, { eq }) => eq(z.name, CANVAS_ZONE_NAME)
	});
	if (!lmsZone) {
		throw new Error(`Canvas zone not found. Please create a zone named "${CANVAS_ZONE_NAME}"`);
	}

	// Sync each event
	for (const event of events) {
		const existing = await db.query.tasks.findFirst({
			where: and(
				eq(tasks.externalId, event.eventId),
				eq(tasks.source, 'canvas')
			)
		});

		if (existing) {
			// Update if due date changed
			if (existing.dueDate !== event.dueDate) {
				await db
					.update(tasks)
					.set({ dueDate: event.dueDate })
					.where(eq(tasks.id, existing.id));
				updated++;
				console.log(`LMS sync: updated due date for "${event.title}"`);
			}
		} else {
			// Create new task
			await db.insert(tasks).values({
				id: randomUUID(),
				title: event.title,
				notes: null,
				dueDate: event.dueDate,
				priority: null,
				done: false,
				completedAt: null,
				source: 'canvas',
				externalId: event.eventId,
				courseName: event.courseName,
				x: lmsZone.x + 20,
				y: lmsZone.y + 20,
				sortOrder: 0,
				createdAt: new Date().toISOString()
			});
			added++;
			console.log(`LMS sync: added "${event.title}" from ${event.courseName}`);
		}
	}

	console.log(`LMS sync complete: added ${added}, updated ${updated}`);
	return { added, updated };
}
