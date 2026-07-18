<script lang="ts">
	let { data }: { data: { error: 'invalid' | 'expired' | 'used' } } = $props();
</script>

<div class="page">
	<div class="card">
		<h1>Link problem</h1>
		{#if data.error === 'expired'}
			<p>That login link has expired. Request a new one.</p>
		{:else if data.error === 'used'}
			<p>That login link was already used. Request a new one.</p>
		{:else}
			<p>That login link isn't valid. Request a new one.</p>
		{/if}
		<a class="btn btn-primary" href="/login">Back to login</a>
	</div>
</div>

<style>
	.page {
		min-height: 100vh;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 1rem;
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
		gap: 1rem;
	}

	.card h1 {
		font-size: 2rem;
	}

	.card .btn-primary {
		width: 100%;
		text-decoration: none;
	}
</style>
