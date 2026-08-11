<script lang="ts">
	import type { Snippet } from 'svelte';

	let {
		side,
		mode,
		open,
		label,
		id,
		count = null,
		anchor,
		onopen,
		onclose,
		children
	}: {
		/** Which edge it docks to — drives row order, borders and slide direction. */
		side: 'left' | 'right';
		/** Docked beside the board on wide screens; a slide-over drawer below 1280px. */
		mode: 'docked' | 'overlay';
		open: boolean;
		/** Names the panel in its header, its collapsed spine and its aria-label. */
		label: string;
		id: string;
		/** Shown beside the label; the caller owns what it counts. */
		count?: string | number | null;
		/** The button that opens the drawer — excluded from the outside-click test. */
		anchor: HTMLElement | null;
		onopen: () => void;
		onclose: (refocus?: boolean) => void;
		children: Snippet;
	} = $props();

	let panelEl = $state<HTMLElement | null>(null);

	// Docked, the fold arrow points at the edge the panel tucks into; as a drawer
	// it is a plain dismiss.
	let foldGlyph = $derived(mode === 'overlay' ? '×' : side === 'left' ? '⟨' : '⟩');

	// Capture phase for the same reason TopBar's menu uses it: task cards and list
	// rows stopPropagation() on their own clicks, so a bubble-phase listener would
	// never see them and the drawer would stay stuck open over the board.
	//
	// The test is scoped to this panel's own element plus the button that opens
	// it, so it neither fights TopBar's listener (which only ever asks about
	// .user-menu) nor closes the drawer on the very click that opened it. Docked
	// mode never registers it: a click on the board must not fold the panel away.
	$effect(() => {
		if (mode !== 'overlay' || !open) return;
		function onDocumentClick(e: MouseEvent) {
			const target = e.target as Node | null;
			if (!target) return;
			if (panelEl?.contains(target)) return;
			if (anchor?.contains(target)) return;
			onclose();
		}
		document.addEventListener('click', onDocumentClick, true);
		return () => document.removeEventListener('click', onDocumentClick, true);
	});

	// A drawer that opens behind the focus ring leaves a keyboard user tabbing
	// through the board to reach it, and Escape — which already returns focus to
	// the opener — would have nothing to return from.
	$effect(() => {
		if (mode !== 'overlay' || !open) return;
		panelEl?.focus();
	});

	function onWindowKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape' && mode === 'overlay' && open) onclose(true);
	}
</script>

<svelte:window onkeydown={onWindowKeydown} />

