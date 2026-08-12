<script lang="ts">
	import { enhance } from '$app/forms';
	import { page } from '$app/state';
	import { untrack } from 'svelte';

	let {
		task,
		onclose
	}: {
		task: {
			id: string;
			title: string;
			notes?: string | null;
			dueDate?: string | null;
			priority?: string | null;
			googleSync?: boolean;
			googleTaskId?: string | null;
			googleError?: string | null;
		};
		onclose: () => void;
	} = $props();

	// Mirrors the date input rather than the saved value, so the toggle enables
	// the moment a date is typed instead of after a save-and-reopen. Read once,
	// untracked: the modal is remounted fresh for each task it opens (there is
	// no in-place "next task" navigation), so re-syncing to `task` here is
	// neither needed nor wanted — it would fight the user's own edits to a
	// field that already carries the initial value.
	let dueDate = $state(untrack(() => task.dueDate ?? ''));
	let googleSync = $state(untrack(() => task.googleSync ?? false));
	// From the layout load, so this component does not have to be handed the flag
	// through the two views that render it.
	let gtasksConfigured = $derived(page.data.gtasksConfigured === true);
	// Creation needs a date; an existing link does not, and is maintained with a
	// null due date rather than severed.
	let canSync = $derived(Boolean(dueDate) || Boolean(task.googleTaskId));

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') onclose();
	}
</script>

<svelte:window onkeydown={handleKeydown} />

<div class="overlay" role="presentation" onclick={() => onclose()}>
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div class="modal" onclick={(e) => e.stopPropagation()}>
		<h2>Edit task</h2>

		<form
			id="edit-task-form"
			method="POST"
			action="/?/updateTask"
			use:enhance={() => {
				return async ({ update }) => {
					await update();
					onclose();
				};
			}}
		>
			<input type="hidden" name="id" value={task.id} />

			<label>
				<span>Title</span>
				<input name="title" value={task.title} required />
			</label>

			<label>
				<span>Notes</span>
				<textarea name="notes">{task.notes ?? ''}</textarea>
			</label>

			<label>
				<span>Due date</span>
				<input type="date" name="dueDate" bind:value={dueDate} />
			</label>

			<label>
				<span>Priority</span>
				<select name="priority">
					<option value="">None</option>
					<option value="low" selected={task.priority === 'low'}>Low</option>
					<option value="med" selected={task.priority === 'med'}>Medium</option>
					<option value="high" selected={task.priority === 'high'}>High</option>
				</select>
			</label>

			{#if gtasksConfigured}
				<label class="check">
					<input type="checkbox" name="googleSync" bind:checked={googleSync} disabled={!canSync} />
					<span>Send to Google Tasks</span>
				</label>
				{#if !canSync && googleSync}
					<!-- A disabled checkbox is never submitted, so a held opt-in (a task
					     synced with no due date yet, waiting for one) would otherwise post
					     as "off" and be silently revoked on Save. This carries the true
					     value through explicitly. It is never rendered alongside an
					     enabled checkbox, so there is never a duplicate `googleSync` field
					     in the body. -->
					<input type="hidden" name="googleSync" value="on" />
				{/if}
				{#if !canSync}
					<p class="hint">Needs a due date — an undated task never reaches the calendar grid.</p>
				{/if}
				{#if task.googleError}
					<p class="hint hint-error">Google Tasks: {task.googleError}</p>
				{/if}
			{/if}
		</form>

		<form
			id="delete-task-form"
			method="POST"
			action="/?/deleteTask"
			use:enhance={() => {
				return async ({ update }) => {
					await update();
					onclose();
				};
			}}
		>
			<input type="hidden" name="id" value={task.id} />
		</form>

		<div class="footer">
			<button class="btn btn-danger" type="submit" form="delete-task-form">Delete</button>
			<div class="spacer"></div>
			<button class="btn btn-ghost" type="button" onclick={() => onclose()}>Cancel</button>
			<button class="btn btn-primary" type="submit" form="edit-task-form">Save</button>
		</div>
	</div>
</div>

<style>
	.overlay {
		position: fixed;
		inset: 0;
		background: var(--overlay);
		backdrop-filter: blur(2px);
		display: flex;
		align-items: center;
		justify-content: center;
		z-index: 1000;
	}

	.modal {
		background: var(--surface);
		border-radius: var(--radius-l);
		box-shadow: var(--shadow-raised);
		padding: 1.25rem;
		width: min(420px, calc(100vw - 2rem));
	}

	.modal h2 {
		margin-bottom: 1rem;
	}

	form#edit-task-form {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}

	label {
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
	}

	label span {
		font-size: 0.78rem;
		color: var(--muted);
	}

	textarea {
		min-height: 80px;
		resize: vertical;
	}

	.check {
		flex-direction: row;
		align-items: center;
		gap: 0.5rem;
	}

	.check span {
		font-size: 0.88rem;
		color: var(--ink);
	}

	.hint {
		margin: -0.35rem 0 0;
		font-size: 0.74rem;
		color: var(--muted);
	}

	.hint-error {
		color: var(--danger);
	}

	.footer {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		margin-top: 1.25rem;
	}

	.spacer {
		flex: 1;
	}
</style>
