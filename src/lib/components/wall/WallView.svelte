<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import WallCalendar from './WallCalendar.svelte';
	import WallBoard from './WallBoard.svelte';
	import { buildWallBoxes, type WallTask } from '$lib/wallBoard';
	import { eventsToday } from '$lib/agenda';
	import { localDateString } from '$lib/listView';
	import type { BentoZone } from '$lib/bento';
	import type { AgendaEvent } from '$lib/server/gcal/agenda';

	let {
		tasks,
		zones,
		agenda,
		calendars,
		lmsConfigured,
		gtasksConfigured,
		onexit
	}: {
		tasks: WallTask[];
		zones: BentoZone[];
		agenda: AgendaEvent[];
		calendars: Array<{ id: string; label: string }>;
		lmsConfigured: boolean;
		gtasksConfigured: boolean;
		onexit: () => void;
	} = $props();

	/** The wall reloads itself: nobody is standing at it pressing F5. */
	const REFRESH_MS = 5 * 60 * 1000;

	let now = $state(new Date());
	let today = $derived(localDateString(now));

	$effect(() => {
		// A minute is fine for a clock with no seconds on it, and it is also what
		// moves the now-line and rolls the date over at midnight.
		const tick = setInterval(() => (now = new Date()), 60_000);
		const reload = setInterval(() => void invalidateAll(), REFRESH_MS);
		return () => {
			clearInterval(tick);
			clearInterval(reload);
		};
	});

	$effect(() => {
		const onKey = (event: KeyboardEvent) => {
			if (event.key === 'Escape') onexit();
		};
		window.addEventListener('keydown', onKey);
		return () => window.removeEventListener('keydown', onKey);
	});

	let boxes = $derived(buildWallBoxes(tasks, zones, today));
	let todaysEvents = $derived(eventsToday(agenda));
</script>

<div class="wall">
	<WallCalendar
		agenda={todaysEvents}
		{calendars}
		{lmsConfigured}
		{gtasksConfigured}
		{now}
		{onexit}
	/>
	<div class="main">
		<WallBoard {boxes} {today} {gtasksConfigured} />
	</div>
</div>

<style>
	/*
	 * The wall has its own palette rather than the app's dark theme.
	 * The panel it runs on is a 15" TN over VGA: it crushes the near-black
	 * greys the theme leans on and shifts their hue off-axis, so the steps here
	 * are wider, every fill is flat, and colour is spent on dots, tags and
	 * meetings rather than on large areas. Nothing leaks out — no theme token is
	 * redefined, so List and Bento are exactly as they were.
	 */
	.wall {
		--wall-bg: #15130f;
		--wall-rail: #100e0b;
		--wall-box: #221e18;
		--wall-sub: #191510;
		--wall-row: #312c24;
		--wall-row-line: #3d3830;
		--wall-today: #4e3c1e;
		--wall-today-line: #6d5326;
		--wall-hour: #241f1a;
		--wall-ink: #f5efe3;
		--wall-ink-soft: #eee4d3;
		--wall-dim: #ada394;
		--wall-soon: #f0b457;
		--wall-soon-edge: #b8852f;
		--wall-late: #f4a091;
		--wall-late-fill: #63332a;
		--wall-tag-edge: #7d7260;
		--wall-tag-fill: #4b4436;

		position: fixed;
		inset: 0;
		z-index: 1200;
		display: grid;
		/* Wide enough for a meeting title beside the hour labels, and never so
		   wide that it eats a board column. */
		grid-template-columns: clamp(190px, 17%, 260px) minmax(0, 1fr);
		background: var(--wall-bg);
		color: var(--wall-ink);
		font-weight: 500;
		line-height: 1.3;
		font-variant-numeric: tabular-nums;
		overflow: hidden;
		/* Nobody is pointing at this screen, and a stray arrow parked over a
		   task is the only thing on it that does not belong. */
		cursor: none;
	}

	.main {
		display: grid;
		padding: 12px;
		min-width: 0;
		min-height: 0;
	}
</style>
