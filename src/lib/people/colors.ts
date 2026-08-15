/**
 * Flags reuse the app's six palette tokens. The CSS custom properties are
 * shared with zones deliberately — they are theme tokens defined in `app.css`,
 * not zone logic — but the token list lives here so the people module owns its
 * own vocabulary and imports nothing from the board.
 */
export type FlagColor = 'sage' | 'sky' | 'butter' | 'blush' | 'lilac' | 'clay';

export const FLAG_COLOR_KEYS: FlagColor[] = ['sage', 'sky', 'butter', 'blush', 'lilac', 'clay'];

/**
 * The CSS custom properties a flag colour resolves to, for inline `style=`
 * attributes. Returning `var(...)` strings rather than hex is what lets the same
 * markup render warm pastels in the light theme and their deep counterparts in
 * the dark one.
 *
 * An unrecognised colour (a stale row, a hand-edited database) falls back to
 * sage rather than emitting a var name no stylesheet defines, which would paint
 * the chip transparent.
 */
export function flagColorVars(key: string): { fill: string; border: string } {
	const safe = (FLAG_COLOR_KEYS as string[]).includes(key) ? key : 'sage';
	return { fill: `var(--zone-${safe}-fill)`, border: `var(--zone-${safe}-border)` };
}
