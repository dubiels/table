<script lang="ts">
	import { enhance, deserialize } from '$app/forms';
	import { invalidateAll } from '$app/navigation';
	import { tick } from 'svelte';
	import TaskCard from './TaskCard.svelte';
	import TaskDetailModal from './TaskDetailModal.svelte';
	import ZoneColorPicker from './ZoneColorPicker.svelte';
	import {
		ZONE_COLORS,
		ZONE_COLOR_KEYS,
		zoneForTask,
		taskCenter,
		DEFAULT_CARD,
		visibleWorldBounds,
		type ZoneColor
	} from '$lib/zones';
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

	let canvasEl = $state<HTMLDivElement | undefined>();
	let canvasWorldEl = $state<HTMLDivElement | undefined>();

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

	// Ctrl/Cmd-click on a zone name opens this popover instead of renaming.
	let colorPickerZoneId = $state<string | null>(null);
	let colorPickerPos = $state<{ x: number; y: number }>({ x: 0, y: 0 });

	// A tap (vs. a drag) on a task opens its edit panel; every other card hides
	// while it's open so nothing else competes for attention behind it.
	let openTaskId = $state<string | null>(null);
	let openTask = $derived(tasks.find((t) => t.id === openTaskId) ?? null);

	type ComposerState = {
		x: number;
		y: number;
		mode: 'task' | 'zone';
		title: string;
		dueDate: string;
		priority: string;
		color: ZoneColor;
	};
	// The click-to-place composer for creating a new task or zone. Toggling
	// mode swaps the fields row below but keeps whatever title/name is typed.
	let composer = $state<ComposerState | null>(null);
	let composerInputEl = $state<HTMLInputElement | undefined>();

	// Whether clicking empty canvas/zone space opens the composer. Off just
	// disables new-item creation — drag, resize, rename, delete, and
	// tap-to-edit-task all keep working regardless.
	let addMode = $state(false);

	const CLUSTER_GAP = 36; // px "closeness" that counts as wanting to cluster
	const ZONE_PAD = 20; // padding added around a resized/created zone
	const ZONE_HEAD_CLEARANCE = 34; // top space reserved for the zone-head row so its name/rename input never overlaps clustered tasks
	const CLICK_MOVE_THRESHOLD = 6; // px of pointer travel below which a drag counts as a click
	const COMPOSER_WIDTH = 240; // approximate rendered size, used to keep the composer on-canvas
	const COMPOSER_HEIGHT = 190;
	const ZOOM_STEP = 0.1;
	const ZOOM_MIN_FLOOR = 0.5;

	// Zoom is a view-only lens: 100% is the max (today's normal, unscaled
	// view). The min is a fixed floor, not content-driven — zooming out past
	// what's needed to see everything is harmless (it just adds margin), so
	// tying the floor to how far content currently spreads only starved the
	// common case (modest content) of any usable zoom-out range at all.
	let zoom = $state(1);
	const zoomMin = ZOOM_MIN_FLOOR;

	function roundZoom(z: number) {
		return Math.round(z * 100) / 100;
	}
	function zoomIn() {
		zoom = Math.min(1, roundZoom(zoom + ZOOM_STEP));
	}
	function zoomOut() {
		zoom = Math.max(zoomMin, roundZoom(zoom - ZOOM_STEP));
	}

	// Ignore the shortcut while the user is typing anywhere (composer,
	// zone-rename input, etc.) so +/- don't hijack normal text entry.
	function isTypingTarget(el: EventTarget | null): boolean {
		if (!(el instanceof HTMLElement)) return false;
		if (el.isContentEditable) return true;
		return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT';
	}
	function handleZoomKeydown(e: KeyboardEvent) {
		if (isTypingTarget(e.target)) return;
		if (e.key === '+' || e.key === '=') {
			e.preventDefault();
			zoomIn();
		} else if (e.key === '-' || e.key === '_') {
			e.preventDefault();
			zoomOut();
		}
	}
	$effect(() => {
		window.addEventListener('keydown', handleZoomKeydown);
		return () => window.removeEventListener('keydown', handleZoomKeydown);
	});

	function taskXY(t: Task) {
		return dragTask.get(t.id) ?? { x: t.x, y: t.y };
	}
	function zoneXY(z: Zone): Rect {
		return dragZone.get(z.id) ?? { x: z.x, y: z.y, width: z.width, height: z.height };
	}

	function colorOf(key: string) {
		return ZONE_COLORS[key as ZoneColor] ?? ZONE_COLORS.sage;
	}

	function zoneDotFor(task: Task) {
		const p = taskXY(task);
		const zone = zoneForTask(
			taskCenter(p),
			zones.map((z) => ({ ...zoneXY(z), id: z.id }))
		);
		const owner = zone ? zones.find((z) => z.id === zone.id) : null;
		return owner ? colorOf(owner.color) : null;
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
	// Extends a rect's top edge so the zone-head row has room above the tasks
	// it wraps, instead of eating into ZONE_PAD and overlapping the top task.
	function withHeadClearance(rect: Rect): Rect {
		const extra = Math.max(0, ZONE_HEAD_CLEARANCE - ZONE_PAD);
		return { x: rect.x, y: rect.y - extra, width: rect.width, height: rect.height + extra };
	}

	// The region of the world visible right now at the current zoom. Every
	// drag/resize/composer placement is clamped to this — so zooming out is
	// exactly what makes more space reachable.
	let viewportBounds = $derived(
		visibleWorldBounds(canvasEl?.clientWidth ?? 0, canvasEl?.clientHeight ?? 0, zoom)
	);

	function clampPoint(x: number, y: number, width: number, height: number) {
		const { minX, minY, maxX, maxY } = viewportBounds;
		return {
			x: Math.min(Math.max(minX, x), Math.max(minX, maxX - width)),
			y: Math.min(Math.max(minY, y), Math.max(minY, maxY - height))
		};
	}
	function clampRect(rect: Rect): Rect {
		const { minX, minY, maxX, maxY } = viewportBounds;
		const width = Math.min(rect.width, maxX - minX);
		const height = Math.min(rect.height, maxY - minY);
		const { x, y } = clampPoint(rect.x, rect.y, width, height);
		return { x, y, width, height };
	}

	// Blocks a zone drag/resize from ever overlapping a sibling zone. Tries
	// the full candidate move first, then each axis independently (so
	// hitting a neighbor on one axis doesn't also freeze the other), and
	// only falls all the way back to the last valid rect if every option
	// still overlaps.
	function zoneOverlapsOthers(id: string, rect: Rect): boolean {
		for (const z of zones) {
			if (z.id === id) continue;
			if (intersects(rect, zoneXY(z))) return true;
		}
		return false;
	}
	function resolveZoneRect(id: string, candidate: Rect, fallback: Rect): Rect {
		if (!zoneOverlapsOthers(id, candidate)) return candidate;
		const xOnly = { ...fallback, x: candidate.x, width: candidate.width };
		if (!zoneOverlapsOthers(id, xOnly)) return xOnly;
		const yOnly = { ...fallback, y: candidate.y, height: candidate.height };
		if (!zoneOverlapsOthers(id, yOnly)) return yOnly;
		return fallback;
	}

	// Same idea as resolveZoneRect, but for a dragged task against every other
	// task's card footprint — keeps cards from ever landing on top of each
	// other while still allowing the near-miss cluster preview (which
	// triggers at CLUSTER_GAP, well before actual overlap). Uses a strict
	// (not intersects()'s inclusive) edge test so cards can butt up flush
	// against each other with zero gap — only actual overlap is blocked.
	function taskOverlapsOthers(id: string, rect: Rect): boolean {
		for (const t of tasks) {
			if (t.id === id) continue;
			const p = taskXY(t);
			const obox = { x: p.x, y: p.y, width: DEFAULT_CARD.width, height: DEFAULT_CARD.height };
			const touchingOrApart =
				rect.x + rect.width <= obox.x ||
				obox.x + obox.width <= rect.x ||
				rect.y + rect.height <= obox.y ||
				obox.y + obox.height <= rect.y;
			if (!touchingOrApart) return true;
		}
		return false;
	}
	function resolveTaskRect(id: string, candidate: Rect, fallback: Rect): Rect {
		if (!taskOverlapsOthers(id, candidate)) return candidate;
		const xOnly = { ...fallback, x: candidate.x };
		if (!taskOverlapsOthers(id, xOnly)) return xOnly;
		const yOnly = { ...fallback, y: candidate.y };
		if (!taskOverlapsOthers(id, yOnly)) return yOnly;
		return fallback;
	}

	function updateClusterPreview(taskId: string, box: Rect) {
		let best: ClusterTarget = null;
		let bestArea = Infinity;

		for (const zone of zones) {
			const zbox = zoneXY(zone);
			if (contains(zbox, box)) continue; // already fully inside — no resize needed
			if (!intersects(box, zbox, CLUSTER_GAP)) continue;
			const rect = clampRect(withHeadClearance(unionRect(box, zbox, ZONE_PAD)));
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
				const rect = clampRect(withHeadClearance(unionRect(box, obox, ZONE_PAD)));
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

	function handleZoneNameClick(e: MouseEvent, zone: Zone) {
		if (!addMode) {
			colorPickerZoneId = zone.id;
			colorPickerPos = { x: e.clientX, y: e.clientY };
		} else {
			startRename(zone);
		}
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

	async function submitComposerTask(c: ComposerState) {
		const fd = new FormData();
		fd.set('title', c.title.trim());
		fd.set('x', String(Math.round(c.x)));
		fd.set('y', String(Math.round(c.y)));
		if (c.dueDate) fd.set('dueDate', c.dueDate);
		if (c.priority) fd.set('priority', c.priority);
		await fetch('?/createTask', { method: 'POST', body: fd });
		await invalidateAll();
	}

	async function submitComposerZone(c: ComposerState) {
		const fd = new FormData();
		fd.set('name', c.title.trim());
		fd.set('color', c.color);
		fd.set('x', String(Math.round(c.x)));
		fd.set('y', String(Math.round(c.y)));
		await fetch('?/createZone', { method: 'POST', body: fd });
		await invalidateAll();
	}

	// Commits if a title/name was typed, otherwise discards silently — the
	// same commit-on-blur-if-non-empty pattern commitRename above uses.
	function resolveComposer() {
		if (!composer) return;
		const c = composer;
		composer = null;
		const title = c.title.trim();
		if (!title) return;
		if (c.mode === 'task') {
			void submitComposerTask(c);
		} else {
			void submitComposerZone(c);
		}
	}

	function cancelComposer() {
		composer = null;
	}

	function toggleAddMode() {
		addMode = !addMode;
		if (!addMode) resolveComposer();
	}

	async function openComposerAt(clientX: number, clientY: number) {
		resolveComposer(); // resolve whatever composer was already open first
		const rect = canvasEl?.getBoundingClientRect();
		if (!rect || !canvasEl) return;
		// .canvas-world scales from its center, so undoing the scale to land
		// back in world units is "distance from center, divided by zoom" —
		// not a flat subtract of rect.left/top.
		const cx = canvasEl.clientWidth / 2;
		const cy = canvasEl.clientHeight / 2;
		const sx = clientX - rect.left;
		const sy = clientY - rect.top;
		const { x, y } = clampPoint(
			cx + (sx - cx) / zoom,
			cy + (sy - cy) / zoom,
			COMPOSER_WIDTH,
			COMPOSER_HEIGHT
		);
		composer = { x, y, mode: 'task', title: '', dueDate: '', priority: '', color: 'sage' };
		await tick();
		composerInputEl?.focus();
	}

	function handleCanvasClick(e: MouseEvent) {
		if (!addMode) return;
		if (e.target !== canvasEl && e.target !== canvasWorldEl) return;
		void openComposerAt(e.clientX, e.clientY);
	}

	function handleComposerKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter') {
			e.preventDefault();
			resolveComposer();
		} else if (e.key === 'Escape') {
			e.preventDefault();
			cancelComposer();
		}
	}

	// Fields inside the composer (due date, priority, swatches) move focus
	// around within the same container — only resolve once focus actually
	// leaves the whole composer, not between its own fields.
	function handleComposerFocusOut(e: FocusEvent) {
		const container = e.currentTarget as HTMLElement;
		const next = e.relatedTarget as Node | null;
		if (next && container.contains(next)) return;
		resolveComposer();
	}

	// Mode/swatch buttons are one-click actions — keep focus on the text
	// input instead of moving it, so picking one never triggers the
	// focus-out commit/cancel logic above.
	function keepFocus(e: MouseEvent) {
		e.preventDefault();
	}

	function setComposerMode(mode: 'task' | 'zone') {
		if (composer) composer.mode = mode;
	}

	function setComposerColor(color: ZoneColor) {
		if (composer) composer.color = color;
	}

	const MIN_ZONE_WIDTH = 140;
	const MIN_ZONE_HEIGHT = 110;

	function startResize(e: PointerEvent, zone: Zone) {
		e.preventDefault();
		e.stopPropagation();
		const start = zoneXY(zone);
		const originX = e.clientX;
		const originY = e.clientY;
		const baseWidth = start.width;
		const baseHeight = start.height;
		const pointerId = e.pointerId;

		function cleanup() {
			window.removeEventListener('pointermove', move);
			window.removeEventListener('pointerup', up);
			window.removeEventListener('pointercancel', cancel);
		}
		function move(ev: PointerEvent) {
			if (ev.pointerId !== pointerId) return;
			const maxWidth = Math.max(MIN_ZONE_WIDTH, viewportBounds.maxX - start.x);
			const maxHeight = Math.max(MIN_ZONE_HEIGHT, viewportBounds.maxY - start.y);
			const width = Math.min(
				Math.max(MIN_ZONE_WIDTH, baseWidth + (ev.clientX - originX) / zoom),
				maxWidth
			);
			const height = Math.min(
				Math.max(MIN_ZONE_HEIGHT, baseHeight + (ev.clientY - originY) / zoom),
				maxHeight
			);
			const candidate = { x: start.x, y: start.y, width, height };
			const fallback = dragZone.get(zone.id) ?? {
				x: start.x,
				y: start.y,
				width: baseWidth,
				height: baseHeight
			};
			dragZone.set(zone.id, resolveZoneRect(zone.id, candidate, fallback));
		}
		function up(ev: PointerEvent) {
			if (ev.pointerId !== pointerId) return;
			cleanup();
			const final = dragZone.get(zone.id) ?? { ...start };
			void persist('zone', zone.id, final.x, final.y, final.width, final.height);
		}
		function cancel(ev: PointerEvent) {
			if (ev.pointerId !== pointerId) return;
			cleanup();
		}
		window.addEventListener('pointermove', move);
		window.addEventListener('pointerup', up);
		window.addEventListener('pointercancel', cancel);
	}

	function startDrag(
		e: PointerEvent,
		kind: 'task' | 'zone',
		id: string,
		base: { x: number; y: number },
		dims: { width: number; height: number }
	) {
		if ((e.target as HTMLElement).closest('button, input, select, a, form')) return;
		e.preventDefault();
		const originX = e.clientX;
		const originY = e.clientY;
		const baseX = base.x;
		const baseY = base.y;
		const pointerId = e.pointerId;
		let traveled = 0;

		function cleanup() {
			window.removeEventListener('pointermove', move);
			window.removeEventListener('pointerup', up);
			window.removeEventListener('pointercancel', cancel);
		}
		function move(ev: PointerEvent) {
			if (ev.pointerId !== pointerId) return;
			traveled = Math.max(traveled, Math.hypot(ev.clientX - originX, ev.clientY - originY));
			const raw = {
				x: baseX + (ev.clientX - originX) / zoom,
				y: baseY + (ev.clientY - originY) / zoom
			};
			const { x: nx, y: ny } = clampPoint(raw.x, raw.y, dims.width, dims.height);
			if (kind === 'task') {
				const prevTaskPos = dragTask.get(id) ?? { x: baseX, y: baseY };
				const candidate = { x: nx, y: ny, width: dims.width, height: dims.height };
				const fallback = { ...prevTaskPos, width: dims.width, height: dims.height };
				const resolved = resolveTaskRect(id, candidate, fallback);
				dragTask.set(id, { x: resolved.x, y: resolved.y });
				updateClusterPreview(id, {
					x: resolved.x,
					y: resolved.y,
					width: DEFAULT_CARD.width,
					height: DEFAULT_CARD.height
				});
			} else {
				const prevZonePos = dragZone.get(id) ?? {
					x: baseX,
					y: baseY,
					width: dims.width,
					height: dims.height
				};
				const candidate = { x: nx, y: ny, width: dims.width, height: dims.height };
				const resolved = resolveZoneRect(id, candidate, prevZonePos);
				const delta = { x: resolved.x - prevZonePos.x, y: resolved.y - prevZonePos.y };
				dragZone.set(id, resolved);

				// Move all tasks that visually belong to this zone along with it — same
				// center-point ownership test the zone-color dot uses, so a task never
				// shows as "in" the zone without also being dragged with it.
				const liveZones = zones.map((z) => ({ ...zoneXY(z), id: z.id }));
				for (const task of tasks) {
					const taskPos = taskXY(task);
					if (zoneForTask(taskCenter(taskPos), liveZones)?.id === id) {
						dragTask.set(task.id, { x: taskPos.x + delta.x, y: taskPos.y + delta.y });
					}
				}
			}
		}
		function up(ev: PointerEvent) {
			if (ev.pointerId !== pointerId) return;
			cleanup();

			if (traveled < CLICK_MOVE_THRESHOLD) {
				// A tap, not a drag: revert any micro-jitter.
				clusterTarget = null;
				previewRect = null;
				if (kind === 'task') {
					dragTask.set(id, base);
					openTaskId = id;
				} else {
					// Tapping empty space inside a zone opens the composer there,
					// same as tapping empty canvas (when add mode is on).
					dragZone.set(id, { ...base, width: dims.width, height: dims.height });
					if (addMode) void openComposerAt(ev.clientX, ev.clientY);
				}
				return;
			}

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
				const final = dragZone.get(id) ?? { ...base, width: dims.width, height: dims.height };
				void persist('zone', id, final.x, final.y, final.width, final.height);

				// Persist all tasks that belong to this zone (same test as above)
				const liveZoneBounds = zones.map((z) => ({ ...zoneXY(z), id: z.id }));
				for (const task of tasks) {
					const finalTaskPos = dragTask.get(task.id);
					if (finalTaskPos) {
						if (zoneForTask(taskCenter(finalTaskPos), liveZoneBounds)?.id === id) {
							void persist('task', task.id, finalTaskPos.x, finalTaskPos.y);
						}
					}
				}
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

<div class="canvas-toolbar">
	<div class="toolbar-label">
		<button
			type="button"
			class="add-mode-toggle"
			class:active={addMode}
			onclick={toggleAddMode}
			aria-pressed={addMode}
		>
			Add
		</button>
		<p class="hint">
			{addMode ? 'Click anywhere to add a task' : 'Add mode off — drag to rearrange'}
		</p>
	</div>
	<div class="toolbar-controls">
		<div class="zoom-control">
			<button
				type="button"
				class="zoom-btn"
				onclick={zoomOut}
				disabled={zoom <= zoomMin}
				aria-label="Zoom out">−</button
			>
			<span class="zoom-readout">{Math.round(zoom * 100)}%</span>
			<button
				type="button"
				class="zoom-btn"
				onclick={zoomIn}
				disabled={zoom >= 1}
				aria-label="Zoom in">+</button
			>
		</div>
	</div>
</div>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="canvas" bind:this={canvasEl} onclick={handleCanvasClick}>
	<div class="canvas-world" bind:this={canvasWorldEl} style="transform: scale({zoom});">
		{#each zones as zone (zone.id)}
			{@const r = zoneXY(zone)}
			{@const c = colorOf(zone.color)}
			<!-- svelte-ignore a11y_no_static_element_interactions -->
			<div
				class="zone"
				style="left:{r.x}px; top:{r.y}px; width:{r.width}px; height:{r.height}px; background:{c.fill}; border-color:{c.border}; border-radius:{blobRadius(
					zone.id
				)};"
				onpointerdown={(e) =>
					startDrag(e, 'zone', zone.id, r, { width: r.width, height: r.height })}
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
						<button
							class="zone-name"
							type="button"
							title={addMode ? 'Click to rename' : 'Click to change color'}
							onclick={(e) => handleZoneNameClick(e, zone)}>{zone.name}</button
						>
					{/if}
					<form method="POST" action="?/deleteZone" use:enhance>
						<input type="hidden" name="id" value={zone.id} />
						<button class="btn btn-ghost btn-icon" type="submit" aria-label="Delete zone">×</button>
					</form>
				</div>
				<!-- svelte-ignore a11y_no_static_element_interactions -->
				<div
					class="zone-resize-handle"
					title="Resize {zone.name}"
					aria-hidden="true"
					onpointerdown={(e) => startResize(e, zone)}
				></div>
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

		{#if !openTaskId}
			{#each tasks as task (task.id)}
				{@const p = taskXY(task)}
				<!-- svelte-ignore a11y_no_static_element_interactions -->
				<div
					class="floating"
					style="left:{p.x}px; top:{p.y}px; z-index:{Math.min(task.sortOrder, 900)};"
					onpointerdown={(e) =>
						startDrag(e, 'task', task.id, p, {
							width: (e.currentTarget as HTMLElement).offsetWidth || DEFAULT_CARD.width,
							height: (e.currentTarget as HTMLElement).offsetHeight || DEFAULT_CARD.height
						})}
				>
					<TaskCard {task} zoneColor={zoneDotFor(task)} />
				</div>
			{/each}
		{/if}

		{#if composer}
			<div
				class="composer"
				style="left:{composer.x}px; top:{composer.y}px;"
				onfocusout={handleComposerFocusOut}
			>
				<div class="composer-toggle" role="group" aria-label="Item type">
					<button
						type="button"
						class="composer-toggle-btn"
						class:active={composer.mode === 'task'}
						onmousedown={keepFocus}
						onclick={() => setComposerMode('task')}>Task</button
					>
					<button
						type="button"
						class="composer-toggle-btn"
						class:active={composer.mode === 'zone'}
						onmousedown={keepFocus}
						onclick={() => setComposerMode('zone')}>Zone</button
					>
				</div>
				<input
					class="composer-input"
					bind:this={composerInputEl}
					bind:value={composer.title}
					placeholder={composer.mode === 'task' ? 'Task title…' : 'Zone name…'}
					onkeydown={handleComposerKeydown}
				/>
				{#if composer.mode === 'task'}
					<div class="composer-fields">
						<label><span>Due</span><input type="date" bind:value={composer.dueDate} /></label>
						<label
							><span>Priority</span>
							<select bind:value={composer.priority}>
								<option value="">None</option>
								<option value="low">Low</option>
								<option value="med">Medium</option>
								<option value="high">High</option>
							</select>
						</label>
					</div>
				{:else}
					<div class="composer-swatches">
						{#each ZONE_COLOR_KEYS as key (key)}
							<button
								type="button"
								class="composer-swatch"
								class:selected={composer.color === key}
								style="background:{ZONE_COLORS[key].fill}; border-color:{ZONE_COLORS[key].border};"
								aria-label={key}
								onmousedown={keepFocus}
								onclick={() => setComposerColor(key)}
							></button>
						{/each}
					</div>
				{/if}
			</div>
		{/if}
	</div>
</div>

{#if openTask}
	<TaskDetailModal task={openTask} onclose={() => (openTaskId = null)} />
{/if}

{#if colorPickerZoneId}
	<ZoneColorPicker
		zoneId={colorPickerZoneId}
		x={colorPickerPos.x}
		y={colorPickerPos.y}
		onclose={() => (colorPickerZoneId = null)}
	/>
{/if}

<style>
	.canvas-toolbar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
		margin: 0 0 0.75rem;
		flex-shrink: 0;
	}
	.hint {
		margin: 0;
		color: var(--muted);
		font-size: 0.85rem;
	}
	.toolbar-label {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		min-width: 0;
	}
	.canvas {
		position: relative;
		flex: 1;
		min-height: 0;
		width: 100%;
		overflow: hidden;
	}
	.canvas-world {
		position: absolute;
		inset: 0;
		transform-origin: center center;
		transition: transform 150ms ease;
	}
	.toolbar-controls {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		flex-shrink: 0;
	}
	.add-mode-toggle {
		flex-shrink: 0;
		padding: 0.3rem 0.85rem;
		border: 1px solid var(--border-strong);
		border-radius: 999px;
		background: var(--surface-2);
		color: var(--muted);
		font-size: 0.78rem;
		font-weight: 600;
		cursor: pointer;
	}
	.add-mode-toggle.active {
		background: var(--accent);
		border-color: var(--accent);
		color: var(--accent-ink);
	}
	.zoom-control {
		display: flex;
		align-items: center;
		gap: 0.35rem;
		padding: 0.25rem 0.4rem;
		background: var(--surface);
		border: 1px solid var(--border-strong);
		border-radius: 999px;
		box-shadow: var(--shadow-raised);
	}
	.zoom-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 22px;
		height: 22px;
		border: none;
		border-radius: 999px;
		background: var(--surface-2);
		color: inherit;
		font-size: 0.95rem;
		line-height: 1;
		cursor: pointer;
	}
	.zoom-btn:disabled {
		opacity: 0.4;
		cursor: default;
	}
	.zoom-readout {
		min-width: 2.6rem;
		text-align: center;
		font-size: 0.78rem;
		color: var(--muted);
		font-variant-numeric: tabular-nums;
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
	.zone-resize-handle {
		position: absolute;
		right: 2px;
		bottom: 2px;
		width: 16px;
		height: 16px;
		cursor: nwse-resize;
		touch-action: none;
		background: linear-gradient(
			135deg,
			transparent 0%,
			transparent 40%,
			var(--border-strong) 40%,
			var(--border-strong) 48%,
			transparent 48%,
			transparent 60%,
			var(--border-strong) 60%,
			var(--border-strong) 68%,
			transparent 68%
		);
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
	.composer {
		position: absolute;
		z-index: 950;
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
		width: 220px;
		padding: 0.6rem;
		background: var(--surface);
		border: 1px solid var(--border-strong);
		border-radius: var(--radius-m);
		box-shadow: var(--shadow-raised);
	}
	.composer-toggle {
		display: flex;
		gap: 0.25rem;
		align-self: flex-start;
		padding: 0.15rem;
		background: var(--surface-2);
		border-radius: 999px;
	}
	.composer-toggle-btn {
		padding: 0.2rem 0.7rem;
		border: none;
		border-radius: 999px;
		background: transparent;
		color: var(--muted);
		font-size: 0.78rem;
		font-weight: 600;
		cursor: pointer;
	}
	.composer-toggle-btn.active {
		background: var(--accent);
		color: var(--accent-ink);
	}
	.composer-input {
		width: 100%;
	}
	.composer-fields {
		display: flex;
		gap: 0.6rem;
	}
	.composer-fields label {
		display: flex;
		flex: 1;
		min-width: 0;
		flex-direction: column;
		gap: 0.2rem;
	}
	.composer-fields span {
		font-size: 0.72rem;
		color: var(--muted);
	}
	.composer-fields input,
	.composer-fields select {
		width: 100%;
	}
	.composer-swatches {
		display: flex;
		gap: 0.4rem;
	}
	.composer-swatch {
		width: 24px;
		height: 24px;
		border: 1.5px solid;
		border-radius: 999px;
		padding: 0;
		cursor: pointer;
	}
	.composer-swatch.selected {
		outline: 2px solid var(--accent);
		outline-offset: 2px;
	}
</style>
