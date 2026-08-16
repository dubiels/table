import type { SearchablePerson } from './search';

/**
 * The shapes components render.
 *
 * They live here rather than being imported from the service because
 * `$lib/server/**` cannot be reached from client code — SvelteKit fails the
 * build, and `import type` is not a dependable escape hatch. The service's
 * `PersonWithFlags` structurally satisfies `PersonView`, so nothing has to be
 * mapped between them.
 */
/**
 * A company mark, resolved server-side and passed down as data.
 *
 * Lives here rather than being imported from `$lib/server/people/logo` for the
 * same reason as everything else in this file: components cannot reach into
 * `$lib/server/**`. One `path` or one `src`, never both.
 */
export interface LogoView {
	title: string;
	path?: string;
	src?: string;
	hex: string;
}

export interface FlagView {
	id: string;
	name: string;
	color: string;
}

export interface PersonView extends SearchablePerson {
	linkedinUrl: string | null;
	email: string | null;
	phone: string | null;
	lastSpokeAt: string | null;
	createdAt: string;
	updatedAt: string;
}
