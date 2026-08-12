/**
 * What a task's Google Tasks columns mean, in one place.
 *
 * The card badge and the legend in the user menu both read from here, so the
 * key can never end up describing marks the board no longer draws.
 */

export type GoogleSyncState = 'off' | 'pending' | 'synced' | 'error';

/** The columns the state is derived from. Everything else about a task is irrelevant here. */
export type GoogleSyncFields = {
	googleSync?: boolean;
	googleTaskId?: string | null;
	googleError?: string | null;
};

/**
 * Which of the four marks a task carries.
 *
 * An error outranks everything else, because the two are not mutually
 * exclusive: a reconcile that finds a linked task gone from Google unlinks it
 * and writes the reason in one go, leaving `googleSync` false, `googleTaskId`
 * null and `googleError` set. That is a durable state, not a flash, and
 * folding it into `off` would make a task Google dropped look exactly like one
 * nobody ever opted in — the very thing the badge exists to tell apart.
 *
 * `googleSync` false with a `googleTaskId` still set does not appear here as a
 * state of its own: switching a task off deletes its Google copy and clears
 * the id in the same transaction, so the pair only exists mid-write.
 */
export function googleSyncState(task: GoogleSyncFields): GoogleSyncState {
	if (task.googleError) return 'error';
	if (!task.googleSync) return 'off';
	return task.googleTaskId ? 'synced' : 'pending';
}

/**
 * Whether Table is currently mirroring this task, which is what decides the
 * direction of a click on the badge.
 *
 * Read from `googleSync` rather than from the state, because `error` sits on
 * both sides of the switch: a rejected push leaves a task opted in, while a
 * task Google dropped is already opted out and wants turning back on.
 */
export function googleSyncIsOn(task: GoogleSyncFields): boolean {
	return task.googleSync === true;
}

/** What the badge says on hover, with the reason spelled out when there is one. */
export function googleSyncLabel(task: GoogleSyncFields): string {
	const state = googleSyncState(task);
	if (state === 'error') return `Google Tasks: ${task.googleError}`;
	return GOOGLE_SYNC_STATES.find((s) => s.state === state)!.label;
}

/** Names the click, so the control says what it will do rather than what it is. */
export function googleSyncActionLabel(task: GoogleSyncFields): string {
	return googleSyncIsOn(task) ? 'Remove from Google Tasks' : 'Send to Google Tasks';
}

/**
 * The legend, in the order a task moves through it: not synced, sent, landed,
 * and the one state that is not a step.
 */
export const GOOGLE_SYNC_STATES: {
	state: GoogleSyncState;
	label: string;
	description: string;
}[] = [
	{
		state: 'off',
		label: 'Not synced',
		description: 'Lives only in Table.'
	},
	{
		state: 'pending',
		label: 'Waiting to reach Google Tasks',
		description: 'Sent, not confirmed yet.'
	},
	{
		state: 'synced',
		label: 'In Google Tasks',
		description: 'Mirrored both ways.'
	},
	{
		state: 'error',
		label: 'Sync problem',
		description: 'Hover the mark for the reason.'
	}
];

/** A task needs a due date to be created in Google; an existing link is kept without one. */
export function canSendToGoogle(task: GoogleSyncFields & { dueDate?: string | null }): boolean {
	return Boolean(task.dueDate) || Boolean(task.googleTaskId);
}

/** The one message both the board and the detail panel show when the date is missing. */
export const NEEDS_DUE_DATE_MESSAGE =
	'Needs a due date — an undated task never reaches the calendar grid.';
