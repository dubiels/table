import { env } from '$env/dynamic/private';
import { db } from '../db';
import { tasks, zones } from '../db/schema';
import { eq, and } from 'drizzle-orm';
import { parseCanvasIcal } from './ical-parser';
import { randomUUID } from 'node:crypto';

const CANVAS_ZONE_NAME = 'Canvas';

export async function syncCanvasAssignments(): Promise<{ added: number; updated: number }> {
	const canvasUrl = env.CANVAS_ICAL_URL;
	if (!canvasUrl) {
		console.warn('CANVAS_ICAL_URL not set, skipping Canvas sync');
		return { added: 0, updated: 0 };
	}

	// Fetch iCal
	let icsText: string;
	try {
		const response = await fetch(canvasUrl);
		if (!response.ok) throw new Error(`HTTP ${response.status}`);
		icsText = await response.text();
	} catch (err) {
		console.error('Failed to fetch Canvas iCal:', err);
		throw err;
	}

	// Parse events
	const events = parseCanvasIcal(icsText);
	console.log(`Canvas sync: parsed ${events.length} events`);

	let added = 0;
	let updated = 0;

	// Get Canvas zone
	const canvasZone = await db.query.zones.findFirst({
		where: (z, { eq }) => eq(z.name, CANVAS_ZONE_NAME)
	});
	if (!canvasZone) {
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
				console.log(`Canvas sync: updated due date for "${event.title}"`);
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
				x: canvasZone.x + 20,
				y: canvasZone.y + 20,
				sortOrder: 0,
				createdAt: new Date().toISOString()
			});
			added++;
			console.log(`Canvas sync: added "${event.title}" from ${event.courseName}`);
		}
	}

	console.log(`Canvas sync complete: added ${added}, updated ${updated}`);
	return { added, updated };
}
