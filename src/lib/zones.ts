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

export const ZONE_COLORS: Record<ZoneColor, { fill: string; border: string }> = {
	sage: { fill: '#e7ebda', border: '#cbd3b4' },
	sky: { fill: '#dee7ec', border: '#bacbd6' },
	butter: { fill: '#f2e8cb', border: '#e1d09b' },
	blush: { fill: '#eeddd8', border: '#dcbeb6' },
	lilac: { fill: '#e6e1ec', border: '#c9bfd6' },
	clay: { fill: '#efddd3', border: '#ddbba6' }
};

export const ZONE_COLOR_KEYS: ZoneColor[] = ['sage', 'sky', 'butter', 'blush', 'lilac', 'clay'];

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
