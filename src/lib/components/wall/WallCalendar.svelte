<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import RefreshButton from '../RefreshButton.svelte';
	import canvasLogo from '$lib/assets/canvas-logo.png';
	import { toast } from '$lib/toast.svelte';
	import { placeDay, allDayEvents, dayBounds } from '$lib/wallDay';
	import type { AgendaEvent } from '$lib/server/gcal/agenda';

	let {
		agenda,
		calendars,
		lmsConfigured,
		gtasksConfigured,
		now,
		onexit
	}: {
		/** Today's events only; the wall draws one day. */
		agenda: AgendaEvent[];
		/** Configured calendars in order, which is also the colour order. */
		calendars: Array<{ id: string; label: string }>;
		lmsConfigured: boolean;
		gtasksConfigured: boolean;
		/** Ticks each minute, so the clock and the now-line follow it. */
		now: Date;
		onexit: () => void;
	} = $props();

	// Deep enough to carry white text, far enough apart to tell on a panel that
	// shifts colour with viewing angle, and none of them the amber that means
	// "now" or the red that means "late".
	const CALENDAR_COLORS = ['#3d6076', '#7d4649', '#4a5a38', '#5a4a6b'];

	/** Below this, a block has no room for a second line of time. */
	const TIME_MIN_HEIGHT = 34;
	const TIME_MIN_WIDTH = 84;

	let gridEl = $state<HTMLDivElement | undefined>();
	let gridSize = $state({ width: 150, height: 400 });

	$effect(() => {
		if (!gridEl) return;
		const observer = new ResizeObserver(([entry]) => {
			gridSize = { width: entry.contentRect.width, height: entry.contentRect.height };
		});
		observer.observe(gridEl);
		return () => observer.disconnect();
	});

	let bounds = $derived(dayBounds(agenda, now));
	let span = $derived((bounds.endHour - bounds.startHour) * 60);
	let placed = $derived(placeDay(agenda, bounds));
	let allDay = $derived(allDayEvents(agenda));

	let colorOf = $derived(
		new Map(calendars.map((c, i) => [c.id, CALENDAR_COLORS[i % CALENDAR_COLORS.length]]))
	);

	let minutesNow = $derived(now.getHours() * 60 + now.getMinutes());
	let nowOffset = $derived((minutesNow - bounds.startHour * 60) / span);

	const hhmm = (date: Date) =>
		date
			.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
			.replace(/\s?[ap]\.?m\.?/i, '');

	let clock = $derived(hhmm(now));
	let weekday = $derived(now.toLocaleDateString(undefined, { weekday: 'long' }));
	let date = $derived(now.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }));

	let hours = $derived(
		Array.from({ length: bounds.endHour - bounds.startHour + 1 }, (_, i) => bounds.startHour + i)
	);

	const hourLabel = (hour: number) =>
		hour === 12 ? 'noon' : hour > 12 ? `${hour - 12} pm` : `${hour} am`;

	/** Where a minute-of-day sits down the grid, as a percentage. */
	const y = (minutes: number) => ((minutes - bounds.startHour * 60) / span) * 100;

	const range = (event: AgendaEvent) =>
		event.end
			? `${hhmm(new Date(event.start))} to ${hhmm(new Date(event.end))}`
			: hhmm(new Date(event.start));

	let syncingTasks = $state(false);
	let syncingCanvas = $state(false);

	/** The same calls, and the same wording, as the buttons on the board. */
	async function post(url: string, describe: (body: Record<string, number>) => string) {
		const res = await fetch(url, { method: 'POST' });
		const body = res.headers.get('content-type')?.includes('application/json')
			? ((await res.json()) as Record<string, number> & { ok?: boolean; error?: string })
			: null;
		if (!res.ok || !body || body.ok === false) throw new Error(body?.error ?? `HTTP ${res.status}`);
		await invalidateAll();
		return describe(body);
	}

	async function syncGoogleTasks() {
		syncingTasks = true;
		try {
			toast(
				await post(
					'/api/gtasks/sync',
					(b) => `Google Tasks synced — ${b.imported ?? 0} in, ${b.pushed ?? 0} out`
				),
				'success'
			);
		} catch {
			toast('Google Tasks sync failed', 'error');
		} finally {
			syncingTasks = false;
		}
	}

	async function syncCanvas() {
		syncingCanvas = true;
		try {
			toast(
				await post(
					'/api/lms/sync',
					(b) => `Canvas synced — ${b.created ?? 0} new, ${b.updated ?? 0} updated`
				),
				'success'
			);
		} catch {
			toast('Canvas sync failed', 'error');
		} finally {
			syncingCanvas = false;
		}
	}
