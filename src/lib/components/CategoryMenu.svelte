<script lang="ts">
	import { ZONE_COLOR_KEYS, zoneColorVars } from '$lib/zones';

	let {
		name,
		color,
		anchor,
		onrename,
		onrecolor,
		ondelete,
		onclose
	}: {
		name: string;
		color: string;
		anchor: HTMLElement;
		onrename: () => void;
		onrecolor: (key: string) => void;
		ondelete: () => void;
		onclose: () => void;
	} = $props();

	let el = $state<HTMLDivElement | undefined>();
	let cancelEl = $state<HTMLButtonElement | undefined>();

	// Deleting is one click away from a category someone spent time filling, so it
	// asks once. The copy names the actual consequence rather than saying "are you
	// sure": the tasks survive, which is the fact that decides the answer.
	let confirmingDelete = $state(false);

	// fixed, not absolute: the board scrolls and clips its overflow, and a menu
	// positioned inside a box would be cut off by the box that owns it.
	let pos = $state({ x: 0, y: 0 });

	const MENU_WIDTH = 208;
	const GAP = 6;
	/** Enough of the menu to be worth showing below rather than flipping above. */
	const MIN_ROOM_BELOW = 150;

	// Bound from the element rather than read on demand, so switching to the
	// confirm step — the one thing that changes the menu's height — re-places it
	// through the effect below instead of leaving it hanging off the bottom.
	let menuHeight = $state(0);

	$effect(() => place(menuHeight));

	function place(height: number) {
		const a = anchor.getBoundingClientRect();
		// Right-aligned under the button it came from, then pulled back inside the
		// viewport — a box in the last column would otherwise hang off the edge.
		const x = Math.max(GAP, Math.min(a.right - MENU_WIDTH, window.innerWidth - MENU_WIDTH - GAP));
		const below = window.innerHeight - a.bottom;
		const y =
			below < Math.max(MIN_ROOM_BELOW, height + GAP) ? a.top - height - GAP : a.bottom + GAP;
		pos = { x, y: Math.max(GAP, y) };
	}

	// Opening moves focus into the menu so Escape and Tab have somewhere to act
	// from. In the confirm step that lands on Cancel, never on Delete — a stray
	// Enter on a freshly-focused destructive button is exactly the accident the
	// confirm exists to prevent.
	$effect(() => {
		if (confirmingDelete) cancelEl?.focus();
		else el?.querySelector('button')?.focus();
	});

	function onWindowPointerdown(e: PointerEvent) {
		const target = e.target as Node;
		// The trigger is excluded so its own click can close the menu itself,
		// instead of this closing it and the click reopening it.
		if (el && !el.contains(target) && !anchor.contains(target)) onclose();
	}

	function onWindowKeydown(e: KeyboardEvent) {
		if (e.key !== 'Escape') return;
		// Escape backs out of the confirm first, so it never destroys anything and
		// never skips straight past the question it was asked.
		if (confirmingDelete) confirmingDelete = false;
		else onclose();
	}
</script>

<svelte:window
	onpointerdown={onWindowPointerdown}
	onkeydown={onWindowKeydown}
	onresize={onclose}
	onscrollcapture={onclose}
/>

<div
	class="menu"
	bind:this={el}
	bind:offsetHeight={menuHeight}
	style="left:{pos.x}px; top:{pos.y}px; width:{MENU_WIDTH}px;"
	role="group"
	aria-label="Category {name}"
>
	{#if confirmingDelete}
		<p class="confirm-copy">
			Delete <strong>{name}</strong>? Its tasks stay on the board, uncategorized.
		</p>
		<div class="confirm-row">
			<button type="button" class="btn-danger" onclick={ondelete}> Delete </button>
			<button
				type="button"
				class="btn-plain"
				bind:this={cancelEl}
				onclick={() => (confirmingDelete = false)}
			>
				Cancel
			</button>
		</div>
	{:else}
		<div class="swatches" role="group" aria-label="Category colour">
			{#each ZONE_COLOR_KEYS as key (key)}
				{@const c = zoneColorVars(key)}
				<button
					type="button"
					class="swatch"
					class:current={key === color}
					style="background:{c.fill}; border-color:{c.border};"
					aria-label={key}
					aria-current={key === color}
					onclick={() => onrecolor(key)}
				></button>
			{/each}
		</div>
		<button type="button" class="item" onclick={onrename}>Rename</button>
		<button type="button" class="item danger" onclick={() => (confirmingDelete = true)}>
			Delete
		</button>
	{/if}
</div>

<style>
	.menu {
		position: fixed;
		/* Above the drag ghost (60), below the panel drawers (980), topbar (999)
		   and task modal (1000) — all of which must be able to cover it. */
		z-index: 70;
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
		padding: 0.4rem;
		background: var(--surface);
		border: 1px solid var(--border-strong);
		border-radius: var(--radius-s);
		box-shadow: var(--shadow-card);
	}

	.swatches {
		display: flex;
		gap: 0.3rem;
		padding: 0.1rem 0.15rem 0.35rem;
		border-bottom: 1px solid var(--border);
		margin-bottom: 0.2rem;
	}

	.swatch {
		width: 1.35rem;
		height: 1.35rem;
		border-radius: 50%;
		border: 2px solid;
		padding: 0;
		cursor: pointer;
	}

	/* A ring rather than a checkmark: the swatches are small, and a tick drawn
	   over a pale fill is less legible than the gap around the current one. */
	.swatch.current {
		box-shadow:
			0 0 0 2px var(--surface),
			0 0 0 3.5px var(--ink);
	}

	.item {
		text-align: left;
		border: none;
		background: transparent;
		color: var(--ink);
		font-size: 0.85rem;
		padding: 0.32rem 0.4rem;
		border-radius: var(--radius-s);
		cursor: pointer;
	}

	.item:hover {
		background: var(--surface-2);
	}

	.item.danger {
		color: var(--danger);
	}

	.item.danger:hover {
		background: var(--danger-soft);
	}

	.confirm-copy {
		margin: 0;
		padding: 0.15rem 0.25rem 0.35rem;
		font-size: 0.82rem;
		line-height: 1.35;
		color: var(--muted);
	}

	.confirm-copy strong {
		color: var(--ink);
	}

	.confirm-row {
		display: flex;
		gap: 0.35rem;
	}

	.btn-danger,
	.btn-plain {
		flex: 1;
		font-size: 0.82rem;
		font-weight: 600;
		padding: 0.32rem 0.4rem;
		border-radius: var(--radius-s);
		cursor: pointer;
	}

	.btn-danger {
		border: 1px solid var(--danger);
		background: var(--danger);
		color: var(--surface);
	}

	.btn-plain {
		border: 1px solid var(--border);
		background: transparent;
		color: var(--ink);
	}
</style>
