<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import { untrack } from 'svelte';
	import { SvelteMap } from 'svelte/reactivity';
	import TaskCard from './TaskCard.svelte';
	import AddTaskForm from './AddTaskForm.svelte';
	import TaskDetailModal from './TaskDetailModal.svelte';
	import {
		groupTasksByZone,
		columnCount,
		packColumns,
		boxRows,
		columnRows,
		zoneCenterPoint,
		findUncategorizedPoint,
		dropPointFor,
		UNCATEGORIZED_ID,
		type BentoTask,
		type BentoZone
	} from '$lib/bento';
	import { zoneColorVars, type Point } from '$lib/zones';
	import { toast } from '$lib/toast.svelte';

	let { tasks, zones }: { tasks: BentoTask[]; zones: BentoZone[] } = $props();

	let containerWidth = $state(0);

	// A dropped card has to change boxes now, but the boxes are derived from the
	// server's tasks prop, which only catches up after invalidateAll returns. So
	// a moved task shadows its loaded position until the two agree — the same
	// hold-until-the-server-confirms shape BlobView uses for canvas drags.
	let moved = new SvelteMap<string, Point>();
	let boardTasks = $derived(
		tasks.map((t) => {
			const held = moved.get(t.id);
			return held ? { ...t, ...held } : t;
		})
	);

	$effect(() => {
		// Re-runs whenever SvelteKit swaps in a new tasks array, which is what
		// every load and every invalidateAll does.
		const live = tasks.map((t) => ({ id: t.id, x: t.x, y: t.y }));
		untrack(() => {
			const byId = new Map(live.map((t) => [t.id, t]));
			for (const [id, held] of [...moved]) {
				const task = byId.get(id);
				// Positions persist rounded, so "the server agrees" means the rounded
				// override matches the prop exactly.
				if (!task || (Math.round(held.x) === task.x && Math.round(held.y) === task.y)) {
					moved.delete(id);
				}
			}
		});
	});

	let groups = $derived(groupTasksByZone(boardTasks, zones));
	let columns = $derived(packColumns(groups, columnCount(containerWidth)));

	function colorOf(color: string | null) {
		return color ? zoneColorVars(color) : null;
	}

	function addPointFor(groupId: string) {
		if (groupId === UNCATEGORIZED_ID) return findUncategorizedPoint(zones);
		const zone = zones.find((z) => z.id === groupId);
		return zone ? zoneCenterPoint(zone) : findUncategorizedPoint(zones);
	}

	let openTaskId = $state<string | null>(null);
	let openTask = $derived(boardTasks.find((t) => t.id === openTaskId) ?? null);

	let openAddId = $state<string | null>(null);

	/** Pointer travel below which the gesture is a click that opens the card. */
	const CLICK_MOVE_THRESHOLD = 6;

	interface DragState {
		task: BentoTask;
		pointerId: number;
		/** Where the pointer went down, to measure travel against. */
		startX: number;
		startY: number;
		/** Grab offset inside the card, so the ghost sits under the same spot. */
		grabX: number;
		grabY: number;
		width: number;
		x: number;
		y: number;
		/** Travel has passed the threshold; this is a drag, not a click. */
		active: boolean;
	}

	let drag = $state<DragState | null>(null);
	let hoverGroupId = $state<string | null>(null);

	// Box rects are measured once when the drag arms rather than per move: the
	// board cannot reflow while a pointer is held down, and re-reading every
	// rect on every pointermove is layout thrash for an answer that cannot have
	// changed.
	let dropTargets: { id: string; rect: DOMRect }[] = [];

	// A drag ends with a click event on the card it started from. Without this
	// the modal would open every time a card is dropped.
	let justDragged = false;

	function boxRef(node: HTMLElement, id: string) {
		boxEls.set(id, node);
		return {
			destroy() {
				boxEls.delete(id);
			}
		};
	}
	const boxEls = new Map<string, HTMLElement>();

	function startDrag(e: PointerEvent, task: BentoTask) {
		// The done-toggle and its form live inside the card; a press on either is
		// theirs, not the start of a drag.
		if ((e.target as HTMLElement).closest('button, form, input, a')) return;
		if (e.button !== 0 && e.pointerType === 'mouse') return;

		const card = e.currentTarget as HTMLElement;
		const rect = card.getBoundingClientRect();
		drag = {
			task,
			pointerId: e.pointerId,
			startX: e.clientX,
			startY: e.clientY,
			grabX: e.clientX - rect.left,
			grabY: e.clientY - rect.top,
			width: rect.width,
			x: e.clientX,
			y: e.clientY,
			active: false
		};
		card.setPointerCapture(e.pointerId);
	}

	function moveDrag(e: PointerEvent) {
		if (!drag || e.pointerId !== drag.pointerId) return;
		drag.x = e.clientX;
		drag.y = e.clientY;

		if (!drag.active) {
			const travel = Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY);
			if (travel < CLICK_MOVE_THRESHOLD) return;
			drag.active = true;
			dropTargets = [...boxEls].map(([id, node]) => ({ id, rect: node.getBoundingClientRect() }));
		}

		const hit = dropTargets.find(
			({ rect }) =>
				e.clientX >= rect.left &&
				e.clientX <= rect.right &&
				e.clientY >= rect.top &&
				e.clientY <= rect.bottom
		);
		hoverGroupId = hit?.id ?? null;
	}

	async function endDrag(e: PointerEvent) {
		if (!drag || e.pointerId !== drag.pointerId) return;
		const d = drag;
		const target = hoverGroupId;
		drag = null;
		hoverGroupId = null;
		dropTargets = [];
		if (!d.active) return;

		justDragged = true;
		// Cleared after the click this pointerup is about to generate.
		setTimeout(() => (justDragged = false), 0);

		// Dropped outside every box: nothing was aimed at, so nothing moves.
		if (!target) return;
		const point = dropPointFor(target, d.task, boardTasks, zones);
		if (!point) return; // already in that box, or the box is gone

		moved.set(d.task.id, point);
		try {
			const res = await fetch('/api/positions', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ kind: 'task', id: d.task.id, x: point.x, y: point.y })
			});
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
		} catch (err) {
			// Dropping the override snaps the card back to the box it really lives
			// in. Leaving it would show a move the database never took.
			console.error(`Could not move task ${d.task.id}`, err);
			moved.delete(d.task.id);
			toast('Could not move task', 'error');
			return;
		}
		await invalidateAll();
	}

	function cancelDrag(e: PointerEvent) {
		if (!drag || e.pointerId !== drag.pointerId) return;
		drag = null;
		hoverGroupId = null;
		dropTargets = [];
	}
