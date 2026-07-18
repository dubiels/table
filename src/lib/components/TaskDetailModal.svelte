<script lang="ts">
	import { enhance } from '$app/forms';

	let { task, onclose }: {
		task: { id: string; title: string; notes?: string | null; dueDate?: string | null; priority?: string | null };
		onclose: () => void;
	} = $props();
</script>

<div class="overlay" on:click={() => onclose()}>
	<div class="modal" on:click|stopPropagation>
		<form
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
			<label>Title <input name="title" value={task.title} required /></label>
			<label>Notes <textarea name="notes">{task.notes ?? ''}</textarea></label>
			<label>Due date <input type="date" name="dueDate" value={task.dueDate ?? ''} /></label>
			<label>Priority
				<select name="priority">
					<option value="">None</option>
					<option value="low" selected={task.priority === 'low'}>Low</option>
					<option value="med" selected={task.priority === 'med'}>Medium</option>
					<option value="high" selected={task.priority === 'high'}>High</option>
				</select>
			</label>
			<button type="submit">Save</button>
		</form>
		<form
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
			<button type="submit">Delete</button>
		</form>
		<button on:click={() => onclose()}>Close</button>
	</div>
</div>

<style>
	.overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.4); display: flex; align-items: center; justify-content: center; }
	.modal { background: white; padding: 1rem; border-radius: 8px; min-width: 300px; }
</style>
