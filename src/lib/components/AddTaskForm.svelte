<script lang="ts">
	import { enhance } from '$app/forms';
	let { x = 60, y = 60 }: { x?: number; y?: number } = $props();
	let open = $state(false);
</script>

<form
	class="add"
	method="POST"
	action="?/createTask"
	use:enhance={() =>
		async ({ update }) => {
			await update();
			open = false;
		}}
>
	<input type="hidden" name="x" value={x} />
	<input type="hidden" name="y" value={y} />
	<div class="row">
		<input
			name="title"
			placeholder="Add something to the table…"
			required
			onfocus={() => (open = true)}
		/>
		<button class="btn btn-primary" type="submit">Add</button>
	</div>
	{#if open}
		<div class="extra">
			<label><span>Due</span><input type="date" name="dueDate" /></label>
			<label
				><span>Priority</span>
				<select name="priority">
					<option value="">None</option>
					<option value="low">Low</option>
					<option value="med">Medium</option>
					<option value="high">High</option>
				</select>
			</label>
		</div>
	{/if}
</form>

<style>
	.add {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}
	.row {
		display: flex;
		gap: 0.5rem;
	}
	/* min-width: 0 because a flex item defaults to min-width: auto, and an input's
	   intrinsic width is wide enough that in a narrow bento box it refuses to
	   shrink and pushes the Add button out past the edge. */
	.row input {
		flex: 1;
		min-width: 0;
	}
	.row .btn {
		flex-shrink: 0;
	}
	.extra {
		display: flex;
		gap: 0.75rem;
	}
	.extra label {
		display: flex;
		flex-direction: column;
		gap: 0.2rem;
	}
	.extra span {
		font-size: 0.72rem;
		color: var(--muted);
	}
</style>
