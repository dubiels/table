<script lang="ts">
	import Board from '$lib/components/Board.svelte';
	import { subscribeToPush } from '$lib/client/push';
	import { env } from '$env/dynamic/public';
	let { data } = $props();

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
<Board topics={data.topics} tasksByTopic={data.tasksByTopic} />

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
