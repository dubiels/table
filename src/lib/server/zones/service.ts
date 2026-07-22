import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db } from '../db';
import { zones } from '../db/schema';
import type { ZoneColor } from '$lib/zones';

export type Zone = typeof zones.$inferSelect;

export async function createZone(input: {
	name: string;
	color?: ZoneColor;
	x?: number;
	y?: number;
	width?: number;
	height?: number;
}): Promise<Zone> {
	const row = {
		id: randomUUID(),
		name: input.name,
		color: input.color ?? 'sage',
		x: input.x ?? 60,
		y: input.y ?? 60,
		width: input.width ?? 320,
		height: input.height ?? 320,
		createdAt: new Date().toISOString()
	};
	await db.insert(zones).values(row);
	return row;
}

export async function listZones(): Promise<Zone[]> {
	return db.query.zones.findMany({ orderBy: (z, { asc }) => [asc(z.createdAt)] });
}

export async function renameZone(id: string, name: string): Promise<void> {
	await db.update(zones).set({ name }).where(eq(zones.id, id));
}

export async function updateZoneColor(id: string, color: ZoneColor): Promise<void> {
	await db.update(zones).set({ color }).where(eq(zones.id, id));
}

export async function updateZoneGeometry(
	id: string,
	geo: { x: number; y: number; width: number; height: number }
): Promise<void> {
	await db.update(zones).set(geo).where(eq(zones.id, id));
}

export async function deleteZone(id: string): Promise<void> {
	await db.delete(zones).where(eq(zones.id, id));
}
