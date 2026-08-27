import { ZONE_COLOR_KEYS, type ZoneColor } from './zones';

/**
 * The keys a course chip may be drawn in: every pastel, but never ember.
 * Ember is the palette's one loud key, and these rows already spend a
 * saturated color on the overdue due date — a chip in it would compete with
 * the only signal on the row that means "act now".
 */
export const COURSE_COLORS: ZoneColor[] = ZONE_COLOR_KEYS.filter((k) => k !== 'ember');

/**
 * The palette key a Canvas course is drawn in.
 *
 * Hashed from the name rather than handed out in list order: a class keeps the
 * same color across reloads, devices and syncs, and nothing has to be stored to
 * make that true. With more classes than palette keys two of them collide — the
 * chip's text is what identifies a class, the color only groups it at a glance.
 */
export function courseColor(courseName: string): ZoneColor {
	// FNV-1a. Any avalanching hash would do; what matters is that it depends on
	// the name alone, so adding or finishing a class never recolors the others.
	const key = courseName.trim().toLowerCase();
	let hash = 0x811c9dc5;
	for (let i = 0; i < key.length; i++) {
		hash ^= key.charCodeAt(i);
		hash = Math.imul(hash, 0x01000193);
	}
	return COURSE_COLORS[(hash >>> 0) % COURSE_COLORS.length];
}
