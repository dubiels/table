<script lang="ts">
	import Mascot from './Mascot.svelte';
	import RefreshButton from './RefreshButton.svelte';
	import { invalidateAll } from '$app/navigation';
	import { toast } from '$lib/toast.svelte';
	import { eventsToday, upcomingByDay, timeRangeLabel } from '$lib/agenda';
	import type { AgendaEvent } from '$lib/server/gcal/agenda';

	let {
		agenda,
		gcalConfigured
	}: {
		agenda: AgendaEvent[];
		gcalConfigured: boolean;
	} = $props();

	let heading = $derived(
		new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })
	);

	let today = $derived(eventsToday(agenda));
	let upcoming = $derived(upcomingByDay(agenda));

	let refreshing = $state(false);

	type RefreshBody = { ok?: boolean; events?: number; error?: string };

	// A proxy error or a crashed route answers with an HTML page; res.json()
	// would throw and lose the status we could have reported instead.
	async function readJson(res: Response): Promise<RefreshBody | null> {
		if (!res.headers.get('content-type')?.includes('application/json')) return null;
		try {
			return (await res.json()) as RefreshBody;
		} catch {
			return null;
		}
	}

	// getAgenda()'s 10-minute cache means a just-added Google event would
	// otherwise take up to 10 minutes to show up here; this bypasses it. A
	// failure must never claim success — the last agenda stays on screen either
	// way, so the toast is the only thing telling the user which one they have.
	async function refreshCalendar() {
		refreshing = true;
		try {
			const res = await fetch('/api/gcal/refresh', { method: 'POST' });
			const body = await readJson(res);
			if (res.ok && body?.ok) {
				await invalidateAll();
				const count = body.events ?? 0;
				toast(`Calendar refreshed — ${count} event${count === 1 ? '' : 's'}`, 'success');
			} else {
				toast('Could not reach the calendar — showing the last agenda', 'error');
			}
		} catch {
			toast('Could not reach the calendar — showing the last agenda', 'error');
		} finally {
			refreshing = false;
		}
	}
</script>

<div class="date-row">
	<p class="date">{heading}</p>
	{#if gcalConfigured}
		<RefreshButton label="Refresh calendar" spinning={refreshing} onclick={refreshCalendar} />
	{/if}
</div>

{#if !gcalConfigured}
	<div class="empty">
		<Mascot mood="sleepy" />
		<p>No calendar connected.</p>
	</div>
	<ol class="setup">
		<li>
			In the <strong>Google Cloud console</strong>, enable the <strong>Calendar API</strong> and
			create a
			<strong>Desktop OAuth client</strong>, then put its id and secret in
			<code>GCAL_CLIENT_ID</code> and <code>GCAL_CLIENT_SECRET</code> in <code>.env</code>.
		</li>
		<li>
			Run <code>npm run gcal:auth</code>, add the printed <code>GCAL_REFRESH_TOKEN</code> to
			<code>.env</code>, and restart to pick it up.
		</li>
	</ol>
{:else if today.length === 0}
	<div class="empty">
		<Mascot mood="happy" />
		<p>Nothing today.</p>
	</div>
{:else}
	<ul class="blocks">
		{#each today as event (event.id)}
			<li class="block" class:all-day={event.allDay}>
				<span class="block-time">{timeRangeLabel(event)}</span>
				<span class="block-title">{event.title}</span>
				{#if event.location}<span class="block-location">{event.location}</span>{/if}
			</li>
		{/each}
	</ul>
{/if}

{#if upcoming.length > 0}
	<div class="upcoming">
		<h3>Upcoming</h3>
		{#each upcoming as group (group.label)}
			<div class="group">
				<div class="day">{group.label}</div>
				<ul class="blocks">
					{#each group.items as event (event.id)}
						<li class="block compact" class:all-day={event.allDay}>
							<span class="block-time">{timeRangeLabel(event)}</span>
							<span class="block-title">{event.title}</span>
							{#if event.location}<span class="block-location">{event.location}</span>{/if}
						</li>
					{/each}
				</ul>
			</div>
		{/each}
	</div>
{/if}

<style>
	.date-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
	}

	.date {
		margin: 0;
		font-size: 0.78rem;
		color: var(--muted);
	}

	/* Events read as calendar blocks rather than as rows: a tinted card with the
	   coloured rail down its leading edge, stacked tight the way a day column
	   stacks them. Nothing here is to scale — a 280px panel has no room for a
	   proportional grid, so an hour and a ten-minute stand-up are the same
	   height and only the label says which is which. */
	.blocks {
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
	}

	.block {
		display: flex;
		flex-direction: column;
		min-width: 0;
		padding: 0.35rem 0.5rem;
		border-radius: var(--radius-s);
		border-left: 3px solid var(--zone-sky-border);
		background: var(--zone-sky-fill);
	}

	/* An all-day event frames the day instead of sitting at a point in it, so it
	   drops the rail and reads as a band across the top of the stack. */
	.block.all-day {
		border-left-color: var(--border-strong);
		background: var(--accent-soft);
	}

	.block-time {
		font-size: 0.7rem;
		line-height: 1.4;
		color: var(--ink);
		/* On the tinted fill --muted is too close to the background to read; the
		   ink held back a little sits where the muted grey would have. */
		opacity: 0.65;
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.block-title {
		font-size: 0.85rem;
		font-weight: 600;
		line-height: 1.3;
		color: var(--ink);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.block-location {
		font-size: 0.7rem;
		line-height: 1.35;
		color: var(--ink);
		opacity: 0.55;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	/* Later days are context, not the agenda: the same block, one step quieter. */
	.block.compact {
		padding: 0.25rem 0.45rem;
	}

	.block.compact .block-title {
		font-size: 0.8rem;
		font-weight: 500;
	}

	.block.compact .block-time {
		font-size: 0.68rem;
	}

	.upcoming {
		display: flex;
		flex-direction: column;
		gap: 0.7rem;
		padding-top: 0.9rem;
		border-top: 1px solid var(--border);
	}

	.upcoming h3 {
		margin: 0 0 0.4rem;
		font-size: 0.78rem;
		font-weight: 700;
		letter-spacing: 0.04em;
		text-transform: uppercase;
		color: var(--muted);
	}

	/* The rail the group used to carry on its left edge is gone: every block now
	   draws one of its own, and two stacked verticals read as a nesting that is
	   not there. The day label is the only separator the groups need. */
	.group {
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
	}

	.day {
		font-size: 0.72rem;
		color: var(--muted);
		letter-spacing: 0.04em;
		text-transform: uppercase;
	}

	.empty {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.4rem;
		padding: 1rem 0;
	}

	.empty p {
		margin: 0;
		color: var(--muted);
		font-size: 0.88rem;
	}

	ul,
	ol {
		margin: 0;
		padding: 0;
		list-style: none;
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