</script>

<aside class="rail">
	<header>
		<div class="date">
			<span class="weekday">{weekday}</span>
			<b>{date}</b>
		</div>
		<!-- The clock doubles as the way out: the one control on the wall, in the
		     corner a hand reaches for, and nothing a glance mistakes for work. -->
		<button type="button" class="clock" onclick={onexit} title="Leave wall view">{clock}</button>
	</header>

	{#if allDay.length > 0}
		<ul class="all-day">
			{#each allDay as event (event.id)}
				<li style="--calendar:{colorOf.get(event.calendarId) ?? CALENDAR_COLORS[0]}">
					{event.title}
				</li>
			{/each}
		</ul>
	{/if}

	<div class="grid" bind:this={gridEl}>
		{#each hours as hour (hour)}
			<div class="line" style="top:{y(hour * 60)}%"></div>
			<span class="hour" style="top:{y(hour * 60)}%">{hourLabel(hour)}</span>
		{/each}

		<!-- Events live in their own track, inset past the hour labels, so lane
		     widths are a share of the track rather than of the whole rail. That
		     is what stopped them colliding with the times. -->
		<div class="track">
			{#each placed as item (item.event.id)}
				{@const width = (100 - 2 * (item.lanes - 1)) / item.lanes}
				{@const height = ((item.end - item.start) / span) * gridSize.height}
				{@const roomy =
					height >= TIME_MIN_HEIGHT && (gridSize.width * width) / 100 >= TIME_MIN_WIDTH}
				<div
					class="event"
					class:tight={height < TIME_MIN_HEIGHT}
					class:done={item.end <= minutesNow}
					style="--calendar:{colorOf.get(item.event.calendarId) ?? CALENDAR_COLORS[0]};top:{y(
						item.start
					)}%;height:{((item.end - item.start) / span) * 100}%;left:{item.lane *
						(width + 2)}%;width:{width}%"
				>
					<span>{item.event.title}</span>
					{#if roomy}<span class="time">{range(item.event)}</span>{/if}
				</div>
			{/each}

			{#if nowOffset >= 0 && nowOffset <= 1}
				<div class="now" style="top:{nowOffset * 100}%"></div>
			{/if}
		</div>
	</div>

	<footer>
		{#if calendars.length > 1}
			<ul class="legend">
				{#each calendars as calendar, index (calendar.id)}
					<li>
						<i style="--calendar:{CALENDAR_COLORS[index % CALENDAR_COLORS.length]}"></i>
						{calendar.label}
					</li>
				{/each}
			</ul>
		{/if}
		{#if gtasksConfigured || lmsConfigured}
			<div class="syncs">
				{#if gtasksConfigured}
					<span class="sync">
						<RefreshButton
							label="Sync Google Tasks"
							spinning={syncingTasks}
							onclick={syncGoogleTasks}
						/>
						Tasks
					</span>
				{/if}
				{#if lmsConfigured}
					<span class="sync">
						<RefreshButton label="Sync Canvas" spinning={syncingCanvas} onclick={syncCanvas} />
						<span class="canvas-chip"><img src={canvasLogo} alt="" width="10" height="10" /></span>
						Canvas
					</span>
				{/if}
			</div>
		{/if}
	</footer>
</aside>

<style>
	.rail {
		background: var(--wall-rail);
		display: flex;
		flex-direction: column;
		min-height: 0;
		padding-bottom: 8px;
	}

	header {
		display: flex;
		align-items: flex-end;
		justify-content: space-between;
		gap: 8px;
		padding: 14px 14px 10px;
	}

	.date {
		display: flex;
		flex-direction: column;
		line-height: 1.15;
	}

	.weekday {
		font-size: 13.5px;
		color: var(--wall-dim);
	}

	.date b {
		font-size: 21px;
		font-weight: 600;
		letter-spacing: -0.02em;
	}

	.clock {
		background: none;
		border: 0;
		padding: 0;
		font: inherit;
		font-size: 26px;
		font-weight: 600;
		letter-spacing: -0.03em;
		color: var(--wall-soon);
		cursor: pointer;
		font-variant-numeric: tabular-nums;
	}

	.all-day {
		list-style: none;
		margin: 0 12px 8px;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 3px;
	}

	.all-day li {
		background: var(--calendar);
		border-radius: 5px;
		padding: 2px 7px;
		font-size: 12px;
		font-weight: 600;
		color: #f7f2e8;
	}

	.grid {
		position: relative;
		flex: 1;
		min-height: 0;
		margin-right: 10px;
	}

	.line {
		position: absolute;
		left: 44px;
		right: 0;
		border-top: 1px solid var(--wall-hour);
	}

	.hour {
		position: absolute;
		left: 0;
		width: 40px;
		text-align: right;
		transform: translateY(-50%);
		font-size: 11px;
		color: var(--wall-dim);
		white-space: nowrap;
	}

	.track {
		position: absolute;
		left: 44px;
		right: 0;
		top: 0;
		bottom: 0;
	}

	.event {
		position: absolute;
		border-radius: 6px;
		padding: 3px 7px;
		overflow: hidden;
		background: var(--calendar);
		color: #fbf7ef;
		font-size: 12.5px;
		font-weight: 600;
		line-height: 1.22;
	}

	/* A short meeting keeps its name and drops everything else, rather than
	   clipping both halfway through. */
	.event.tight {
		padding: 1px 7px;
		font-size: 11.5px;
	}

	/* A meeting that has happened is still part of the shape of the day, so it
	   steps back rather than disappearing. */
	.event.done {
		opacity: 0.42;
	}

	.time {
		display: block;
		font-size: 11px;
		font-weight: 500;
		color: #eadfcd;
		margin-top: 1px;
	}

	.now {
		position: absolute;
		left: -6px;
		right: 0;
		height: 2px;
		border-radius: 2px;
		background: var(--wall-late);
		z-index: 3;
	}

	.now::before {
		content: '';
		position: absolute;
		left: 0;
		top: -4px;
		width: 10px;
		height: 10px;
		border-radius: 50%;
		background: var(--wall-late);
	}

	footer {
		display: flex;
		flex-direction: column;
		gap: 8px;
		margin-top: 8px;
		padding: 10px 12px 0;
		border-top: 1px solid var(--wall-hour);
	}

	.legend {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-wrap: wrap;
		gap: 4px 12px;
		font-size: 11.5px;
		color: var(--wall-dim);
	}

	.legend li {
		display: inline-flex;
		align-items: center;
		gap: 6px;
	}

	.legend i {
		width: 9px;
		height: 9px;
		border-radius: 3px;
		background: var(--calendar);
	}

	.syncs {
		display: flex;
		flex-wrap: wrap;
		gap: 6px 14px;
	}

	.sync {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		font-size: 12px;
		font-weight: 600;
		color: var(--wall-dim);
	}

	.canvas-chip {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 14px;
		height: 14px;
		border-radius: 4px;
		background: #d64027;
	}

	.canvas-chip img {
		display: block;
	}
</style>
