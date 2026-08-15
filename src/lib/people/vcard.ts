/**
 * A minimal vCard reader for Apple Contacts exports.
 *
 * Pure — it takes the text of a `.vcf` and returns plain objects — so every rule
 * below is testable without a file, a request, or a database.
 *
 * Deliberately not a general vCard implementation. It reads the handful of
 * properties a contact book needs (name, org, title, email, phone, URL, note,
 * address locality) and ignores the rest rather than failing on them, because a
 * real export from Contacts.app is full of photos, anniversaries, and
 * X-APPLE-* extensions that have nothing to do with remembering a person.
 */

export interface ParsedContact {
	name: string;
	email: string | null;
	phone: string | null;
	company: string | null;
	role: string | null;
	city: string | null;
	linkedinUrl: string | null;
	notes: string | null;
}

/**
 * Undo RFC 6350 line folding.
 *
 * A vCard wraps long values by starting the continuation with a space or tab.
 * Unfolding has to happen before anything is parsed, or a folded NOTE turns
 * into a property name nothing recognises.
 */
function unfold(text: string): string[] {
	const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
	const out: string[] = [];
	for (const line of lines) {
		if ((line.startsWith(' ') || line.startsWith('\t')) && out.length > 0) {
			out[out.length - 1] += line.slice(1);
		} else {
			out.push(line);
		}
	}
	return out;
}

/** `\n`, `\,` and `\;` carry meaning inside a value and have to be restored. */
function unescape(value: string): string {
	return value
		.replace(/\\n/gi, '\n')
		.replace(/\\,/g, ',')
		.replace(/\\;/g, ';')
		.replace(/\\\\/g, '\\')
		.trim();
}

/** Splits on unescaped semicolons — `N` and `ADR` are semicolon-delimited. */
function splitComponents(value: string): string[] {
	const parts: string[] = [];
	let current = '';
	for (let i = 0; i < value.length; i++) {
		const char = value[i];
		if (char === '\\' && i + 1 < value.length) {
			current += char + value[i + 1];
			i++;
		} else if (char === ';') {
			parts.push(current);
			current = '';
		} else {
			current += char;
		}
	}
	parts.push(current);
	return parts;
}

interface Line {
	name: string;
	params: string;
	value: string;
}

function parseLine(raw: string): Line | null {
	const colon = raw.indexOf(':');
	if (colon === -1) return null;
	const left = raw.slice(0, colon);
	const value = raw.slice(colon + 1);
	const semi = left.indexOf(';');
	const name = (semi === -1 ? left : left.slice(0, semi)).toUpperCase().trim();
	// Apple prefixes grouped properties as `item1.EMAIL`. The group is only there
	// to tie a label to a value, and we do not use labels.
	const dot = name.lastIndexOf('.');
	return {
		name: dot === -1 ? name : name.slice(dot + 1),
		params: semi === -1 ? '' : left.slice(semi + 1).toUpperCase(),
		value
	};
}

/** A display name from `FN`, falling back to assembling `N`'s components. */
function nameFrom(fn: string | null, n: string | null): string {
	if (fn) return unescape(fn);
	if (!n) return '';
	// N is Family;Given;Additional;Prefix;Suffix — rendered as given family.
	const [family, given, additional] = splitComponents(n).map(unescape);
	return [given, additional, family].filter(Boolean).join(' ').trim();
}

/**
 * Contacts.app writes LinkedIn either as a plain URL or as an
 * `X-SOCIALPROFILE` with `TYPE=linkedin`. Only a URL that actually points at
 * linkedin.com is taken, so a personal website does not end up in the field the
 * detail view labels LinkedIn.
 */
function isLinkedin(value: string, params: string): boolean {
	return params.includes('LINKEDIN') || /(^|\/\/|\.)linkedin\.com\//i.test(value);
}

/** Every contact in a `.vcf`. Cards without a usable name are dropped. */
export function parseVCards(text: string): ParsedContact[] {
	const contacts: ParsedContact[] = [];
	let current: Partial<Record<string, string>> | null = null;
	let fn: string | null = null;
	let n: string | null = null;
	let linkedin: string | null = null;
	let city: string | null = null;

	for (const raw of unfold(text)) {
		const line = parseLine(raw);
		if (!line) continue;

		if (line.name === 'BEGIN' && line.value.trim().toUpperCase() === 'VCARD') {
			current = {};
			fn = n = linkedin = city = null;
			continue;
		}
		if (!current) continue;

		if (line.name === 'END') {
			const name = nameFrom(fn, n);
			if (name) {
				contacts.push({
					name,
					email: current.email ? unescape(current.email) : null,
					phone: current.phone ? unescape(current.phone) : null,
					company: current.company ? unescape(current.company) : null,
					role: current.role ? unescape(current.role) : null,
					city,
					linkedinUrl: linkedin,
					notes: current.notes ? unescape(current.notes) : null
				});
			}
			current = null;
			continue;
		}

		switch (line.name) {
			case 'FN':
				fn = line.value;
				break;
			case 'N':
				n = line.value;
				break;
			// First one wins throughout: a contact with three emails gets their
			// primary, and the rest are not worth a schema.
			case 'EMAIL':
				current.email ??= line.value;
				break;
			case 'TEL':
				current.phone ??= line.value;
				break;
			case 'ORG':
				// ORG is Company;Department — only the company is interesting.
				current.company ??= splitComponents(line.value)[0];
				break;
			case 'TITLE':
				current.role ??= line.value;
				break;
			case 'NOTE':
				current.notes ??= line.value;
				break;
			case 'ADR':
				// ADR is PO;Extended;Street;Locality;Region;Postcode;Country.
				city ??= unescape(splitComponents(line.value)[3] ?? '') || null;
				break;
			case 'URL':
			case 'X-SOCIALPROFILE':
				if (!linkedin && isLinkedin(line.value, line.params)) {
					linkedin = unescape(line.value);
				}
				break;
		}
	}

	return contacts;
}
