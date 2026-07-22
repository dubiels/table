<script lang="ts">
	import BlobView from '$lib/components/BlobView.svelte';
	import MobileColumns from '$lib/components/MobileColumns.svelte';
	import ListView from '$lib/components/ListView.svelte';
	import BentoView from '$lib/components/BentoView.svelte';
	import { subscribeToPush } from '$lib/client/push';
	import { env } from '$env/dynamic/public';
	let { data } = $props();

	let view = $state<'blob' | 'list' | 'bento'>('blob');
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
	<div class="toolbar-actions">
		<select class="btn btn-ghost view-select" bind:value={view}>
			<option value="blob">Blob view</option>
			<option value="list">List view</option>
			<option value="bento">Bento view</option>
		</select>
		<a class="btn btn-ghost" href="/history">History</a>
		<a class="btn btn-ghost" href="/inbox">Inbox</a>
		<button class="btn btn-ghost" onclick={enableNotifications}>Enable notifications</button>
		{#if data.user}
			<span class="user-email">{data.user.email}</span>
		{/if}
		<form method="POST" action="/logout">
			<button class="btn btn-ghost" type="submit">Log Out</button>
		</form>
	</div>
</div>

{#if view === 'list'}
	<ListView tasks={data.tasks} zones={data.zones} />
{:else if view === 'bento'}
	<BentoView tasks={data.tasks} zones={data.zones} />
{:else if isMobile}
	<MobileColumns tasks={data.tasks} zones={data.zones} />
{:else}
	<BlobView tasks={data.tasks} zones={data.zones} />
{/if}

<style>
	.toolbar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-bottom: 1rem;
		flex-shrink: 0;
	}
	.toolbar h1 {
		font-size: 1.4rem;
	}
	.toolbar-actions {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}
	.view-select {
		appearance: none;
		padding-right: 1.6rem;
	}
	.user-email {
		color: var(--muted);
		font-size: 0.85rem;
	}
</style>
