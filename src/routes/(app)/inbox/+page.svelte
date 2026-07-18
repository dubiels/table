<script lang="ts">
	let { data } = $props();
</script>

<h1>Notifications</h1>
<a href="/">Back to board</a>
<ul>
	{#each data.notifications as n (n.id)}
		<li class:unread={!n.readAt}>
			<strong>{n.type === 'morning_digest' ? 'Morning digest' : 'Due soon'}</strong>
			— {n.content.text}
			<time>{n.sentAt}</time>
		</li>
	{/each}
</ul>

<style>
	.unread {
		font-weight: bold;
	}
</style>
