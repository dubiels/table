<script lang="ts">
	let { data, children } = $props();
</script>

<div class="app-shell">
	<header class="topbar">
		<a class="wordmark" href="/">Table</a>
		<nav>
			<a href="/inbox">Inbox</a>
			{#if data.user}
				<span class="user-email">{data.user.email}</span>
			{/if}
		</nav>
	</header>

	<main>
		{@render children()}
	</main>
</div>

<style>
	.topbar {
		position: sticky;
		top: 0;
		z-index: 10;
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 0.75rem 1.5rem;
		background: var(--surface);
		border-bottom: 1px solid var(--border);
		box-shadow: var(--shadow-card);
	}

	.wordmark {
		font-family: var(--font-display);
		font-size: 1.3rem;
		font-weight: 600;
		color: var(--ink);
		text-decoration: none;
	}

	nav {
		display: flex;
		align-items: center;
		gap: 1rem;
	}

	nav a {
		color: var(--ink);
		text-decoration: none;
	}

	nav a:hover {
		color: var(--accent);
	}

	.user-email {
		color: var(--muted);
		font-size: 0.85rem;
	}

	main {
		max-width: none;
		padding: 1.25rem 1.5rem;
	}
</style>
