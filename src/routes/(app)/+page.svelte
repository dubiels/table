<script lang="ts">
	import BlobView from '$lib/components/BlobView.svelte';
	import MobileColumns from '$lib/components/MobileColumns.svelte';
	import ListView from '$lib/components/ListView.svelte';
	import BentoView from '$lib/components/BentoView.svelte';
	import ViewSwitcher from '$lib/components/ViewSwitcher.svelte';
	import Mascot from '$lib/components/Mascot.svelte';
	import SidePanel from '$lib/components/SidePanel.svelte';
	import TodayPanel from '$lib/components/TodayPanel.svelte';
	import CanvasPanel from '$lib/components/CanvasPanel.svelte';
	import canvasLogo from '$lib/assets/canvas-logo.png';
	import { eventsToday } from '$lib/agenda';
	import { localDateString, CANVAS_SOURCE } from '$lib/listView';
	let { data } = $props();

	// Synced assignments have a home now — the Canvas panel and the list — and it
	// is not the board. They still carry coordinates because the row needs them,
	// but a fortnight of Canvas deadlines dropped onto the table buries the
	// handful of things actually arranged there.
	let boardTasks = $derived(data.tasks.filter((t) => t.source !== CANVAS_SOURCE));

	// Read once at setup, like TaskCard and ListView do: a board left open across
	// midnight re-reads it on the next load, and re-deriving it per render would
	// not help anyway — nothing invalidates on the clock.
	const today = localDateString();

	// The robot reacts to the board rather than decorating it: something is late,
	// nothing is left, or the table is simply in use.
	let mascotMood = $derived.by(() => {
		const active = data.tasks.filter((t) => !t.done);
		if (active.some((t) => t.dueDate && t.dueDate < today)) return 'worried' as const;
		if (active.length === 0) return 'sleepy' as const;
		return 'happy' as const;
	});

	let todayCount = $derived(eventsToday(data.agenda).length);

	// The header count is a workload, not an inventory: a finished assignment is
	// still worth showing struck through, but counting it would mean the number
	// beside "Canvas" never falls as work gets done.
	let canvasOpenCount = $derived(
		data.tasks.filter((t) => t.source === CANVAS_SOURCE && !t.done).length
	);

	const VIEW_KEY = 'table:view';
	const PANEL_TODAY_KEY = 'table:panelToday';
	const PANEL_CANVAS_KEY = 'table:panelCanvas';

	// Safari in private mode throws on both of these; an uncaught throw inside an
	// $effect takes the whole page down over a remembered dropdown.
	function readSetting(key: string): string | null {
		try {
			return localStorage.getItem(key);
		} catch {
			return null;
		}
	}
	function saveSetting(key: string, value: string) {
		try {
			localStorage.setItem(key, value);
		} catch {
			// Not remembering a preference is survivable; crashing is not.
		}
	}
	/** A stored open/closed flag, falling back when nothing usable is stored. */
	function readFlag(key: string, fallback: boolean): boolean {
		const saved = readSetting(key);
		return saved === 'open' || saved === 'closed' ? saved === 'open' : fallback;
	}
	const flagValue = (open: boolean) => (open ? 'open' : 'closed');

	// Bento is the opening view for anyone who has not picked one: it reads at a
	// glance and needs no dragging to be useful. The $effect below still lets a
	// stored choice win, so this only ever decides a first visit.
	let view = $state<'blob' | 'list' | 'bento'>('bento');
	$effect(() => {
		const saved = readSetting(VIEW_KEY);
		if (saved === 'blob' || saved === 'list' || saved === 'bento') view = saved;
	});
	$effect(() => saveSetting(VIEW_KEY, view));

	// Each panel now remembers its own docked state — folding Today away no longer
	// says anything about Canvas. The narrow-screen drawers are never remembered,
	// because a drawer that reopens itself over the board on every load is a
	// nuisance, not a memory.
	let todayOpen = $state(true);
	let canvasOpen = $state(true);
	let todayDrawer = $state(false);
	let canvasDrawer = $state(false);
	$effect(() => {
		todayOpen = readFlag(PANEL_TODAY_KEY, true);
		canvasOpen = readFlag(PANEL_CANVAS_KEY, true);
	});
	$effect(() => saveSetting(PANEL_TODAY_KEY, flagValue(todayOpen)));
	$effect(() => saveSetting(PANEL_CANVAS_KEY, flagValue(canvasOpen)));

	let isMobile = $state(false);
	$effect(() => {
		const mq = window.matchMedia('(max-width: 720px)');
		const apply = () => (isMobile = mq.matches);
		apply();
		mq.addEventListener('change', apply);
		return () => mq.removeEventListener('change', apply);
	});

	// Wide enough to keep both panels docked beside the board. Two 280px panels
	// plus the row's gaps and the shell's padding leave the board ~630px here,
	// and folding either one hands back 252px. Below this they become drawers the
	// toolbar opens, so the board keeps the full width.
	let wideEnough = $state(true);
	$effect(() => {
		const mq = window.matchMedia('(min-width: 1280px)');
		const apply = () => {
			wideEnough = mq.matches;
			// A drawer left open on a phone-width window would otherwise still count
			// as open after a rotation or a resize, so the toolbar button's first
			// press would close a panel the user can already see docked.
			if (mq.matches) {
				todayDrawer = false;
				canvasDrawer = false;
			}
		};
		apply();
		mq.addEventListener('change', apply);
		return () => mq.removeEventListener('change', apply);
	});

	// Handed to each panel so its outside-click test can exclude its own button —
	// otherwise the capture listener would close the drawer on the same click
	// that reopens it, and the toggle would only ever appear to do nothing.
	let todayButtonEl = $state<HTMLButtonElement | null>(null);
	let canvasButtonEl = $state<HTMLButtonElement | null>(null);

	function openToday() {
		if (wideEnough) todayOpen = true;
		else todayDrawer = true;
	}

	function closeToday(refocus = false) {
		if (wideEnough) {
			todayOpen = false;
		} else {
			todayDrawer = false;
			if (refocus) todayButtonEl?.focus();
		}
	}

	function openCanvas() {
		if (wideEnough) canvasOpen = true;
		else canvasDrawer = true;
	}

	function closeCanvas(refocus = false) {
		if (wideEnough) {
			canvasOpen = false;
		} else {
			canvasDrawer = false;
			if (refocus) canvasButtonEl?.focus();
		}
	}
