<script lang="ts">
	import { enhance } from '$app/forms';
	import { flagColorVars, FLAG_COLOR_KEYS } from '$lib/people/colors';
	import type { FlagView } from '$lib/people/types';

	let {
		flags,
		counts,
		selected,
		includeArchived,
		total,
		onToggle,
		onToggleArchived
	}: {
		flags: FlagView[];
		/** Flag id to number of matching people, for the chip labels. */
		counts: Record<string, number>;
		selected: string[];
		includeArchived: boolean;
		total: number;
		onToggle: (id: string) => void;
		onToggleArchived: () => void;
	} = $props();

	// Which flag's ⋯ menu is open. One at a time, keyed by id.
	let editing = $state<string | null>(null);
</script>

<div class="bar">
	<button type="button" class="chip all" class:on={selected.length === 0} onclick={() => onToggle('')}>
		All · {total}
	</button>

	{#each flags as flag (flag.id)}
		{@const vars = flagColorVars(flag.color)}
		<span class="chip-wrap">
			<button
				type="button"
				class="chip"
				class:on={selected.includes(flag.id)}
				style="background:{vars.fill};border-color:{vars.border}"
				onclick={() => onToggle(flag.id)}
			>
				{flag.name} · {counts[flag.id] ?? 0}
			</button>
			<button
				type="button"
				class="more"
				aria-label="Edit {flag.name}"
				onclick={() => (editing = editing === flag.id ? null : flag.id)}>⋯</button
			>

			{#if editing === flag.id}
				<div class="menu">
					<form
						method="POST"
						action="?/updateFlag"
						use:enhance={() => async ({ update }) => {
							await update();
							editing = null;
						}}
					>
						<input type="hidden" name="id" value={flag.id} />
						<input name="name" value={flag.name} aria-label="Flag name" />
						<select name="color" value={flag.color} aria-label="Flag colour">
							{#each FLAG_COLOR_KEYS as key (key)}
								<option value={key}>{key}</option>
							{/each}
						</select>
						<button type="submit">Save</button>
					</form>
					<form
						method="POST"
						action="?/deleteFlag"
						use:enhance={() => async ({ update }) => {
							await update();
							editing = null;
						}}
					>
						<input type="hidden" name="id" value={flag.id} />
						<!-- Deleting a flag is not deleting people; say so, because the
						     ⋯ menu sits on a chip that appears on their cards. -->
						<button type="submit" class="danger">Delete flag (people are kept)</button>
					</form>
				</div>
			{/if}
		</span>
	{/each}

	<button type="button" class="chip archived-toggle" class:on={includeArchived} onclick={onToggleArchived}>
		{includeArchived ? 'Hide archived' : 'Show archived'}
	</button>
</div>

<style>
	.bar {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.35rem;
		margin-bottom: 1rem;
	}
	.chip-wrap {
		position: relative;
		display: inline-flex;
		align-items: center;
	}
	.chip {
		padding: 0.2rem 0.6rem;
		border: 1px solid var(--border, #e2dace);
		border-radius: 999px;
		background: var(--surface, #fff);
		font: inherit;
		font-size: 0.78rem;
		color: inherit;
		cursor: pointer;
	}
	.chip.on {
		outline: 2px solid var(--accent, #6f7f5f);
		outline-offset: 1px;
	}
	.more {
		border: none;
		background: none;
		padding: 0 0.2rem;
		font: inherit;
		color: var(--muted, #93897d);
		cursor: pointer;
	}
	.menu {
		position: absolute;
		top: 100%;
		left: 0;
		z-index: 20;
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
		margin-top: 0.3rem;
		padding: 0.6rem;
		border: 1px solid var(--border, #e2dace);
		border-radius: 8px;
		background: var(--surface, #fff);
		box-shadow: 0 10px 28px rgba(60, 50, 35, 0.18);
	}
	.menu form {
		display: flex;
		gap: 0.3rem;
	}
	.menu input,
	.menu select {
		padding: 0.25rem 0.4rem;
		border: 1px solid var(--border, #e2dace);
		border-radius: 5px;
		font: inherit;
		font-size: 0.8rem;
	}
	.danger {
		border: none;
		background: none;
		padding: 0;
		font: inherit;
		font-size: 0.78rem;
		color: #a3462f;
		cursor: pointer;
		white-space: nowrap;
	}
</style>
