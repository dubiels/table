export interface Point {
	x: number;
	y: number;
}

export interface ZoneBounds {
	id: string;
	x: number;
	y: number;
	width: number;
	height: number;
}

/** Nominal card size used to derive a task's center from its top-left anchor. */
export const DEFAULT_CARD = { width: 220, height: 72 };

export function taskCenter(task: Point, card = DEFAULT_CARD): Point {
	return { x: task.x + card.width / 2, y: task.y + card.height / 2 };
}

/**
 * The zone a point belongs to. A point inside multiple overlapping zones
 * belongs to the smallest-area zone (most specific). Boundaries are inclusive.
 */
export function zoneForTask(point: Point, zones: ZoneBounds[]): ZoneBounds | null {
	const containing = zones.filter(
		(z) => point.x >= z.x && point.x <= z.x + z.width && point.y >= z.y && point.y <= z.y + z.height
	);
	if (containing.length === 0) return null;
	return containing.reduce((smallest, z) =>
		z.width * z.height < smallest.width * smallest.height ? z : smallest
	);
}

export type ZoneColor = 'sage' | 'sky' | 'butter' | 'blush' | 'lilac' | 'clay';

/**
 * Light-theme source of truth for the zone palette. These values are hand-copied
 * into `app.css` as the `--zone-*` custom properties; nothing but `zoneColorVars`
 * should reach for the hex, or the colors stop following the active theme.
 */
export const ZONE_COLORS: Record<ZoneColor, { fill: string; border: string }> = {
	sage: { fill: '#e7ebda', border: '#cbd3b4' },
	sky: { fill: '#dee7ec', border: '#bacbd6' },
	butter: { fill: '#f2e8cb', border: '#e1d09b' },
	blush: { fill: '#eeddd8', border: '#dcbeb6' },
	lilac: { fill: '#e6e1ec', border: '#c9bfd6' },
	clay: { fill: '#efddd3', border: '#ddbba6' }
};

export const ZONE_COLOR_KEYS: ZoneColor[] = ['sage', 'sky', 'butter', 'blush', 'lilac', 'clay'];

/**
 * The CSS custom properties a zone color resolves to, for inline `style=`
 * attributes. Returning `var(...)` strings rather than hex is what lets the same
 * markup render warm pastels in the light theme and their deep counterparts in
 * the dark one — the swap happens in CSS, so no component re-renders.
 *
 * An unrecognized color (a stale row, a hand-edited database) falls back to sage
 * rather than emitting a var name no stylesheet defines, which would paint the
 * zone transparent.
 */
export function zoneColorVars(key: string): { fill: string; border: string } {
	const safe = (ZONE_COLOR_KEYS as string[]).includes(key) ? key : 'sage';
	return { fill: `var(--zone-${safe}-fill)`, border: `var(--zone-${safe}-border)` };
}

export interface Rect {
	x: number;
	y: number;
	width: number;
	height: number;
}

/**
 * Whether two rects share any area, optionally requiring `gap` clear space
 * between them.
 *
 * Edges that merely touch are clear, matching `overlapsAny`'s card test — a new
 * rect laid flush against an existing one covers none of it. BlobView keeps its
 * own inclusive `intersects` for the opposite job: spotting a near miss before
 * one happens, where "touching" is exactly the case worth reacting to.
 */
export function rectsOverlap(a: Rect, b: Rect, gap = 0): boolean {
	return !(
		a.x + a.width + gap <= b.x ||
		b.x + b.width + gap <= a.x ||
		a.y + a.height + gap <= b.y ||
		b.y + b.height + gap <= a.y
	);
}

export interface ViewportBounds {
	minX: number;
	minY: number;
	maxX: number;
	maxY: number;
}

/**
 * The world-coordinate region visible in a canvas of the given natural size at
 * the given zoom, where the canvas content scales around the natural center.
 * Placement is legal anywhere visible — zooming out reveals fresh space that
 * can be dragged onto immediately; there is no stored "world size".
 */
export function visibleWorldBounds(
	naturalWidth: number,
	naturalHeight: number,
	zoom: number
): ViewportBounds {
	const halfW = naturalWidth / (2 * zoom);
	const halfH = naturalHeight / (2 * zoom);
	const cx = naturalWidth / 2;
	const cy = naturalHeight / 2;
	return {
		minX: Math.max(0, cx - halfW),
		minY: Math.max(0, cy - halfH),
		maxX: cx + halfW,
		maxY: cy + halfH
	};
}

/**
 * `bounds` widened so it also contains `rect`.
 *
 * The visible region is the right limit for *new* reach, but a wrong one for
 * something that already sits outside it — an item placed or grown while zoomed
 * out is out of view again at zoom 1 (the state after every reload), and
 * clamping it there would silently pull it in or shrink it on the next
 * pointermove. Widening by the item's own footprint keeps the "can't push it
 * further out of sight" guarantee while leaving what already exists alone.
 */
export function boundsIncluding(
	bounds: ViewportBounds,
	rect: { x: number; y: number; width: number; height: number }
): ViewportBounds {
	return {
		minX: Math.min(bounds.minX, rect.x),
		minY: Math.min(bounds.minY, rect.y),
		maxX: Math.max(bounds.maxX, rect.x + rect.width),
		maxY: Math.max(bounds.maxY, rect.y + rect.height)
	};
}
