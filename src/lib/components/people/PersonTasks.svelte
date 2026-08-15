<script lang="ts">
	import { enhance } from '$app/forms';

	export type PersonTask = {
		id: string;
		title: string;
		dueDate: string | null;
		done: boolean;
	};

	let { personId, tasks }: { personId: string; tasks: PersonTask[] } = $props();

	let adding = $state(false);

	// Open ones first, then the recently crossed off. Completed tasks stay
	// visible rather than vanishing on tick — watching something disappear the
	// instant you check it reads as data loss, not as progress.
	let ordered = $derived(
		[...tasks].sort((a, b) => {
			if (a.done !== b.done) return a.done ? 1 : -1;
			return (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999');
		})
	);
</script>

<section class="tasks">
	<h3>Follow-ups</h3>

	{#if ordered.length > 0}
		<ul>
			{#each ordered as task (task.id)}
				<li class:done={task.done}>
					<form method="POST" action="?/toggleTaskForPerson" use:enhance>
						<input type="hidden" name="taskId" value={task.id} />
						<button
							type="submit"
							class="tick"
							aria-label={task.done ? `Reopen ${task.title}` : `Complete ${task.title}`}
						>
							{task.done ? '☑' : '☐'}
						</button>
					</form>
					<span class="title">{task.title}</span>
					{#if task.dueDate}<span class="due">{task.dueDate}</span>{/if}
				</li>
			{/each}
		</ul>
	{/if}

	{#if adding}
		<form
			method="POST"
			action="?/createTaskForPerson"
			class="add-task"
			use:enhance={() =>
				async ({ result, update }) => {
					await update();
					// Stay open only if it failed, so a run of follow-ups can be typed
					// without reaching for the button between each.
					if (result.type === 'success') adding = false;
				}}
		>
			<input type="hidden" name="personId" value={personId} />
			<!-- svelte-ignore a11y_autofocus -->
			<input name="title" placeholder="Send the queue-design doc" required autofocus />
			<input type="date" name="dueDate" aria-label="Due date" />
			<button type="submit" class="save">Add</button>
			<button type="button" class="cancel" onclick={() => (adding = false)}>Cancel</button>
		</form>
	{:else}
		<button type="button" class="new" onclick={() => (adding = true)}>+ Add a follow-up</button>
	{/if}
</section>

<style>
	.tasks {
		grid-column: 1 / -1;
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
		margin-top: 0.9rem;
		padding-top: 0.75rem;
		border-top: 1px solid var(--border);
	}
	h3 {
		margin: 0;
		font-size: 0.72rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: var(--muted);
	}
	ul {
		margin: 0;
		padding: 0;
		list-style: none;
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
	}
	li {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		font-size: 0.82rem;
	}
	li.done .title {
		text-decoration: line-through;
		color: var(--muted);
	}
	.tick {
		border: none;
		background: none;
		padding: 0;
		font: inherit;
		color: inherit;
		cursor: pointer;
	}
	.due {
		margin-left: auto;
		font-size: 0.72rem;
		color: var(--muted);
	}
	.add-task {
		display: flex;
		flex-wrap: wrap;
		gap: 0.35rem;
		align-items: center;
	}
	.add-task input {
		padding: 0.3rem 0.45rem;
		border: 1px solid var(--border);
		border-radius: var(--radius-s);
		background: var(--surface);
		font: inherit;
		font-size: 0.82rem;
		color: inherit;
	}
	.add-task input[name='title'] {
		flex: 1 1 12rem;
		min-width: 0;
	}
	.new {
		align-self: flex-start;
		border: none;
		background: none;
		padding: 0;
		font: inherit;
		font-size: 0.78rem;
		color: var(--accent-strong, var(--muted));
		cursor: pointer;
	}
	.save {
		padding: 0.3rem 0.7rem;
		border: none;
		border-radius: var(--radius-s);
		background: var(--accent);
		color: var(--accent-ink);
		font: inherit;
		font-size: 0.78rem;
		font-weight: 600;
		cursor: pointer;
	}
	.cancel {
		border: none;
		background: none;
		padding: 0;
		font: inherit;
		font-size: 0.78rem;
		color: var(--muted);
		cursor: pointer;
	}
</style>