</script>

<div class="bento" bind:clientWidth={containerWidth}>
	{#each columns as column, index (index)}
		<div class="column" style="flex-grow:{columnRows(column)}">
			{#each column as group (group.id)}
				{@const c = colorOf(group.color)}
				{@const point = addPointFor(group.id)}
				{@const adding = openAddId === group.id}
				<div
					class="box"
					class:drop-target={hoverGroupId === group.id && drag?.active}
					use:boxRef={group.id}
					style="flex-grow:{boxRows(group)}; background:{c?.fill ??
						'var(--surface)'}; border-color:{c?.border ?? 'var(--border)'};"
				>
					<div class="box-head">
						<span class="box-name">{group.name}</span>
						<span class="box-count">{group.tasks.length}</span>
						<!-- The + lives in the header rather than a footer of its own: a
						     reserved footer row cost every box a card's worth of height,
						     which is most of a small box. -->
						<button
							type="button"
							class="add-plus"
							class:open={adding}
							aria-expanded={adding}
							onclick={() => (openAddId = adding ? null : group.id)}
							aria-label={adding ? 'Close add task' : `Add task to ${group.name}`}
						>
							+
						</button>
					</div>

					{#if adding}
						<AddTaskForm x={point.x} y={point.y} />
					{/if}

					{#if group.tasks.length > 0}
						<div class="box-body">
							{#each group.tasks as task (task.id)}
								<!-- The interactive element is the TaskCard inside, which already
								     carries role="button" and its own keyboard handling. This
								     wrapper adds a pointer gesture over it and no new semantics,
								     so a role here would announce a second control that is not
								     there. Keyboard users reach the same move via the card's
								     detail panel. -->
								<!-- svelte-ignore a11y_no_static_element_interactions -->
								<div
									class="drag-wrap"
									class:dragging={drag?.active && drag.task.id === task.id}
									onpointerdown={(e) => startDrag(e, task)}
									onpointermove={moveDrag}
									onpointerup={endDrag}
									onpointercancel={cancelDrag}
								>
									<TaskCard
										{task}
										onclick={() => {
											if (!justDragged) openTaskId = task.id;
										}}
									/>
								</div>
							{/each}
						</div>
					{:else if !adding}
						<p class="empty">No tasks yet</p>
					{/if}
				</div>
			{/each}
		</div>
	{/each}
</div>

{#if drag?.active}
	<!-- Ghost, not the card itself: the card stays in the flow so the box it
	     came from keeps its shape while the drag is in progress. -->
	<div
		class="ghost"
		style="left:{drag.x - drag.grabX}px; top:{drag.y - drag.grabY}px; width:{drag.width}px;"
	>
		<TaskCard task={drag.task} />
	</div>
{/if}

{#if openTask}
	<TaskDetailModal task={openTask} onclose={() => (openTaskId = null)} />
{/if}

<style>
	/* Columns of a guaranteed minimum width, filling the board in both axes. Every
	   flex-grow here is set inline from the group's row count, so a column's width
	   and a box's height both track how much they actually hold. */
	.bento {
		flex: 1;
		min-height: 0;
		width: 100%;
		display: flex;
		align-items: stretch;
		gap: 8px;
		overflow-y: auto;
	}

	/* flex-basis: 0 so the inline grow factors alone decide the split; min-width
	   mirrors MIN_COLUMN_WIDTH, which is what columnCount() sized the count
	   against, so the floor can never make the row overflow. */
	.column {
		flex-basis: 0;
		min-width: 240px;
		display: flex;
		flex-direction: column;
		gap: 8px;
	}

	/* basis auto, so a box starts at its content height and only the slack is
	   shared out by the grow factor. min-height: 0 lets it shrink past its content
	   when a column holds more than fits, handing the overflow to .box-body. */
	.box {
		flex-basis: auto;
		flex-shrink: 1;
		min-height: 0;
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
		border: 1.5px solid;
		border-radius: var(--radius-m);
		padding: 0.45rem 0.5rem 0.5rem;
	}

	.box-head {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		flex-shrink: 0;
		font-family: var(--font-display);
		font-weight: 600;
	}

	.box-name {
		flex: 1;
		min-width: 0;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.box-count {
		font-size: 0.78rem;
		color: var(--muted);
		font-weight: 500;
		font-variant-numeric: tabular-nums;
	}

	.add-plus {
		flex-shrink: 0;
		width: 1.15rem;
		height: 1.15rem;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		border: none;
		border-radius: 50%;
		background: transparent;
		color: var(--muted);
		font-size: 1rem;
		line-height: 1;
		padding: 0;
		cursor: pointer;
		transition:
			transform 0.15s ease,
			background 0.15s ease,
			color 0.15s ease;
	}

	.add-plus:hover {
		background: var(--accent);
		color: var(--accent-ink);
	}

	/* The + is the close control too, so it turns into an ×. */
	.add-plus.open {
		transform: rotate(45deg);
	}

	@media (prefers-reduced-motion: reduce) {
		.add-plus {
			transition: none;
		}
	}

	/* Takes the box's slack, and scrolls rather than growing the box when a zone
	   holds more than its column can show. */
	.box-body {
		flex: 1;
		min-height: 0;
		overflow-y: auto;
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
	}

	.empty {
		color: var(--muted);
		font-size: 0.85rem;
		margin: 0;
	}

	/* touch-action: none is what lets a touch drag a card at all — without it
	   the browser claims the gesture as a scroll and never sends pointermove.
	   The cost is that a box is scrolled from its padding rather than from a
	   card, which is why the wrapper is only as big as the card itself. */
	.drag-wrap {
		touch-action: none;
		cursor: grab;
	}

	/* The source card dims rather than disappearing, so the box it came from
	   keeps its height and the board does not reflow mid-drag. */
	.drag-wrap.dragging {
		opacity: 0.35;
		cursor: grabbing;
	}

	.box.drop-target {
		outline: 2px solid var(--accent);
		outline-offset: 1px;
	}

	.ghost {
		position: fixed;
		z-index: 60;
		pointer-events: none;
		opacity: 0.9;
		transform: rotate(-1.5deg);
		box-shadow: var(--shadow-pop, 0 8px 24px rgb(0 0 0 / 0.18));
	}
</style>
