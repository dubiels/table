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

	<form class="new-topic" method="POST" action="?/createTopic" use:enhance>
		<input name="name" placeholder="New topic" required />
		<button class="btn btn-ghost" type="submit">Add topic</button>
	</form>
</div>

<style>
	.board {
		display: flex;
		align-items: flex-start;
		gap: 1rem;
		overflow-x: auto;
		padding-bottom: 1rem;
	}

	.new-topic {
		flex-shrink: 0;
		width: 280px;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		padding: 0.75rem;
		border: 1px dashed var(--border-strong);
		border-radius: var(--radius-m);
		background: transparent;
	}

	.new-topic input {
		width: 100%;
		background: transparent;
		border-color: transparent;
	}

	.new-topic input:focus-visible,
	.new-topic input:focus {
		background: var(--surface);
		border-color: var(--border-strong);
	}
</style>
