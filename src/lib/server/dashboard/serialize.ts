import { zoneForTask, taskCenter } from '$lib/zones';

export interface DashboardZone {
	id: string;
	name: string;
	color: string;
}

export interface DashboardTask {
	id: string;
	title: string;
	dueDate: string | null;
	/** The day the work is scheduled for. Additive: the wall renderer may ignore it. */
	plannedDate: string | null;
	priority: string | null;
	source: string;
	courseName: string | null;
	zone: DashboardZone | null;
}

export interface DashboardPayload {
	generatedAt: string;
	timezone: string;
	tasks: DashboardTask[];
	zones: DashboardZone[];
}

interface TaskRow {
	id: string;
	title: string;
	dueDate: string | null;
	plannedDate: string | null;
	priority: string | null;
	source: string;
	courseName: string | null;
	x: number;
	y: number;
}

interface ZoneRow {
	id: string;
	name: string;
	color: string;
	x: number;
	y: number;
	width: number;
	height: number;
}

const PRIORITY_RANK: Record<string, number> = { high: 0, med: 1, low: 2 };
const rank = (p: string | null) => (p !== null && p in PRIORITY_RANK ? PRIORITY_RANK[p] : 3);

export function buildDashboardPayload(
	taskRows: TaskRow[],
	zoneRows: ZoneRow[],
	generatedAt: Date,
	timezone: string
): DashboardPayload {
	const zonesOut = zoneRows.map((z) => ({ id: z.id, name: z.name, color: z.color }));
	const byId = new Map(zonesOut.map((z) => [z.id, z]));

	const tasksOut: DashboardTask[] = taskRows.map((t) => {
		const hit = zoneForTask(taskCenter({ x: t.x, y: t.y }), zoneRows);
		return {
			id: t.id,
			title: t.title,
			dueDate: t.dueDate,
			plannedDate: t.plannedDate,
			priority: t.priority,
			source: t.source,
			courseName: t.courseName,
			zone: hit ? (byId.get(hit.id) ?? null) : null
		};
	});

	tasksOut.sort((a, b) => {
		if (a.dueDate !== b.dueDate) {
			if (a.dueDate === null) return 1;
			if (b.dueDate === null) return -1;
			return a.dueDate < b.dueDate ? -1 : 1;
		}
		const byPriority = rank(a.priority) - rank(b.priority);
		if (byPriority !== 0) return byPriority;
		return a.title.localeCompare(b.title);
	});

	return { generatedAt: generatedAt.toISOString(), timezone, tasks: tasksOut, zones: zonesOut };
}
