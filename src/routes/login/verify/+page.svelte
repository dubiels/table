<script lang="ts">
	import { resolve } from '$app/paths';

	let { data }: { data: { error: 'invalid' | 'expired' | 'used' } } = $props();
</script>

<div class="page">
	<div class="card">
		<header class="brand">
			<h1>Table</h1>
			<p class="tagline">Link problem</p>
		</header>
		{#if data.error === 'expired'}
			<p class="status-error" role="alert">That login link has expired. Request a new one.</p>
		{:else if data.error === 'used'}
			<p class="status-error" role="alert">That login link was already used. Request a new one.</p>
		{:else}
			<p class="status-error" role="alert">That login link isn't valid. Request a new one.</p>
		{/if}
		<a class="btn btn-primary" href={resolve('/login')}>Back to login</a>
	</div>
</div>

<style>
	.page {
		min-height: 100vh;
		display: flex;
		align-items: flex-start;
		justify-content: center;
		padding: 1rem;
		padding-top: 35vh;
	}

	.card {
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius-l);
		box-shadow: var(--shadow-card);
		padding: 2rem;
		width: min(380px, calc(100vw - 2rem));
		display: flex;
		flex-direction: column;
		/* Matches the login card, and for the same reason — see the note there. */
		gap: 1.35rem;
	}

	/* Flex does not collapse margins, so a paragraph's default `1em` is added to
	   the gap on both sides of it. */
	.card p {
		margin: 0;
	}

	.brand {
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
	}

	.card h1 {
		font-family: var(--font-display);
		font-weight: 700;
		font-size: 1.6rem;
	}

	.tagline {
		color: var(--muted);
	}

	.status-error {
		color: var(--danger);
		font-size: 0.85rem;
	}

	.card .btn-primary {
		width: 100%;
		text-decoration: none;
	}
</style>
