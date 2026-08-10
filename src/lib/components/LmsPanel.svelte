<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import Mascot from './Mascot.svelte';
	import { localDateString } from '$lib/listView';
	import { zoneColorVars } from '$lib/zones';
	import { toast } from '$lib/toast.svelte';

	type PanelTask = {
		id: string;
		title: string;
		done: boolean;
		dueDate: string | null;
		source: string;
		courseName: string | null;
	};
	type PanelZone = { id: string; name: string; color: string };

	let {
		open,
		configured,
		tasks,
		zones,
		anchor,
		onclose
	}: {
		open: boolean;
		configured: boolean;
		tasks: PanelTask[];
		zones: PanelZone[];
		/** The button that opens the panel — excluded from the outside-click test. */
		anchor: HTMLElement | null;
		onclose: (refocus?: boolean) => void;
	} = $props();

	let panelEl = $state<HTMLElement | null>(null);
	let syncing = $state(false);

	const today = localDateString();

	const OTHER = 'Other';

	type CourseGroup = { course: string; tasks: PanelTask[] };

	// Grouped with a plain array rather than a Map: nothing here is reactive
	// state, and prefer-svelte-reactivity is right that a bare Map in a component
	// is usually a mistake. Courses keep first-seen order, "Other" always last.
	let groups = $derived.by(() => {
		const out: CourseGroup[] = [];
		for (const task of tasks) {
			if (task.source !== 'canvas') continue;
			const course = task.courseName?.trim() || OTHER;
			let group = out.find((g) => g.course === course);
			if (!group) {
				group = { course, tasks: [] };
				out.push(group);
			}
			group.tasks.push(task);
		}
		for (const group of out) {
			// Soonest first; undated assignments sink to the bottom of their course.
			group.tasks.sort((a, b) => {
				if (a.dueDate === b.dueDate) return a.title.localeCompare(b.title);
				if (!a.dueDate) return 1;
				if (!b.dueDate) return -1;
				return a.dueDate < b.dueDate ? -1 : 1;
			});
		}
		return out.sort((a, b) => {
			if (a.course === OTHER) return 1;
			if (b.course === OTHER) return -1;
			return a.course.localeCompare(b.course);
		});
	});

	let assignmentCount = $derived(groups.reduce((n, g) => n + g.tasks.length, 0));

	/**
	 * A due date as "Mon, Aug 17".
	 *
	 * Split and rebuilt field by field rather than handed to `new Date(str)`:
	 * a bare `YYYY-MM-DD` parses as UTC midnight, so west of Greenwich every
	 * assignment would render as the day before the one it is due.
	 */
	function formatDue(dueDate: string): string {
		const [year, month, day] = dueDate.split('-').map(Number);
		if (!year || !month || !day) return dueDate;
		return new Date(year, month - 1, day).toLocaleDateString(undefined, {
			weekday: 'short',
			month: 'short',
			day: 'numeric'
		});
	}

	async function copyZoneId(id: string) {
		try {
			await navigator.clipboard.writeText(id);
			toast('Zone id copied', 'success');
		} catch {
			// Clipboard access is refused outright over plain HTTP and in some
			// embedded browsers; saying so beats a button that silently does nothing.
			toast('Could not copy — select the id and copy it by hand', 'error');
		}
	}

	type SyncBody = {
		error?: string;
		created?: number;
		updated?: number;
		placedLoose?: boolean;
	};

	// A proxy error or a crashed route answers with an HTML page; res.json() would
	// throw and lose the status we could have reported instead.
	async function readJson(res: Response): Promise<SyncBody | null> {
		if (!res.headers.get('content-type')?.includes('application/json')) return null;
		try {
			return (await res.json()) as SyncBody;
		} catch {
			return null;
		}
	}

	async function syncNow() {
		syncing = true;
		toast('Syncing assignments…');
		try {
			const res = await fetch('/api/lms/sync', { method: 'POST' });
			const body = await readJson(res);
			if (!res.ok) {
				toast(body?.error ?? `Sync failed (HTTP ${res.status})`, 'error');
			} else if (!body) {
				toast('Sync failed — unexpected response', 'error');
			} else {
				toast(
					`Synced — ${body.created} new, ${body.updated} updated${body.placedLoose ? ' (placed loose)' : ''}`,
					'success'
				);
				await invalidateAll();
			}
		} catch {
			toast('Sync failed', 'error');
		} finally {
			syncing = false;
		}
	}

	// Capture phase for the same reason TopBar's menu uses it: task cards and list
	// rows stopPropagation() on their own clicks, so a bubble-phase listener would
	// never see them and the drawer would stay stuck open over the board.
	//
	// The test is scoped to this panel's own element plus the button that opens
	// it, so it neither fights TopBar's listener (which only ever asks about
	// .user-menu) nor closes the drawer on the very click that opened it.
	$effect(() => {
		if (!open) return;
		function onDocumentClick(e: MouseEvent) {
			const target = e.target as Node | null;
			if (!target) return;
			if (panelEl?.contains(target)) return;
			if (anchor?.contains(target)) return;
			onclose();
		}
		document.addEventListener('click', onDocumentClick, true);
		return () => document.removeEventListener('click', onDocumentClick, true);
	});

	function onWindowKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape' && open) onclose(true);
	}
