import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import * as tasksService from '$lib/server/tasks/service';
import * as zonesService from '$lib/server/zones/service';

interface PositionBody {
	kind: 'task' | 'zone';
	id: string;
	x: number;
	y: number;
	width?: number;
	height?: number;
}

export const POST: RequestHandler = async ({ request }) => {
	const body = (await request.json()) as PositionBody;
	if (!body?.id || typeof body.x !== 'number' || typeof body.y !== 'number') {
		throw error(400, 'x, y and id are required');
	}
	if (body.kind === 'task') {
		await tasksService.updateTaskPosition(body.id, Math.round(body.x), Math.round(body.y));
	} else if (body.kind === 'zone') {
		await zonesService.updateZoneGeometry(body.id, {
			x: Math.round(body.x),
			y: Math.round(body.y),
			width: Math.round(body.width ?? 320),
			height: Math.round(body.height ?? 320)
		});
	} else {
		throw error(400, 'kind must be task or zone');
	}
	return json({ ok: true });
};
