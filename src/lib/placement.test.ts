import { describe, it, expect } from 'vitest';
import { nextFreeSlot, PLACEMENT_GAP } from './placement';
import { DEFAULT_CARD } from './zones';

const bounds = { x: 100, y: 100, width: 800, height: 600 };

describe('nextFreeSlot', () => {
	it('returns the top-left anchor when nothing is occupied', () => {
		expect(nextFreeSlot([], bounds)).toEqual({ x: 100, y: 100 });
	});

	it('skips an occupied top-left slot and moves right', () => {
		const slot = nextFreeSlot([{ x: 100, y: 100 }], bounds);
		expect(slot.y).toBe(100);
		expect(slot.x).toBeGreaterThanOrEqual(100 + DEFAULT_CARD.width);
	});

	it('wraps to the next row when a row is full', () => {
		// bounds fit exactly one card per row
		const narrow = { x: 0, y: 0, width: DEFAULT_CARD.width + 10, height: 600 };
		const slot = nextFreeSlot([{ x: 0, y: 0 }], narrow);
		expect(slot.x).toBe(0);
		expect(slot.y).toBeGreaterThanOrEqual(DEFAULT_CARD.height + PLACEMENT_GAP);
	});

	it('does not overlap arbitrary (non-grid) occupied positions', () => {
		const occupied = [{ x: 150, y: 130 }];
		const slot = nextFreeSlot(occupied, bounds);
		const apart =
			slot.x + DEFAULT_CARD.width <= 150 ||
			150 + DEFAULT_CARD.width <= slot.x ||
			slot.y + DEFAULT_CARD.height <= 130 ||
			130 + DEFAULT_CARD.height <= slot.y;
		expect(apart).toBe(true);
	});

	it('falls back to the last row instead of returning null when full', () => {
		const tiny = { x: 0, y: 0, width: DEFAULT_CARD.width, height: DEFAULT_CARD.height };
		const slot = nextFreeSlot([{ x: 0, y: 0 }], tiny);
		expect(slot).toEqual({ x: 0, y: 0 }); // best-effort anchor, never null
	});

	it('handles bounds smaller than a card without looping forever', () => {
		const slot = nextFreeSlot([], { x: 50, y: 50, width: 10, height: 10 });
		expect(slot).toEqual({ x: 50, y: 50 });
	});
});
