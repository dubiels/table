import { describe, it, expect } from 'vitest';
import {
	categoryNameFor,
	categoryKeyFor,
	categoryColorFor,
	filterTasks,
	sortTasks,
	localDateString,
	NO_CATEGORY,
	type ListTask,
	type ListZone
} from './listView';

const work: ListZone = {
	id: 'work',
	name: 'Work',
	color: 'sky',
	x: 0,
	y: 0,
	width: 400,
	height: 400
};
const home: ListZone = {
	id: 'home',
	name: 'Home',
	color: 'blush',
	x: 500,
	y: 0,
	width: 200,
	height: 200
};

function task(overrides: Partial<ListTask> & { id: string }): ListTask {
	return {
		title: 'Untitled',
		done: false,
		priority: null,
		dueDate: null,
		notes: null,
		x: -1000,
		y: -1000,
		...overrides
	};
}

describe('categoryNameFor / categoryKeyFor', () => {
	it('returns the owning zone name for a task inside its bounds', () => {
		const t = task({ id: '1', x: 100, y: 100 });
		expect(categoryNameFor(t, [work, home])).toBe('Work');
		expect(categoryKeyFor(t, [work, home])).toBe('work');
	});

	it('keys two zones sharing a display name separately', () => {
		const alias: ListZone = { ...home, id: 'home-2', name: 'Work' };
		const inWork = task({ id: '1', x: 100, y: 100 });
		const inAlias = task({ id: '2', x: 550, y: 50 });
		expect(categoryNameFor(inAlias, [work, alias])).toBe('Work');
		expect(categoryKeyFor(inWork, [work, alias])).not.toBe(categoryKeyFor(inAlias, [work, alias]));
	});

	it('keeps a key that survives a rename', () => {
		const renamed: ListZone = { ...work, name: 'Studies' };
		const t = task({ id: '1', x: 100, y: 100 });
		expect(categoryKeyFor(t, [renamed])).toBe(categoryKeyFor(t, [work]));
	});

	it('returns an em dash / NO_CATEGORY for a loose task', () => {
		const t = task({ id: '1', x: -1000, y: -1000 });
		expect(categoryNameFor(t, [work, home])).toBe('—');
		expect(categoryKeyFor(t, [work, home])).toBe(NO_CATEGORY);
	});
});

describe('categoryColorFor', () => {
	it("returns the owning zone's color for a task inside its bounds", () => {
		const t = task({ id: '1', x: 100, y: 100 });
		expect(categoryColorFor(t, [work, home])).toBe('sky');
	});

	it('returns null for a loose task', () => {
		const t = task({ id: '1', x: -1000, y: -1000 });
		expect(categoryColorFor(t, [work, home])).toBeNull();
	});
});

describe('localDateString', () => {
	it('formats a date as zero-padded YYYY-MM-DD', () => {
		expect(localDateString(new Date(2026, 0, 5, 12, 0, 0))).toBe('2026-01-05');
	});

	it('reads the calendar date the user sees, not the UTC one', () => {
		// Task due dates are stored as local calendar dates. `toISOString()`
		// answers a different question — the instant in UTC — so late in the
		// evening west of Greenwich it returns tomorrow, marking everything due
		// today overdue a day early.
		const lateEvening = new Date(2026, 6, 21, 23, 30, 0);
		expect(localDateString(lateEvening)).toBe('2026-07-21');
		expect(localDateString(new Date(2026, 6, 21, 0, 15, 0))).toBe('2026-07-21');
	});

	it('handles the last day of a month and of a year', () => {
		expect(localDateString(new Date(2026, 11, 31, 23, 59, 59))).toBe('2026-12-31');
		expect(localDateString(new Date(2026, 1, 28, 6, 0, 0))).toBe('2026-02-28');
	});
});

