<script lang="ts">
	import TaskCard from './TaskCard.svelte';
	import AddTaskForm from './AddTaskForm.svelte';
	import TaskDetailModal from './TaskDetailModal.svelte';
	import {
		groupTasksByZone,
		computeTreemap,
		zoneCenterPoint,
		findUncategorizedPoint,
		UNCATEGORIZED_ID,
		type BentoTask,
		type BentoZone
	} from '$lib/bento';
	import { ZONE_COLORS, type ZoneColor } from '$lib/zones';

	let { tasks, zones }: { tasks: BentoTask[]; zones: BentoZone[] } = $props();

	let containerWidth = $state(0);
	let containerHeight = $state(0);

	const GUTTER = 8;

	let groups = $derived(groupTasksByZone(tasks, zones));
	let rects = $derived(
		containerWidth > 0 && containerHeight > 0
			? computeTreemap(
					groups.map((g) => ({ id: g.id, weight: g.weight })),
					containerWidth,
					containerHeight
				)
			: []
	);

	function rectFor(id: string) {
		return rects.find((r) => r.id === id) ?? null;
	}

	function colorOf(color: string | null) {
		return color ? (ZONE_COLORS[color as ZoneColor] ?? ZONE_COLORS.sage) : null;
	}

	function addPointFor(groupId: string) {
		if (groupId === UNCATEGORIZED_ID) return findUncategorizedPoint(zones);
		const zone = zones.find((z) => z.id === groupId);
		return zone ? zoneCenterPoint(zone) : findUncategorizedPoint(zones);
	}

	let openTaskId = $state<string | null>(null);
	let openTask = $derived(tasks.find((t) => t.id === openTaskId) ?? null);
</script>

<div class="bento" bind:clientWidth={containerWidth} bind:clientHeight={containerHeight}>
	{#each groups as group (group.id)}
		{@const rect = rectFor(group.id)}
		{#if rect}
			{@const c = colorOf(group.color)}
			{@const point = addPointFor(group.id)}
			<div
				class="box"
				style="left:{rect.x + GUTTER}px; top:{rect.y + GUTTER}px; width:{rect.width -
					GUTTER * 2}px; height:{rect.height - GUTTER * 2}px; background:{c?.fill ??
					'var(--surface)'}; border-color:{c?.border ?? 'var(--border)'};"
			>
				<div class="box-head">
					<span class="box-name">{group.name}</span>
					<span class="box-count">{group.tasks.length}</span>
				</div>
				<div class="box-body">
					{#if group.tasks.length === 0}
						<p class="empty">No tasks yet</p>
					{:else}
						{#each group.tasks as task (task.id)}
							<TaskCard {task} onclick={() => (openTaskId = task.id)} />
						{/each}
					{/if}
				</div>
				<div class="box-foot">
					<AddTaskForm x={point.x} y={point.y} />
				</div>
			</div>
		{/if}
	{/each}
</div>

{#if openTask}
	<TaskDetailModal task={openTask} onclose={() => (openTaskId = null)} />
{/if}

<style>
	.bento {
		position: relative;
		flex: 1;
		min-height: 0;
		width: 100%;
	}
	.box {
		position: absolute;
		display: flex;
		flex-direction: column;
		border: 1.5px solid;
		border-radius: var(--radius-m);
		padding: 0.6rem;
		gap: 0.4rem;
		overflow: hidden;
		transition:
			left 200ms ease,
			top 200ms ease,
			width 200ms ease,
			height 200ms ease;
	}
	.box-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		flex-shrink: 0;
		font-family: var(--font-display);
		font-weight: 600;
	}
	.box-count {
		font-size: 0.78rem;
		color: var(--muted);
		font-weight: 500;
	}
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
	.box-foot {
		flex-shrink: 0;
	}
</style>
