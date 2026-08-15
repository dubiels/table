/**
 * `date` as a local calendar date in `YYYY-MM-DD`.
 *
 * Dates the user picked — a task's due date, the day you met someone — are
 * stored with no time or zone attached. `new Date().toISOString()` answers a
 * different question, namely where the current instant falls on the UTC
 * calendar, so anywhere west of Greenwich it rolls over to tomorrow during the
 * evening: tasks due today start reading as overdue hours early, and someone
 * added after dinner is recorded as met tomorrow.
 *
 * This lives in its own module rather than beside the list view because both
 * the board and Dinner Table need it, and Dinner Table must not depend on the
 * board — that one-way rule is what keeps it cheap to extract later.
 */
export function localDateString(date = new Date()): string {
	const month = String(date.getMonth() + 1).padStart(2, '0');
	const day = String(date.getDate()).padStart(2, '0');
	return `${date.getFullYear()}-${month}-${day}`;
}
