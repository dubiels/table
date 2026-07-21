<script lang="ts">
	let { children } = $props();
</script>

<div class="app-shell">
	<main>
		{@render children()}
	</main>
</div>

<style>
	main {
		max-width: none;
		padding: 1.25rem 1.5rem;
	}
</style>
