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

/**
 * How cold a relationship has gone, on a scale rather than a switch.
 *
 * A binary stale/not-stale flag answers the wrong question: at a glance you
 * want to see who is drifting, not only who has already gone. The bands are
 * deliberately coarse — nobody acts differently at 44 days than at 46.
 *
 * `none` is not a degree of cold. Someone with no logged contact has nothing to
 * have gone quiet on, and colouring them as the worst case would bury the
 * people who genuinely have.
 */
export type ContactHeat = 'none' | 'fresh' | 'recent' | 'cooling' | 'stale' | 'cold';

/** Lower bound in days for each band, coldest first. */
const HEAT_BANDS: { from: number; heat: ContactHeat }[] = [
	{ from: 180, heat: 'cold' },
	{ from: 90, heat: 'stale' },
	{ from: 45, heat: 'cooling' },
	{ from: 14, heat: 'recent' },
	{ from: 0, heat: 'fresh' }
];

export function contactHeat(from: string | null | undefined, today: string): ContactHeat {
	if (!from) return 'none';
	const days = daysSince(from, today);
	if (days === null) return 'none';
	// A date in the future is a typo or a plan; treat it as freshly in touch
	// rather than letting a negative number fall off the bottom of the scale.
	if (days < 0) return 'fresh';
	return HEAT_BANDS.find((band) => days >= band.from)?.heat ?? 'fresh';
}

/** Human label for a band, for the pill on a card and its title attribute. */
export const HEAT_LABEL: Record<ContactHeat, string> = {
	none: 'No contact logged',
	fresh: 'In touch',
	recent: 'Recent',
	cooling: 'Cooling off',
	stale: 'Going quiet',
	cold: 'Gone cold'
};
