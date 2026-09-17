import { describe, it, expect } from 'vitest';
import { flowColumns, balanceColumns, packBoard, type PackZone } from './wallPack';

/** A zone of `n` tasks, every row the same height, with round numbers. */
const zone = (id: string, n: number, row = 20, head = 20, box = 10): PackZone => ({
	id,
	box,
	head,
	rows: Array.from({ length: n }, () => row)
});

const shape = (columns: ReturnType<typeof flowColumns>) =>
	columns!.map((col) => col.map((f) => `${f.zoneId}:${f.start}-${f.end}${f.continued ? '+' : ''}`));

describe('flowColumns', () => {
	it('keeps zones in board order, left to right', () => {
		// Each zone is 30 + 60 of rows = 90 tall, so 200 holds two per column.
		const zones = [zone('a', 3), zone('b', 3), zone('c', 3), zone('d', 3)];
		expect(shape(flowColumns(zones, 200))).toEqual([['a:0-3', 'b:0-3'], ['c:0-3', 'd:0-3'], []]);
	});

	it('continues a zone that outgrows the column it started in', () => {
		// 8 rows of 20 plus 30 of box is 190; a 150 column takes six of them.
		const columns = flowColumns([zone('a', 8)], 150)!;
		expect(shape(columns)).toEqual([['a:0-6'], ['a:6-8+'], []]);
		expect(columns[1][0].continued).toBe(true);
	});

	it('moves a zone on rather than stranding its header under one task', () => {
		// 'a' leaves room for a header and a single row of 'b'. The minimum of
		// two sends the whole of 'b' to the next column.
		const columns = flowColumns([zone('a', 4), zone('b', 3)], 160)!;
		expect(shape(columns)).toEqual([['a:0-4'], ['b:0-3'], []]);
	});

	it('allows a lone task when that is the whole of what is left', () => {
		// 'a' is 110 tall and 'b' needs 40 of overhead plus one 20 row: 170 in all.
		const columns = flowColumns([zone('a', 4), zone('b', 1)], 180)!;
		expect(shape(columns)).toEqual([['a:0-4', 'b:0-1'], [], []]);
	});

	it('refuses a layout that needs a fourth column', () => {
		expect(flowColumns([zone('a', 6), zone('b', 6), zone('c', 6), zone('d', 6)], 110)).toBeNull();
	});

	it('refuses a zone whose first tasks overflow an empty column', () => {
		expect(flowColumns([zone('a', 2, 60)], 100)).toBeNull();
	});

	it('gives the "N more" row to the fragment that ends the zone', () => {
		const columns = flowColumns([zone('a', 8)], 150, { a: 3 })!;
		expect(columns[0][0].hidden).toBe(0);
		expect(columns[1][0].hidden).toBe(3);
	});

	it('skips an empty zone but keeps one that is hiding everything', () => {
		expect(shape(flowColumns([zone('a', 0), zone('b', 2)], 200))).toEqual([['b:0-2'], [], []]);
		expect(shape(flowColumns([zone('a', 0), zone('b', 2)], 200, { a: 5 }))).toEqual([
			['a:0-0', 'b:0-2'],
			[],
			[]
		]);
	});
});

describe('balanceColumns', () => {
	it('spreads zones instead of filling the first column', () => {
		const zones = [zone('a', 3), zone('b', 3), zone('c', 3)];
		// A 400-tall column would swallow all three; balancing gives one each.
		expect(shape(balanceColumns(zones, 400))).toEqual([['a:0-3'], ['b:0-3'], ['c:0-3']]);
	});

	it('stays null when nothing fits at full height', () => {
		expect(balanceColumns([zone('a', 2, 60)], 100)).toBeNull();
	});
});

describe('packBoard', () => {
	// Rows and header scale with the text; the box padding does too.
	const measure = (counts: Record<string, number>) => (scale: number) =>
		Object.entries(counts).map(([id, n]) => zone(id, n, 20 * scale, 20 * scale, 10 * scale));

	it('takes the largest scale that fits', () => {
		// A six-row zone is 150 × scale tall, so only 1.1 and below fit in 180.
		const result = packBoard([1.3, 1.1, 1], measure({ a: 6, b: 6, c: 6 }), 180);
		expect(result.scale).toBe(1.1);
		expect(result.hidden).toEqual({});
		expect(result.columns.flat()).toHaveLength(3);
	});

	it('hides the tail of the fullest zone only when the smallest scale fails', () => {
		const result = packBoard([1.2, 1], measure({ a: 20, b: 2, c: 2 }), 150);
		expect(result.scale).toBe(1);
		expect(result.hidden.a).toBeGreaterThan(0);
		// Every zone still has a box, and the hidden count is honest.
		const shown = result.columns.flat().filter((f) => f.zoneId === 'a');
		const rows = shown.reduce((n, f) => n + (f.end - f.start), 0);
		expect(rows + result.hidden.a).toBe(20);
		expect(new Set(result.columns.flat().map((f) => f.zoneId))).toEqual(new Set(['a', 'b', 'c']));
	});

	it('returns three columns even when a single zone cannot be shown at all', () => {
		const result = packBoard([1], measure({ a: 4 }), 40);
		expect(result.columns).toHaveLength(3);
		expect(result.hidden.a).toBe(4);
	});
});
