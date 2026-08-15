<script lang="ts">
	import { enhance } from '$app/forms';
	import { flagColorVars } from '$lib/people/colors';
	import { toast } from '$lib/toast.svelte';
	import PersonFields from './PersonFields.svelte';
	import type { FlagView } from '$lib/people/types';

	let { flags, today, onclose }: { flags: FlagView[]; today: string; onclose: () => void } =
		$props();

	let formEl = $state<HTMLFormElement | null>(null);
	let saving = $state(false);
	let addError = $state<string | null>(null);
	let selectedFlagIds = $state<string[]>([]);

	function toggleFlag(id: string) {
		selectedFlagIds = selectedFlagIds.includes(id)
			? selectedFlagIds.filter((f) => f !== id)
			: [...selectedFlagIds, id];
	}

	// Focus the name field on open, so "type a name, press Enter" stays a
	// three-second path even with the whole form on screen.
	$effect(() => {
		formEl?.querySelector<HTMLInputElement>('input[name="name"]')?.focus();
	});

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') onclose();
	}
</script>

<svelte:window onkeydown={handleKeydown} />

<div class="backdrop" role="presentation" onclick={onclose}></div>

<div class="modal" role="dialog" aria-modal="true" aria-label="Add a person">
	<header>
		<h2>Add a person</h2>
		<button type="button" class="close" aria-label="Close" onclick={onclose}>✕</button>
	</header>

	<form
		bind:this={formEl}
		method="POST"
		action="?/createPerson"
		use:enhance={() => {
			saving = true;
			return async ({ result, update }) => {
				saving = false;
				// Close BEFORE awaiting the refresh. Closing afterwards leaves the
				// dialog on screen for the length of the round trip still holding
				// what was typed, which reads as a second, duplicate add waiting to
				// be submitted. Nothing below this touches component state, so
				// unmounting here is safe.
				if (result.type === 'success') {
					onclose();
					await update();
					toast('Added', 'success');
					return;
				}
				await update();
				// Enumerated rather than a bare else: ActionResult also carries
				// `redirect` and `error`, and neither of those added anyone.
				if (result.type === 'failure') {
					addError =
						(result.data as { error?: string } | undefined)?.error ?? 'Something went wrong.';
				}
			};
		}}
	>
		<PersonFields
			values={{ metOn: today, lastSpokeAt: today }}
			errorId="add-error"
			error={addError}
			linkDates
			detailsOpen
		/>

		<div class="flags wide">
			<span>Flags</span>
			<div class="chips">
				{#each flags as flag (flag.id)}
					{@const vars = flagColorVars(flag.color)}
					<button
						type="button"
						class="chip"
						class:on={selectedFlagIds.includes(flag.id)}
						style="background:{vars.fill};border-color:{vars.border}"
						aria-pressed={selectedFlagIds.includes(flag.id)}
						onclick={() => toggleFlag(flag.id)}
					>
						{flag.name}
					</button>
				{/each}
				<input
					class="new-flag"
					name="newFlagName"
					placeholder="+ new flag"
					autocomplete="off"
					aria-label="Create and attach a new flag"
				/>
			</div>
		</div>

		<!-- Repeated fields rather than a joined string, so the action can read them
		     with getAll() and never has to parse a delimiter out of a flag name. -->
		{#each selectedFlagIds as id (id)}
			<input type="hidden" name="flagIds" value={id} />
		{/each}

		<div class="actions">
			<button type="button" class="cancel" onclick={onclose}>Cancel</button>
			<button type="submit" class="save" disabled={saving}
				>{saving ? 'Adding…' : 'Add person'}</button
			>
		</div>
	</form>
</div>

<style>
	.backdrop {
		position: fixed;
		inset: 0;
		/* Same band as the detail modal: TopBar is sticky at 999 and is a sibling
		   of <main> in a parent that creates no stacking context, so anything
		   under ~1000 loses to it. Toasts sit at 2000, deliberately above this. */
		z-index: 1000;
		background: var(--overlay);
	}
	.modal {
		position: fixed;
		z-index: 1001;
		inset: 4vh 50% auto auto;
		transform: translateX(50%);
		width: min(860px, 94vw);
		max-height: 92vh;
		overflow-y: auto;
		padding: 1.1rem 1.25rem;
		border: 1px solid var(--border);
		border-radius: var(--radius-l);
		background: var(--surface);
		box-shadow: var(--shadow-raised);
	}
	header {
		display: flex;
		align-items: center;
		margin-bottom: 0.75rem;
	}
	h2 {
		margin: 0;
		font-size: 1.05rem;
	}
	.close {
		margin-left: auto;
		border: none;
		background: none;
		font: inherit;
		color: var(--muted);
		cursor: pointer;
	}
	form {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 0.6rem;
	}
	.flags {
		display: flex;
		flex-direction: column;
		gap: 0.2rem;
		font-size: 0.72rem;
		color: var(--muted);
	}
	.wide {
		grid-column: 1 / -1;
	}
	.chips {
		display: flex;
		flex-wrap: wrap;
		gap: 0.25rem;
		align-items: center;
	}
	.chip {
		padding: 0.15rem 0.5rem;
		border: 1px solid transparent;
		border-radius: 999px;
		font: inherit;
		font-size: 0.7rem;
		color: inherit;
		cursor: pointer;
		opacity: 0.55;
	}
	.chip.on {
		opacity: 1;
		outline: 2px solid var(--accent);
		outline-offset: 1px;
	}
	.new-flag {
		width: 7rem;
		padding: 0.25rem 0.45rem;
		border: 1px solid var(--border);
		border-radius: var(--radius-s);
		background: var(--surface);
		font: inherit;
		font-size: 0.7rem;
		color: inherit;
	}
	.actions {
		grid-column: 1 / -1;
		display: flex;
		align-items: center;
		justify-content: flex-end;
		gap: 0.6rem;
		margin-top: 0.2rem;
	}
	.cancel {
		border: none;
		background: none;
		padding: 0.4rem 0.5rem;
		font: inherit;
		font-size: 0.82rem;
		color: var(--muted);
		cursor: pointer;
	}
	.save {
		padding: 0.4rem 1rem;
		border: none;
		border-radius: var(--radius-s);
		background: var(--accent);
		color: var(--accent-ink);
		font: inherit;
		font-weight: 600;
		cursor: pointer;
	}
	.save:disabled {
		opacity: 0.6;
		cursor: default;
	}
	@media (max-width: 640px) {
		form {
			grid-template-columns: 1fr;
		}
	}
</style>
