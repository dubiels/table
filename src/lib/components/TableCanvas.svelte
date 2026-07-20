<script lang="ts">
	import { enhance } from '$app/forms';
	import TaskCard from './TaskCard.svelte';
	import AddTaskForm from './AddTaskForm.svelte';
	import { ZONE_COLORS, type ZoneColor } from '$lib/zones';

	type Task = { id: string; title: string; done: boolean; priority: string | null; dueDate: string | null; x: number; y: number; sortOrder: number };
	type Zone = { id: string; name: string; color: string; x: number; y: number; width: number; height: number };

	let { tasks, zones }: { tasks: Task[]; zones: Zone[] } = $props();

	// Local mutable copies so drags feel instant before the server round-trip.
	let taskPos = $state(new Map(tasks.map((t) => [t.id, { x: t.x, y: t.y }])));
	let zonePos = $state(new Map(zones.map((z) => [z.id, { x: z.x, y: z.y, width: z.width, height: z.height }])));

	function colorOf(key: string) {
		return ZONE_COLORS[(key as ZoneColor)] ?? ZONE_COLORS.sage;
	}

	async function persist(kind: 'task' | 'zone', id: string, x: number, y: number, width?: number, height?: number) {
		await fetch('/api/positions', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ kind, id, x, y, width, height })
		});
	}

	function startDrag(e: PointerEvent, kind: 'task' | 'zone', id: string) {
		if ((e.target as HTMLElement).closest('button, input, select, a, form')) return;
		e.preventDefault();
		const store = kind === 'task' ? taskPos : zonePos;
		const start = store.get(id)!;
		const originX = e.clientX;
		const originY = e.clientY;
		const baseX = start.x;
		const baseY = start.y;

		function move(ev: PointerEvent) {
			const nx = Math.max(0, baseX + (ev.clientX - originX));
			const ny = Math.max(0, baseY + (ev.clientY - originY));
			store.set(id, { ...store.get(id)!, x: nx, y: ny });
		}
		function up() {
			window.removeEventListener('pointermove', move);
			window.removeEventListener('pointerup', up);
			const final = store.get(id)!;
			persist(kind, id, final.x, final.y, (final as any).width, (final as any).height);
		}
		window.addEventListener('pointermove', move);
		window.addEventListener('pointerup', up);
	}
</script>

<div class="toolbar">
	<AddTaskForm />
	<form method="POST" action="?/createZone" use:enhance style="display:flex; gap:0.5rem;">
		<input name="name" placeholder="New zone name" required />
		<button class="btn" type="submit">Add zone</button>
	</form>
</div>

<div class="canvas">
	{#each zones as zone (zone.id)}
		{@const p = zonePos.get(zone.id)!}
		{@const c = colorOf(zone.color)}
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div class="zone" style="left:{p.x}px; top:{p.y}px; width:{p.width}px; height:{p.height}px; background:{c.fill}; border-color:{c.border};"
			onpointerdown={(e) => startDrag(e, 'zone', zone.id)}>
			<div class="zone-head">
				<span class="zone-name">{zone.name}</span>
				<form method="POST" action="?/deleteZone" use:enhance>
					<input type="hidden" name="id" value={zone.id} />
					<button class="btn btn-ghost btn-icon" type="submit" aria-label="Delete zone">×</button>
				</form>
			</div>
		</div>
	{/each}

	{#each tasks as task (task.id)}
		{@const p = taskPos.get(task.id)!}
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div class="floating" style="left:{p.x}px; top:{p.y}px; z-index:{task.sortOrder};"
			onpointerdown={(e) => startDrag(e, 'task', task.id)}>
			<TaskCard {task} />
		</div>
	{/each}
</div>

<style>
	.toolbar {
		display: flex;
		flex-wrap: wrap;
		gap: 1rem;
		align-items: flex-start;
		margin-bottom: 1rem;
	}
	.canvas {
		position: relative;
		min-height: 70vh;
		width: 100%;
		overflow: auto;
	}
	.zone {
		position: absolute;
		border: 1.5px solid;
		border-radius: var(--radius-m);
		padding: 0.5rem;
		cursor: grab;
	}
	.zone-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
	}
	.zone-name {
		font-family: var(--font-display);
		font-weight: 600;
		font-size: 0.95rem;
	}
	.floating {
		position: absolute;
		width: 220px;
		cursor: grab;
		touch-action: none;
	}
	.floating:active {
		cursor: grabbing;
	}
</style>
