import { zoneForTask, taskCenter, type ZoneBounds } from './zones';

export type ListTask = {
	id: string;
	title: string;
	done: boolean;
	priority: string | null;
	dueDate: string | null;
	notes: string | null;
	source: string;
	x: number;
	y: number;
	googleSync?: boolean;
	googleTaskId?: string | null;
	googleError?: string | null;
	/** Denormalised by the board's load, so a card can say who a task is about. */
	personName?: string | null;
};

/** The fields category resolution actually reads. */
type Categorizable = Pick<ListTask, 'x' | 'y' | 'source'>;

export type ListZone = ZoneBounds & { name: string; color: string };

export type SortField = 'done' | 'title' | 'category' | 'dueDate' | 'priority' | 'notes';
export type SortDirection = 'asc' | 'desc';
export type DueFilter = 'all' | 'overdue' | 'today' | 'week' | 'none';
export type PriorityFilter = 'all' | 'low' | 'med' | 'high';

export const NO_CATEGORY = 'none';

/**
 * The pseudo-category for synced Canvas assignments.
 *
 * They still carry x/y because the row needs them, but they are no longer
 * drawn on the spatial views, so the zone they happen to overlap is an
 * accident of placement rather than a statement about the work. Sorted and
 * filtered like any zone category; it just is not one.
 */
export const CANVAS_CATEGORY = 'canvas';
export const CANVAS_CATEGORY_NAME = 'Canvas';

/** `task.source` for rows created by the Canvas sync. */
export const CANVAS_SOURCE = 'canvas';

const PRIORITY_RANK: Record<string, number> = { low: 0, med: 1, high: 2 };

/** The owning zone's name for a task, "Canvas" for an assignment, "—" when loose. */
export function categoryNameFor(task: Categorizable, zones: ListZone[]): string {
	if (task.source === CANVAS_SOURCE) return CANVAS_CATEGORY_NAME;
	const hit = zoneForTask(taskCenter(task), zones);
	if (!hit) return '—';
	return zones.find((z) => z.id === hit.id)?.name ?? '—';
}

/**
 * The filter-bar key for a task's category: CANVAS_CATEGORY for an assignment,
 * otherwise its zone id, or NO_CATEGORY when loose. Ids, not names — two zones
 * may share a name, and a rename must not quietly move a task into a different
 * filter bucket.
 */
export function categoryKeyFor(task: Categorizable, zones: ListZone[]): string {
	if (task.source === CANVAS_SOURCE) return CANVAS_CATEGORY;
	return zoneForTask(taskCenter(task), zones)?.id ?? NO_CATEGORY;
}

/** The owning zone's color for a task; null for assignments and loose tasks. */
export function categoryColorFor(task: Categorizable, zones: ListZone[]): string | null {
	if (task.source === CANVAS_SOURCE) return null;
	const hit = zoneForTask(taskCenter(task), zones);
	if (!hit) return null;
	return zones.find((z) => z.id === hit.id)?.color ?? null;
}

// Re-exported from its own module so the board's many callers keep importing it
// from here, while code that must not depend on the board can reach it directly.
export { localDateString } from './date';

function addDays(dateStr: string, days: number): string {
	const d = new Date(`${dateStr}T00:00:00Z`);
	d.setUTCDate(d.getUTCDate() + days);
	return d.toISOString().slice(0, 10);
}

export type ListFilters = {
	/** Category keys (zone id, or NO_CATEGORY) the user has unchecked. Empty = everything shown. */
	deselectedCategories: Set<string>;
	due: DueFilter;
	priority: PriorityFilter;
};

export function filterTasks(
	tasks: ListTask[],
	zones: ListZone[],
	filters: ListFilters,
	today: string
): ListTask[] {
	return tasks.filter((task) => {
		if (filters.deselectedCategories.has(categoryKeyFor(task, zones))) return false;

		if (filters.due !== 'all') {
			if (filters.due === 'none') {
				if (task.dueDate) return false;
			} else if (!task.dueDate) {
				return false;
			} else if (filters.due === 'overdue' && !(task.dueDate < today)) {
				return false;
			} else if (filters.due === 'today' && task.dueDate !== today) {
				return false;
			} else if (
				filters.due === 'week' &&
				!(task.dueDate >= today && task.dueDate <= addDays(today, 7))
			) {
				return false;
			}
		}

		if (filters.priority !== 'all' && task.priority !== filters.priority) return false;

		return true;
	});
}

function sortValue(task: ListTask, field: SortField, zones: ListZone[]): string | number | null {
	switch (field) {
		case 'done':
			return task.done ? 1 : 0;
		case 'title':
			return task.title.toLowerCase();
		case 'category': {
			const name = categoryNameFor(task, zones);
			return name === '—' ? null : name.toLowerCase();
		}
		case 'dueDate':
			return task.dueDate;
		case 'priority':
			return task.priority ? PRIORITY_RANK[task.priority] : null;
		case 'notes': {
			const notes = task.notes?.trim();
			return notes ? notes.toLowerCase() : null;
		}
	}
}

/** Sorted copy of `tasks`; entries with no value for `field` always sort last, in either direction. */
export function sortTasks(
	tasks: ListTask[],
	zones: ListZone[],
	field: SortField,
	direction: SortDirection
): ListTask[] {
	const mul = direction === 'asc' ? 1 : -1;
	return [...tasks].sort((a, b) => {
		const av = sortValue(a, field, zones);
		const bv = sortValue(b, field, zones);
		if (av === null && bv === null) return 0;
		if (av === null) return 1;
		if (bv === null) return -1;
		if (av < bv) return -mul;
		if (av > bv) return mul;
		return 0;
	});
}
