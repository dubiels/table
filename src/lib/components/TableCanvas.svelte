<script lang="ts">
	import { enhance } from '$app/forms';
	import TaskCard from './TaskCard.svelte';
	import AddTaskForm from './AddTaskForm.svelte';
	import { ZONE_COLORS, type ZoneColor } from '$lib/zones';
	import { SvelteMap } from 'svelte/reactivity';

	type Task = { id: string; title: string; done: boolean; priority: string | null; dueDate: string | null; x: number; y: number; sortOrder: number };
	type Zone = { id: string; name: string; color: string; x: number; y: number; width: number; height: number };

	let { tasks, zones }: { tasks: Task[]; zones: Zone[] } = $props();

	// Position comes from the server-loaded props; a drag override holds the live
	// position only for an item currently (or just) being dragged. This way newly
	// created tasks/zones render immediately from props instead of waiting for the
	// map to be re-seeded on a full reload.
	let dragTask = new SvelteMap<string, { x: number; y: number }>();
	let dragZone = new SvelteMap<string, { x: number; y: number }>();

	function taskXY(t: Task) {
		return dragTask.get(t.id) ?? { x: t.x, y: t.y };
	}
	function zoneXY(z: Zone) {
		return dragZone.get(z.id) ?? { x: z.x, y: z.y };
	}

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

	function startDrag(
		e: PointerEvent,
		kind: 'task' | 'zone',
		id: string,
		base: { x: number; y: number },
		dims?: { width: number; height: number }
	) {
		if ((e.target as HTMLElement).closest('button, input, select, a, form')) return;
		e.preventDefault();
		const store = kind === 'task' ? dragTask : dragZone;
		const originX = e.clientX;
		const originY = e.clientY;
		const baseX = base.x;
		const baseY = base.y;
		const pointerId = e.pointerId;

		function cleanup() {
			window.removeEventListener('pointermove', move);
			window.removeEventListener('pointerup', up);
			window.removeEventListener('pointercancel', cancel);
		}
		function move(ev: PointerEvent) {
			if (ev.pointerId !== pointerId) return;
			const nx = Math.max(0, baseX + (ev.clientX - originX));
			const ny = Math.max(0, baseY + (ev.clientY - originY));
			store.set(id, { x: nx, y: ny });
		}
		function up(ev: PointerEvent) {
			if (ev.pointerId !== pointerId) return;
			cleanup();
			const final = store.get(id) ?? base;
			persist(kind, id, final.x, final.y, dims?.width, dims?.height);
		}
		function cancel(ev: PointerEvent) {
			if (ev.pointerId !== pointerId) return;
			cleanup();
		}
		window.addEventListener('pointermove', move);
		window.addEventListener('pointerup', up);
		window.addEventListener('pointercancel', cancel);
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
		{@const p = zoneXY(zone)}
		{@const c = colorOf(zone.color)}
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div class="zone" style="left:{p.x}px; top:{p.y}px; width:{zone.width}px; height:{zone.height}px; background:{c.fill}; border-color:{c.border};"
			onpointerdown={(e) => startDrag(e, 'zone', zone.id, p, { width: zone.width, height: zone.height })}>
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
		{@const p = taskXY(task)}
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div class="floating" style="left:{p.x}px; top:{p.y}px; z-index:{task.sortOrder};"
			onpointerdown={(e) => startDrag(e, 'task', task.id, p)}>
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
