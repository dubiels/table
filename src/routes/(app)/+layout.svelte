<script lang="ts">
	let { children } = $props();
</script>

<div class="app-shell">
	<main>
		{@render children()}
	</main>
</div>

<style>
	.app-shell {
		display: flex;
		flex-direction: column;
		min-height: 100dvh;
	}
	main {
		flex: 1;
		display: flex;
		flex-direction: column;
		min-height: 0;
		max-width: none;
		padding: 1.25rem 1.5rem 0.5rem;
	}
</style>