{#if mode === 'docked' && !open}
	<!-- No aria-controls: the panel it would name is not in the DOM while the
	     strip is showing, and a dangling reference is worse than none. -->
	<button
		type="button"
		class="edge-strip"
		aria-expanded="false"
		title="Show {label}"
		onclick={onopen}
	>
		<span class="edge-text">{label}</span>
	</button>
{:else}
	<!-- tabindex so the drawer can take focus when it opens: that is what makes
	     Escape and tabbing onward work from there rather than from the board. -->
	<aside
		class="side-panel"
		class:left={side === 'left'}
		class:overlay={mode === 'overlay'}
		class:open
		{id}
		tabindex="-1"
		bind:this={panelEl}
		aria-label={label}
		aria-hidden={mode === 'overlay' && !open}
	>
		<div class="panel-head">
			<h2 class="panel-title">{label}</h2>
			{#if count !== null}
				<span class="count">{count}</span>
			{/if}
			<button
				type="button"
				class="btn btn-ghost btn-icon fold"
				aria-label={mode === 'overlay' ? `Close ${label}` : `Collapse ${label}`}
				title={mode === 'overlay' ? `Close ${label}` : `Collapse ${label}`}
				onclick={() => onclose(true)}
			>
				{foldGlyph}
			</button>
		</div>

		<div class="panel-body">
			{@render children()}
		</div>
	</aside>
{/if}

<style>
	.side-panel {
		/* 280px rather than the 320 this was as a single panel: two of them dock at
		   once now, and the board has to keep a usable width between them. */
		width: 280px;
		flex-shrink: 0;
		display: flex;
		flex-direction: column;
		min-height: 0;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius-m);
		overflow: hidden;
	}

	/* Focus lands here when the drawer opens; the ring around a whole panel is
	   noise, and the content inside it shows its own. */
	.side-panel:focus {
		outline: none;
	}

	/* Below 1280px the panel stops being furniture and becomes a drawer: fixed to
	   its own edge, starting where the shell's header ends. */
	.side-panel.overlay {
		position: fixed;
		top: var(--topbar-height);
		right: 0;
		bottom: 0;
		width: min(340px, 100vw);
		border: none;
		border-left: 1px solid var(--border-strong);
		border-radius: 0;
		box-shadow: var(--shadow-raised);
		/* Above the canvas (cards reach 900, the composer 950) and above the board
		   mascot at 960, but under the topbar's 999 and the task modal's 1000. */
		z-index: 980;
		transform: translateX(100%);
		visibility: hidden;
		/* visibility is a discrete property: transitioned over a duration it flips
		   at the halfway mark, blanking the drawer mid-slide. Held instead until
		   the slide-out finishes, and released immediately on the way in by the
		   zeroed delay below. */
		transition:
			transform 200ms ease,
			visibility 0s linear 200ms;
	}

	/* A left-docked panel slides out of the left edge and carries its border on
	   the side facing the board. */
	.side-panel.overlay.left {
		right: auto;
		left: 0;
		border-left: none;
		border-right: 1px solid var(--border-strong);
		transform: translateX(-100%);
	}

	.side-panel.overlay.open {
		transform: translateX(0);
		visibility: visible;
		transition-delay: 0s;
	}

	/* The drawer is still a drawer without the slide; motion is the part that is
	   optional. */
	@media (prefers-reduced-motion: reduce) {
		.side-panel.overlay {
			transition: none;
		}
	}

	/* Collapsed: a 28px spine that keeps the panel's place in the row and says
	   what comes back when it is clicked. */
	.edge-strip {
		flex-shrink: 0;
		width: 28px;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 0.6rem 0;
		border: 1px solid var(--border);
		border-radius: var(--radius-m);
		background: var(--surface);
		color: var(--muted);
		cursor: pointer;
		transition:
			background 0.15s ease,
			color 0.15s ease;
	}

	.edge-strip:hover {
		background: var(--surface-2);
		color: var(--ink);
	}

	.edge-text {
		writing-mode: vertical-rl;
		font-size: 0.75rem;
		font-weight: 600;
		letter-spacing: 0.06em;
		white-space: nowrap;
	}

	.panel-head {
		flex-shrink: 0;
		display: flex;
		align-items: baseline;
		gap: 0.4rem;
		padding: 0.5rem 0.9rem;
		border-bottom: 1px solid var(--border);
	}

	.panel-title {
		margin: 0;
		font-family: var(--font-display);
		font-size: 0.95rem;
		font-weight: 600;
		letter-spacing: -0.022em;
		color: var(--ink);
	}

	.count {
		font-size: 0.74rem;
		font-weight: 400;
		color: var(--muted);
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	/* The fold control sits on the edge the panel tucks into, so both panels'
	   arrows point outward at the screen edges rather than both pointing right.
	   Ordered rather than reordered in markup so the heading still comes first
	   for a screen reader. */
	.fold {
		order: 1;
		align-self: center;
		margin-left: auto;
		font-size: 0.95rem;
	}

	.side-panel.left .fold {
		order: -1;
		margin-left: 0;
		margin-right: 0.15rem;
	}

	.panel-body {
		flex: 1;
		min-height: 0;
		overflow-y: auto;
		display: flex;
		flex-direction: column;
		gap: 1rem;
		padding: 0.8rem 0.9rem 0.9rem;
	}
</style>
