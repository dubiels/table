import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
	zoneForTask,
	taskCenter,
	ZONE_COLORS,
	ZONE_COLOR_KEYS,
	zoneColorVars,
	visibleWorldBounds,
	boundsIncluding,
	rectsOverlap,
	type ZoneBounds
} from './zones';

const work: ZoneBounds = { id: 'work', x: 0, y: 0, width: 400, height: 400 };
const inbox: ZoneBounds = { id: 'inbox', x: 50, y: 50, width: 100, height: 100 };

describe('zoneForTask', () => {
	it('returns the zone whose bounds contain the point', () => {
		expect(zoneForTask({ x: 300, y: 300 }, [work])?.id).toBe('work');
	});

	it('returns null when the point is outside every zone', () => {
		expect(zoneForTask({ x: 500, y: 500 }, [work])).toBeNull();
	});

	it('breaks overlap ties by choosing the smallest-area zone', () => {
		expect(zoneForTask({ x: 100, y: 100 }, [work, inbox])?.id).toBe('inbox');
	});

	it('includes points exactly on the boundary', () => {
		expect(zoneForTask({ x: 0, y: 0 }, [work])?.id).toBe('work');
		expect(zoneForTask({ x: 400, y: 400 }, [work])?.id).toBe('work');
	});
});

describe('taskCenter', () => {
	it('offsets a top-left anchor by half the default card size', () => {
		const c = taskCenter({ x: 10, y: 20 });
		expect(c.x).toBeGreaterThan(10);
		expect(c.y).toBeGreaterThan(20);
	});
});

describe('ZONE_COLOR_KEYS', () => {
	it('exposes the seven palette keys', () => {
		expect(ZONE_COLOR_KEYS).toEqual(['sage', 'sky', 'butter', 'blush', 'lilac', 'clay', 'ember']);
	});
});

describe('zoneColorVars', () => {
	it('maps every palette key to its own pair of custom properties', () => {
		for (const key of ZONE_COLOR_KEYS) {
			expect(zoneColorVars(key)).toEqual({
				fill: `var(--zone-${key}-fill)`,
				border: `var(--zone-${key}-border)`
			});
		}
	});

	it('falls back to sage for a key outside the palette', () => {
		expect(zoneColorVars('chartreuse')).toEqual({
			fill: 'var(--zone-sage-fill)',
			border: 'var(--zone-sage-border)'
		});
		expect(zoneColorVars('')).toEqual(zoneColorVars('sage'));
	});
});

describe('zone tokens in app.css', () => {
	// Components resolve zone colors through zoneColorVars(), so nothing imports
	// the hex map any more and app.css holds a hand-copy of it. Without this
	// guard, editing a value in ZONE_COLORS would change precisely nothing on
	// screen and the two would drift apart silently.
	const css = readFileSync(new URL('../app.css', import.meta.url), 'utf8');
	// Only the light block: `:root[data-theme='dark']` has a selector between
	// `:root` and `{`, so it cannot satisfy these assertions in its place.
	const lightBlock = /^:root\s*\{([^}]*)\}/m.exec(css)?.[1] ?? '';

	it('finds the light :root block', () => {
		expect(lightBlock).toContain('--bg:');
	});

	it('declares every ZONE_COLORS value as its matching custom property', () => {
		for (const key of ZONE_COLOR_KEYS) {
			expect(lightBlock).toContain(`--zone-${key}-fill: ${ZONE_COLORS[key].fill};`);
			expect(lightBlock).toContain(`--zone-${key}-border: ${ZONE_COLORS[key].border};`);
		}
	});
});

describe('visibleWorldBounds', () => {
	it('equals the natural viewport at zoom 1', () => {
		expect(visibleWorldBounds(1000, 600, 1)).toEqual({ minX: 0, minY: 0, maxX: 1000, maxY: 600 });
	});

	it('extends beyond the natural viewport when zoomed out', () => {
		// scale(0.5) around the center shows 2x the size, centered: [-500, 1500] clipped to >= 0
		expect(visibleWorldBounds(1000, 600, 0.5)).toEqual({ minX: 0, minY: 0, maxX: 1500, maxY: 900 });
	});

	it('grows monotonically as zoom decreases', () => {
		const z1 = visibleWorldBounds(1000, 600, 0.9);
		const z2 = visibleWorldBounds(1000, 600, 0.6);
		expect(z2.maxX).toBeGreaterThan(z1.maxX);
		expect(z2.maxY).toBeGreaterThan(z1.maxY);
	});
});

describe('boundsIncluding', () => {
	it('leaves bounds untouched for a rect that already fits', () => {
		const bounds = visibleWorldBounds(1000, 600, 1);
		expect(boundsIncluding(bounds, { x: 10, y: 10, width: 100, height: 50 })).toEqual(bounds);
	});

	it('widens to the far edge of a rect that sticks out past the viewport', () => {
		// A zone grown to 1500 wide while zoomed out, now seen back at zoom 1.
		const bounds = visibleWorldBounds(1000, 600, 1);
		expect(boundsIncluding(bounds, { x: 0, y: 0, width: 1500, height: 900 })).toEqual({
			minX: 0,
			minY: 0,
			maxX: 1500,
			maxY: 900
		});
	});

	it('never shrinks a rect that is already out of view', () => {
		// The bug: at zoom 1 a resize clamped `width` to `maxX - x`, snapping an
		// oversized zone back to the natural canvas on the first pointermove.
		const zone = { x: 200, y: 100, width: 1200, height: 700 };
		const widened = boundsIncluding(visibleWorldBounds(1000, 600, 1), zone);
		expect(widened.maxX - zone.x).toBeGreaterThanOrEqual(zone.width);
		expect(widened.maxY - zone.y).toBeGreaterThanOrEqual(zone.height);
	});

	it('widens the minimum edges for a rect with a negative anchor', () => {
		const bounds = visibleWorldBounds(1000, 600, 1);
		expect(boundsIncluding(bounds, { x: -50, y: -20, width: 100, height: 40 })).toEqual({
			minX: -50,
			minY: -20,
			maxX: 1000,
			maxY: 600
		});
	});
});

describe('rectsOverlap', () => {
	const box = { x: 100, y: 100, width: 200, height: 200 };

	it('reports overlap for rects sharing area', () => {
		expect(rectsOverlap(box, { x: 250, y: 250, width: 100, height: 100 })).toBe(true);
	});

	it('reports no overlap for separated rects', () => {
		expect(rectsOverlap(box, { x: 400, y: 100, width: 100, height: 100 })).toBe(false);
	});

	it('treats touching edges as clear', () => {
		expect(rectsOverlap(box, { x: 300, y: 100, width: 100, height: 100 })).toBe(false);
	});

	it('counts a neighbour closer than the gap as overlapping', () => {
		const neighbour = { x: 310, y: 100, width: 100, height: 100 };
		expect(rectsOverlap(box, neighbour)).toBe(false);
		expect(rectsOverlap(box, neighbour, 20)).toBe(true);
	});

	it('reports overlap when one rect contains the other', () => {
		expect(rectsOverlap(box, { x: 150, y: 150, width: 20, height: 20 })).toBe(true);
	});
});
