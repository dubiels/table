<script lang="ts">
	import { enhance, deserialize } from '$app/forms';
	import { invalidateAll } from '$app/navigation';
	import TaskCard from './TaskCard.svelte';
	import AddTaskForm from './AddTaskForm.svelte';
	import { ZONE_COLORS, zoneForTask, taskCenter, DEFAULT_CARD, type ZoneColor } from '$lib/zones';
	import { SvelteMap } from 'svelte/reactivity';

	type Task = {
		id: string;
		title: string;
		done: boolean;
		priority: string | null;
		dueDate: string | null;
		x: number;
		y: number;
		sortOrder: number;
	};
	type Zone = {
		id: string;
		name: string;
		color: string;
		x: number;
		y: number;
		width: number;
		height: number;
	};
	type Rect = { x: number; y: number; width: number; height: number };
	type ClusterTarget = { type: 'zone' | 'task'; id: string; rect: Rect } | null;

	let { tasks, zones }: { tasks: Task[]; zones: Zone[] } = $props();

	// Position comes from the server-loaded props; a drag override holds the live
	// position only for an item currently (or just) being dragged. This way newly
	// created tasks/zones render immediately from props instead of waiting for a
	// full reload to re-seed a locally-owned map.
	let dragTask = new SvelteMap<string, { x: number; y: number }>();
	let dragZone = new SvelteMap<string, Rect>();

	// Live preview while dragging a task near another loose task or an existing
	// zone's edge — an organic outline shows what would happen on drop.
	let clusterTarget = $state<ClusterTarget>(null);
	let previewRect = $state<Rect | null>(null);

	// A newly-clustered zone starts unnamed; this drives the inline rename input
	// that auto-focuses right after creation (also reused for manual rename).
	let renamingZoneId = $state<string | null>(null);
	let renameValue = $state('');

	const CLUSTER_GAP = 36; // px "closeness" that counts as wanting to cluster
	const ZONE_PAD = 20; // padding added around a resized/created zone

	function taskXY(t: Task) {
		return dragTask.get(t.id) ?? { x: t.x, y: t.y };
	}
	function zoneXY(z: Zone): Rect {
		return dragZone.get(z.id) ?? { x: z.x, y: z.y, width: z.width, height: z.height };
	}

	function colorOf(key: string) {
		return ZONE_COLORS[key as ZoneColor] ?? ZONE_COLORS.sage;
	}

	// Deterministic organic outline per zone (or a fixed one for the live preview)
	// so groups read as hand-drawn blobs rather than boxes.
	function blobRadius(seed: string): string {
		let h = 0;
		for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
		const vals: number[] = [];
		let s = h || 1;
		for (let i = 0; i < 8; i++) {
			s = (s * 1103515245 + 12345) >>> 0;
			vals.push(30 + (s % 41)); // 30–70
		}
		return `${vals[0]}% ${vals[1]}% ${vals[2]}% ${vals[3]}% / ${vals[4]}% ${vals[5]}% ${vals[6]}% ${vals[7]}%`;
	}

	function intersects(a: Rect, b: Rect, gap = 0): boolean {
		return !(
			a.x + a.width + gap < b.x ||
			b.x + b.width + gap < a.x ||
			a.y + a.height + gap < b.y ||
			b.y + b.height + gap < a.y
		);
	}
	function contains(outer: Rect, inner: Rect): boolean {
		return (
			inner.x >= outer.x &&
			inner.y >= outer.y &&
			inner.x + inner.width <= outer.x + outer.width &&
			inner.y + inner.height <= outer.y + outer.height
		);
	}
	function unionRect(a: Rect, b: Rect, padding = 0): Rect {
		const x = Math.min(a.x, b.x) - padding;
		const y = Math.min(a.y, b.y) - padding;
		const right = Math.max(a.x + a.width, b.x + b.width) + padding;
		const bottom = Math.max(a.y + a.height, b.y + b.height) + padding;
		return { x, y, width: right - x, height: bottom - y };
	}

	function updateClusterPreview(taskId: string, box: Rect) {
		let best: ClusterTarget = null;
		let bestArea = Infinity;

		for (const zone of zones) {
			const zbox = zoneXY(zone);
			if (contains(zbox, box)) continue; // already fully inside — no resize needed
			if (!intersects(box, zbox, CLUSTER_GAP)) continue;
			const rect = unionRect(box, zbox, ZONE_PAD);
			const area = rect.width * rect.height;
			if (area < bestArea) {
				bestArea = area;
				best = { type: 'zone', id: zone.id, rect };
			}
		}

		if (!best) {
			for (const other of tasks) {
				if (other.id === taskId) continue;
				if (zoneForTask(taskCenter(other), zones)) continue; // only cluster loose tasks
				const p = taskXY(other);
				const obox = { x: p.x, y: p.y, width: DEFAULT_CARD.width, height: DEFAULT_CARD.height };
				if (!intersects(box, obox, CLUSTER_GAP)) continue;
				const rect = unionRect(box, obox, ZONE_PAD);
				const area = rect.width * rect.height;
				if (area < bestArea) {
					bestArea = area;
					best = { type: 'task', id: other.id, rect };
				}
			}
		}

		clusterTarget = best;
		previewRect = best?.rect ?? null;
	}

	async function persist(
		kind: 'task' | 'zone',
		id: string,
		x: number,
		y: number,
		width?: number,
		height?: number
	) {
		await fetch('/api/positions', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ kind, id, x, y, width, height })
		});
	}

	async function createZoneFromCluster(rect: Rect) {
		const fd = new FormData();
		fd.set('x', String(Math.round(rect.x)));
		fd.set('y', String(Math.round(rect.y)));
		fd.set('width', String(Math.round(rect.width)));
		fd.set('height', String(Math.round(rect.height)));
		const res = await fetch('?/createZone', { method: 'POST', body: fd });
		const result = deserialize(await res.text());
		await invalidateAll();
		if (result.type === 'success' && result.data && 'zone' in result.data) {
			const zone = result.data.zone as { id: string; name: string };
			renamingZoneId = zone.id;
			renameValue = zone.name;
		}
	}

	function startRename(zone: Zone) {
		renamingZoneId = zone.id;
		renameValue = zone.name;
	}

	async function commitRename(id: string) {
		const name = renameValue.trim();
		renamingZoneId = null;
		if (!name) return;
		const fd = new FormData();
		fd.set('id', id);
		fd.set('name', name);
		await fetch('?/renameZone', { method: 'POST', body: fd });
		await invalidateAll();
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
			if (kind === 'task') {
				dragTask.set(id, { x: nx, y: ny });
				updateClusterPreview(id, {
					x: nx,
					y: ny,
					width: DEFAULT_CARD.width,
					height: DEFAULT_CARD.height
				});
			} else {
				dragZone.set(id, { x: nx, y: ny, width: dims!.width, height: dims!.height });
			}
		}
		function up(ev: PointerEvent) {
			if (ev.pointerId !== pointerId) return;
			cleanup();
			if (kind === 'task') {
				const final = dragTask.get(id) ?? base;
				void persist('task', id, final.x, final.y);
				const target = clusterTarget;
				clusterTarget = null;
				previewRect = null;
				if (target?.type === 'zone') {
					dragZone.set(target.id, target.rect);
					void persist(
						'zone',
						target.id,
						target.rect.x,
						target.rect.y,
						target.rect.width,
						target.rect.height
					);
				} else if (target?.type === 'task') {
					void createZoneFromCluster(target.rect);
				}
			} else {
				const final = dragZone.get(id) ?? { ...base, width: dims!.width, height: dims!.height };
				void persist('zone', id, final.x, final.y, final.width, final.height);
			}
		}
		function cancel(ev: PointerEvent) {
			if (ev.pointerId !== pointerId) return;
			cleanup();
			if (kind === 'task') {
				clusterTarget = null;
				previewRect = null;
			}
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
		{@const r = zoneXY(zone)}
		{@const c = colorOf(zone.color)}
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div
			class="zone"
			style="left:{r.x}px; top:{r.y}px; width:{r.width}px; height:{r.height}px; background:{c.fill}; border-color:{c.border}; border-radius:{blobRadius(
				zone.id
			)};"
			onpointerdown={(e) => startDrag(e, 'zone', zone.id, r, { width: r.width, height: r.height })}
		>
			<div class="zone-head">
				{#if renamingZoneId === zone.id}
					<input
						class="zone-name-input"
						bind:value={renameValue}
						onblur={() => commitRename(zone.id)}
						onkeydown={(e) => {
							if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur();
							if (e.key === 'Escape') renamingZoneId = null;
						}}
					/>
				{:else}
					<button class="zone-name" type="button" onclick={() => startRename(zone)}
						>{zone.name}</button
					>
				{/if}
				<form method="POST" action="?/deleteZone" use:enhance>
					<input type="hidden" name="id" value={zone.id} />
					<button class="btn btn-ghost btn-icon" type="submit" aria-label="Delete zone">×</button>
				</form>
			</div>
		</div>
	{/each}

	{#if previewRect}
		<div
			class="cluster-preview"
			style="left:{previewRect.x}px; top:{previewRect.y}px; width:{previewRect.width}px; height:{previewRect.height}px; border-radius:{blobRadius(
				'preview'
			)};"
		></div>
	{/if}

	{#each tasks as task (task.id)}
		{@const p = taskXY(task)}
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div
			class="floating"
			style="left:{p.x}px; top:{p.y}px; z-index:{task.sortOrder};"
			onpointerdown={(e) => startDrag(e, 'task', task.id, p)}
		>
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
		padding: 0.5rem;
		cursor: grab;
	}
	.zone-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.4rem;
	}
	.zone-name {
		font-family: var(--font-display);
		font-weight: 600;
		font-size: 0.95rem;
		background: transparent;
		border: none;
		padding: 0;
		cursor: text;
		color: inherit;
	}
	.zone-name-input {
		font-family: var(--font-display);
		font-weight: 600;
		font-size: 0.95rem;
		background: var(--surface);
		border: 1px solid var(--border-strong);
		border-radius: var(--radius-s);
		padding: 0.1rem 0.4rem;
		min-width: 0;
		flex: 1;
	}
	.cluster-preview {
		position: absolute;
		border: 2px dashed var(--accent);
		background: var(--accent-soft);
		opacity: 0.55;
		pointer-events: none;
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
