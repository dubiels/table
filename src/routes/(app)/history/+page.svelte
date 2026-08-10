<script lang="ts">
	import { resolve } from '$app/paths';
	import TaskCard from '$lib/components/TaskCard.svelte';
	import TaskDetailModal from '$lib/components/TaskDetailModal.svelte';
	import Mascot from '$lib/components/Mascot.svelte';
	let { data } = $props();

	let openTaskId = $state<string | null>(null);
	let openTask = $derived(data.tasks.find((t) => t.id === openTaskId) ?? null);

	function formatCompletedAt(iso: string | null) {
		if (!iso) return '';
		return new Date(iso).toLocaleTimeString(undefined, {
			hour: 'numeric',
			minute: '2-digit'
		});
	}

	function dayLabel(iso: string): string {
		const d = new Date(iso);
		const now = new Date();
		const startOfDay = (date: Date) =>
			new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
		const diffDays = Math.round((startOfDay(now) - startOfDay(d)) / 86_400_000);
		if (diffDays === 0) return 'Today';
		if (diffDays === 1) return 'Yesterday';
		return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
	}

	// Rows arrive sorted desc by completedAt, so same-day tasks are always
	// adjacent — a running list avoids reaching for a Map just to group them.
	let groups = $derived.by(() => {
		const result: { label: string; items: typeof data.tasks }[] = [];
		for (const task of data.tasks) {
			const label = dayLabel(task.completedAt ?? new Date().toISOString());
			const current = result.at(-1);
			if (current && current.label === label) {
				current.items.push(task);
			} else {
				result.push({ label, items: [task] });
			}
		}
		return result;
	});
</script>

<div class="toolbar">
	<h1>History</h1>
	<a class="btn btn-ghost" href={resolve('/')}>Back to the table</a>
</div>

{#if data.tasks.length === 0}
	<div class="empty">
		<Mascot mood="happy" />
		<p class="empty-title">Nothing completed yet.</p>
		<p class="empty-sub">Finished tasks move here from the table.</p>
	</div>
{:else}
	<div class="list">
		{#each groups as group (group.label)}
			<div class="day">{group.label}</div>
			{#each group.items as task (task.id)}
				<div class="row">
					<div class="card-wrap">
						<TaskCard {task} onclick={() => (openTaskId = task.id)} />
					</div>
					<span class="completed-at">{formatCompletedAt(task.completedAt)}</span>
				</div>
			{/each}
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

	.list {
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
		max-width: 560px;
	}

	.day {
		margin: 1rem 0 0.3rem;
		font-size: 0.72rem;
		color: var(--muted);
		letter-spacing: 0.04em;
		text-transform: uppercase;
	}

	.day:first-child {
		margin-top: 0;
	}

	.row {
		display: flex;
		align-items: center;
		gap: 0.6rem;
	}

	.card-wrap {
		flex: 1;
		min-width: 0;
	}

	.card-wrap :global(.card) {
		width: 100%;
	}

	.completed-at {
		flex-shrink: 0;
		font-size: 0.75rem;
		color: var(--muted);
		white-space: nowrap;
	}

	.empty {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.3rem;
		padding: 3.5rem 1rem;
		text-align: center;
		color: var(--muted);
	}

	.empty :global(.mascot) {
		margin-bottom: 0.6rem;
	}

	.empty-title {
		margin: 0;
		font-family: var(--font-display);
		font-weight: 600;
		color: var(--ink);
	}

	.empty-sub {
		margin: 0;
		font-size: 0.85rem;
	}
</style>
