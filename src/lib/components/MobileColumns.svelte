<script lang="ts">
	import TaskCard from './TaskCard.svelte';
	import AddTaskForm from './AddTaskForm.svelte';
	import { zoneForTask, taskCenter, type ZoneBounds } from '$lib/zones';

	type Task = { id: string; title: string; done: boolean; priority: string | null; dueDate: string | null; x: number; y: number };
	type Zone = ZoneBounds & { name: string };

	let { tasks, zones }: { tasks: Task[]; zones: Zone[] } = $props();

	function tasksIn(zoneId: string | null) {
		return tasks.filter((t) => (zoneForTask(taskCenter(t), zones)?.id ?? null) === zoneId);
	}
</script>

<AddTaskForm />

<div class="col">
	<h2>On the table</h2>
	{#each tasksIn(null) as task (task.id)}<TaskCard {task} />{/each}
</div>

{#each zones as zone (zone.id)}
	<div class="col">
		<h2>{zone.name}</h2>
		{#each tasksIn(zone.id) as task (task.id)}<TaskCard {task} />{/each}
	</div>
{/each}

<style>
	.col { margin-top: 1.25rem; display: flex; flex-direction: column; gap: 0.4rem; }
	.col h2 { font-size: 1.05rem; margin-bottom: 0.3rem; }
</style>
