import { z } from 'zod';
import { FLAG_COLOR_KEYS, type FlagColor } from '$lib/people/colors';

/**
 * Validation for a machine client, which is a different job from the form
 * schemas in `tasks/forms.ts` and `people/forms.ts`.
 *
 * Those exist to forgive a browser: a rendered form posts every control it has,
 * so they treat an empty string as "not set". An agent composes JSON
 * deliberately, so here `null` means "clear this field" and an absent key means
 * "leave it alone" — a distinction a form can never express, and the one that
 * makes PATCH honest.
 */
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected a YYYY-MM-DD date');

const flagColor = z.enum(FLAG_COLOR_KEYS as [FlagColor, ...FlagColor[]]);

const title = z.string().trim().min(1, 'title cannot be empty');
const name = z.string().trim().min(1, 'name cannot be empty');

/** Trimmed, with the empty string normalised to null rather than accepted. */
const optionalText = z
	.string()
	.trim()
	.nullable()
	.transform((v) => (v === null || v === '' ? null : v));

export const createTaskSchema = z.object({
	title,
	notes: optionalText.optional(),
	dueDate: isoDate.nullable().optional(),
	// The day Google sees — sending a task to Google is choosing which day to
	// put it on. `dueDate` is the last-possible day and never leaves Table.
	plannedDate: isoDate.nullable().optional(),
	priority: z.enum(['low', 'med', 'high']).nullable().optional(),
	personId: z.string().nullable().optional(),
	zoneId: z.string().nullable().optional(),
	// Honoured only alongside a planned date, exactly as the composer's checkbox
	// is: an undated Google task never reaches the calendar grid, which is the
	// whole point of pushing it. The route applies that rule, not this schema.
	googleSync: z.boolean().optional()
});

export const updateTaskSchema = z
	.object({
		title: title.optional(),
		notes: optionalText.optional(),
		dueDate: isoDate.nullable().optional(),
		// The day Google sees — see `createTaskSchema` above.
		plannedDate: isoDate.nullable().optional(),
		priority: z.enum(['low', 'med', 'high']).nullable().optional(),
		personId: z.string().nullable().optional(),
		zoneId: z.string().nullable().optional()
	})
	.refine((patch) => Object.keys(patch).length > 0, {
		message: 'patch must set at least one field'
	});

export const setDoneSchema = z.object({ done: z.boolean() });

export const createPersonSchema = z.object({
	name,
	status: z.enum(['met', 'to_meet']).optional(),
	linkedinUrl: optionalText.optional(),
	email: optionalText.optional(),
	phone: optionalText.optional(),
	company: optionalText.optional(),
	role: optionalText.optional(),
	city: optionalText.optional(),
	cityId: z.number().int().positive().nullable().optional(),
	metAt: optionalText.optional(),
	metOn: isoDate.nullable().optional(),
	lastSpokeAt: isoDate.nullable().optional(),
	notes: optionalText.optional(),
	flagIds: z.array(z.string()).optional()
});

export const updatePersonSchema = z
	.object({
		name: name.optional(),
		status: z.enum(['met', 'to_meet']).optional(),
		linkedinUrl: optionalText.optional(),
		email: optionalText.optional(),
		phone: optionalText.optional(),
		company: optionalText.optional(),
		role: optionalText.optional(),
		city: optionalText.optional(),
		cityId: z.number().int().positive().nullable().optional(),
		metAt: optionalText.optional(),
		metOn: isoDate.nullable().optional(),
		lastSpokeAt: isoDate.nullable().optional(),
		notes: optionalText.optional()
	})
	.refine((patch) => Object.keys(patch).length > 0, {
		message: 'patch must set at least one field'
	});

export const touchpointSchema = z.object({
	occurredOn: isoDate,
	note: optionalText.optional()
});

export const createFlagSchema = z.object({
	name,
	color: flagColor.optional()
});

export const attachFlagSchema = z.object({ flagId: z.string().min(1) });

export const taskQuerySchema = z.object({
	includeCompleted: z.boolean().optional(),
	since: z.string().optional()
});

export type CreateTaskInput = z.infer<typeof createTaskSchema>;
export type UpdateTaskInput = z.infer<typeof updateTaskSchema>;
export type CreatePersonInput = z.infer<typeof createPersonSchema>;
export type UpdatePersonInput = z.infer<typeof updatePersonSchema>;
