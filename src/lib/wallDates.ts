import { taskMarks, type TaskDates } from './taskMarks';

/**
 * The date pills the wall draws, and the rule for the today highlight.
 *
 * The wall says the words "Do" and "Due" on every task that carries either
 * date: a panel read from across the room has no room for the board's quieter
 * conventions, and nobody standing two metres away can hover a chip to find
 * out which date they are looking at.
 *
 * Which of them is *late* is not decided here — that comes from `taskMarks`,
 * the same function the board and the list read — so a task can never be red
 * on one surface and plain on another.
 */

export type PillKind = 'do' | 'due';
export type PillTone = 'plain' | 'now' | 'late';

export interface WallPill {
	kind: PillKind;
	/** Ready to render, e.g. "Do tomorrow", "Due Aug 14". */
	text: string;
	tone: PillTone;
}

const SHORT_DAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const SHORT_MONTH = [
	'Jan',
	'Feb',
	'Mar',
	'Apr',
	'May',
	'Jun',
	'Jul',
	'Aug',
	'Sep',
	'Oct',
	'Nov',
	'Dec'
];

/** Parsed as parts, never `new Date(iso)`: see the note in `date.ts`. */
function parts(date: string): { y: number; m: number; d: number } {
	const [y, m, d] = date.split('-').map(Number);
	return { y, m, d };
}

function dayNumber(date: string): number {
	const { y, m, d } = parts(date);
	return Math.round(new Date(y, m - 1, d).getTime() / 86_400_000);
}

/**
 * How far `date` is from `today`, in whole calendar days. Negative is past.
 *
 * Both are local calendar dates, so this counts days on the wall calendar
 * rather than 24-hour periods, and a DST boundary between them cannot shift
 * the answer.
 */
export function dayOffset(date: string, today: string): number {
	return dayNumber(date) - dayNumber(today);
}

/**
 * A date in the wall's words: "today", "tomorrow", "yesterday", a weekday
 * inside the coming week, and a month and day beyond that.
 *
 * The year is only spoken when it is not the year `today` falls in — "Jan 8,
 * 2027" earns its extra characters, "Sep 23, 2026" does not.
 */
export function wallDayLabel(date: string, today: string): string {
	const offset = dayOffset(date, today);
	if (offset === 0) return 'today';
	if (offset === 1) return 'tomorrow';
	if (offset === -1) return 'yesterday';

	const { y, m, d } = parts(date);
	// Only forwards: "Tue" for a day three weeks back would read as the coming
	// Tuesday, which is the one thing a weekday name must never do.
	if (offset > 1 && offset < 7) return SHORT_DAY[new Date(y, m - 1, d).getDay()];

	const label = `${SHORT_MONTH[m - 1]} ${d}`;
	return y === parts(today).y ? label : `${label}, ${y}`;
}

/**
 * Both dates a task carries, each named, in the order they are read: what you
 * planned to do first, then what the world expects.
 *
 * A done task shows nothing. The wall lists active work, and a finished task
 * with a red deadline is a false alarm on a screen read at a glance.
 */
export function wallPills(task: TaskDates, today: string): WallPill[] {
	if (task.done) return [];
	const marks = taskMarks(task, today);
	const pills: WallPill[] = [];

	if (task.plannedDate) {
		pills.push({
			kind: 'do',
			text: `Do ${wallDayLabel(task.plannedDate, today)}`,
			// A plan for today and a plan that has slipped are the same call to
			// action on a wall: this is the work in front of you now.
			tone: dayOffset(task.plannedDate, today) <= 0 ? 'now' : 'plain'
		});
	}

	if (task.dueDate) {
		pills.push({
			kind: 'due',
			text: `Due ${wallDayLabel(task.dueDate, today)}`,
			tone: marks.overdue ? 'late' : 'plain'
		});
	}

	return pills;
}

/**
 * Whether the row is highlighted: the day you meant to do it is here or has
 * been and gone. Deliberately says nothing about the deadline — a task due
 * tomorrow that you planned for tomorrow is not today's work.
 */
export function isOnTodaysPlan(task: TaskDates, today: string): boolean {
	if (task.done || !task.plannedDate) return false;
	return dayOffset(task.plannedDate, today) <= 0;
}
