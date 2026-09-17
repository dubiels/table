<script lang="ts">
	import GoogleSyncGlyph from '../GoogleSyncGlyph.svelte';
	import canvasLogo from '$lib/assets/canvas-logo.png';
	import { googleSyncState } from '$lib/googleSync';
	import { wallPills, isOnTodaysPlan } from '$lib/wallDates';
	import { packBoard, type Fragment, type PackZone } from '$lib/wallPack';
	import type { WallBox, WallItem, WallTask } from '$lib/wallBoard';

	let {
		boxes,
		today,
		gtasksConfigured
	}: {
		boxes: WallBox[];
		today: string;
		gtasksConfigured: boolean;
	} = $props();

	// The board reads as large as the day's workload allows. Tried biggest
	// first; the first size whose layout fits is the one drawn.
	const SCALES = Array.from({ length: 36 }, (_, i) => 2 - i * 0.03);
	const GAP = 12;
	/** Narrowest a column may be before the board drops one. */
	const MIN_COLUMN = 260;

	let boardEl = $state<HTMLDivElement | undefined>();
	let rulerEl = $state<HTMLDivElement | undefined>();
	let scale = $state(1);
	let columnCount = $state(3);
	let columns = $state<Fragment[][]>([[], [], []]);

	const byId = $derived(new Map(boxes.map((b) => [b.id, b])));

	/**
	 * Heights straight from the DOM at one text size.
	 *
	 * How a title wraps at the column's width is not something arithmetic
	 * predicts, so the ruler renders every box at that exact width, out of
	 * sight, and is measured. One height per *item*: a task row, or a whole
	 * Canvas group, which is why a group can never be split down the middle.
	 */
	function measure(ruler: HTMLDivElement, columnWidth: number, textScale: number): PackZone[] {
		ruler.style.width = `${columnWidth}px`;
		ruler.style.setProperty('--wall-k', String(textScale));
		return [...ruler.children].map((box, i) => {
			const head = box.querySelector<HTMLElement>('.box-head')!.offsetHeight;
			const items = [...(box.querySelector('.items')?.children ?? [])] as HTMLElement[];
			// The gap below an item belongs to the item, so a column's height is
			// the sum of what it holds and nothing else.
			const itemGap = 0.25 * 15 * textScale;
			const rows = items.map((el) => el.offsetHeight + itemGap);
			const contents = head + rows.reduce((a, b) => a + b, 0);
			return {
				id: boxes[i].id,
				head,
				rows,
				box: (box as HTMLElement).offsetHeight - contents
			};
		});
	}

	function repack() {
		if (!boardEl || !rulerEl) return;
		const height = boardEl.clientHeight;
		const width = boardEl.clientWidth;
		if (height < 1 || width < 1 || boxes.length === 0) return;

		// Three columns on the Samsung, four on a laptop: a column narrower than
		// this wraps every second title, which costs more height than the extra
		// column saves.
		const cols = Math.max(2, Math.min(4, Math.floor(width / MIN_COLUMN)));
		const columnWidth = (width - (cols - 1) * GAP) / cols;
		const ruler = rulerEl;
		// Reading offsetHeight forces the layout the inline style just
		// invalidated, so no tick() is needed here: the ruler is written to
		// directly rather than through state.
		const result = packBoard(SCALES, (s) => measure(ruler, columnWidth, s), height, {
			gap: GAP,
			columns: cols
		});

		columnCount = cols;
		scale = result.scale;
		columns = result.columns;
	}

	function itemsIn(fragment: Fragment): WallItem[] {
		return byId.get(fragment.zoneId)?.items.slice(fragment.start, fragment.end) ?? [];
	}

	$effect(() => {
		void boxes;
		void today;
		repack();
	});

	$effect(() => {
		if (!boardEl) return;
		const observer = new ResizeObserver(() => repack());
		observer.observe(boardEl);
		// Fonts land after the first paint, and a height measured against the
		// fallback face is wrong by a line here and there.
		document.fonts?.ready.then(() => repack());
		return () => observer.disconnect();
	});
</script>

