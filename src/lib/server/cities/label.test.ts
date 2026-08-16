import { describe, expect, it } from 'vitest';
import { cityLabel, citySecondaryLabel } from './label';

const us = {
	name: 'San Francisco',
	countryCode: 'US',
	countryName: 'United States',
	admin1Code: 'CA',
	admin1Name: 'California'
};

const abroad = {
	name: 'Berlin',
	countryCode: 'DE',
	countryName: 'Germany',
	admin1Code: '16',
	admin1Name: 'Berlin'
};

describe('cityLabel', () => {
	it('writes a US city with its state', () => {
		expect(cityLabel(us)).toBe('San Francisco, CA');
	});

	it('writes a foreign city with its country, because the region code is opaque', () => {
		expect(cityLabel(abroad)).toBe('Berlin, Germany');
	});

	it('falls back to the country when a US row has no state, rather than a dangling comma', () => {
		expect(cityLabel({ ...us, admin1Code: null })).toBe('San Francisco, United States');
	});
});

describe('citySecondaryLabel', () => {
	it('shows the state name for a US city', () => {
		expect(citySecondaryLabel(us)).toBe('California');
	});

	it('shows region and country abroad, where two same-named places are likelier', () => {
		expect(citySecondaryLabel(abroad)).toBe('Berlin, Germany');
	});

	it('is null when there is nothing to disambiguate with', () => {
		expect(citySecondaryLabel({ ...us, admin1Name: null })).toBeNull();
	});
});
