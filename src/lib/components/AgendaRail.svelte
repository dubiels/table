<script lang="ts">
	import type { AgendaEvent } from '$lib/server/gcal/agenda';

	let { events }: { events: AgendaEvent[] } = $props();

	const MAX_DAYS = 5;

	const startOfDay = (date: Date) =>
		new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();

	function dayLabel(iso: string): string {
		const d = new Date(iso);
		const diffDays = Math.round((startOfDay(d) - startOfDay(new Date())) / 86_400_000);
		if (diffDays === 0) return 'Today';
		if (diffDays === 1) return 'Tomorrow';
		return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
	}

	function timeLabel(event: AgendaEvent): string {
		if (event.allDay) return 'all day';
		return new Date(event.start).toLocaleTimeString(undefined, {
			hour: 'numeric',
			minute: '2-digit'
		});
	}

	// Events arrive sorted ascending by start, so same-day events are always
	// adjacent — a running list groups them without reaching for a Map.
	let groups = $derived.by(() => {
		const result: { label: string; items: AgendaEvent[] }[] = [];
		for (const event of events) {
			const label = dayLabel(event.start);
			const current = result.at(-1);
			if (current && current.label === label) {
				current.items.push(event);
			} else {
				if (result.length === MAX_DAYS) break;
				result.push({ label, items: [event] });
			}
		}
		return result;
	});

	let shownCount = $derived(groups.reduce((n, group) => n + group.items.length, 0));
</script>

{#if events.length > 0}
	<section class="rail">
		<h2 class="rail-title">Agenda <span class="count">{shownCount}</span></h2>
		{#each groups as group (group.label)}
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

<style>
	.rail {
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}

	.rail-title {
		display: flex;
		align-items: baseline;
		gap: 0.4rem;
		margin: 0;
		font-family: var(--font-display);
		font-weight: 600;
		font-size: 0.95rem;
	}

	.count {
		font-size: 0.78rem;
		font-weight: 400;
		color: var(--muted);
		font-variant-numeric: tabular-nums;
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
</style>
