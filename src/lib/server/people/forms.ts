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
 * point back at Table. Anything already carrying a scheme is left alone apart
 * from upgrading `http`.
 */
export function normalizeLinkedinUrl(value: string): string | undefined {
	const trimmedValue = value.trim();
	if (!trimmedValue) return undefined;
	const lower = trimmedValue.toLowerCase();
	if (lower.startsWith('https://')) return `https://${trimmedValue.slice('https://'.length)}`;
	if (lower.startsWith('http://')) return `https://${trimmedValue.slice('http://'.length)}`;
	return `https://${trimmedValue}`;
}

export const quickAddPersonSchema = z.object({
	name: trimmed.min(1),
	notes: optionalText
});

export const updatePersonSchema = z.object({
	name: trimmed.min(1),
	linkedinUrl: z.preprocess(
		blankToUndefined,
		trimmed
			.optional()
			.transform((value) => (value === undefined ? undefined : normalizeLinkedinUrl(value)))
	),
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
