<script lang="ts">
	import BlobView from '$lib/components/BlobView.svelte';
	import MobileColumns from '$lib/components/MobileColumns.svelte';
	import ListView from '$lib/components/ListView.svelte';
	import BentoView from '$lib/components/BentoView.svelte';
	import ViewSwitcher from '$lib/components/ViewSwitcher.svelte';
	import AgendaRail from '$lib/components/AgendaRail.svelte';
	import Mascot from '$lib/components/Mascot.svelte';
	import LmsPanel from '$lib/components/LmsPanel.svelte';
	import { localDateString } from '$lib/listView';
	let { data } = $props();

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
	// Bento is the opening view for anyone who has not picked one: it reads at a
	// glance and needs no dragging to be useful. The $effect below still lets a
	// stored choice win, so this only ever decides a first visit.
	let view = $state<'blob' | 'list' | 'bento'>('bento');
	// Safari in private mode throws on both of these; an uncaught throw inside an
	// $effect takes the whole page down over a remembered dropdown.
	function readSavedView(): string | null {
		try {
			return localStorage.getItem(VIEW_KEY);
		} catch {
			return null;
		}
	}
	$effect(() => {
		const saved = readSavedView();
		if (saved === 'blob' || saved === 'list' || saved === 'bento') view = saved;
	});
	$effect(() => {
		try {
			localStorage.setItem(VIEW_KEY, view);
		} catch {
			// Not remembering the view is survivable; crashing is not.
		}
	});

	let isMobile = $state(false);
	$effect(() => {
		const mq = window.matchMedia('(max-width: 720px)');
		const apply = () => (isMobile = mq.matches);
		apply();
		mq.addEventListener('change', apply);
		return () => mq.removeEventListener('change', apply);
	});

	let lmsOpen = $state(false);
	// Handed to the panel so its outside-click test can exclude this button —
	// otherwise the capture listener would close the drawer on the same click
	// that reopens it, and the toggle would only ever appear to do nothing.
	let lmsButtonEl = $state<HTMLButtonElement | null>(null);
	function closeLms(refocus = false) {
		lmsOpen = false;
		if (refocus) lmsButtonEl?.focus();
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
	<button
		type="button"
		class="btn btn-ghost lms-toggle"
		bind:this={lmsButtonEl}
		aria-expanded={lmsOpen}
		aria-controls="lms-panel"
		onclick={() => (lmsOpen = !lmsOpen)}
	>
		<span aria-hidden="true">🎓</span> Canvas
	</button>
</div>

<LmsPanel
	open={lmsOpen}
	configured={data.lmsConfigured}
	tasks={data.tasks}
	zones={data.zones}
	anchor={lmsButtonEl}
	onclose={closeLms}
/>

<div class="board-row">
	<div class="board-main">
		{#if view === 'list'}
			<ListView tasks={data.tasks} zones={data.zones} />
		{:else if view === 'bento'}
			<BentoView tasks={data.tasks} zones={data.zones} />
		{:else if isMobile}
			<MobileColumns tasks={data.tasks} zones={data.zones} />
		{:else}
			<BlobView tasks={data.tasks} zones={data.zones} />
		{/if}
		<div class="board-mascot"><Mascot mood={mascotMood} /></div>
	</div>
	{#if data.agenda.length > 0}
		<aside class="agenda-rail">
			<AgendaRail events={data.agenda} />
		</aside>
	{/if}
</div>

<style>
	.page-toolbar {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		margin-bottom: 0.85rem;
		flex-shrink: 0;
	}

	.lms-toggle {
		padding: 0.32rem 0.85rem;
		font-size: 0.82rem;
		font-weight: 600;
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
		   the robot never drifts under the agenda rail. */
		position: relative;
	}

	/* A companion, not a control: it sits over the board's bottom-right corner and
	   passes every click straight through to the canvas beneath it. Cards carry
	   z-indexes up to 900 and the composer 950, so clearing those is what keeps it
	   from being buried; 960 still leaves the LMS drawer (980), topbar (999) and
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

	.agenda-rail {
		width: 250px;
		flex-shrink: 0;
		overflow-y: auto;
	}

	/* The agenda is a desk-monitor affordance; narrow screens get the board only. */
	@media (max-width: 1100px) {
		.agenda-rail {
			display: none;
		}
	}
</style>