describe('filterTasks', () => {
	const today = '2026-07-21';

	it('excludes tasks whose category key is deselected', () => {
		const inWork = task({ id: '1', x: 100, y: 100 });
		const loose = task({ id: '2', x: -1000, y: -1000 });
		const result = filterTasks(
			[inWork, loose],
			[work, home],
			{ deselectedCategories: new Set(['work']), due: 'all', priority: 'all' },
			today
		);
		expect(result.map((t) => t.id)).toEqual(['2']);
	});

	it('excludes loose tasks when NO_CATEGORY is deselected', () => {
		const loose = task({ id: '1', x: -1000, y: -1000 });
		const result = filterTasks(
			[loose],
			[work, home],
			{ deselectedCategories: new Set([NO_CATEGORY]), due: 'all', priority: 'all' },
			today
		);
		expect(result).toEqual([]);
	});

	it('filters overdue: due date strictly before today, excludes tasks with no due date', () => {
		const overdue = task({ id: '1', dueDate: '2026-07-20' });
		const future = task({ id: '2', dueDate: '2026-07-22' });
		const none = task({ id: '3', dueDate: null });
		const result = filterTasks(
			[overdue, future, none],
			[],
			{ deselectedCategories: new Set(), due: 'overdue', priority: 'all' },
			today
		);
		expect(result.map((t) => t.id)).toEqual(['1']);
	});

	it('filters today: exact date match only', () => {
		const todayTask = task({ id: '1', dueDate: today });
		const other = task({ id: '2', dueDate: '2026-07-22' });
		const result = filterTasks(
			[todayTask, other],
			[],
			{ deselectedCategories: new Set(), due: 'today', priority: 'all' },
			today
		);
		expect(result.map((t) => t.id)).toEqual(['1']);
	});

	it('filters this week: today through 7 days ahead, inclusive', () => {
		const inWindow = task({ id: '1', dueDate: '2026-07-28' });
		const pastWindow = task({ id: '2', dueDate: '2026-07-29' });
		const beforeToday = task({ id: '3', dueDate: '2026-07-20' });
		const result = filterTasks(
			[inWindow, pastWindow, beforeToday],
			[],
			{ deselectedCategories: new Set(), due: 'week', priority: 'all' },
			today
		);
		expect(result.map((t) => t.id)).toEqual(['1']);
	});

	it('filters none: tasks with no due date only', () => {
		const withDate = task({ id: '1', dueDate: today });
		const noDate = task({ id: '2', dueDate: null });
		const result = filterTasks(
			[withDate, noDate],
			[],
			{ deselectedCategories: new Set(), due: 'none', priority: 'all' },
			today
		);
		expect(result.map((t) => t.id)).toEqual(['2']);
	});

	it('filters by priority', () => {
		const high = task({ id: '1', priority: 'high' });
		const low = task({ id: '2', priority: 'low' });
		const none = task({ id: '3', priority: null });
		const result = filterTasks(
			[high, low, none],
			[],
			{ deselectedCategories: new Set(), due: 'all', priority: 'high' },
			today
		);
		expect(result.map((t) => t.id)).toEqual(['1']);
	});

	it('composes category, due, and priority filters with AND semantics', () => {
		const match = task({ id: '1', x: 100, y: 100, dueDate: today, priority: 'high' });
		const wrongPriority = task({ id: '2', x: 100, y: 100, dueDate: today, priority: 'low' });
		const result = filterTasks(
			[match, wrongPriority],
			[work],
			{ deselectedCategories: new Set(), due: 'today', priority: 'high' },
			today
		);
		expect(result.map((t) => t.id)).toEqual(['1']);
	});
});

describe('sortTasks', () => {
	it('sorts by due date ascending with no-due-date tasks last (default view sort)', () => {
		const a = task({ id: 'a', dueDate: '2026-07-25' });
		const b = task({ id: 'b', dueDate: '2026-07-22' });
		const c = task({ id: 'c', dueDate: null });
		const result = sortTasks([a, b, c], [], 'dueDate', 'asc');
		expect(result.map((t) => t.id)).toEqual(['b', 'a', 'c']);
	});

	it('keeps no-due-date tasks last even when direction is descending', () => {
		const a = task({ id: 'a', dueDate: '2026-07-25' });
		const c = task({ id: 'c', dueDate: null });
		const result = sortTasks([c, a], [], 'dueDate', 'desc');
		expect(result.map((t) => t.id)).toEqual(['a', 'c']);
	});

	it('sorts by title case-insensitively', () => {
		const a = task({ id: 'a', title: 'banana' });
		const b = task({ id: 'b', title: 'Apple' });
		const result = sortTasks([a, b], [], 'title', 'asc');
		expect(result.map((t) => t.id)).toEqual(['b', 'a']);
	});

	it('sorts by category name with loose tasks last', () => {
		const inHome = task({ id: 'home', x: 550, y: 50 });
		const inWork = task({ id: 'work', x: 100, y: 100 });
		const loose = task({ id: 'loose', x: -1000, y: -1000 });
		const result = sortTasks([loose, inHome, inWork], [work, home], 'category', 'asc');
		expect(result.map((t) => t.id)).toEqual(['home', 'work', 'loose']);
	});

	it('sorts by priority low to high with unset priority last', () => {
		const high = task({ id: 'high', priority: 'high' });
		const low = task({ id: 'low', priority: 'low' });
		const med = task({ id: 'med', priority: 'med' });
		const none = task({ id: 'none', priority: null });
		const result = sortTasks([none, high, low, med], [], 'priority', 'asc');
		expect(result.map((t) => t.id)).toEqual(['low', 'med', 'high', 'none']);
	});

	it('sorts by done state and by notes presence', () => {
		const done = task({ id: 'done', done: true });
		const notDone = task({ id: 'not-done', done: false });
		expect(sortTasks([done, notDone], [], 'done', 'asc').map((t) => t.id)).toEqual([
			'not-done',
			'done'
		]);

		const withNotes = task({ id: 'with-notes', notes: 'call back' });
		const emptyNotes = task({ id: 'empty-notes', notes: '' });
		const noNotes = task({ id: 'no-notes', notes: null });
		const result = sortTasks([noNotes, withNotes, emptyNotes], [], 'notes', 'asc');
		// Empty-string and null notes are equivalent ("no value") and tie for last place.
		expect(result[0].id).toBe('with-notes');
		expect(new Set(result.slice(1).map((t) => t.id))).toEqual(new Set(['empty-notes', 'no-notes']));
	});
});
