<script lang="ts">
	import TaskCard from './TaskCard.svelte';
	import AddTaskForm from './AddTaskForm.svelte';
	import TaskDetailModal from './TaskDetailModal.svelte';
	import { zoneForTask, taskCenter, type ZoneBounds } from '$lib/zones';
	import { findUncategorizedPoint } from '$lib/bento';

	type Task = {
		id: string;
		title: string;
		done: boolean;
		priority: string | null;
		dueDate: string | null;
		x: number;
		y: number;
	};
	type Zone = ZoneBounds & { name: string };

	let { tasks, zones }: { tasks: Task[]; zones: Zone[] } = $props();

	let openTaskId = $state<string | null>(null);
	let openTask = $derived(tasks.find((t) => t.id === openTaskId) ?? null);

	function tasksIn(zoneId: string | null) {
		return tasks.filter((t) => (zoneForTask(taskCenter(t), zones)?.id ?? null) === zoneId);
	}

	// This form has no column of its own to place into, so it aims for open
	// ground. Without a point it fell back to the createTask default of (60, 60),
	// which is also the default anchor of the first zone — so a task added on the
	// phone silently joined whichever zone happened to cover that corner.
	let addPoint = $derived(findUncategorizedPoint(zones));
</script>

<AddTaskForm x={addPoint.x} y={addPoint.y} />

<div class="col">
	<h2>On the table</h2>
	{#each tasksIn(null) as task (task.id)}<TaskCard
			{task}
			onclick={() => (openTaskId = task.id)}
		/>{/each}
</div>

{#each zones as zone (zone.id)}
	<div class="col">
		<h2>{zone.name}</h2>
		{#each tasksIn(zone.id) as task (task.id)}<TaskCard
				{task}
				onclick={() => (openTaskId = task.id)}
			/>{/each}
	</div>
{/each}

{#if openTask}
	<TaskDetailModal task={openTask} onclose={() => (openTaskId = null)} />
{/if}

<style>
	.col {
		margin-top: 1.25rem;
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
	}
	.col h2 {
		font-size: 1.05rem;
		margin-bottom: 0.3rem;
	}
</style>
