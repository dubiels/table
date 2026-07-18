<script lang="ts">
	let { data } = $props();
</script>

<h1>Inbox</h1>

{#if data.notifications.length === 0}
	<p class="empty">Nothing here yet.</p>
{:else}
	<div class="list">
		{#each data.notifications as n (n.id)}
			<div class="notification">
				<div class="type">
					{#if !n.readAt}<span class="dot"></span>{/if}
					{n.type === 'morning_digest' ? 'Morning digest' : 'Due soon'}
				</div>
				<div class="content">{n.content.text}</div>
				<time>{new Date(n.sentAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}</time>
			</div>
		{/each}
	</div>
{/if}

<style>
	h1 {
		font-size: 1.4rem;
		margin-bottom: 1rem;
	}

	.empty {
		color: var(--muted);
	}

	.list {
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
		max-width: 560px;
	}

	.notification {
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius-s);
		padding: 0.75rem 0.9rem;
		box-shadow: var(--shadow-card);
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
	}

	time {
		display: block;
		margin-top: 0.3rem;
		font-size: 0.78rem;
		color: var(--muted);
	}
</style>
