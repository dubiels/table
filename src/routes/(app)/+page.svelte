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

<h1>Table</h1>
<a href="/inbox">Notifications</a>
<button on:click={enableNotifications}>Enable notifications</button>
<Board topics={data.topics} tasksByTopic={data.tasksByTopic} />
