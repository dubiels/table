<script lang="ts">
	import AddPersonDialog from '$lib/components/people/AddPersonDialog.svelte';
	import FlagFilterBar from '$lib/components/people/FlagFilterBar.svelte';
	import PersonGrid from '$lib/components/people/PersonGrid.svelte';
	import PersonDetailModal from '$lib/components/people/PersonDetailModal.svelte';
	import { filterPeople } from '$lib/people/search';
	import { localDateString } from '$lib/date';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	let query = $state('');
	let selectedFlagIds = $state<string[]>([]);
	let includeArchived = $state(false);
	let openPersonId = $state<string | null>(null);
	let adding = $state(false);
	// Stamped when the dialog opens rather than at render: reading the clock
	// during render makes the server and client disagree, and this only has to be
	// right at the moment you press Add.
	let todayValue = $state('');

	function openAdd() {
		todayValue = localDateString();
		adding = true;
	}
	// Re-read from `data` rather than captured on click, so a save re-render shows
	// the saved values instead of the ones the modal opened with.
	let openPerson = $derived(data.people.find((p) => p.id === openPersonId) ?? null);

	// A flag deleted while it's an active filter would otherwise leave its id
	// stranded in `selectedFlagIds` — the chip that could clear it is gone, the
	// grid goes empty, and "All" doesn't look selected because the raw array
	// isn't. A $derived view (rather than an $effect writing back into
	// `selectedFlagIds`) keeps this a pure read of state + props: it recomputes
	// whenever `data.flags` changes after a delete, and there's nothing to
	// feed back into itself, so there's no risk of it re-triggering its own
	// recomputation.
	let activeFlagIds = $derived(
		selectedFlagIds.filter((id) => data.flags.some((flag) => flag.id === id))
	);

	let visible = $derived(
		filterPeople(data.people, { query, flagIds: activeFlagIds, includeArchived })
	);

	// Counts describe the whole book, not the current result set — a chip reading
	// "SF · 0" because of an unrelated search term would look like a bug.
	let counts = $derived.by(() => {
		const tally: Record<string, number> = {};
		for (const person of data.people) {
			if (person.archivedAt && !includeArchived) continue;
			for (const id of person.flagIds) tally[id] = (tally[id] ?? 0) + 1;
		}
		return tally;
	});

	let total = $derived(data.people.filter((p) => includeArchived || !p.archivedAt).length);

	function toggleFlag(id: string) {
		// The "All" chip posts an empty id and means "clear the filters".
		if (!id) {
			selectedFlagIds = [];
			return;
		}
		selectedFlagIds = selectedFlagIds.includes(id)
			? selectedFlagIds.filter((f) => f !== id)
			: [...selectedFlagIds, id];
	}
</script>

<svelte:head><title>Dinner Table</title></svelte:head>

<section class="dinner">
	<header>
		<h1>Dinner Table</h1>
		<input
			bind:value={query}
			placeholder="Search people, notes, places…"
			aria-label="Search people"
			class="search"
		/>
		<button type="button" class="add" onclick={openAdd}>+ Add person</button>
	</header>

	<FlagFilterBar
		flags={data.flags}
		{counts}
		selected={activeFlagIds}
		{includeArchived}
		{total}
		onToggle={toggleFlag}
		onToggleArchived={() => (includeArchived = !includeArchived)}
	/>

	<PersonGrid
		people={visible}
		flags={data.flags}
		hasAnyPeople={data.people.length > 0}
		onopen={(id) => (openPersonId = id)}
	/>

	{#if adding}
		<AddPersonDialog flags={data.flags} today={todayValue} onclose={() => (adding = false)} />
	{/if}

	{#if openPerson}
		{#key openPerson.id}
			<PersonDetailModal
				person={openPerson}
				flags={data.flags}
				onclose={() => (openPersonId = null)}
			/>
		{/key}
	{/if}
</section>

<style>
	.dinner {
		width: 100%;
		max-width: 1500px;
		margin: 0 auto;
	}
	header {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.75rem;
		margin-bottom: 1rem;
	}
	h1 {
		margin: 0;
		font-size: 1.1rem;
		font-weight: 700;
	}
	.search {
		flex: 1 1 16rem;
		min-width: 0;
		padding: 0.45rem 0.65rem;
		border: 1px solid var(--border, #e2dace);
		border-radius: 7px;
		background: var(--surface, #fff);
		font: inherit;
		color: inherit;
	}
	.add {
		padding: 0.45rem 0.9rem;
		border: none;
		border-radius: 7px;
		background: var(--accent);
		color: var(--accent-ink);
		font: inherit;
		font-weight: 600;
		white-space: nowrap;
		cursor: pointer;
	}
</style>
