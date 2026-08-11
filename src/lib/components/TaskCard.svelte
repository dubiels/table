<script lang="ts">
	import { enhance } from '$app/forms';
	import { localDateString } from '$lib/listView';

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
			googleSync?: boolean;
			googleTaskId?: string | null;
			googleError?: string | null;
		};
		zoneColor?: { fill: string; border: string } | null;
		onclick?: () => void;
	} = $props();

	let today = localDateString();
	let overdue = $derived(!!task.dueDate && task.dueDate < today && !task.done);

	// null hides the badge entirely: a task nobody asked to mirror should carry
	// no mark at all, or every card on the board grows one.
	let googleState = $derived(
		!task.googleSync && !task.googleTaskId
			? null
			: task.googleError
				? 'error'
				: task.googleSync && task.googleTaskId
					? 'synced'
					: 'pending'
	);

	let googleLabel = $derived(
		googleState === 'error'
			? `Google Tasks: ${task.googleError}`
			: googleState === 'pending'
				? 'Waiting to reach Google Tasks'
				: 'In Google Tasks'
	);

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
	{#if googleState}
		<span class="gmark gmark-{googleState}" title={googleLabel}>
			<!-- Drawn rather than set in type, like the topbar icons: a glyph would
			     ignore the span's colour and so could not carry the three states. -->
			<svg
				viewBox="0 0 24 24"
				width="11"
				height="11"
				fill="none"
				stroke="currentColor"
				stroke-width="2.5"
				stroke-linecap="round"
				stroke-linejoin="round"
				aria-hidden="true"
			>
				<circle cx="12" cy="12" r="9" />
				<path d="M8 12.5l2.5 2.5L16 9.5" />
			</svg>
			<span class="sr-only">{googleLabel}</span>
		</span>
	{/if}
	<div class="row-main">
		<!-- Keydown is guarded alongside click: Enter on the submit button would
		     otherwise bubble to the card's role="button" handler, whose
		     preventDefault cancels the submit and opens the modal instead. -->
		<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
		<form
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

<style>
	.card {
		position: relative;
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
	.gmark {
		position: absolute;
		top: 0.3rem;
		right: 1.15rem;
		display: inline-flex;
		line-height: 0;
	}
	.gmark-synced {
		color: var(--ok);
	}
	.gmark-pending {
		color: var(--muted);
	}
	.gmark-error {
		color: var(--danger);
	}
	.sr-only {
		position: absolute;
		width: 1px;
		height: 1px;
		padding: 0;
		overflow: hidden;
		clip-path: inset(50%);
		white-space: nowrap;
	}
	.row-main {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding-right: 1.8rem;
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