</script>

<div class="page-toolbar">
	<ViewSwitcher
		bind:value={view}
		options={[
			{ value: 'blob', label: 'Table' },
			{ value: 'list', label: 'List' },
			{ value: 'bento', label: 'Bento' }
		]}
	/>
	{#if !wideEnough}
		<button
			type="button"
			class="btn btn-ghost panel-toggle"
			bind:this={todayButtonEl}
			aria-expanded={todayDrawer}
			aria-controls="side-panel-today"
			onclick={() => (todayDrawer = !todayDrawer)}
		>
			<span aria-hidden="true">🗓</span> Today
		</button>
		<button
			type="button"
			class="btn btn-ghost panel-toggle"
			bind:this={canvasButtonEl}
			aria-expanded={canvasDrawer}
			aria-controls="side-panel-canvas"
			onclick={() => (canvasDrawer = !canvasDrawer)}
		>
			<span aria-hidden="true">📚</span> Canvas
		</button>
	{/if}
	{#if view === 'bento'}
		<!-- Bento tiles the whole board edge to edge with 8px gutters, so a corner
		     robot lands on the bottom-right box and its + button. Up here it keeps
		     the same reactive mood with nothing to collide with. -->
		<div class="toolbar-mascot" aria-hidden="true"><Mascot mood={mascotMood} compact /></div>
	{/if}
</div>

<div class="board-row">
	<SidePanel
		side="left"
		id="side-panel-today"
		label="Today"
		mode={wideEnough ? 'docked' : 'overlay'}
		open={wideEnough ? todayOpen : todayDrawer}
		count={todayCount > 0 ? todayCount : null}
		anchor={todayButtonEl}
		onopen={openToday}
		onclose={closeToday}
	>
		<TodayPanel agenda={data.agenda} gcalConfigured={data.gcalConfigured} />
	</SidePanel>

	<div class="board-main">
		{#if view === 'list'}
			<ListView tasks={data.tasks} zones={data.zones} />
		{:else if view === 'bento'}
			<BentoView tasks={boardTasks} zones={data.zones} />
		{:else if isMobile}
			<MobileColumns tasks={boardTasks} zones={data.zones} />
		{:else}
			<BlobView tasks={boardTasks} zones={data.zones} />
		{/if}
		{#if view !== 'bento'}
			<div class="board-mascot"><Mascot mood={mascotMood} /></div>
		{/if}
	</div>

	<SidePanel
		side="right"
		id="side-panel-canvas"
		label="Canvas"
		mode={wideEnough ? 'docked' : 'overlay'}
		open={wideEnough ? canvasOpen : canvasDrawer}
		count={data.lmsConfigured ? `${canvasOpenCount} open` : null}
		anchor={canvasButtonEl}
		onopen={openCanvas}
		onclose={closeCanvas}
	>
		{#snippet icon()}
			<!-- The mark is white, which is invisible on this palette in either
			     theme, so it rides on a Canvas-red chip rather than bare. The
			     heading already says "Canvas", so the image is decorative. -->
			<span class="canvas-chip">
				<img src={canvasLogo} alt="" width="14" height="14" />
			</span>
		{/snippet}
		<CanvasPanel tasks={data.tasks} lmsConfigured={data.lmsConfigured} />
	</SidePanel>
</div>

<style>
	.page-toolbar {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		margin-bottom: 0.85rem;
		flex-shrink: 0;
	}

	.panel-toggle {
		padding: 0.32rem 0.85rem;
		font-size: 0.82rem;
		font-weight: 600;
	}

	/* Canvas red, left at full chroma: it is a brand mark, and muting it into the
	   warm palette would only make it read as a generic red square. Fixed px
	   rather than em — it should track the 14px logo inside it, not the heading. */
	.canvas-chip {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 20px;
		height: 20px;
		/* Not --radius-s: 10px on a 20px box is a full circle, and a red disc
		   directly behind a circular mark reads as a halo. */
		border-radius: 6px;
		background: #d64027;
	}

	/* The bento stand-in for .board-mascot. margin-left: auto parks it at the far
	   right of the row; align-items: center on .page-toolbar already centers it
	   against the taller controls, and one 0.7rem line is shorter than they are,
	   so the row's height does not move. */
	.toolbar-mascot {
		margin-left: auto;
		pointer-events: none;
		opacity: 0.5;
	}

	.board-row {
		display: flex;
		gap: 1.25rem;
		flex: 1;
		min-height: 0;
	}

	/* BlobView's .canvas sizes itself with flex: 1 / min-height: 0, so every
	   wrapper between <main> and it has to keep that chain intact. */
	.board-main {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		min-height: 0;
		/* The anchor for .board-mascot. Inside this column rather than the row, so
		   the robot never drifts under either side panel. */
		position: relative;
	}

	/* A companion, not a control: it sits over the board's bottom-right corner and
	   passes every click straight through to the canvas beneath it. Cards carry
	   z-indexes up to 900 and the composer 950, so clearing those is what keeps it
	   from being buried; 960 still leaves the panel drawers (980), topbar (999) and
	   task modal (1000) above it. */
	.board-mascot {
		position: absolute;
		right: 0.25rem;
		bottom: 0.25rem;
		z-index: 960;
		pointer-events: none;
		opacity: 0.5;
	}

	/* Phones need the space more than they need the company. */
	@media (max-width: 720px) {
		.board-mascot {
			display: none;
		}
	}
</style>
