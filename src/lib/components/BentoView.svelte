<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import { tick, untrack } from 'svelte';
	import { SvelteMap } from 'svelte/reactivity';
	import TaskCard from './TaskCard.svelte';
	import AddTaskForm from './AddTaskForm.svelte';
	import TaskDetailModal from './TaskDetailModal.svelte';
	import CategoryMenu from './CategoryMenu.svelte';
	import {
		groupTasksByZone,
		columnCount,
		packColumns,
		boxRows,
		columnRows,
		zoneCenterPoint,
		findUncategorizedPoint,
		dropPointFor,
		nextFreeZoneRect,
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
	// a moved task shadows its loaded position until the two agree.
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

	// Taking a task out of its category means dropping it somewhere no zone
	// covers, so the drag needs an Uncategorized box to aim at — and on a board
	// where everything is filed there is none. It appears for the length of the
	// drag and goes again if nothing landed in it.
	let groups = $derived(
		groupTasksByZone(boardTasks, zones, { alwaysIncludeUncategorized: drag?.active ?? false })
	);

	/** Sentinel group id for the trailing "+ New category" box. */
	const NEW_CATEGORY_ID = 'new-category';

	// Laid out as a group so the packer treats it like any other box and it lands
	// wherever the shortest column is, rather than being pinned under one of them.
	// Holding no tasks, it costs a header row, which is all it draws.
	let columns = $derived(
		packColumns(
			[...groups, { id: NEW_CATEGORY_ID, name: '', color: null, tasks: [] }],
			columnCount(containerWidth)
		)
	);

	// Box rects are measured once when the drag arms rather than per move: the
	// board cannot reflow while a pointer is held down, and re-reading every
	// rect on every pointermove is layout thrash for an answer that cannot have
	// changed.
	let dropTargets: { id: string; rect: DOMRect }[] = [];

	// A drag ends with a click event on the card it started from. Without this
	// the modal would open every time a card is dropped.
	let justDragged = false;

	/**
	 * Opens a card's detail panel.
	 *
	 * Called from both the drag wrapper and the card inside it, so it must stay
	 * idempotent — see the comment on the wrapper for why both need it.
	 */
	function openDetail(task: BentoTask) {
		if (justDragged) return;
		openTaskId = task.id;
	}

	let creating = $state(false);
	let newCategoryName = $state('');
	let nameInputEl = $state<HTMLInputElement | null>(null);

	// The board is now the only place a category can be edited, so the box header
	// carries the whole of it. Three controls would crowd a header that is mostly
	// an ellipsized name, so they live behind one ⋯ trigger.
	let menuZoneId = $state<string | null>(null);
	let menuAnchor = $state<HTMLElement | null>(null);
	let menuZone = $derived(zones.find((z) => z.id === menuZoneId) ?? null);

	function openMenu(e: MouseEvent, zoneId: string) {
		// A second press on the same trigger closes it. The menu's outside-click
		// test deliberately ignores its own anchor, so without this the press would
		// land here and reopen what it was meant to dismiss.
		if (menuZoneId === zoneId) return closeMenu();
		closeAdd();
		menuAnchor = e.currentTarget as HTMLElement;
		menuZoneId = zoneId;
	}

	function closeMenu() {
		menuZoneId = null;
		menuAnchor = null;
	}

	// The add form is a popover hung off the + it came from, not a block inside
	// the box: opening it in place grew the box, reflowed the column beneath it,
	// and squeezed a date input and a select into a column as narrow as 240px.
	let addAnchor = $state<HTMLElement | null>(null);
	let addGroup = $derived(groups.find((g) => g.id === openAddId) ?? null);

	function toggleAdd(e: MouseEvent, groupId: string) {
		// As with the menu, a second press on the same trigger closes it — the
		// popover's outside-click test ignores its own anchor, so without this the
		// press would land here and reopen what it was meant to dismiss.
		if (openAddId === groupId) return closeAdd();
		// One popover at a time: both hang off the same box header.
		closeMenu();
		addAnchor = e.currentTarget as HTMLElement;
		openAddId = groupId;
	}

	function closeAdd() {
		openAddId = null;
		addAnchor = null;
	}

	let renamingId = $state<string | null>(null);
	let renameValue = $state('');
	let renameInputEl = $state<HTMLInputElement | null>(null);

	async function startRename(zoneId: string, current: string) {
		closeMenu();
		renamingId = zoneId;
		renameValue = current;
		await tick();
		renameInputEl?.focus();
		renameInputEl?.select();
	}

	/**
	 * Commits a typed name, discards an empty one — the same
	 * commit-on-blur-if-non-empty shape the create field uses, so renaming and
	 * naming behave identically.
	 */
	async function commitRename(zoneId: string) {
		const name = renameValue.trim();
		const previous = zones.find((z) => z.id === zoneId)?.name;
		renamingId = null;
		renameValue = '';
		// An unchanged name is not worth a round trip, and re-rendering the board
		// for it would only make the field flicker.
		if (!name || name === previous) return;

		const body = new FormData();
		body.set('id', zoneId);
		body.set('name', name);
		await mutateCategory('?/renameZone', body, 'Could not rename category');
	}

	async function recolor(zoneId: string, color: string) {
		closeMenu();
		const body = new FormData();
		body.set('id', zoneId);
		body.set('color', color);
		await mutateCategory('?/updateZoneColor', body, 'Could not recolour category');
	}

	async function removeCategory(zoneId: string) {
		closeMenu();
		const body = new FormData();
		body.set('id', zoneId);
		// Only the zone goes. The tasks keep their coordinates and resurface in
		// Uncategorized, which is why the confirm can promise they survive.
		await mutateCategory('?/deleteZone', body, 'Could not delete category');
	}

	/** Posts a zone form action, reporting a failure rather than swallowing it. */
	async function mutateCategory(action: string, body: FormData, failure: string) {
		try {
			const res = await fetch(action, { method: 'POST', body });
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
		} catch (err) {
			console.error(`${failure} (${action})`, err);
			toast(failure, 'error');
			return;
		}
		await invalidateAll();
	}

	async function startCreating() {
		creating = true;
		newCategoryName = '';
		await tick();
		nameInputEl?.focus();
	}

	/**
	 * Commits if a name was typed, discards silently otherwise.
	 *
	 * A category is still stored as a rectangle — that geometry is what sorts
	 * tasks into groups — but no view draws it any more, so nobody picks the spot:
	 * it comes from nextFreeZoneRect. Color is left to the server, which hands out
	 * the next one in the palette.
	 */
	async function commitCategory() {
		const name = newCategoryName.trim();
		creating = false;
		newCategoryName = '';
		if (!name) return;

		const rect = nextFreeZoneRect(zones);
		const body = new FormData();
		body.set('name', name);
		body.set('x', String(rect.x));
		body.set('y', String(rect.y));
		body.set('width', String(rect.width));
		body.set('height', String(rect.height));
		try {
			const res = await fetch('?/createZone', { method: 'POST', body });
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
		} catch (err) {
			console.error(`Could not create category ${name}`, err);
			toast('Could not create category', 'error');
			return;
		}
		await invalidateAll();
	}

	function boxRef(node: HTMLElement, id: string) {
		boxEls.set(id, node);
		return {
			destroy() {
				boxEls.delete(id);
			}
		};
	}
	// A plain Map on purpose, not a SvelteMap: this is a registry of DOM nodes that
	// only ever gets read imperatively inside the drag handlers, never during
	// render. Making it reactive would invalidate the board every time a box
	// mounts or unmounts, for a value no template reads.
	// eslint-disable-next-line svelte/prefer-svelte-reactivity
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

	async function moveDrag(e: PointerEvent) {
		if (!drag || e.pointerId !== drag.pointerId) return;
		drag.x = e.clientX;
		drag.y = e.clientY;

		if (!drag.active) {
			const travel = Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY);
			if (travel < CLICK_MOVE_THRESHOLD) return;
			drag.active = true;
			// Going active is what adds the Uncategorized box, so the rects can only
			// be read once Svelte has put it on screen — measuring first would leave
			// the one box this drag might be aiming for out of the list entirely.
			await tick();
			if (!drag || e.pointerId !== drag.pointerId) return; // dropped mid-tick
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
				{#if group.id === NEW_CATEGORY_ID}
					<!-- No boxRef: this box is not somewhere a task can be dropped, and
					     registering it would light it up as a drop target that does
					     nothing. -->
					<div class="box new-category" style="flex-grow:{boxRows(group)}">
						{#if creating}
							<input
								class="new-category-input"
								bind:this={nameInputEl}
								bind:value={newCategoryName}
								placeholder="Category name"
								aria-label="New category name"
								onblur={commitCategory}
								onkeydown={(e) => {
									if (e.key === 'Enter') e.currentTarget.blur();
									// Blurring with the field cleared is how a cancel reaches
									// commitCategory, which discards an empty name.
									if (e.key === 'Escape') {
										newCategoryName = '';
										e.currentTarget.blur();
									}
								}}
							/>
						{:else}
							<button type="button" class="new-category-open" onclick={startCreating}>
								+ New category
							</button>
						{/if}
					</div>
				{:else}
					{@const c = colorOf(group.color)}
					{@const adding = openAddId === group.id}
					{@const hint = group.id === UNCATEGORIZED_ID && group.tasks.length === 0}
					<div
						class="box"
						class:drop-target={hoverGroupId === group.id && drag?.active}
						class:drop-hint={hint}
						use:boxRef={group.id}
						style="flex-grow:{boxRows(group)}; background:{hint
							? 'transparent'
							: (c?.fill ?? 'var(--surface)')}; border-color:{c?.border ?? 'var(--border)'};"
					>
						<div class="box-head">
							{#if renamingId === group.id}
								<input
									class="box-name-input"
									bind:this={renameInputEl}
									bind:value={renameValue}
									aria-label="Rename {group.name}"
									onblur={() => commitRename(group.id)}
									onkeydown={(e) => {
										if (e.key === 'Enter') e.currentTarget.blur();
										// Same cancel route as the create field: clear, then blur into
										// the commit, which discards an empty name.
										if (e.key === 'Escape') {
											renameValue = '';
											e.currentTarget.blur();
										}
									}}
								/>
							{:else}
								<span class="box-name">{group.name}</span>
							{/if}
							<span class="box-count">{group.tasks.length}</span>
							<!-- Uncategorized is not a zone — it is the absence of one — so it
						     has no name, colour or row to edit. -->
							{#if group.id !== UNCATEGORIZED_ID}
								<button
									type="button"
									class="box-menu"
									aria-haspopup="true"
									aria-expanded={menuZoneId === group.id}
									aria-label="Edit {group.name}"
									onclick={(e) => openMenu(e, group.id)}
								>
									⋯
								</button>
							{/if}
							<!-- The + lives in the header rather than a footer of its own: a
						     reserved footer row cost every box a card's worth of height,
						     which is most of a small box. It is also what the add popover
						     hangs off, so it must stay put while that is open. -->
							<button
								type="button"
								class="add-plus"
								class:open={adding}
								aria-expanded={adding}
								aria-haspopup="dialog"
								onclick={(e) => toggleAdd(e, group.id)}
								aria-label={adding ? 'Close add task' : `Add task to ${group.name}`}
							>
								+
							</button>
						</div>

						{#if group.tasks.length > 0}
							<div class="box-body">
								{#each group.tasks as task (task.id)}
									<!-- The interactive element is the TaskCard inside, which already
								     carries role="button" and its own keyboard handling. This
								     wrapper adds a pointer gesture over it and no new semantics,
								     so a role here would announce a second control that is not
								     there. Recategorizing has no keyboard path yet — the detail
								     panel has no category control to offer one.

								     The click is handled here as well as on the card because
								     startDrag captures the pointer on this wrapper, and a captured
								     pointer retargets the click that follows to the capturing
								     element — so a handler only on the descendant card never runs
								     and the panel never opens. The card keeps its own handler
								     because that is what gives it role="button" and Enter/Space.
								     Both call the same idempotent opener, so it does not matter
								     which of them the browser delivers the click to, or whether it
								     delivers to both. A press on the done-toggle is unaffected:
								     startDrag ignores buttons and forms before capturing anything,
								     so that click keeps its own target and its stopPropagation. -->
									<!-- svelte-ignore a11y_no_static_element_interactions -->
									<!-- svelte-ignore a11y_click_events_have_key_events -->
									<div
										class="drag-wrap"
										class:dragging={drag?.active && drag.task.id === task.id}
										onpointerdown={(e) => startDrag(e, task)}
										onpointermove={moveDrag}
										onpointerup={endDrag}
										onpointercancel={cancelDrag}
										onclick={() => openDetail(task)}
									>
										<TaskCard {task} onclick={() => openDetail(task)} />
									</div>
								{/each}
							</div>
						{:else}
							<p class="empty">
								{group.id === UNCATEGORIZED_ID && drag?.active
									? 'Drop to uncategorize'
									: 'No tasks yet'}
							</p>
						{/if}
					</div>
				{/if}
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

{#if addGroup && addAnchor}
	{@const point = addPointFor(addGroup.id)}
	<!-- Keyed on the box, so pressing + on a second box rebuilds the popover with
	     that box's landing point and an empty title rather than carrying the
	     first one's half-typed task across. -->
	{#key addGroup.id}
		<AddTaskForm
			x={point.x}
			y={point.y}
			anchor={addAnchor}
			zoneName={addGroup.id === UNCATEGORIZED_ID ? 'Uncategorized' : addGroup.name}
			onclose={closeAdd}
		/>
	{/key}
{/if}

{#if menuZone && menuAnchor}
	<CategoryMenu
		name={menuZone.name}
		color={menuZone.color}
		anchor={menuAnchor}
		onrename={() => startRename(menuZone.id, menuZone.name)}
		onrecolor={(key) => recolor(menuZone.id, key)}
		ondelete={() => removeCategory(menuZone.id)}
		onclose={closeMenu}
	/>
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

	/* A clipped name is a name you cannot read, and a box header has vertical
	   room to spare where it has none horizontally — so long names wrap onto a
	   second line instead of trailing off into an ellipsis. `anywhere` covers
	   the single-unbroken-word name, which no amount of wrapping would fit. */
	.box-name {
		flex: 1;
		min-width: 0;
		overflow-wrap: anywhere;
	}

	.box-count {
		font-size: 0.78rem;
		color: var(--muted);
		font-weight: 500;
		font-variant-numeric: tabular-nums;
	}

	/* Sized and shaped like .add-plus so the pair reads as one control cluster;
	   the glyph sits low in its em box, so it is nudged up to look centred. */
	.box-menu {
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
		font-size: 0.95rem;
		line-height: 0.6;
		padding: 0 0 0.2rem;
		cursor: pointer;
		transition:
			background 0.15s ease,
			color 0.15s ease;
	}

	.box-menu:hover,
	.box-menu[aria-expanded='true'] {
		background: var(--surface-2);
		color: var(--ink);
	}

	/* Matches .box-name's slot exactly, so committing a rename does not jog the
	   header by a pixel as the input is swapped back for the text. */
	.box-name-input {
		flex: 1;
		min-width: 0;
		font-family: var(--font-display);
		font-weight: 600;
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

	/* The Uncategorized box while it holds nothing — it is on screen only for the
	   length of a drag, so it reads as a target rather than as a real box. Its
	   fill is dropped inline, not here: the box sets background in a style
	   attribute, which no rule in this block can outrank. */
	.box.drop-hint {
		border-style: dashed;
	}

	/* Dashed and unfilled for the same reason: it is a place to start something,
	   not a box with contents. */
	.box.new-category {
		border-style: dashed;
		border-color: var(--border);
		background: transparent;
		justify-content: center;
	}

	.new-category-open {
		width: 100%;
		border: none;
		background: transparent;
		color: var(--muted);
		font-family: var(--font-display);
		font-weight: 600;
		font-size: 0.9rem;
		padding: 0.25rem;
		cursor: pointer;
		border-radius: var(--radius-s, 6px);
	}

	.new-category-open:hover {
		color: var(--ink);
		background: var(--surface);
	}

	.new-category-input {
		width: 100%;
		min-width: 0;
		font-family: var(--font-display);
		font-weight: 600;
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
