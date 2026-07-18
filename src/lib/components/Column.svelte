<script lang="ts">
	import { enhance } from '$app/forms';
	import TaskCard from './TaskCard.svelte';

	let { topic, tasks }: {
		topic: { id: string; name: string };
		tasks: Array<{ id: string; title: string; done: boolean; priority: string | null; dueDate: string | null }>;
	} = $props();

	let notDone = $derived(tasks.filter((t) => !t.done));
	let done = $derived(tasks.filter((t) => t.done));
</script>

<div class="column">
	<header>
		<h2>{topic.name}</h2>
		<div class="header-actions">
			<form method="POST" action="?/moveTopic" use:enhance style="display:inline">
				<input type="hidden" name="id" value={topic.id} />
				<button class="btn btn-ghost btn-icon" name="direction" value="up" type="submit">▲</button>
				<button class="btn btn-ghost btn-icon" name="direction" value="down" type="submit">▼</button>
			</form>
			<form method="POST" action="?/archiveTopic" use:enhance style="display:inline">
				<input type="hidden" name="id" value={topic.id} />
				<button
					class="btn btn-ghost btn-icon"
					type="submit"
					title="Archive topic"
					aria-label="Archive topic"
				>
					×
				</button>
			</form>
		</div>
	</header>

	<div class="tasks">
		{#each notDone as task (task.id)}
			<TaskCard {task} />
		{/each}
	</div>

	<form class="new-task" method="POST" action="?/createTask" use:enhance>
		<input type="hidden" name="topicId" value={topic.id} />
		<input name="title" placeholder="Add a task…" required />
	</form>

	{#if done.length}
		<details>
			<summary>Done ({done.length})</summary>
			<div class="tasks">
				{#each done as task (task.id)}
					<TaskCard {task} />
				{/each}
			</div>
		</details>
	{/if}
</div>

<style>
	.column {
		width: 280px;
		flex-shrink: 0;
		background: var(--surface-2);
		border: 1px solid var(--border);
		border-radius: var(--radius-m);
		padding: 0.75rem;
		box-shadow: var(--shadow-card);
	}

	header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-bottom: 0.6rem;
	}

	header h2 {
		font-family: var(--font-display);
		font-size: 1.05rem;
	}

	.header-actions {
		display: flex;
		align-items: center;
		gap: 0.15rem;
	}

	.tasks {
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
	}

	.new-task {
		margin-top: 0.5rem;
	}

	.new-task input {
		width: 100%;
		background: transparent;
		border-color: transparent;
	}

	.new-task input:focus-visible,
	.new-task input:focus {
		background: var(--surface);
		border-color: var(--border-strong);
	}

	details {
		margin-top: 0.5rem;
	}

	summary {
		color: var(--muted);
		font-size: 0.82rem;
		cursor: pointer;
	}

	details .tasks {
		margin-top: 0.4rem;
	}
</style>
