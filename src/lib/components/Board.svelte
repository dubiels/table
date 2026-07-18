<script lang="ts">
	import { enhance } from '$app/forms';
	import Column from './Column.svelte';

	type BoardTask = { id: string; title: string; done: boolean; priority: string | null; dueDate: string | null };

	let { topics, tasksByTopic }: {
		topics: Array<{ id: string; name: string }>;
		tasksByTopic: Record<string, BoardTask[]>;
	} = $props();
</script>

<div class="board">
	{#each topics as topic (topic.id)}
		<Column {topic} tasks={tasksByTopic[topic.id] ?? []} />
	{/each}
</div>

<form method="POST" action="?/createTopic" use:enhance>
	<input name="name" placeholder="New topic" required />
	<button type="submit">Add topic</button>
</form>

<style>
	.board {
		display: flex;
		gap: 1rem;
		align-items: flex-start;
		overflow-x: auto;
	}
</style>
