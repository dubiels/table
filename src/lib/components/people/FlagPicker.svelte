<script lang="ts">
	import { enhance } from '$app/forms';
	import { flagColorVars } from '$lib/people/colors';
	import type { FlagView } from '$lib/people/types';

	let {
		personId,
		flags,
		attachedIds
	}: { personId: string; flags: FlagView[]; attachedIds: string[] } = $props();

	let newName = $state('');
	let matches = $derived(
		flags.filter((f) => f.name.toLowerCase().includes(newName.trim().toLowerCase()))
	);
	let exactMatch = $derived(
		flags.some((f) => f.name.toLowerCase() === newName.trim().toLowerCase())
	);
</script>

<!-- Flags apply immediately rather than on Save: a flag is a relation, not a
     field, this is how CategoryMenu already behaves, and it spares diffing a set
     on submit. -->
<div class="picker">
	<div class="attached">
		{#each flags.filter((f) => attachedIds.includes(f.id)) as flag (flag.id)}
			{@const vars = flagColorVars(flag.color)}
			<form method="POST" action="?/detachFlag" use:enhance>
				<input type="hidden" name="personId" value={personId} />
				<input type="hidden" name="flagId" value={flag.id} />
				<button
					type="submit"
					class="chip"
					style="background:{vars.fill};border-color:{vars.border}"
					title="Remove {flag.name}"
				>
					{flag.name} ✕
				</button>
			</form>
		{/each}
	</div>

	<input bind:value={newName} placeholder="Add a flag…" aria-label="Add a flag" class="input" />

	{#if newName.trim()}
		<div class="suggestions">
			{#each matches.filter((f) => !attachedIds.includes(f.id)) as flag (flag.id)}
				<form
					method="POST"
					action="?/attachFlag"
					use:enhance={() =>
						async ({ update }) => {
							await update();
							newName = '';
						}}
				>
					<input type="hidden" name="personId" value={personId} />
					<input type="hidden" name="flagId" value={flag.id} />
					<button type="submit" class="suggestion">{flag.name}</button>
				</form>
			{/each}

			{#if !exactMatch}
				<!-- Creating from here attaches in the same round trip, so a new flag
				     lands on the person who prompted it without a second submit. -->
				<form
					method="POST"
					action="?/createFlag"
					use:enhance={() =>
						async ({ update }) => {
							await update();
							newName = '';
						}}
				>
					<input type="hidden" name="personId" value={personId} />
					<input type="hidden" name="name" value={newName.trim()} />
					<input type="hidden" name="color" value="sage" />
					<button type="submit" class="suggestion create">Create “{newName.trim()}”</button>
				</form>
			{/if}
		</div>
	{/if}
</div>

<style>
	.picker {
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
	}
	.attached {
		display: flex;
		flex-wrap: wrap;
		gap: 0.25rem;
	}
	.chip {
		padding: 0.15rem 0.5rem;
		border: 1px solid transparent;
		border-radius: 999px;
		font: inherit;
		font-size: 0.7rem;
		cursor: pointer;
	}
	.input {
		padding: 0.3rem 0.5rem;
		border: 1px solid var(--border, #e2dace);
		border-radius: 6px;
		font: inherit;
		font-size: 0.82rem;
	}
	.suggestions {
		display: flex;
		flex-wrap: wrap;
		gap: 0.25rem;
	}
	.suggestion {
		padding: 0.15rem 0.5rem;
		border: 1px dashed var(--border, #d8cfc0);
		border-radius: 999px;
		background: none;
		font: inherit;
		font-size: 0.72rem;
		color: inherit;
		cursor: pointer;
	}
	.create {
		color: var(--accent, #6f7f5f);
	}
</style>
