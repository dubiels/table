<script lang="ts">
	import { enhance } from '$app/forms';
	import TaskDetailModal from './TaskDetailModal.svelte';

	let { task }: {
		task: { id: string; title: string; done: boolean; priority: string | null; dueDate: string | null };
	} = $props();

	let showModal = $state(false);

	let today = new Date().toISOString().slice(0, 10);
	let overdue = $derived(!!task.dueDate && task.dueDate < today && !task.done);

	function openModal() {
		showModal = true;
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter' || e.key === ' ') {
			e.preventDefault();
			openModal();
		}
	}
</script>

<div
	class="card"
	class:done={task.done}
	role="button"
	tabindex="0"
	onclick={openModal}
	onkeydown={handleKeydown}
>
	<div class="row-move">
		<!-- svelte-ignore a11y_click_events_have_key_events -->
		<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
		<form method="POST" action="?/moveTask" use:enhance onclick={(e) => e.stopPropagation()} style="display:inline">
			<input type="hidden" name="id" value={task.id} />
			<button class="btn btn-ghost btn-icon" name="direction" value="up" type="submit">▲</button>
			<button class="btn btn-ghost btn-icon" name="direction" value="down" type="submit">▼</button>
		</form>
	</div>

	<div class="row-main">
		<!-- svelte-ignore a11y_click_events_have_key_events -->
		<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
		<form method="POST" action="?/toggleTaskDone" use:enhance onclick={(e) => e.stopPropagation()}>
			<input type="hidden" name="id" value={task.id} />
			<button class="done-toggle" class:checked={task.done} type="submit" aria-label="Toggle done">
				{#if task.done}✓{/if}
			</button>
		</form>
		<span class="title">{task.title}</span>
	</div>

	{#if task.priority || task.dueDate}
		<div class="row-meta">
			{#if task.priority}
				<span class="pill pill-{task.priority}">
					{task.priority === 'high' ? 'High' : task.priority === 'med' ? 'Med' : 'Low'}
				</span>
			{/if}
			{#if task.dueDate}
				<span class="chip-due" class:overdue>{task.dueDate}</span>
			{/if}
		</div>
	{/if}
</div>

{#if showModal}
	<TaskDetailModal {task} onclose={() => (showModal = false)} />
{/if}

<style>
	.card {
		position: relative;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius-s);
		padding: 0.5rem 0.6rem;
		box-shadow: var(--shadow-card);
		cursor: pointer;
	}

	.card:hover {
		border-color: var(--accent);
	}

	.row-move {
		position: absolute;
		top: 0.3rem;
		right: 0.3rem;
		opacity: 0;
		transition: opacity 0.12s ease;
	}

	.card:hover .row-move,
	.card:focus-within .row-move {
		opacity: 1;
	}

	.row-main {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding-right: 2.5rem;
	}

	.done-toggle {
		flex-shrink: 0;
		width: 1.05rem;
		height: 1.05rem;
		border: 1.5px solid var(--border-strong);
		border-radius: 50%;
		background: transparent;
		padding: 0;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		font-size: 0.7rem;
		line-height: 1;
		cursor: pointer;
	}

	.done-toggle.checked {
		color: var(--ok);
		border-color: var(--ok);
	}

	.title {
		flex: 1;
	}

	.done .title {
		text-decoration: line-through;
		color: var(--muted);
	}

	.row-meta {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		margin-top: 0.4rem;
	}
</style>
