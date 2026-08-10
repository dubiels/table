import { DEFAULT_CARD, type Point } from './zones';

export interface PlacementBounds {
	x: number;
	y: number;
	width: number;
	height: number;
}

/** Gap between auto-placed cards so a batch drop reads as a tidy grid. */
export const PLACEMENT_GAP = 12;

function overlapsAny(
	x: number,
	y: number,
	occupied: Point[],
	card: { width: number; height: number }
): boolean {
	for (const o of occupied) {
		const apart =
			x + card.width <= o.x ||
			o.x + card.width <= x ||
			y + card.height <= o.y ||
			o.y + card.height <= y;
		if (!apart) return true;
	}
	return false;
}

/**
 * Walks a grid inside `bounds` and returns the first anchor whose card rect
 * does not overlap any occupied card. When the bounds are full (or smaller
 * than one card), falls back to the last fitting row's start — a placed-
 * imperfectly card beats a dropped one, so this never returns null.
 */
export function nextFreeSlot(
	occupied: Point[],
	bounds: PlacementBounds,
	card = DEFAULT_CARD
): Point {
	const stepX = card.width + PLACEMENT_GAP;
	const stepY = card.height + PLACEMENT_GAP;
	const maxX = bounds.x + bounds.width - card.width;
	const maxY = bounds.y + bounds.height - card.height;
	for (let y = bounds.y; y <= maxY; y += stepY) {
		for (let x = bounds.x; x <= maxX; x += stepX) {
			if (!overlapsAny(x, y, occupied, card)) return { x, y };
		}
	}
	return { x: bounds.x, y: Math.max(bounds.y, maxY) };
}
