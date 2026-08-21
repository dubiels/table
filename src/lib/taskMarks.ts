/**
 * The three things a card can say about its dates, in one place.
 *
 * The board and the list view both read from here, so a mark can never come to
 * mean one thing on a card and another in a row — the same reason the Google
 * sync states live in `googleSync.ts` rather than beside either view.
 */
export type TaskDates = {
	dueDate: string | null;
	plannedDate: string | null;
	done: boolean;
};

export type TaskMarks = {
	/** The last possible day has passed. */
	overdue: boolean;
	/** The day you meant to do it has passed, but the deadline has not. */
	slipped: boolean;
	/** The plan falls after the deadline, so it cannot meet it. */
	unachievable: boolean;
};

const NONE: TaskMarks = { overdue: false, slipped: false, unachievable: false };

/**
 * `today` is a local `YYYY-MM-DD`, compared as a string: both dates are stored
 * in the same zero-padded format, so lexical order is calendar order and no
 * Date is ever constructed.
 *
 * `slipped` is suppressed by `overdue` because they are two tellings of one
 * story and the card only has room for the truer one. `unachievable` is not
 * suppressed by either: that the plan never met the deadline is a separate
 * fact from whether the deadline has arrived yet.
 */
export function taskMarks(task: TaskDates, today: string): TaskMarks {
	if (task.done) return NONE;

	const overdue = Boolean(task.dueDate) && task.dueDate! < today;
	const slipped = !overdue && Boolean(task.plannedDate) && task.plannedDate! < today;
	const unachievable =
		Boolean(task.dueDate) && Boolean(task.plannedDate) && task.plannedDate! > task.dueDate!;

	return { overdue, slipped, unachievable };
}
