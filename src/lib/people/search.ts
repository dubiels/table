/**
 * Pure filtering and ordering for the people grid.
 *
 * It takes an array and returns an array, touching no database, so every rule
 * here is unit-testable without fixtures — the same split `lms/plan.ts` and
 * `gtasks/plan.ts` already use against their `sync.ts`.
 */

export interface SearchablePerson {
	id: string;
	name: string;
	company: string | null;
	role: string | null;
	city: string | null;
	metAt: string | null;
	notes: string | null;
	metOn: string | null;
	archivedAt: string | null;
	flagIds: string[];
}

export interface SearchOptions {
	query: string;
	flagIds: string[];
	includeArchived: boolean;
}

/** Every field the query is matched against. */
function haystack(person: SearchablePerson): string {
	return [person.name, person.company, person.role, person.city, person.metAt, person.notes]
		.filter(Boolean)
		.join('\n')
		.toLowerCase();
}

function matchesName(person: SearchablePerson, query: string): boolean {
	return person.name.toLowerCase().includes(query);
}

/**
 * Most recently met first, undated last, ties broken by name.
 *
 * `metOn` is an ISO date, so a plain string comparison orders it correctly and
 * avoids parsing a value that may have been hand-edited.
 */
function byRecency(a: SearchablePerson, b: SearchablePerson): number {
	if (a.metOn !== b.metOn) {
		if (!a.metOn) return 1;
		if (!b.metOn) return -1;
		return a.metOn < b.metOn ? 1 : -1;
	}
	return a.name.localeCompare(b.name);
}

export function filterPeople<T extends SearchablePerson>(people: T[], options: SearchOptions): T[] {
	const query = options.query.trim().toLowerCase();

	const matched = people.filter((person) => {
		if (person.archivedAt && !options.includeArchived) return false;
		// Flags OR among themselves; the text query ANDs with the result.
		if (options.flagIds.length > 0 && !options.flagIds.some((id) => person.flagIds.includes(id))) {
			return false;
		}
		if (query && !haystack(person).includes(query)) return false;
		return true;
	});

	if (!query) return matched.sort(byRecency);

	// A name hit outranks a word buried in someone's notes; within each group the
	// same recency order applies.
	return matched.sort((a, b) => {
		const aNamed = matchesName(a, query);
		const bNamed = matchesName(b, query);
		if (aNamed !== bNamed) return aNamed ? -1 : 1;
		return byRecency(a, b);
	});
}
