<script lang="ts">
	import Mascot from './Mascot.svelte';
	import { eventsToday, upcomingByDay, timeLabel } from '$lib/agenda';
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
</script>

<p class="date">{heading}</p>

{#if !gcalConfigured}
	<div class="empty">
		<Mascot mood="sleepy" />
		<p>No calendar connected.</p>
	</div>
	<ol class="setup">
		<li>
			In the <strong>Google Cloud console</strong>, enable the <strong>Calendar API</strong> and create a
			<strong>Desktop OAuth client</strong>.
		</li>
		<li>
			Run <code>npm run gcal:auth</code>, then add <code>GCAL_CLIENT_ID</code>,
			<code>GCAL_CLIENT_SECRET</code>, and the printed <code>GCAL_REFRESH_TOKEN</code> to
			<code>.env</code> — and restart to pick it up.
		</li>
	</ol>
{:else if today.length === 0}
	<div class="empty">
		<Mascot mood="happy" />
		<p>Nothing today.</p>
	</div>
{:else}
	<ul class="today-events">
		{#each today as event (event.id)}
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

{#if upcoming.length > 0}
	<div class="upcoming">
		<h3>Upcoming</h3>
		{#each upcoming as group (group.label)}
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
	</div>
{/if}

<style>
	.date {
		margin: 0;
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

	.upcoming h3 {
		margin: 0 0 0.4rem;
		font-size: 0.78rem;
		font-weight: 700;
		letter-spacing: 0.04em;
		text-transform: uppercase;
		color: var(--muted);
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
