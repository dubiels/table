<script lang="ts">
	import BlobView from '$lib/components/BlobView.svelte';
	import MobileColumns from '$lib/components/MobileColumns.svelte';
	import ListView from '$lib/components/ListView.svelte';
	import BentoView from '$lib/components/BentoView.svelte';
	import ViewSwitcher from '$lib/components/ViewSwitcher.svelte';
	import AgendaRail from '$lib/components/AgendaRail.svelte';
	let { data } = $props();

	const VIEW_KEY = 'table:view';
	let view = $state<'blob' | 'list' | 'bento'>('blob');
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
</div>

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
		margin-bottom: 0.85rem;
		flex-shrink: 0;
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
