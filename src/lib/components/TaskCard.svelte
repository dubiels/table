<script lang="ts">
	import { enhance } from '$app/forms';
	import TaskDetailModal from './TaskDetailModal.svelte';

	let { task }: {
		task: { id: string; title: string; done: boolean; priority: string | null; dueDate: string | null };
	} = $props();

	let showModal = $state(false);
</script>

<div class="card" class:done={task.done} on:click={() => (showModal = true)}>
	<span>{task.title}</span>
	{#if task.priority}<span class="priority">{task.priority}</span>{/if}
	{#if task.dueDate}<span class="due">{task.dueDate}</span>{/if}

	<form method="POST" action="?/toggleTaskDone" use:enhance on:click|stopPropagation>
		<input type="hidden" name="id" value={task.id} />
		<button type="submit">{task.done ? 'Undo' : 'Done'}</button>
	</form>
	<form method="POST" action="?/moveTask" use:enhance on:click|stopPropagation style="display:inline">
		<input type="hidden" name="id" value={task.id} />
		<button name="direction" value="up" type="submit">▲</button>
		<button name="direction" value="down" type="submit">▼</button>
	</form>
</div>

{#if showModal}
	<TaskDetailModal {task} onclose={() => (showModal = false)} />
{/if}

<style>
	.card { border: 1px solid #ddd; border-radius: 6px; padding: 0.5rem; margin: 0.25rem 0; cursor: pointer; }
	.done { text-decoration: line-through; opacity: 0.6; }
</style>