{#snippet taskRow(task: WallTask)}
	{@const pills = wallPills(task, today)}
	<div class="row" class:on-plan={isOnTodaysPlan(task, today)}>
		<span class="title">{task.title}</span>
		{#if gtasksConfigured}
			<span class="mark"><GoogleSyncGlyph state={googleSyncState(task)} /></span>
		{/if}
		{#if pills.length > 0 || task.courseName}
			<span class="meta">
				{#each pills as pill (pill.kind)}
					<span class="tag {pill.kind} {pill.tone}">{pill.text}</span>
				{/each}
				{#if task.courseName}<span class="course">{task.courseName}</span>{/if}
			</span>
		{/if}
	</div>
{/snippet}

{#snippet boxBody(box: WallBox, items: WallItem[], hiddenCount: number, continued: boolean)}
	<section class="box">
		<h2 class="box-head">
			{#if box.canvas}
				<!-- The mark is white, so it rides a Canvas-red chip here exactly as
				     it does on the board's panel button. -->
				<span class="canvas-chip"><img src={canvasLogo} alt="" width="14" height="14" /></span>
			{:else}
				<span class="dot" style="--dot:{box.color ?? 'transparent'}"></span>
			{/if}
			<span>{box.name}</span>
			{#if continued}
				<span class="continued">continued</span>
			{:else}
				<span class="count">{box.count}</span>
			{/if}
		</h2>
		<div class="items">
			{#each items as item, index (item.kind === 'task' ? item.task.id : item.label + index)}
				{#if item.kind === 'task'}
					{@render taskRow(item.task)}
				{:else}
					<div class="group">
						<div class="group-head">
							<span>{item.label}</span><span class="count">{item.tasks.length}</span>
						</div>
						<div class="rows">
							{#each item.tasks as task (task.id)}{@render taskRow(task)}{/each}
						</div>
					</div>
				{/if}
			{/each}
		</div>
		{#if hiddenCount > 0}
			<p class="more">{hiddenCount} more</p>
		{/if}
	</section>
{/snippet}

<!-- Measured, never seen. `visibility: hidden` rather than `display: none`,
     because a box with no display has no height to read. -->
<div class="ruler" bind:this={rulerEl} aria-hidden="true">
	{#each boxes as box (box.id)}
		{@render boxBody(box, box.items, 0, false)}
	{/each}
</div>

<div
	class="board"
	bind:this={boardEl}
	style="--wall-k:{scale};grid-template-columns:repeat({columnCount}, minmax(0, 1fr))"
>
	{#each columns as column, index (index)}
		<div class="column">
			{#each column as fragment (fragment.zoneId + fragment.start)}
				{@const box = byId.get(fragment.zoneId)}
				{#if box}
					{@render boxBody(box, itemsIn(fragment), fragment.hidden, fragment.continued)}
				{/if}
			{/each}
		</div>
	{/each}
</div>

<style>
	.board {
		display: grid;
		gap: 12px;
		min-height: 0;
		min-width: 0;
		font-size: calc(15px * var(--wall-k, 1));
	}

	.ruler {
		position: absolute;
		visibility: hidden;
		pointer-events: none;
		top: 0;
		left: 0;
		font-size: calc(15px * var(--wall-k, 1));
	}

	.column {
		display: flex;
		flex-direction: column;
		gap: 12px;
		min-height: 0;
	}

	/* The last box in a column takes the slack, so the columns end level
	   instead of leaving a ragged strip of background at three heights. */
	.column .box:last-child {
		flex: 1;
	}

	.box {
		background: var(--wall-box);
		border-radius: 12px;
		padding: 0.55em 0.55em 0.5em;
		display: flex;
		flex-direction: column;
		gap: 0.3em;
	}

	.box-head {
		display: flex;
		align-items: center;
		gap: 0.5em;
		margin: 0;
		padding: 0.1em 0.35em 0.25em;
		font-size: 1.05em;
		font-weight: 650;
		letter-spacing: -0.01em;
	}

	.dot {
		width: 0.6em;
		height: 0.6em;
		border-radius: 50%;
		background: var(--dot);
		flex: none;
	}

	.canvas-chip {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 1.2em;
		height: 1.2em;
		border-radius: 0.3em;
		background: #d64027;
		flex: none;
	}

	.canvas-chip img {
		width: 0.8em;
		height: 0.8em;
		display: block;
	}

	.count,
	.continued {
		color: var(--wall-dim);
		font-weight: 500;
		font-size: 0.85em;
	}

	.box-head .count {
		margin-left: auto;
	}

	.items,
	.rows {
		display: flex;
		flex-direction: column;
		gap: 0.25em;
	}

	/* Canvas keeps its own shape inside its box: one sub-box per deadline
	   group, holding exactly the same rows as everywhere else. */
	.group {
		background: var(--wall-sub);
		border-radius: 10px;
		padding: 0.35em 0.4em 0.4em;
		display: flex;
		flex-direction: column;
		gap: 0.25em;
	}

	.group-head {
		display: flex;
		align-items: center;
		gap: 0.4em;
		padding: 0 0.3em;
		font-size: 0.85em;
		font-weight: 600;
		color: var(--wall-dim);
	}

	.group-head .count {
		margin-left: auto;
	}

	/*
	 * Every line of work is the same object, whether you wrote it or Canvas
	 * did: a raised row carrying a title, its dates and the Google mark. A
	 * hairline between paragraphs of text was not enough to count rows by from
	 * across a room.
	 */
	.row {
		background: var(--wall-row);
		border: 1px solid var(--wall-row-line);
		border-radius: 8px;
		padding: 0.35em 0.6em;
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto;
		gap: 0.2em 0.5em;
	}

	.title {
		grid-column: 1;
	}

	.mark {
		grid-column: 2;
		grid-row: 1;
		width: 0.95em;
		margin-top: 0.15em;
		flex: none;
	}

	.meta {
		grid-column: 1 / -1;
		display: flex;
		align-items: center;
		gap: 0.35em;
		flex-wrap: wrap;
	}

	/* Today's work, marked where it already sits rather than copied into a list
	   of its own: one board, and the eye finds the warm rows on it. */
	.row.on-plan {
		background: var(--wall-today);
		border-color: var(--wall-today-line);
	}

	/* Not `.pill`: app.css owns that name globally and would uppercase these
	   and reset their size from under the component. */
	.tag {
		font-size: 0.78em;
		font-weight: 600;
		padding: 0.05em 0.5em;
		border-radius: 999px;
		border: 1px solid transparent;
		white-space: nowrap;
	}

	/* Do is outlined and Due is filled, so which date a tag carries reads as
	   shape before the words resolve. */
	.tag.do {
		border-color: var(--wall-tag-edge);
		color: var(--wall-ink-soft);
	}

	.tag.do.now {
		border-color: var(--wall-soon-edge);
		color: var(--wall-soon);
	}

	.tag.due {
		background: var(--wall-tag-fill);
		color: var(--wall-ink);
	}

	.tag.due.late {
		background: var(--wall-late-fill);
		color: var(--wall-late);
	}

	.course {
		font-size: 0.78em;
		color: var(--wall-dim);
		margin-left: auto;
		white-space: nowrap;
	}

	.more {
		font-size: 0.85em;
		color: var(--wall-dim);
		margin: 0;
		padding: 0.2em 0.4em 0;
	}
</style>
