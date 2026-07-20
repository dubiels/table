<script lang="ts">
	import TaskCard from '$lib/components/TaskCard.svelte';
	import TaskDetailModal from '$lib/components/TaskDetailModal.svelte';
	let { data } = $props();

	let openTaskId = $state<string | null>(null);
	let openTask = $derived(data.tasks.find((t) => t.id === openTaskId) ?? null);

	function formatCompletedAt(iso: string | null) {
		if (!iso) return '';
		return new Date(iso).toLocaleString(undefined, {
			month: 'short',
			day: 'numeric',
			hour: 'numeric',
			minute: '2-digit'
		});
	}
</script>

<div class="toolbar">
	<h1>History</h1>
	<a class="btn btn-ghost" href="/">Back to the table</a>
</div>

{#if data.tasks.length === 0}
	<p class="empty">Nothing completed yet.</p>
{:else}
	<div class="list">
		{#each data.tasks as task (task.id)}
			<div class="row">
				<div class="card-wrap">
					<TaskCard {task} onclick={() => (openTaskId = task.id)} />
				</div>
				<span class="completed-at">Completed {formatCompletedAt(task.completedAt)}</span>
			</div>
		{/each}
	</div>
{/if}

{#if openTask}
	<TaskDetailModal task={openTask} onclose={() => (openTaskId = null)} />
{/if}

<style>
	.toolbar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-bottom: 1rem;
	}

	.toolbar h1 {
		font-size: 1.4rem;
	}

	.empty {
		color: var(--muted);
	}

	.list {
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
		max-width: 480px;
	}

	.row {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}

	.card-wrap :global(.card) {
		width: 100%;
	}

	.completed-at {
		font-size: 0.75rem;
		color: var(--muted);
		padding-left: 0.2rem;
	}
</style>
