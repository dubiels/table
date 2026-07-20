<script lang="ts">
	import TableCanvas from '$lib/components/TableCanvas.svelte';
	import MobileColumns from '$lib/components/MobileColumns.svelte';
	import { subscribeToPush } from '$lib/client/push';
	import { env } from '$env/dynamic/public';
	let { data } = $props();

	let isMobile = $state(false);
	$effect(() => {
		const mq = window.matchMedia('(max-width: 720px)');
		const apply = () => (isMobile = mq.matches);
		apply();
		mq.addEventListener('change', apply);
		return () => mq.removeEventListener('change', apply);
	});

	async function enableNotifications() {
		try {
			await subscribeToPush(env.PUBLIC_VAPID_PUBLIC_KEY ?? '');
			alert('Notifications enabled.');
		} catch (err) {
			alert(`Could not enable notifications: ${(err as Error).message}`);
		}
	}
</script>

<div class="toolbar">
	<h1>On the table</h1>
	<button class="btn btn-ghost" onclick={enableNotifications}>Enable notifications</button>
</div>

{#if isMobile}
	<MobileColumns tasks={data.tasks} zones={data.zones} />
{:else}
	<TableCanvas tasks={data.tasks} zones={data.zones} />
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
</style>
