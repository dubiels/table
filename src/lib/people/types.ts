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
export interface FlagView {
	id: string;
	name: string;
	color: string;
}

export interface PersonView extends SearchablePerson {
	linkedinUrl: string | null;
	email: string | null;
	phone: string | null;
	createdAt: string;
	updatedAt: string;
}
