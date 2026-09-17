/**
 * How the wall fills its three columns.
 *
 * Bento gives every zone a box of its own and lets the leftover space fall
 * where it may, which is fine on a laptop and wasteful on a 1024 × 768 panel
 * read from across a room. Here the zones are poured into the columns in board
 * order, a zone too tall for what is left continues at the top of the next
 * column, and the text then grows until the columns are full.
 *
 * Everything in this module is pure and works in pixels it is handed. The
 * measuring — how tall a header or a two-line task actually is at a given text
 * size — belongs to the component, which has a DOM to ask. That split is what
 * makes the packing testable without one.
 */

export interface PackZone {
	id: string;
	/** Height of the box's own padding and borders, without its contents. */
	box: number;
	/** Height of the zone header row. */
	head: number;
	/** Height of each task row, in the order the tasks are shown. */
	rows: number[];
}

export interface Fragment {
	zoneId: string;
	/** Index of the first task in this fragment. */
	start: number;
	/** Index one past the last task in this fragment. */
	end: number;
	/** A second or later piece of a zone that began in an earlier column. */
	continued: boolean;
	/** Tasks dropped from the end of the zone, shown as "N more". */
	hidden: number;
}

export interface PackOptions {
	/** Space between two boxes stacked in the same column. */
	gap: number;
	columns: number;
	/**
	 * Fewest tasks a fragment may carry, so a header is never stranded at the
	 * foot of a column. A zone with fewer tasks left than this is exempt — one
	 * orphan task is better than an empty gap and a header on its own.
	 */
	minRows: number;
	/** Height of the "N more" row, counted only in a fragment that has one. */
	moreRow: number;
}

export const DEFAULT_PACK: PackOptions = { gap: 10, columns: 3, minRows: 2, moreRow: 24 };

/**
 * Pours the zones into columns no taller than `capacity`.
 *
 * Returns `null` when they do not fit — a zone whose first `minRows` tasks
 * overflow an empty column, or work left over once the last column is full.
 * Callers answer a `null` by shrinking the text or hiding tasks; this function
 * never does either, so the two decisions stay separable.
 */
export function flowColumns(
	zones: PackZone[],
	capacity: number,
	hiddenByZone: Record<string, number> = {},
	options: Partial<PackOptions> = {}
): Fragment[][] | null {
	const o = { ...DEFAULT_PACK, ...options };
	const columns: Fragment[][] = [[]];
	let used = 0;

	const openColumn = () => {
		if (columns.length >= o.columns) return false;
		columns.push([]);
		used = 0;
		return true;
	};

	for (const zone of zones) {
		const hidden = hiddenByZone[zone.id] ?? 0;
		let i = 0;
		let continued = false;

		// A zone with no visible tasks still deserves its header when something
		// was hidden from it; an empty zone is simply skipped.
		if (zone.rows.length === 0 && hidden === 0) continue;

		do {
			const gap = columns.at(-1)!.length > 0 ? o.gap : 0;
			const overhead = gap + zone.box + zone.head;
			const remaining = zone.rows.length - i;
			// The "N more" row only lands on the fragment that ends the zone.
			const tail = hidden > 0 ? o.moreRow : 0;

			let fit = 0;
			let height = overhead;
			while (i + fit < zone.rows.length && used + height + zone.rows[i + fit] <= capacity) {
				height += zone.rows[i + fit];
				fit++;
			}
			// Whether the tail fits decides only whether this fragment can be the
			// last one, so it is checked after the rows rather than reserved up
			// front: reserving it would push rows into another column needlessly.
			const complete = fit === remaining && used + height + tail <= capacity;
			const need = Math.min(o.minRows, remaining);

			if (fit < need || (fit === remaining && !complete)) {
				if (columns.at(-1)!.length === 0) return null; // too tall for a whole column
				if (!openColumn()) return null;
				continue;
			}

			columns.at(-1)!.push({
				zoneId: zone.id,
				start: i,
				end: i + fit,
				continued,
				hidden: complete ? hidden : 0
			});
			used += height + (complete ? tail : 0);
			i += fit;
			continued = true;

			if (i < zone.rows.length && !openColumn()) return null;
		} while (i < zone.rows.length);
	}

	// Always hand back the full set, so a caller can render column boxes without
	// counting: an unused column is an empty one, not a missing one.
	while (columns.length < o.columns) columns.push([]);
	return columns;
}

/**
 * The same flow, at the smallest capacity that still holds everything.
 *
 * Pouring at the full board height fills the first columns and leaves the last
 * one short. Finding the tightest capacity that still fits and pouring again
 * spreads the zones evenly, so the columns end level.
 */
export function balanceColumns(
	zones: PackZone[],
	height: number,
	hiddenByZone: Record<string, number> = {},
	options: Partial<PackOptions> = {}
): Fragment[][] | null {
	const full = flowColumns(zones, height, hiddenByZone, options);
	if (!full) return null;

	let low = 0; // known not to fit
	let high = height; // known to fit
	while (high - low > 1) {
		const mid = Math.floor((low + high) / 2);
		if (flowColumns(zones, mid, hiddenByZone, options)) high = mid;
		else low = mid;
	}
	return flowColumns(zones, high, hiddenByZone, options) ?? full;
}

export interface PackResult {
	columns: Fragment[][];
	/** The text scale the layout settled on. */
	scale: number;
	/** Tasks hidden per zone, empty when everything is shown. */
	hidden: Record<string, number>;
}

/**
 * Picks the largest text scale whose layout fits, and hides tasks only when
 * even the smallest one cannot.
 *
 * `measure` is asked for the zone heights at a scale; the component answers it
 * from the DOM. Scales are tried largest first, so the wall reads as large as
 * the day's workload allows.
 */
export function packBoard(
	scales: number[],
	measure: (scale: number) => PackZone[],
	height: number,
	options: Partial<PackOptions> = {}
): PackResult {
	let smallest: { scale: number; zones: PackZone[] } | null = null;

	for (const scale of scales) {
		const zones = measure(scale);
		const columns = balanceColumns(zones, height, {}, options);
		if (columns) return { columns, scale, hidden: {} };
		smallest = { scale, zones };
	}

	// Nothing fits: at the smallest scale, take tasks off the end of the
	// fullest zone until it does. Hiding from the longest list keeps every
	// zone present, which matters more on a wall than any single task does.
	const { scale, zones } = smallest!;
	const hidden: Record<string, number> = {};
	const target = zones.reduce((a, z) => (z.rows.length > a.rows.length ? z : a), zones[0]);
	const full = target.rows.length;

	for (let keep = full - 1; keep >= 1; keep--) {
		hidden[target.id] = full - keep;
		const trimmed = zones.map((z) =>
			z.id === target.id ? { ...z, rows: z.rows.slice(0, keep) } : z
		);
		const columns = balanceColumns(trimmed, height, hidden, options);
		if (columns) return { columns, scale, hidden };
	}

	// Even one task per zone overflows. Show what the columns hold and say so.
	hidden[target.id] = full;
	const stripped = zones.map((z) => (z.id === target.id ? { ...z, rows: [] } : z));
	return {
		columns: flowColumns(stripped, height, hidden, options) ?? [[], [], []],
		scale,
		hidden
	};
}
