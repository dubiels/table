<script lang="ts">
	import { enhance } from '$app/forms';
	import { localDateString } from '$lib/listView';
	import { taskMarks } from '$lib/taskMarks';
	import GoogleSyncBadge from './GoogleSyncBadge.svelte';

	let {
		task,
		zoneColor = null,
		onclick
	}: {
		task: {
			id: string;
			title: string;
			done: boolean;
			priority: string | null;
			dueDate: string | null;
			plannedDate: string | null;
			googleSync?: boolean;
			googleTaskId?: string | null;
			googleError?: string | null;
			/** Denormalised by the board's load — a task about someone says whose. */
			personName?: string | null;
		};
		zoneColor?: { fill: string; border: string } | null;
		onclick?: () => void;
	} = $props();

	let today = localDateString();
	let marks = $derived(taskMarks(task, today));

	function handleKeydown(e: KeyboardEvent) {
		if (!onclick) return;
		if (e.key === 'Enter' || e.key === ' ') {
			e.preventDefault();
			onclick();
		}
	}
</script>

<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
<div
	class="card"
	class:done={task.done}
	class:clickable={!!onclick}
	role={onclick ? 'button' : undefined}
	tabindex={onclick ? 0 : undefined}
	onclick={() => onclick?.()}
	onkeydown={handleKeydown}
>
	{#if zoneColor}
		<span
			class="zone-dot"
			style="background:{zoneColor.fill}; border-color:{zoneColor.border};"
			aria-hidden="true"
		></span>
	{/if}
	<!-- Only a surface that can act on the state offers the control. The history
	     list renders the same card with no `onclick`, and gets a report-only mark. -->
	<GoogleSyncBadge {task} interactive={!!onclick} />

	<!-- Keydown is guarded alongside click: Enter on the submit button would
	     otherwise bubble to the card's role="button" handler, whose
	     preventDefault cancels the submit and opens the modal instead. -->
	<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
	<form
		class="done-form"
		method="POST"
		action="?/toggleTaskDone"
		use:enhance
		onclick={(e) => e.stopPropagation()}
		onkeydown={(e) => e.stopPropagation()}
	>
		<input type="hidden" name="id" value={task.id} />
		<button class="done-toggle" class:checked={task.done} type="submit" aria-label="Toggle done">
			{#if task.done}✓{/if}
		</button>
	</form>

	<!-- The toggle is a sibling of the whole text block rather than of the title
	     alone, so it centres against the card's full height. Nested inside a title
	     row it lined up with the first line and read as sitting high on any card
	     that also carries a priority or due chip. -->
	<div class="content">
		<span class="title">{task.title}</span>
		{#if task.personName}<span class="person">{task.personName}</span>{/if}

		{#if task.priority || task.dueDate || task.plannedDate}
			<div class="row-meta">
				{#if task.priority}
					<span class="pill pill-{task.priority}">
						{task.priority === 'high' ? 'High' : task.priority === 'med' ? 'Med' : 'Low'}
					</span>
				{/if}
				{#if task.dueDate}
					<span class="chip-due" class:overdue={marks.overdue}>{task.dueDate}</span>
				{/if}
				{#if task.plannedDate}
					<span
						class="chip-plan"
						class:slipped={marks.slipped}
						class:unachievable={marks.unachievable}
						title={marks.unachievable ? 'Planned after the last possible day' : undefined}
					>
						{task.plannedDate}
					</span>
				{/if}
			</div>
		{/if}
	</div>
</div>

<style>
	.card {
		position: relative;
		display: flex;
		align-items: center;
		gap: 0.5rem;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius-s);
		padding: 0.5rem 0.6rem;
		box-shadow: var(--shadow-card);
	}
	.card.clickable {
		cursor: pointer;
	}
	.zone-dot {
		position: absolute;
		top: 0.4rem;
		right: 0.4rem;
		width: 0.5rem;
		height: 0.5rem;
		border-radius: 50%;
		border: 1px solid;
	}
	/* The unsynced ring sits back at rest and comes up with the card, so the
	   control is there when you are looking at that task and quiet otherwise. */
	.card:hover :global(.gbtn.faint) {
		opacity: 1;
	}
	/* The form is what the card centres, so it has to be exactly as tall as the
	   button it holds. Left as a block it becomes a line box — 1.5 line-height on
	   a 15px root, against a 1.05rem button — and an inline-flex button sits on
	   that line's baseline rather than its centre, leaving the toggle a few
	   pixels high on every card. */
	.done-form {
		display: flex;
		align-items: center;
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
	.content {
		flex: 1;
		min-width: 0;
		/* Keeps a long title from running under the zone dot and the sync mark. */
		padding-right: 1.5rem;
	}
	.done .title {
		text-decoration: line-through;
		color: var(--muted);
	}
	/* Who the task is about. "Send the queue-design doc" is meaningless on its
	   own; the name is what makes it actionable from the board. */
	.person {
		display: inline-block;
		margin-top: 0.2rem;
		padding: 0.05rem 0.4rem;
		border-radius: 999px;
		background: var(--zone-lilac-fill);
		border: 1px solid var(--zone-lilac-border);
		font-size: 0.65rem;
	}
	.row-meta {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		margin-top: 0.4rem;
	}
</style>
