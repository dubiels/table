<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import Mascot from './Mascot.svelte';
	import { localDateString } from '$lib/listView';
	import { toast } from '$lib/toast.svelte';
	import type { AgendaEvent } from '$lib/server/gcal/agenda';

	type PanelTask = {
		id: string;
		title: string;
		done: boolean;
		dueDate: string | null;
		source: string;
		courseName: string | null;
	};

	let {
		mode,
		open,
		tab = $bindable(),
		agenda,
		gcalConfigured,
		lmsConfigured,
		tasks,
		anchor,
		onopen,
		onclose
	}: {
		/** Docked beside the board on wide screens; a slide-over drawer below 1100px. */
		mode: 'docked' | 'overlay';
		open: boolean;
		tab: 'today' | 'canvas';
		agenda: AgendaEvent[];
		gcalConfigured: boolean;
		lmsConfigured: boolean;
		tasks: PanelTask[];
		/** The button that opens the drawer — excluded from the outside-click test. */
		anchor: HTMLElement | null;
		onopen: () => void;
		onclose: (refocus?: boolean) => void;
	} = $props();

	let panelEl = $state<HTMLElement | null>(null);
	let syncing = $state(false);

	const today = localDateString();

	// ---- Today tab -------------------------------------------------------------

	const MS_PER_DAY = 86_400_000;
	const UPCOMING_DAYS = 4;

	const startOfDay = (date: Date) =>
		new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();

	function daysFromToday(iso: string): number {
		return Math.round((startOfDay(new Date(iso)) - startOfDay(new Date())) / MS_PER_DAY);
	}

	function dayLabel(iso: string): string {
		const diffDays = daysFromToday(iso);
		if (diffDays === 0) return 'Today';
		if (diffDays === 1) return 'Tomorrow';
		return new Date(iso).toLocaleDateString(undefined, {
			weekday: 'short',
			month: 'short',
			day: 'numeric'
		});
	}

	function timeLabel(event: AgendaEvent): string {
		if (event.allDay) return 'all day';
		return new Date(event.start).toLocaleTimeString(undefined, {
			hour: 'numeric',
			minute: '2-digit'
		});
	}

	let todayHeading = $derived(
		new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })
	);

	// All-day events first: they frame the day rather than sit at a point in it,
	// so a timed 9am meeting listed above an all-day conference reads backwards.
	let todayEvents = $derived(
		agenda
			.filter((event) => daysFromToday(event.start) === 0)
			.sort((a, b) => {
				if (a.allDay !== b.allDay) return a.allDay ? -1 : 1;
				return a.start.localeCompare(b.start);
			})
	);

	// Events arrive sorted ascending by start, so same-day events are always
	// adjacent — a running list groups them without reaching for a Map.
	let upcomingGroups = $derived.by(() => {
		const result: { label: string; items: AgendaEvent[] }[] = [];
		for (const event of agenda) {
			if (daysFromToday(event.start) < 1) continue;
			const label = dayLabel(event.start);
			const current = result.at(-1);
			if (current && current.label === label) {
				current.items.push(event);
			} else {
				if (result.length === UPCOMING_DAYS) break;
				result.push({ label, items: [event] });
			}
		}
		return result;
	});

	// ---- Canvas tab ------------------------------------------------------------

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

	type SyncBody = {
		error?: string;
		created?: number;
		updated?: number;
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
				toast(`Synced — ${body.created} new, ${body.updated} updated`, 'success');
				await invalidateAll();
			}
		} catch {
			toast('Sync failed', 'error');
		} finally {
			syncing = false;
		}
	}

	// ---- Drawer dismissal (overlay mode only) ----------------------------------

	// Capture phase for the same reason TopBar's menu uses it: task cards and list
	// rows stopPropagation() on their own clicks, so a bubble-phase listener would
	// never see them and the drawer would stay stuck open over the board.
	//
	// The test is scoped to this panel's own element plus the button that opens
	// it, so it neither fights TopBar's listener (which only ever asks about
	// .user-menu) nor closes the drawer on the very click that opened it. Docked
	// mode never registers it: a click on the board must not fold the panel away.
	$effect(() => {
		if (mode !== 'overlay' || !open) return;
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
		if (e.key === 'Escape' && mode === 'overlay' && open) onclose(true);
	}
</script>

<svelte:window onkeydown={onWindowKeydown} />

{#if mode === 'docked' && !open}
	<button
		type="button"
		class="edge-strip"
		aria-expanded="false"
		aria-controls="side-panel"
		title="Show Today and Canvas"
		onclick={onopen}
	>
		<span class="edge-text">Today · Canvas</span>
	</button>
{:else}
	<aside
		class="side-panel"
		class:overlay={mode === 'overlay'}
		class:open
		id="side-panel"
		bind:this={panelEl}
		aria-label="Today and Canvas"
		aria-hidden={mode === 'overlay' && !open}
	>
		<div class="panel-head">
			<div class="tabs" role="tablist" aria-label="Side panel">
				<button
					type="button"
					role="tab"
					aria-selected={tab === 'today'}
					class="tab"
					class:active={tab === 'today'}
					onclick={() => (tab = 'today')}
				>
					Today
				</button>
				<button
					type="button"
					role="tab"
					aria-selected={tab === 'canvas'}
					class="tab"
					class:active={tab === 'canvas'}
					onclick={() => (tab = 'canvas')}
				>
					Canvas
					{#if assignmentCount > 0}<span class="count">{assignmentCount}</span>{/if}
				</button>
			</div>
			<button
				type="button"
				class="btn btn-ghost btn-icon collapse"
				aria-label={mode === 'overlay' ? 'Close panel' : 'Collapse panel'}
				onclick={() => onclose(true)}
			>
				{mode === 'overlay' ? '×' : '›'}
			</button>
		</div>

		<div class="panel-body">
			{#if tab === 'today'}
				<section class="today">
					<h2 class="today-title">Today</h2>
					<p class="today-date">{todayHeading}</p>

					{#if !gcalConfigured}
						<div class="empty">
							<Mascot mood="sleepy" />
							<p>No calendar connected.</p>
						</div>
						<ol class="setup">
							<li>
								In Google Calendar, open <strong>Settings → your calendar</strong> and copy the
								<strong>Secret address in iCal format</strong>.
							</li>
							<li>
								Add <code>GCAL_ICAL_URLS=&lt;url&gt;</code> to <code>.env</code> — comma-separated for
								several calendars — and restart to pick it up.
							</li>
						</ol>
					{:else if todayEvents.length === 0}
						<div class="empty">
							<Mascot mood="happy" />
							<p>Nothing today.</p>
						</div>
					{:else}
						<ul class="today-events">
							{#each todayEvents as event (event.id)}
								<li class="today-event">
									<span class="today-time">{timeLabel(event)}</span>
									<span class="detail">
										<span class="title">{event.title}</span>
										{#if event.location}<span class="location">{event.location}</span>{/if}
									</span>
								</li>
							{/each}
						</ul>
					{/if}
				</section>

				{#if upcomingGroups.length > 0}
					<section class="upcoming">
						<h3>Upcoming</h3>
						{#each upcomingGroups as group (group.label)}
							<div class="group">
								<div class="day">{group.label}</div>
								{#each group.items as event (event.id)}
									<div class="event">
										<span class="time">{timeLabel(event)}</span>
										<span class="detail">
											<span class="title">{event.title}</span>
											{#if event.location}<span class="location">{event.location}</span>{/if}
										</span>
									</div>
								{/each}
							</div>
						{/each}
					</section>
				{/if}
			{:else if lmsConfigured}
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
			{:else}
				<h3 class="setup-title">Connect Canvas</h3>
				<ol class="setup">
					<li>In Canvas, open <strong>Calendar → Calendar Feed</strong> and copy the .ics URL.</li>
					<li>
						Add <code>LMS_ICAL_URL=&lt;url&gt;</code> to <code>.env</code>, or
						<code>flyctl secrets set LMS_ICAL_URL=…</code> on a deployed app. Restart to pick it up.
					</li>
					<li>Assignments due in the next two weeks show up here and in the list view.</li>
				</ol>
			{/if}
		</div>
	</aside>
{/if}

<style>
	.side-panel {
		width: 320px;
		flex-shrink: 0;
		display: flex;
		flex-direction: column;
		min-height: 0;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius-m);
		overflow: hidden;
	}

	/* Below 1100px the panel stops being furniture and becomes a drawer: fixed to
	   the right edge, starting where the shell's header ends. */
	.side-panel.overlay {
		position: fixed;
		top: var(--topbar-height);
		right: 0;
		bottom: 0;
		width: min(340px, 100vw);
		border: none;
		border-left: 1px solid var(--border-strong);
		border-radius: 0;
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

	.side-panel.overlay.open {
		transform: translateX(0);
		visibility: visible;
	}

	/* The drawer is still a drawer without the slide; motion is the part that is
	   optional. */
	@media (prefers-reduced-motion: reduce) {
		.side-panel.overlay {
			transition: none;
		}
	}

	/* Collapsed: a 28px spine that keeps the panel's place in the row and says
	   what comes back when it is clicked. */
	.edge-strip {
		flex-shrink: 0;
		width: 28px;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 0.6rem 0;
		border: 1px solid var(--border);
		border-radius: var(--radius-m);
		background: var(--surface);
		color: var(--muted);
		cursor: pointer;
		transition:
			background 0.15s ease,
			color 0.15s ease;
	}

	.edge-strip:hover {
		background: var(--surface-2);
		color: var(--ink);
	}

	.edge-text {
		writing-mode: vertical-rl;
		font-size: 0.75rem;
		font-weight: 600;
		letter-spacing: 0.06em;
		white-space: nowrap;
	}

	.panel-head {
		flex-shrink: 0;
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.4rem;
		padding: 0.5rem 0.55rem;
		border-bottom: 1px solid var(--border);
	}

	/* The same pill-in-a-tray shape as ViewSwitcher, so the two segmented controls
	   on this page read as one family. */
	.tabs {
		display: inline-flex;
		gap: 2px;
		padding: 3px;
		background: var(--surface-2);
		border-radius: 999px;
	}

	.tab {
		display: inline-flex;
		align-items: center;
		gap: 0.3rem;
		border: none;
		background: transparent;
		color: var(--muted);
		font-size: 0.82rem;
		font-weight: 600;
		padding: 0.28rem 0.8rem;
		border-radius: 999px;
		cursor: pointer;
		transition:
			background 0.15s ease,
			color 0.15s ease,
			box-shadow 0.15s ease;
	}

	.tab:hover {
		color: var(--ink);
	}

	.tab.active {
		background: var(--surface);
		color: var(--ink);
		box-shadow: var(--shadow-card);
	}

	.count {
		font-size: 0.7rem;
		font-weight: 700;
		color: var(--muted);
		font-variant-numeric: tabular-nums;
	}

	.collapse {
		flex-shrink: 0;
		font-size: 1rem;
	}

	.panel-body {
		flex: 1;
		min-height: 0;
		overflow-y: auto;
		padding: 0.9rem;
		display: flex;
		flex-direction: column;
		gap: 1.1rem;
	}

	.today-title {
		font-size: 1.15rem;
		font-weight: 700;
	}

	.today-date {
		margin: 0.1rem 0 0.7rem;
		font-size: 0.78rem;
		color: var(--muted);
	}

	.today-events {
		display: flex;
		flex-direction: column;
		gap: 0.55rem;
	}

	.today-event {
		display: flex;
		gap: 0.6rem;
		min-width: 0;
	}

	.today-time {
		flex: 0 0 4rem;
		font-size: 0.85rem;
		font-weight: 600;
		line-height: 1.35;
		color: var(--ink);
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.today-event .title {
		font-size: 0.95rem;
	}

	.upcoming {
		display: flex;
		flex-direction: column;
		gap: 0.7rem;
		padding-top: 0.9rem;
		border-top: 1px solid var(--border);
	}

	.group {
		display: flex;
		flex-direction: column;
		gap: 0.45rem;
		padding-left: 0.6rem;
		border-left: 2px solid var(--border-strong);
	}

	.day {
		font-size: 0.72rem;
		color: var(--muted);
		letter-spacing: 0.04em;
		text-transform: uppercase;
	}

	.event {
		display: flex;
		gap: 0.5rem;
		min-width: 0;
	}

	.time {
		flex: 0 0 3.5rem;
		font-size: 0.78rem;
		line-height: 1.45;
		color: var(--muted);
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.detail {
		display: flex;
		flex-direction: column;
		min-width: 0;
	}

	.title {
		font-size: 0.85rem;
		line-height: 1.35;
		color: var(--ink);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.location {
		font-size: 0.72rem;
		color: var(--muted);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.sync-btn {
		align-self: flex-start;
	}

	.empty {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.4rem;
		padding: 1.2rem 0;
	}

	.empty p {
		margin: 0;
		color: var(--muted);
		font-size: 0.88rem;
	}

	.course h3,
	.upcoming h3 {
		margin: 0 0 0.4rem;
		font-size: 0.78rem;
		font-weight: 700;
		letter-spacing: 0.04em;
		text-transform: uppercase;
		color: var(--muted);
	}

	.setup-title {
		font-size: 0.98rem;
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
</style>
