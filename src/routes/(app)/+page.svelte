<script lang="ts">
	import BlobView from '$lib/components/BlobView.svelte';
	import MobileColumns from '$lib/components/MobileColumns.svelte';
	import ListView from '$lib/components/ListView.svelte';
	import BentoView from '$lib/components/BentoView.svelte';
	import ViewSwitcher from '$lib/components/ViewSwitcher.svelte';
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

{#if view === 'list'}
	<ListView tasks={data.tasks} zones={data.zones} />
{:else if view === 'bento'}
	<BentoView tasks={data.tasks} zones={data.zones} />
{:else if isMobile}
	<MobileColumns tasks={data.tasks} zones={data.zones} />
{:else}
	<BlobView tasks={data.tasks} zones={data.zones} />
{/if}

<style>
	.page-toolbar {
		display: flex;
		align-items: center;
		margin-bottom: 0.85rem;
		flex-shrink: 0;
	}
</style>
