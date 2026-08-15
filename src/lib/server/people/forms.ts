import { z } from 'zod';
import { FLAG_COLOR_KEYS, type FlagColor } from '$lib/people/colors';

// A browser submits every control the form has rendered, so untouched optional
// fields post empty strings rather than leaving the keys out. Treat blank as
// "not set" — the same reason `tasks/forms.ts` does.
const blankToUndefined = (value: unknown) =>
	typeof value === 'string' && value.trim() === '' ? undefined : value;

const trimmed = z.string().trim();
const optionalText = z.preprocess(blankToUndefined, trimmed.optional());

/**
 * A profile URL as typed, made clickable.
 *
 * People paste `linkedin.com/in/x` far more often than they paste a full URL,
 * and a bare host in an `href` is read as a relative path — so the link would
 * point back at Table. A value that already carries a scheme keeps its host
 * casing untouched; only the scheme is canonicalised, which upgrades `http` and
 * repairs the `HTTPS://` a phone keyboard's auto-capitalise produces.
 */
export function normalizeLinkedinUrl(value: string): string | undefined {
	const trimmedValue = value.trim();
	if (!trimmedValue) return undefined;
	const lower = trimmedValue.toLowerCase();
	if (lower.startsWith('https://')) return `https://${trimmedValue.slice('https://'.length)}`;
	if (lower.startsWith('http://')) return `https://${trimmedValue.slice('http://'.length)}`;
	return `https://${trimmedValue}`;
}

/** The scheme-normalising optional URL field, shared by the add and edit forms. */
const optionalLinkedin = z.preprocess(
	blankToUndefined,
	trimmed
		.optional()
		.transform((value) => (value === undefined ? undefined : normalizeLinkedinUrl(value)))
);

// Deliberately the same field set as `updatePersonSchema`: adding someone shows
// exactly what editing them shows, so nothing has to be discovered later.
export const addPersonSchema = z.object({
	name: trimmed.min(1),
	status: z.enum(['met', 'to_meet']).default('met'),
	linkedinUrl: optionalLinkedin,
	email: optionalText,
	phone: optionalText,
	company: optionalText,
	role: optionalText,
	city: optionalText,
	metAt: optionalText,
	metOn: optionalText,
	// Left blank, the service seeds this from `metOn` — meeting someone is the
	// first time you spoke to them.
	lastSpokeAt: optionalText,
	notes: optionalText
});

export const updatePersonSchema = z.object({
	name: trimmed.min(1),
	status: z.enum(['met', 'to_meet']).default('met'),
	linkedinUrl: optionalLinkedin,
	lastSpokeAt: optionalText,
	// Email and phone are stored as typed, unvalidated, on purpose.
	email: optionalText,
	phone: optionalText,
	company: optionalText,
	role: optionalText,
	city: optionalText,
	metAt: optionalText,
	metOn: optionalText,
	notes: optionalText
});

export const flagSchema = z.object({
	name: trimmed.min(1),
	color: z.enum(FLAG_COLOR_KEYS as [FlagColor, ...FlagColor[]]).default('sage')
});
