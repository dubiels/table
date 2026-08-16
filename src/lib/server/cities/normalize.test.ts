import { describe, expect, it } from 'vitest';
import { normalizeCityQuery } from './normalize';

describe('normalizeCityQuery', () => {
	it('folds to the ASCII lowercase form the search key is stored in', () => {
		expect(normalizeCityQuery('Málaga')).toBe('malaga');
		expect(normalizeCityQuery('SÃO PAULO')).toBe('sao paulo');
	});

	it('collapses the whitespace a phone keyboard leaves behind', () => {
		expect(normalizeCityQuery('  new   york  ')).toBe('new york');
	});

	it('leaves an already-plain query alone', () => {
		expect(normalizeCityQuery('el segundo')).toBe('el segundo');
	});
});
