<script lang="ts">
	import { enhance } from '$app/forms';

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
		};
		onclose: () => void;
	} = $props();

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
				<input type="date" name="dueDate" value={task.dueDate ?? ''} />
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
