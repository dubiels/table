import { describe, it, expect } from 'vitest';
import { parseVCards } from './vcard';

/** A card as Contacts.app actually writes one, CRLF and all. */
function card(body: string): string {
	return ['BEGIN:VCARD', 'VERSION:3.0', body, 'END:VCARD'].join('\r\n');
}

describe('parseVCards', () => {
	it('reads the display name from FN', () => {
		const [c] = parseVCards(card('FN:Devon Reyes'));
		expect(c.name).toBe('Devon Reyes');
	});

	// N is Family;Given;Additional;Prefix;Suffix and must be reassembled in
	// reading order, not the order it is stored in.
	it('assembles a name from N when FN is absent', () => {
		const [c] = parseVCards(card('N:Reyes;Devon;;;'));
		expect(c.name).toBe('Devon Reyes');
	});

	it('prefers FN over N', () => {
		const [c] = parseVCards(card('FN:Dev Reyes\r\nN:Reyes;Devon;;;'));
		expect(c.name).toBe('Dev Reyes');
	});

	it('drops a card with no usable name rather than importing a blank person', () => {
		expect(parseVCards(card('EMAIL:nobody@example.com'))).toEqual([]);
	});

	it('reads several cards from one file', () => {
		const text = [card('FN:Devon Reyes'), card('FN:Maya Okonkwo')].join('\r\n');
		expect(parseVCards(text).map((c) => c.name)).toEqual(['Devon Reyes', 'Maya Okonkwo']);
	});

	it('reads email, phone, title and note', () => {
		const [c] = parseVCards(
			card(
				'FN:Devon Reyes\r\nEMAIL;type=INTERNET;type=pref:devon@cadence.dev\r\nTEL;type=CELL:+1 917 555 0148\r\nTITLE:Founder\r\nNOTE:Ask about queue design.'
			)
		);
		expect(c).toMatchObject({
			email: 'devon@cadence.dev',
			phone: '+1 917 555 0148',
			role: 'Founder',
			notes: 'Ask about queue design.'
		});
	});

	// ORG is Company;Department — importing "Cadence;Engineering" verbatim would
	// put a semicolon in the company field on every card that has a department.
	it('takes only the company from ORG', () => {
		const [c] = parseVCards(card('FN:Devon Reyes\r\nORG:Cadence;Engineering'));
		expect(c.company).toBe('Cadence');
	});

	it('takes the locality from ADR as the city', () => {
		const [c] = parseVCards(
			card('FN:Devon Reyes\r\nADR;type=WORK:;;12 Main St;New York;NY;10001;USA')
		);
		expect(c.city).toBe('New York');
	});

	it('leaves city null when ADR has no locality', () => {
		const [c] = parseVCards(card('FN:Devon Reyes\r\nADR;type=WORK:;;;;;;'));
		expect(c.city).toBeNull();
	});

	it('takes a linkedin URL from URL', () => {
		const [c] = parseVCards(card('FN:Devon Reyes\r\nURL:https://www.linkedin.com/in/devonreyes'));
		expect(c.linkedinUrl).toBe('https://www.linkedin.com/in/devonreyes');
	});

	it('takes a linkedin URL from X-SOCIALPROFILE', () => {
		const [c] = parseVCards(
			card('FN:Devon Reyes\r\nX-SOCIALPROFILE;type=linkedin:https://linkedin.com/in/devonreyes')
		);
		expect(c.linkedinUrl).toBe('https://linkedin.com/in/devonreyes');
	});

	// A personal site must not land in the field the detail view labels LinkedIn.
	it('ignores a URL that is not linkedin', () => {
		const [c] = parseVCards(card('FN:Devon Reyes\r\nURL:https://cadence.dev'));
		expect(c.linkedinUrl).toBeNull();
	});

	// Long values are wrapped by starting the next line with a space. Unfolding
	// has to happen before parsing or the continuation reads as a property.
	it('unfolds a wrapped value', () => {
		const [c] = parseVCards(card('FN:Devon Reyes\r\nNOTE:Deep on distributed\r\n  systems.'));
		expect(c.notes).toBe('Deep on distributed systems.');
	});

	it('unescapes newlines and commas inside a note', () => {
		const [c] = parseVCards(card('FN:Devon Reyes\r\nNOTE:One\\nTwo\\, three'));
		expect(c.notes).toBe('One\nTwo, three');
	});

	// Apple groups labelled properties as `item1.EMAIL`. The group prefix is not
	// part of the property name.
	it('reads a grouped apple property', () => {
		const [c] = parseVCards(card('FN:Devon Reyes\r\nitem1.EMAIL:devon@cadence.dev'));
		expect(c.email).toBe('devon@cadence.dev');
	});

	it('keeps the first email when a contact has several', () => {
		const [c] = parseVCards(
			card('FN:Devon Reyes\r\nEMAIL:first@cadence.dev\r\nEMAIL:second@cadence.dev')
		);
		expect(c.email).toBe('first@cadence.dev');
	});

	it('ignores properties it does not model instead of failing', () => {
		const [c] = parseVCards(
			card('FN:Devon Reyes\r\nPHOTO;ENCODING=b:AAAA\r\nX-APPLE-SUBLOCALITY:SoHo\r\nBDAY:1990-01-01')
		);
		expect(c.name).toBe('Devon Reyes');
	});

	it('handles LF-only files as well as CRLF', () => {
		const [c] = parseVCards('BEGIN:VCARD\nFN:Devon Reyes\nEND:VCARD');
		expect(c.name).toBe('Devon Reyes');
	});

	it('returns nothing for an empty or non-vcard file', () => {
		expect(parseVCards('')).toEqual([]);
		expect(parseVCards('just some text')).toEqual([]);
	});
});
