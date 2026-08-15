<script lang="ts">
	import { deserialize, enhance } from '$app/forms';
	import { invalidateAll } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { toast } from '$lib/toast.svelte';
	import FlagPicker from './FlagPicker.svelte';
	import PersonFields from './PersonFields.svelte';
	import PersonTasks from './PersonTasks.svelte';
	import LinkedinCard from './LinkedinCard.svelte';
	import type { PersonTask } from './PersonTasks.svelte';
	import type { PersonView, FlagView } from '$lib/people/types';

	let {
		person,
		flags,
		tasks = [],
		onclose
	}: {
		person: PersonView;
		flags: FlagView[];
		tasks?: PersonTask[];
		onclose: () => void;
	} = $props();

	// The modal is remounted per person — there is no in-place "next person"
	// navigation — so props are read directly and never re-synced.
	let archiving = $state(false);
	// A failed save's message, shown next to the Name field — the field that
	// usually needs correcting — rather than only as a toast.
	let saveError = $state<string | null>(null);

	/**
	 * Undo, from the toast raised after archiving.
	 *
	 * It posts to the action endpoint by hand rather than through `use:enhance`,
	 * because by the time the toast is clicked the modal — and its form — has
	 * already closed. The header is what makes SvelteKit answer with an action
	 * result instead of a redirect.
	 */
	async function restore(id: string) {
		const body = new FormData();
		body.set('id', id);
		// Absolute to the Dinner Table route rather than relative: '?/restorePerson'
		// resolves against the *current* URL, and by the time the toast is
		// clicked the user may well have navigated away from /dinner already.
		const res = await fetch(`${resolve('/dinner')}?/restorePerson`, {
			method: 'POST',
			body,
			headers: { accept: 'application/json', 'x-sveltekit-action': 'true' }
		});
		// A bare res.ok check is not enough: an expired session comes back as
		// HTTP 200 carrying {type:'redirect'} — the action header suppresses the
		// real redirect response — so the result has to be deserialized and
		// branched on its type instead.
		const result = deserialize(await res.text());
		if (result.type === 'success') {
			await invalidateAll();
			return;
		}
		const message =
			result.type === 'failure'
				? ((result.data as { error?: string } | undefined)?.error ?? 'Could not undo the archive')
				: 'Could not undo the archive';
		toast(message, 'error');
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') onclose();
	}
</script>

<svelte:window onkeydown={handleKeydown} />

<div class="backdrop" role="presentation" onclick={onclose}></div>

<div class="modal" role="dialog" aria-modal="true" aria-label={person.name}>
	<header>
		<h2>{person.name}</h2>
		<button type="button" class="close" aria-label="Close" onclick={onclose}>✕</button>
	</header>

	{#if person.linkedinUrl}
		<LinkedinCard
			url={person.linkedinUrl}
			name={person.name}
			role={person.role}
			company={person.company}
		/>
	{/if}

	<FlagPicker personId={person.id} {flags} attachedIds={person.flagIds} />

	<form
		class="person-form"
		method="POST"
		action="?/updatePerson"
		use:enhance={() =>
			async ({ result, update }) => {
				await update();
				// Enumerated rather than if/else: ActionResult also carries `redirect`
				// and `error`, and a thrown server error must not report "Saved" on top
				// of the error boundary SvelteKit has already rendered.
				if (result.type === 'success') {
					saveError = null;
					toast('Saved', 'success');
				} else if (result.type === 'failure') {
					saveError =
						(result.data as { error?: string } | undefined)?.error ?? 'Something went wrong.';
				}
			}}
	>
		<input type="hidden" name="id" value={person.id} />

		<PersonFields values={person} errorId="save-error" error={saveError} />

		<div class="actions">
			<button type="submit" class="save">Save</button>
		</div>

		<PersonTasks personId={person.id} {tasks} />
	</form>

	<form
		method="POST"
		action={person.archivedAt ? '?/restorePerson' : '?/archivePerson'}
		use:enhance={() => {
			archiving = true;
			const wasArchived = Boolean(person.archivedAt);
			const id = person.id;
			return async ({ result, update }) => {
				await update();
				archiving = false;
				// Enumerated rather than if/else, mirroring the save form above:
				// ActionResult also carries `redirect` and `error` — an expired
				// session comes back as {type:'redirect'} riding a 200 (the
				// x-sveltekit-action header suppresses the real redirect), and
				// offline synthesises {type:'error'} — and neither must be able to
				// report success and close the modal over nothing having happened.
				if (result.type !== 'success') return;
				onclose();
				if (wasArchived) {
					toast('Restored', 'success');
				} else {
					// Longer than the default: an undo nobody has time to read is not
					// an undo. "Show archived" remains the slower path back.
					toast('Archived', 'success', 8000, {
						label: 'Undo',
						// Offline or a network blip would otherwise turn this into an
						// unhandled promise rejection — restore() already toasts on a
						// server-reported failure, so this only needs to cover the fetch
						// itself throwing.
						run: () => void restore(id).catch(() => toast('Could not undo the archive', 'error'))
					});
				}
			};
		}}
	>
		<input type="hidden" name="id" value={person.id} />
		<button type="submit" class="archive" disabled={archiving}>
			{person.archivedAt ? 'Restore' : 'Archive'}
		</button>
	</form>
</div>

<style>
	.backdrop {
		position: fixed;
		inset: 0;
		/* Same band TaskDetailModal uses, and for the same reason: TopBar is
		   sticky with z-index 999 and is a sibling of <main> in a parent that
		   creates no stacking context of its own, so anything under ~1000 loses
		   to it. Toasts sit at 2000 deliberately, so this stays under that. */
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
		border: 1px solid var(--border, #ddd4c6);
		border-radius: var(--radius-l);
		background: var(--surface, #fff);
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
		color: var(--muted, #b0a698);
		cursor: pointer;
	}
	/* Scoped to the update form only — this was a bare element selector, so it
	   was also squeezing the archive/restore form's single button into one of
	   two grid columns. */
	.person-form {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 0.6rem;
		margin-top: 0.9rem;
	}
	/* The field styles live in PersonFields now, which owns the markup they
	   apply to. Only the hidden id input is still rendered here. */
	input {
		padding: 0.35rem 0.5rem;
		border: 1px solid var(--border, #e2dace);
		border-radius: 6px;
		background: var(--surface, #fff);
		font: inherit;
		font-size: 0.85rem;
		color: inherit;
	}
	.actions {
		grid-column: 1 / -1;
		display: flex;
		align-items: center;
		gap: 0.75rem;
	}
	.save {
		margin-left: auto;
		padding: 0.4rem 1rem;
		border: none;
		border-radius: 7px;
		background: var(--accent, #6f7f5f);
		color: var(--accent-ink);
		font: inherit;
		font-weight: 600;
		cursor: pointer;
	}
	.archive {
		border: none;
		background: none;
		padding: 0;
		font: inherit;
		font-size: 0.78rem;
		color: var(--danger);
		cursor: pointer;
	}
	@media (max-width: 640px) {
		.person-form {
			grid-template-columns: 1fr;
		}
	}
</style>
