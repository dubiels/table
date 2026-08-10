<script lang="ts">
	import BlobView from '$lib/components/BlobView.svelte';
	import MobileColumns from '$lib/components/MobileColumns.svelte';
	import ListView from '$lib/components/ListView.svelte';
	import BentoView from '$lib/components/BentoView.svelte';
	import ViewSwitcher from '$lib/components/ViewSwitcher.svelte';
	import Mascot from '$lib/components/Mascot.svelte';
	import SidePanel from '$lib/components/SidePanel.svelte';
	import { localDateString, CANVAS_SOURCE } from '$lib/listView';
	let { data } = $props();

	// Synced assignments have a home now — the panel's Canvas tab and the list —
	// and it is not the board. They still carry coordinates because the row needs
	// them, but a fortnight of Canvas deadlines dropped onto the table buries the
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

	const VIEW_KEY = 'table:view';
	const PANEL_KEY = 'table:panel';
	const PANEL_TAB_KEY = 'table:panelTab';

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

	// Bento is the opening view for anyone who has not picked one: it reads at a
	// glance and needs no dragging to be useful. The $effect below still lets a
	// stored choice win, so this only ever decides a first visit.
	let view = $state<'blob' | 'list' | 'bento'>('bento');
	$effect(() => {
		const saved = readSetting(VIEW_KEY);
		if (saved === 'blob' || saved === 'list' || saved === 'bento') view = saved;
	});
	$effect(() => saveSetting(VIEW_KEY, view));

	// The docked panel is open until someone folds it away; the narrow-screen
	// drawer is never remembered, because a drawer that reopens itself over the
	// board on every load is a nuisance rather than a memory.
	let panelOpen = $state(true);
	let panelTab = $state<'today' | 'canvas'>('today');
	let drawerOpen = $state(false);
	$effect(() => {
		const saved = readSetting(PANEL_KEY);
		if (saved === 'open' || saved === 'closed') panelOpen = saved === 'open';
		const savedTab = readSetting(PANEL_TAB_KEY);
		if (savedTab === 'today' || savedTab === 'canvas') panelTab = savedTab;
	});
	$effect(() => saveSetting(PANEL_KEY, panelOpen ? 'open' : 'closed'));
	$effect(() => saveSetting(PANEL_TAB_KEY, panelTab));

	let isMobile = $state(false);
	$effect(() => {
		const mq = window.matchMedia('(max-width: 720px)');
		const apply = () => (isMobile = mq.matches);
		apply();
		mq.addEventListener('change', apply);
		return () => mq.removeEventListener('change', apply);
	});

	// Wide enough to keep the panel docked beside the board. Below this it turns
	// into a drawer the toolbar button opens, so the board keeps the full width.
	let wideEnough = $state(true);
	$effect(() => {
		const mq = window.matchMedia('(min-width: 1101px)');
		const apply = () => (wideEnough = mq.matches);
		apply();
		mq.addEventListener('change', apply);
		return () => mq.removeEventListener('change', apply);
	});

	// Handed to the panel so its outside-click test can exclude this button —
	// otherwise the capture listener would close the drawer on the same click
	// that reopens it, and the toggle would only ever appear to do nothing.
	let panelButtonEl = $state<HTMLButtonElement | null>(null);

	function openPanel() {
		if (wideEnough) panelOpen = true;
		else drawerOpen = true;
	}

	function closePanel(refocus = false) {
		if (wideEnough) {
			panelOpen = false;
		} else {
			drawerOpen = false;
			if (refocus) panelButtonEl?.focus();
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
			bind:this={panelButtonEl}
			aria-expanded={drawerOpen}
			aria-controls="side-panel"
			onclick={() => (drawerOpen = !drawerOpen)}
		>
			<span aria-hidden="true">🗓</span> Panel
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
		mode={wideEnough ? 'docked' : 'overlay'}
		open={wideEnough ? panelOpen : drawerOpen}
		bind:tab={panelTab}
		agenda={data.agenda}
		gcalConfigured={data.gcalConfigured}
		lmsConfigured={data.lmsConfigured}
		tasks={data.tasks}
		anchor={panelButtonEl}
		onopen={openPanel}
		onclose={closePanel}
	/>
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
		   the robot never drifts under the side panel. */
		position: relative;
	}

	/* A companion, not a control: it sits over the board's bottom-right corner and
	   passes every click straight through to the canvas beneath it. Cards carry
	   z-indexes up to 900 and the composer 950, so clearing those is what keeps it
	   from being buried; 960 still leaves the panel drawer (980), topbar (999) and
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
