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
		form,
		onToggle,
		onToggleArchived
	}: {
		flags: FlagView[];
		/** Flag id to number of matching people, for the chip labels. */
		counts: Record<string, number>;
		selected: string[];
		includeArchived: boolean;
		total: number;
		/** The page's action result, so a failed rename can be shown in the open menu. */
		form: { error?: string } | null;
		onToggle: (id: string) => void;
		onToggleArchived: () => void;
	} = $props();

	// Which flag's ⋯ menu is open. One at a time, keyed by id.
	let editing = $state<string | null>(null);
	let menuEl = $state<HTMLDivElement | undefined>();
	// The ⋯ button that opened the current menu, so Escape can return focus to it.
	let triggerEl = $state<HTMLButtonElement | undefined>();

	function toggleMenu(id: string, trigger: HTMLButtonElement) {
		if (editing === id) {
			editing = null;
		} else {
			editing = id;
			triggerEl = trigger;
		}
	}

	function closeMenu() {
		editing = null;
	}

	function onWindowPointerdown(e: PointerEvent) {
		if (editing === null) return;
		const target = e.target as Node;
		// The trigger is excluded so its own click can close the menu itself,
		// instead of this closing it and the click reopening it.
		if (menuEl && !menuEl.contains(target) && !(triggerEl && triggerEl.contains(target))) {
			closeMenu();
		}
	}

	function onWindowKeydown(e: KeyboardEvent) {
		if (editing === null) return;
		if (e.key !== 'Escape') return;
		closeMenu();
		triggerEl?.focus();
	}
</script>

<svelte:window onpointerdown={onWindowPointerdown} onkeydown={onWindowKeydown} />

<div class="bar">
	<button
		type="button"
		class="chip all"
		class:on={selected.length === 0}
		aria-pressed={selected.length === 0}
		onclick={() => onToggle('')}
	>
		All · {total}
	</button>

	{#each flags as flag (flag.id)}
		{@const vars = flagColorVars(flag.color)}
		<span class="chip-wrap">
			<button
				type="button"
				class="chip"
				class:on={selected.includes(flag.id)}
				aria-pressed={selected.includes(flag.id)}
				style="background:{vars.fill};border-color:{vars.border}"
				onclick={() => onToggle(flag.id)}
			>
				{flag.name} · {counts[flag.id] ?? 0}
			</button>
			<button
				type="button"
				class="more"
				aria-label="Edit {flag.name}"
				aria-haspopup="true"
				aria-expanded={editing === flag.id}
				onclick={(e) => toggleMenu(flag.id, e.currentTarget)}>⋯</button
			>

			{#if editing === flag.id}
				<div class="menu" bind:this={menuEl}>
					<form
						method="POST"
						action="?/updateFlag"
						use:enhance={() => async ({ result, update }) => {
							await update();
							// A failed rename keeps the menu open so the error is visible
							// and the name is still there to correct.
							if (result.type !== 'failure') editing = null;
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
					{#if form?.error}
						<p class="status-error" role="alert">{form.error}</p>
					{/if}
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
		color: var(--danger);
		cursor: pointer;
		white-space: nowrap;
	}
	.status-error {
		margin: 0;
		font-size: 0.78rem;
		color: var(--danger);
	}
</style>