</script>

<svelte:window onkeydown={onWindowKeydown} />

<aside
	class="lms-panel"
	class:open
	id="lms-panel"
	bind:this={panelEl}
	aria-label="Canvas"
	aria-hidden={!open}
>
	<header class="panel-head">
		<h2>{configured ? 'Canvas assignments' : 'Connect Canvas'}</h2>
		<button
			type="button"
			class="btn btn-ghost btn-icon"
			aria-label="Close Canvas panel"
			onclick={() => onclose(true)}
		>
			×
		</button>
	</header>

	<div class="panel-body">
		{#if configured}
			<button type="button" class="btn btn-primary sync-btn" disabled={syncing} onclick={syncNow}>
				{syncing ? 'Syncing…' : 'Sync now'}
			</button>

			{#if assignmentCount === 0}
				<div class="empty">
					<Mascot mood="sleepy" />
					<p>No assignments synced yet.</p>
				</div>
			{:else}
				{#each groups as group (group.course)}
					<section class="course">
						<h3>{group.course}</h3>
						<ul>
							{#each group.tasks as task (task.id)}
								<li class="row" class:done={task.done}>
									<span class="row-title">{task.title}</span>
									{#if task.dueDate}
										<span class="row-due" class:overdue={!task.done && task.dueDate < today}>
											Due {formatDue(task.dueDate)}
										</span>
									{:else}
										<span class="row-due">No due date</span>
									{/if}
								</li>
							{/each}
						</ul>
					</section>
				{/each}
			{/if}

			<details class="zone-setup">
				<summary>Zone setup</summary>
				{@render zoneList()}
			</details>
		{:else}
			<ol class="setup">
				<li>In Canvas, open <strong>Calendar → Calendar Feed</strong> and copy the .ics URL.</li>
				<li>
					Add <code>LMS_ICAL_URL=&lt;url&gt;</code> to <code>.env</code>, or
					<code>flyctl secrets set LMS_ICAL_URL=…</code> on a deployed app. Restart to pick it up.
				</li>
				<li>
					Optional: set <code>LMS_ZONE_ID</code> to one of the ids below so assignments land inside that
					zone. Leave it unset and they go loose on the open table.
				</li>
			</ol>
			{@render zoneList()}
		{/if}
	</div>
</aside>

{#snippet zoneList()}
	<div class="zones">
		<h3>Your zones</h3>
		{#if zones.length === 0}
			<p class="hint">No zones yet — group a couple of tasks on the board first.</p>
		{:else}
			<ul>
				{#each zones as zone (zone.id)}
					{@const c = zoneColorVars(zone.color)}
					<li class="zone-row">
						<span
							class="dot"
							style="background:{c.fill}; border-color:{c.border};"
							aria-hidden="true"
						></span>
						<span class="zone-name">{zone.name}</span>
						<code class="zone-id">{zone.id}</code>
						<button
							type="button"
							class="btn btn-ghost btn-icon copy"
							onclick={() => copyZoneId(zone.id)}
						>
							Copy id
						</button>
					</li>
				{/each}
			</ul>
		{/if}
	</div>
{/snippet}

<style>
	.lms-panel {
		position: fixed;
		top: var(--topbar-height); /* the drawer starts where the shell's header ends */
		right: 0;
		bottom: 0;
		width: min(340px, 100vw);
		display: flex;
		flex-direction: column;
		background: var(--surface);
		border-left: 1px solid var(--border-strong);
		box-shadow: var(--shadow-raised);
		/* Above the canvas (cards reach 900, the composer 950) and above the board
		   mascot at 960, but under the topbar's 999 and the task modal's 1000. */
		z-index: 980;
		transform: translateX(100%);
		visibility: hidden;
		transition:
			transform 200ms ease,
			visibility 200ms;
	}

	.lms-panel.open {
		transform: translateX(0);
		visibility: visible;
	}

	/* The drawer is still a drawer without the slide; motion is the part that is
	   optional. */
	@media (prefers-reduced-motion: reduce) {
		.lms-panel {
			transition: none;
		}
	}

	.panel-head {
		flex-shrink: 0;
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
		padding: 0.75rem 0.9rem;
		border-bottom: 1px solid var(--border);
	}

	.panel-head h2 {
		font-size: 0.98rem;
	}

	.panel-body {
		flex: 1;
		min-height: 0;
		overflow-y: auto;
		padding: 0.9rem;
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}

	.sync-btn {
		align-self: flex-start;
	}

	.empty {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.4rem;
		padding: 1.5rem 0;
	}

	.empty p {
		margin: 0;
		color: var(--muted);
		font-size: 0.88rem;
	}

	.course h3,
	.zones h3 {
		margin: 0 0 0.4rem;
		font-size: 0.78rem;
		font-weight: 700;
		letter-spacing: 0.04em;
		text-transform: uppercase;
		color: var(--muted);
	}

	ul,
	ol {
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.row {
		display: flex;
		flex-direction: column;
		gap: 0.1rem;
		padding: 0.4rem 0;
		border-top: 1px solid var(--border);
		font-size: 0.88rem;
	}

	.row-title {
		overflow-wrap: anywhere;
	}

	.row-due {
		font-size: 0.78rem;
		color: var(--muted);
	}

	.row-due.overdue {
		color: var(--danger);
		font-weight: 600;
	}

	.row.done .row-title {
		color: var(--muted);
		text-decoration: line-through;
	}

	.setup {
		margin: 0;
		padding-left: 1.1rem;
		list-style: decimal;
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
		color: var(--muted);
		font-size: 0.88rem;
		line-height: 1.5;
	}

	.setup strong {
		color: var(--ink);
		font-weight: 600;
	}

	code {
		font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
		font-size: 0.8rem;
		padding: 0.05rem 0.3rem;
		border-radius: var(--radius-s);
		background: var(--surface-2);
		color: var(--ink);
		overflow-wrap: anywhere;
	}

	.hint {
		margin: 0;
		color: var(--muted);
		font-size: 0.85rem;
	}

	.zone-row {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		padding: 0.35rem 0;
		border-top: 1px solid var(--border);
	}

	.dot {
		flex-shrink: 0;
		width: 0.7rem;
		height: 0.7rem;
		border: 1.5px solid;
		border-radius: 50%;
	}

	.zone-name {
		flex-shrink: 0;
		max-width: 7rem;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-size: 0.85rem;
	}

	.zone-id {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-size: 0.7rem;
		color: var(--muted);
	}

	.copy {
		flex-shrink: 0;
		font-size: 0.72rem;
	}

	.zone-setup summary {
		cursor: pointer;
		color: var(--muted);
		font-size: 0.82rem;
		font-weight: 600;
	}

	.zone-setup[open] summary {
		margin-bottom: 0.6rem;
	}
</style>
