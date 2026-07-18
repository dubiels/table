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
		<form method="POST" action="?/moveTopic" use:enhance style="display:inline">
			<input type="hidden" name="id" value={topic.id} />
			<button name="direction" value="up" type="submit">▲</button>
			<button name="direction" value="down" type="submit">▼</button>
		</form>
		<form method="POST" action="?/archiveTopic" use:enhance style="display:inline">
			<input type="hidden" name="id" value={topic.id} />
			<button type="submit">Archive</button>
		</form>
	</header>

	{#each notDone as task (task.id)}
		<TaskCard {task} />
	{/each}

	<form method="POST" action="?/createTask" use:enhance>
		<input type="hidden" name="topicId" value={topic.id} />
		<input name="title" placeholder="New task" required />
		<button type="submit">Add</button>
	</form>

	{#if done.length}
		<details>
			<summary>Done ({done.length})</summary>
			{#each done as task (task.id)}
				<TaskCard {task} />
			{/each}
		</details>
	{/if}
</div>

<style>
	.column {
		min-width: 240px;
		border: 1px solid #ccc;
		border-radius: 8px;
		padding: 0.5rem;
	}
</style>
