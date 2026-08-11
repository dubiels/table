<script lang="ts">
	import TaskCard from './TaskCard.svelte';
	import AddTaskForm from './AddTaskForm.svelte';
	import TaskDetailModal from './TaskDetailModal.svelte';
	import {
		groupTasksByZone,
		columnCount,
		packColumns,
		boxRows,
		columnRows,
		zoneCenterPoint,
		findUncategorizedPoint,
		UNCATEGORIZED_ID,
		type BentoTask,
		type BentoZone
	} from '$lib/bento';
	import { zoneColorVars } from '$lib/zones';

	let { tasks, zones }: { tasks: BentoTask[]; zones: BentoZone[] } = $props();

	let containerWidth = $state(0);

	let groups = $derived(groupTasksByZone(tasks, zones));
	let columns = $derived(packColumns(groups, columnCount(containerWidth)));

	function colorOf(color: string | null) {
		return color ? zoneColorVars(color) : null;
	}

	function addPointFor(groupId: string) {
		if (groupId === UNCATEGORIZED_ID) return findUncategorizedPoint(zones);
		const zone = zones.find((z) => z.id === groupId);
		return zone ? zoneCenterPoint(zone) : findUncategorizedPoint(zones);
	}

	let openTaskId = $state<string | null>(null);
	let openTask = $derived(tasks.find((t) => t.id === openTaskId) ?? null);

	let openAddId = $state<string | null>(null);
</script>

<div class="bento" bind:clientWidth={containerWidth}>
	{#each columns as column, index (index)}
		<div class="column" style="flex-grow:{columnRows(column)}">
			{#each column as group (group.id)}
				{@const c = colorOf(group.color)}
				{@const point = addPointFor(group.id)}
				{@const adding = openAddId === group.id}
				<div
					class="box"
					style="flex-grow:{boxRows(group)}; background:{c?.fill ??
						'var(--surface)'}; border-color:{c?.border ?? 'var(--border)'};"
				>
					<div class="box-head">
						<span class="box-name">{group.name}</span>
						<span class="box-count">{group.tasks.length}</span>
						<!-- The + lives in the header rather than a footer of its own: a
						     reserved footer row cost every box a card's worth of height,
						     which is most of a small box. -->
						<button
							type="button"
							class="add-plus"
							class:open={adding}
							aria-expanded={adding}
							onclick={() => (openAddId = adding ? null : group.id)}
							aria-label={adding ? 'Close add task' : `Add task to ${group.name}`}
						>
							+
						</button>
					</div>

					{#if adding}
						<AddTaskForm x={point.x} y={point.y} />
					{/if}

					{#if group.tasks.length > 0}
						<div class="box-body">
							{#each group.tasks as task (task.id)}
								<TaskCard {task} onclick={() => (openTaskId = task.id)} />
							{/each}
						</div>
					{:else if !adding}
						<p class="empty">No tasks yet</p>
					{/if}
				</div>
			{/each}
		</div>
	{/each}
</div>

{#if openTask}
	<TaskDetailModal task={openTask} onclose={() => (openTaskId = null)} />
{/if}

<style>
	/* Columns of a guaranteed minimum width, filling the board in both axes. Every
	   flex-grow here is set inline from the group's row count, so a column's width
	   and a box's height both track how much they actually hold. */
	.bento {
		flex: 1;
		min-height: 0;
		width: 100%;
		display: flex;
		align-items: stretch;
		gap: 8px;
		overflow-y: auto;
	}

	/* flex-basis: 0 so the inline grow factors alone decide the split; min-width
	   mirrors MIN_COLUMN_WIDTH, which is what columnCount() sized the count
	   against, so the floor can never make the row overflow. */
	.column {
		flex-basis: 0;
		min-width: 240px;
		display: flex;
		flex-direction: column;
		gap: 8px;
	}

	/* basis auto, so a box starts at its content height and only the slack is
	   shared out by the grow factor. min-height: 0 lets it shrink past its content
	   when a column holds more than fits, handing the overflow to .box-body. */
	.box {
		flex-basis: auto;
		flex-shrink: 1;
		min-height: 0;
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
		border: 1.5px solid;
		border-radius: var(--radius-m);
		padding: 0.45rem 0.5rem 0.5rem;
	}

	.box-head {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		flex-shrink: 0;
		font-family: var(--font-display);
		font-weight: 600;
	}

	.box-name {
		flex: 1;
		min-width: 0;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.box-count {
		font-size: 0.78rem;
		color: var(--muted);
		font-weight: 500;
		font-variant-numeric: tabular-nums;
	}

	.add-plus {
		flex-shrink: 0;
		width: 1.15rem;
		height: 1.15rem;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		border: none;
		border-radius: 50%;
		background: transparent;
		color: var(--muted);
		font-size: 1rem;
		line-height: 1;
		padding: 0;
		cursor: pointer;
		transition:
			transform 0.15s ease,
			background 0.15s ease,
			color 0.15s ease;
	}

	.add-plus:hover {
		background: var(--accent);
		color: var(--accent-ink);
	}

	/* The + is the close control too, so it turns into an ×. */
	.add-plus.open {
		transform: rotate(45deg);
	}

	@media (prefers-reduced-motion: reduce) {
		.add-plus {
			transition: none;
		}
	}

	/* Takes the box's slack, and scrolls rather than growing the box when a zone
	   holds more than its column can show. */
	.box-body {
		flex: 1;
		min-height: 0;
		overflow-y: auto;
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
	}

	.empty {
		color: var(--muted);
		font-size: 0.85rem;
		margin: 0;
	}
</style>
