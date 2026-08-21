import { describe, it, expect } from 'vitest';
import {
	googleSyncState,
	googleSyncIsOn,
	googleSyncLabel,
	googleSyncActionLabel,
	canSendToGoogle,
	GOOGLE_SYNC_STATES
} from './googleSync';

describe('googleSyncState', () => {
	it('reads a task nobody opted in as off', () => {
		expect(googleSyncState({ googleSync: false, googleTaskId: null })).toBe('off');
	});

	it('treats missing columns as off, so a task from a view that does not select them is unmarked', () => {
		expect(googleSyncState({})).toBe('off');
	});

	it('reads an opted-in task with no id yet as pending', () => {
		expect(googleSyncState({ googleSync: true, googleTaskId: null })).toBe('pending');
	});

	it('reads an opted-in task with an id as synced', () => {
		expect(googleSyncState({ googleSync: true, googleTaskId: 'g1' })).toBe('synced');
	});

	it('lets an error outrank a task that is otherwise synced', () => {
		expect(googleSyncState({ googleSync: true, googleTaskId: 'g1', googleError: 'boom' })).toBe(
			'error'
		);
	});

	it('still shows an error for a task Google dropped, which is left opted out and unlinked', () => {
		// What a full reconcile writes when a linked task is genuinely gone from
		// Google. Folding this into `off` would hide the one state the user has to
		// act on.
		expect(
			googleSyncState({
				googleSync: false,
				googleTaskId: null,
				googleError: 'no longer in Google Tasks'
			})
		).toBe('error');
	});

	it('reads a task mid-unlink as off rather than inventing a fifth state', () => {
		expect(googleSyncState({ googleSync: false, googleTaskId: 'g1' })).toBe('off');
	});
});

describe('googleSyncIsOn', () => {
	it('is false for a task Google dropped, so the badge offers to turn it back on', () => {
		expect(googleSyncIsOn({ googleSync: false, googleError: 'no longer in Google Tasks' })).toBe(
			false
		);
	});

	it('is true for a task whose push was rejected, so the badge offers to remove it', () => {
		expect(googleSyncIsOn({ googleSync: true, googleTaskId: 'g1', googleError: 'boom' })).toBe(
			true
		);
	});
});

describe('googleSyncLabel', () => {
	it('spells out the reason on an error', () => {
		expect(googleSyncLabel({ googleError: 'quota exceeded' })).toBe('Google Tasks: quota exceeded');
	});

	it('uses the legend wording everywhere else, so the key and the card agree', () => {
		expect(googleSyncLabel({ googleSync: true, googleTaskId: 'g1' })).toBe('In Google Tasks');
		expect(googleSyncLabel({ googleSync: false })).toBe('Not synced');
	});
});

describe('googleSyncActionLabel', () => {
	it('names the click, not the state', () => {
		expect(googleSyncActionLabel({ googleSync: false })).toBe('Send to Google Tasks');
		expect(googleSyncActionLabel({ googleSync: true, googleTaskId: 'g1' })).toBe(
			'Remove from Google Tasks'
		);
	});
});

describe('canSendToGoogle', () => {
	it('requires a planned day to create', () => {
		expect(canSendToGoogle({ plannedDate: null, googleTaskId: null })).toBe(false);
		expect(canSendToGoogle({ plannedDate: '2026-08-11', googleTaskId: null })).toBe(true);
	});

	it('keeps an existing link alive without one', () => {
		expect(canSendToGoogle({ plannedDate: null, googleTaskId: 'g1' })).toBe(true);
	});

	it('ignores the deadline entirely', () => {
		// Bound to a variable first: as an inline literal, TypeScript's excess
		// property check would reject `dueDate` before the assertion could run,
		// and the point here is that the value is ignored at runtime too.
		const task = { plannedDate: null, dueDate: '2026-08-11', googleTaskId: null };
		expect(canSendToGoogle(task)).toBe(false);
	});
});

describe('GOOGLE_SYNC_STATES', () => {
	it('covers every state the badge can render, so the legend cannot go stale', () => {
		const listed = GOOGLE_SYNC_STATES.map((s) => s.state).sort();
		expect(listed).toEqual(['error', 'off', 'pending', 'synced']);
	});
});
