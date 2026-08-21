import { z } from 'zod';

// A browser submits every control the form has rendered, so the composer's
// optional Due/Priority row posts empty strings while it is open rather than
// leaving the keys out. Treat blank as "not set" — otherwise an untouched row
// fails validation, and the task is only created on the second press, once the
// row has collapsed.
const blankToUndefined = (value: unknown) => (value === '' ? undefined : value);

export const newTaskSchema = z.object({
	title: z.string().min(1),
	dueDate: z.preprocess(blankToUndefined, z.string().optional()),
	plannedDate: z.preprocess(blankToUndefined, z.string().optional()),
	priority: z.preprocess(blankToUndefined, z.enum(['low', 'med', 'high']).optional()),
	// An unchecked checkbox is never submitted, so absence means false. A checked
	// one posts the string "on".
	googleSync: z.preprocess((value) => value === 'on', z.boolean()),
	x: z.coerce.number().optional(),
	y: z.coerce.number().optional()
});
