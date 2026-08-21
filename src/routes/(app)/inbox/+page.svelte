<script lang="ts">
	import { onMount } from 'svelte';
	import { invalidate } from '$app/navigation';
	import { resolve } from '$app/paths';
	import Mascot from '$lib/components/Mascot.svelte';

	let { data } = $props();

	let expanded = $state<Record<string, boolean>>({});

	const startOfDay = (date: Date) =>
		new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();

	// Due dates are local YYYY-MM-DD; parsing the parts keeps the day from
	// shifting the way new Date('YYYY-MM-DD') (UTC midnight) would.
	function dueLabel(dueDate: string): string {
		const [year, month, day] = dueDate.split('-').map(Number);
		const due = new Date(year, month - 1, day);
		const diffDays = Math.round((due.getTime() - startOfDay(new Date())) / 86_400_000);
		if (diffDays === 0) return 'due today';
		if (diffDays === 1) return 'due tomorrow';
		if (diffDays < 0)
			return `overdue — was due ${due.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`;
		return `due ${due.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`;
	}

	function isOverdue(dueDate: string): boolean {
		const [year, month, day] = dueDate.split('-').map(Number);
		return new Date(year, month - 1, day).getTime() < startOfDay(new Date());
	}

	function dayLabel(iso: string): string {
		const d = new Date(iso);
		const diffDays = Math.round((startOfDay(new Date()) - startOfDay(d)) / 86_400_000);
		if (diffDays === 0) return 'Today';
		if (diffDays === 1) return 'Yesterday';
		return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
	}

	// Rows arrive sorted desc by sentAt, so same-day notifications are always
	// adjacent — a running list avoids reaching for a Map just to group them.
	let groups = $derived.by(() => {
		const result: { label: string; items: typeof data.notifications }[] = [];
		for (const n of data.notifications) {
			const label = dayLabel(n.sentAt);
			const current = result.at(-1);
			if (current && current.label === label) {
				current.items.push(n);
			} else {
				result.push({ label, items: [n] });
			}
		}
		return result;
	});

	// The layout's unreadCount comes from a load that runs before/parallel to this
	// page's load on first visit, so it can't see the mark-read this load just did.
	// Invalidating once after mount re-runs the layout load with fresh data; the
	// mark-read itself is idempotent, so re-running it is harmless.
	onMount(() => {
		invalidate('app:notifications');
	});
</script>

<div class="toolbar">
	<h1>Inbox</h1>
	<a class="btn btn-ghost" href={resolve('/')}>Back to the table</a>
</div>

{#if data.notifications.length === 0}
	<div class="empty">
		<Mascot mood="sleepy" />
		<p class="empty-title">All caught up.</p>
		<p class="empty-sub">Due-date alerts land here.</p>
	</div>
{:else}
	<div class="list">
		{#each groups as group (group.label)}
			<div class="day">{group.label}</div>
			{#each group.items as n (n.id)}
				<div class="notification" class:unread={!n.readAt}>
					{#if n.tasks.length > 0}
						<button
							class="header"
							aria-expanded={expanded[n.id] ?? false}
							onclick={() => (expanded[n.id] = !expanded[n.id])}
						>
							<div class="type">
								{#if !n.readAt}<span class="dot"></span>{/if}
								{n.type === 'morning_digest' ? 'Morning digest' : 'Due soon'}
							</div>
							<div class="content">{n.content.text}</div>
							<div class="disclosure">
								<span class="chevron" class:open={expanded[n.id]}>›</span>
								{expanded[n.id] ? 'Hide' : 'Show'}
								{n.tasks.length} task{n.tasks.length === 1 ? '' : 's'}
							</div>
						</button>
						{#if expanded[n.id]}
							<ul class="tasks">
								{#each n.tasks as task (task.id)}
									<li class:done={task.done}>
										<span class="title">{task.title}</span>
										{#if task.done}
											<span class="meta">done</span>
										{:else if task.dueDate}
											<span class="meta" class:late={isOverdue(task.dueDate)}
												>{dueLabel(task.dueDate)}</span
											>
										{/if}
									</li>
								{/each}
							</ul>
						{/if}
					{:else}
						<div class="header static">
							<div class="type">
								{#if !n.readAt}<span class="dot"></span>{/if}
								{n.type === 'morning_digest' ? 'Morning digest' : 'Due soon'}
							</div>
							<div class="content">{n.content.text}</div>
						</div>
					{/if}
					<time
						>{new Date(n.sentAt).toLocaleTimeString(undefined, {
							hour: 'numeric',
							minute: '2-digit'
						})}</time
					>
				</div>
			{/each}
		{/each}
	</div>
{/if}

<style>
	.toolbar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-bottom: 1rem;
	}

	.toolbar h1 {
		font-size: 1.4rem;
	}

	.list {
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
		max-width: 560px;
	}

	.day {
		margin: 1rem 0 0.3rem;
		font-size: 0.72rem;
		color: var(--muted);
		letter-spacing: 0.04em;
		text-transform: uppercase;
	}

	.day:first-child {
		margin-top: 0;
	}

	.notification {
		background: transparent;
		border: 1px solid var(--border);
		border-radius: var(--radius-s);
		padding: 0.75rem 0.9rem;
		box-shadow: var(--shadow-card);
	}

	.notification.unread {
		background: var(--surface);
		border-color: var(--border-strong);
	}

	.header {
		display: block;
		width: 100%;
		padding: 0;
		background: none;
		border: none;
		font: inherit;
		color: inherit;
		text-align: left;
		cursor: pointer;
	}

	.header.static {
		cursor: default;
	}

	.disclosure {
		display: flex;
		align-items: center;
		gap: 0.3rem;
		margin-top: 0.45rem;
		font-size: 0.78rem;
		color: var(--muted);
	}

	.header:hover .disclosure {
		color: var(--ink);
	}

	.chevron {
		display: inline-block;
		transition: transform 120ms ease;
	}

	.chevron.open {
		transform: rotate(90deg);
	}

	.tasks {
		list-style: none;
		margin: 0.6rem 0 0;
		padding: 0.6rem 0 0;
		border-top: 1px solid var(--border);
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
	}

	.tasks li {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 0.75rem;
		font-size: 0.9rem;
	}

	.tasks li.done .title {
		text-decoration: line-through;
		color: var(--muted);
	}

	.meta {
		flex-shrink: 0;
		font-size: 0.78rem;
		color: var(--muted);
	}

	.meta.late {
		color: var(--danger);
	}

	.type {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		font-size: 0.72rem;
		text-transform: uppercase;
		letter-spacing: 0.02em;
		color: var(--muted);
	}

	.dot {
		width: 0.4rem;
		height: 0.4rem;
		border-radius: 50%;
		background: var(--accent);
		display: inline-block;
	}

	.content {
		margin-top: 0.3rem;
		white-space: pre-line;
	}

	time {
		display: block;
		margin-top: 0.3rem;
		font-size: 0.78rem;
		color: var(--muted);
	}

	.empty {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.3rem;
		padding: 3.5rem 1rem;
		text-align: center;
		color: var(--muted);
	}

	.empty :global(.mascot) {
		margin-bottom: 0.6rem;
	}

	.empty-title {
		margin: 0;
		font-family: var(--font-display);
		font-weight: 600;
		color: var(--ink);
	}

	.empty-sub {
		margin: 0;
		font-size: 0.85rem;
	}
</style>
