<script lang="ts">
	import Board from '$lib/components/Board.svelte';
	let { data } = $props();
</script>

<h1>Table</h1>
<a href="/inbox">Notifications</a>
<Board topics={data.topics} tasksByTopic={data.tasksByTopic} />
