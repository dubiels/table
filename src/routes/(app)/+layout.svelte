<script lang="ts">
	import TopBar from '$lib/components/TopBar.svelte';
	import Toasts from '$lib/components/Toasts.svelte';

	let { data, children } = $props();
</script>

<div class="app-shell">
	<TopBar user={data.user} unreadCount={data.unreadCount} />
	<main>
		{@render children()}
	</main>
</div>
<Toasts />

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
