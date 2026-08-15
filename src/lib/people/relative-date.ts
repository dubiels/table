/**
 * How long ago a date was, in words.
 *
 * Pure, and takes `today` as an argument rather than reading the clock, so the
 * rules are testable and the server and the browser cannot disagree about what
 * day it is mid-render.
 *
 * Both arguments are local `YYYY-MM-DD` strings, the form every date in this
 * app is stored in. They are compared as UTC midnights purely to count whole
 * days between them — no timezone is implied, and none is applied.
 */

const DAY_MS = 86_400_000;

function toUtcMidnight(isoDate: string): number | null {
	const parsed = Date.parse(`${isoDate}T00:00:00Z`);
	return Number.isNaN(parsed) ? null : parsed;
}

/** Whole days from `from` to `today`; negative if `from` is in the future. */
export function daysSince(from: string, today: string): number | null {
	const a = toUtcMidnight(from);
	const b = toUtcMidnight(today);
	if (a === null || b === null) return null;
	return Math.round((b - a) / DAY_MS);
}

/**
 * "today", "yesterday", "3 days ago", "5 weeks ago", "8 months ago", "2 years
 * ago" — the coarseness rising with distance, because the difference between 94
 * and 96 days ago has never mattered to anyone.
 *
 * Returns null for an unparseable date so a hand-edited row renders nothing
 * rather than "NaN days ago".
 */
export function describeAge(from: string | null | undefined, today: string): string | null {
	if (!from) return null;
	const days = daysSince(from, today);
	if (days === null) return null;

	// A date in the future is a typo or a plan, not a memory; report it plainly
	// rather than as a negative age.
	if (days < 0) return 'in the future';
	if (days === 0) return 'today';
	if (days === 1) return 'yesterday';
	if (days < 7) return `${days} days ago`;
	if (days < 31) {
		const weeks = Math.floor(days / 7);
		return weeks === 1 ? 'a week ago' : `${weeks} weeks ago`;
	}
	if (days < 365) {
		const months = Math.floor(days / 30);
		return months === 1 ? 'a month ago' : `${months} months ago`;
	}
	const years = Math.floor(days / 365);
	return years === 1 ? 'a year ago' : `${years} years ago`;
}

/** Long enough without contact to be worth noticing on a card. */
export const STALE_AFTER_DAYS = 90;

export function isStale(from: string | null | undefined, today: string): boolean {
	if (!from) return false;
	const days = daysSince(from, today);
	return days !== null && days >= STALE_AFTER_DAYS;
}
