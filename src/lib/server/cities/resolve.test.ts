import { describe, expect, it } from 'vitest';
import { resolveCity, type CityLookup } from './resolve';
import type { CityMatch } from '$lib/people/types';

const SF: CityMatch = {
	id: 5391959,
	label: 'San Francisco, CA',
	name: 'San Francisco',
	secondary: 'California',
	countryCode: 'US',
	population: 827526
};

const lookup: CityLookup = { findById: (id) => (id === SF.id ? SF : null) };

describe('resolveCity', () => {
	it('lets a matched id overwrite the text posted beside it', () => {
		// The desync this exists to prevent: a stale tab posting one city's id
		// next to another city's name.
		const resolved = resolveCity({ city: 'Sam Fransisco', cityId: SF.id }, lookup);
		expect(resolved).toEqual({ city: 'San Francisco, CA', cityId: SF.id });
	});

	it('keeps unmatched text exactly as typed', () => {
		expect(resolveCity({ city: "my parents' place" }, lookup)).toEqual({
			city: "my parents' place",
			cityId: null
		});
	});

	it('degrades an id the dataset no longer has to plain text', () => {
		// The seed tables are rebuildable and carry no foreign key, so a dangling
		// id has to be survivable rather than an error.
		expect(resolveCity({ city: 'Atlantis', cityId: 404 }, lookup)).toEqual({
			city: 'Atlantis',
			cityId: null
		});
	});

	it('treats blank and whitespace-only text as no city at all', () => {
		expect(resolveCity({ city: '   ' }, lookup)).toEqual({ city: null, cityId: null });
		expect(resolveCity({}, lookup)).toEqual({ city: null, cityId: null });
	});

	it('trims text it keeps', () => {
		expect(resolveCity({ city: '  Reykjavik  ' }, lookup).city).toBe('Reykjavik');
	});
});
