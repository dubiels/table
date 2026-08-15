import { describe, it, expect } from 'vitest';
import { filterPeople, type SearchablePerson } from './search';

function person(overrides: Partial<SearchablePerson> & { id: string; name: string }): SearchablePerson {
	return {
		company: null,
		role: null,
		city: null,
		metAt: null,
		notes: null,
		metOn: null,
		archivedAt: null,
		flagIds: [],
		...overrides
	};
}

const maya = person({
	id: 'p1',
	name: 'Maya Okonkwo',
	company: 'Figma',
	role: 'Staff engineer',
	city: 'San Francisco',
	metAt: 'Recurse pairing night',
	notes: 'Design systems. Offered to look at the bento drag code.',
	metOn: '2026-03-02',
	flagIds: ['sf']
});

const devon = person({
	id: 'p2',
	name: 'Devon Reyes',
	company: 'Cadence',
	role: 'Founder',
	city: 'New York',
	metAt: "Ana's dinner party",
	notes: 'Deep on distributed systems — ask about queue design.',
	metOn: '2026-01-14',
	flagIds: ['nyc', 'founders']
});

const sam = person({
	id: 'p3',
	name: 'Sam Lindqvist',
	company: 'Stripe',
	role: 'Product manager',
	city: 'San Francisco',
	metOn: '2026-02-20',
	flagIds: ['sf']
});

const everyone = [maya, devon, sam];
const noFilter = { query: '', flagIds: [], includeArchived: false };

describe('filterPeople — text matching', () => {
	it('returns everyone when the query is empty', () => {
		expect(filterPeople(everyone, noFilter)).toHaveLength(3);
	});

	it('matches on name, ignoring case', () => {
		const found = filterPeople(everyone, { ...noFilter, query: 'devon' });
		expect(found.map((p) => p.id)).toEqual(['p2']);
	});

	it('matches on company', () => {
		const found = filterPeople(everyone, { ...noFilter, query: 'figma' });
		expect(found.map((p) => p.id)).toEqual(['p1']);
	});

	it('matches on role', () => {
		const found = filterPeople(everyone, { ...noFilter, query: 'founder' });
		expect(found.map((p) => p.id)).toEqual(['p2']);
	});

	it('matches on city', () => {
		const found = filterPeople(everyone, { ...noFilter, query: 'san francisco' });
		expect(found.map((p) => p.id).sort()).toEqual(['p1', 'p3']);
	});

	it('matches on where you met them', () => {
		const found = filterPeople(everyone, { ...noFilter, query: 'recurse' });
		expect(found.map((p) => p.id)).toEqual(['p1']);
	});

	// The whole point of the notes blob: "who do I know who can help with X".
	it('matches on the notes blob', () => {
		const found = filterPeople(everyone, { ...noFilter, query: 'queue design' });
		expect(found.map((p) => p.id)).toEqual(['p2']);
	});

	it('matches a substring rather than a whole word', () => {
		const found = filterPeople(everyone, { ...noFilter, query: 'distrib' });
		expect(found.map((p) => p.id)).toEqual(['p2']);
	});

	it('ignores surrounding whitespace in the query', () => {
		const found = filterPeople(everyone, { ...noFilter, query: '  figma  ' });
		expect(found.map((p) => p.id)).toEqual(['p1']);
	});

	it('returns nothing when no field matches', () => {
		expect(filterPeople(everyone, { ...noFilter, query: 'kayaking' })).toEqual([]);
	});

	it('tolerates null fields without throwing', () => {
		const sparse = [person({ id: 'p9', name: 'Priya Tan' })];
		expect(filterPeople(sparse, { ...noFilter, query: 'priya' })).toHaveLength(1);
	});
});

describe('filterPeople — flags', () => {
	it('narrows to people carrying the flag', () => {
		const found = filterPeople(everyone, { ...noFilter, flagIds: ['nyc'] });
		expect(found.map((p) => p.id)).toEqual(['p2']);
	});

	// Two cities means "either city" — that is what planning a trip asks.
	it('ORs multiple flags together', () => {
		const found = filterPeople(everyone, { ...noFilter, flagIds: ['sf', 'nyc'] });
		expect(found.map((p) => p.id).sort()).toEqual(['p1', 'p2', 'p3']);
	});

	it('ANDs the flag filter with the text query', () => {
		const found = filterPeople(everyone, { ...noFilter, query: 'stripe', flagIds: ['sf'] });
		expect(found.map((p) => p.id)).toEqual(['p3']);
	});

	it('returns nothing when the query and the flag disagree', () => {
		expect(filterPeople(everyone, { ...noFilter, query: 'stripe', flagIds: ['nyc'] })).toEqual([]);
	});
});

describe('filterPeople — archived', () => {
	const archived = person({ id: 'p4', name: 'Jonas Weber', archivedAt: '2026-05-01' });

	it('hides archived people by default', () => {
		const found = filterPeople([...everyone, archived], noFilter);
		expect(found.map((p) => p.id)).not.toContain('p4');
	});

	it('includes them when asked', () => {
		const found = filterPeople([...everyone, archived], { ...noFilter, includeArchived: true });
		expect(found.map((p) => p.id)).toContain('p4');
	});

	it('still applies the text query to archived people', () => {
		const found = filterPeople([...everyone, archived], {
			query: 'jonas',
			flagIds: [],
			includeArchived: true
		});
		expect(found.map((p) => p.id)).toEqual(['p4']);
	});
});

describe('filterPeople — ordering', () => {
	// Someone met last week is usually who you are looking for.
	it('sorts by metOn descending when there is no query', () => {
		const found = filterPeople(everyone, noFilter);
		expect(found.map((p) => p.id)).toEqual(['p1', 'p3', 'p2']);
	});

	it('puts people with no metOn last', () => {
		const undated = person({ id: 'p5', name: 'Aaron Abbott' });
		const found = filterPeople([undated, ...everyone], noFilter);
		expect(found[found.length - 1].id).toBe('p5');
	});

	it('breaks ties on metOn by name', () => {
		const a = person({ id: 'pa', name: 'Zoe Adams', metOn: '2026-04-01' });
		const b = person({ id: 'pb', name: 'Adam Zeal', metOn: '2026-04-01' });
		const found = filterPeople([a, b], noFilter);
		expect(found.map((p) => p.id)).toEqual(['pb', 'pa']);
	});

	// A name hit is a stronger signal than a word buried in someone's notes.
	it('ranks name matches above matches on other fields', () => {
		const named = person({ id: 'pn', name: 'Cadence Hill', metOn: '2020-01-01' });
		const found = filterPeople([devon, named], { ...noFilter, query: 'cadence' });
		expect(found.map((p) => p.id)).toEqual(['pn', 'p2']);
	});
});
