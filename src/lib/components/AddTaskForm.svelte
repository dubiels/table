<script lang="ts">
	import { enhance } from '$app/forms';
	import { page } from '$app/state';
	let { x = 60, y = 60 }: { x?: number; y?: number } = $props();
	let open = $state(false);

	const STORAGE_KEY = 'table:gtasks-default';

	let dueDate = $state('');
	// Sticky, because pushing everything should cost one click ever rather than
	// one per task.
	let googleSync = $state(false);
	let gtasksConfigured = $derived(page.data.gtasksConfigured === true);
	let canSync = $derived(Boolean(dueDate));

	// No reactive dependencies, so this runs once after mount to seed the sticky
	// preference. The server has no localStorage to read and renders it unticked.
	$effect(() => {
		try {
			googleSync = localStorage.getItem(STORAGE_KEY) === 'true';
		} catch {
			// Blocked storage: the checkbox still works, it just will not persist.
		}
	});

	function rememberGoogleSync(on: boolean) {
		googleSync = on;
		try {
			localStorage.setItem(STORAGE_KEY, String(on));
		} catch {
			// As above.
		}
	}
</script>

<form
	class="add"
	method="POST"
	action="?/createTask"
	use:enhance={() =>
		async ({ update }) => {
			await update();
			open = false;
			dueDate = '';
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
			<label><span>Due</span><input type="date" name="dueDate" bind:value={dueDate} /></label>
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
		{#if gtasksConfigured}
			<label class="gsync">
				<input
					type="checkbox"
					name="googleSync"
					checked={googleSync}
					disabled={!canSync}
					onchange={(e) => rememberGoogleSync(e.currentTarget.checked)}
				/>
				<span>Also add to Google Tasks{canSync ? '' : ' — needs a due date'}</span>
			</label>
		{/if}
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
	.gsync {
		display: flex;
		align-items: center;
		gap: 0.4rem;
	}
	.gsync span {
		font-size: 0.72rem;
		color: var(--muted);
	}
</style>
