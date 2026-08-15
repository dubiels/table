<script lang="ts">
	import { enhance } from '$app/forms';
	import { describeAge } from '$lib/people/relative-date';

	export type Touchpoint = {
		id: string;
		occurredOn: string;
		note: string | null;
	};

	let {
		personId,
		touchpoints,
		today
	}: { personId: string; touchpoints: Touchpoint[]; today: string } = $props();

	let adding = $state(false);
	let noteEl = $state<HTMLInputElement | null>(null);
</script>

<section class="reachouts">
	<h3>Reach-outs</h3>

	{#if touchpoints.length > 0}
		<ul>
			{#each touchpoints as point (point.id)}
				<li>
					<span class="when">
						{point.occurredOn}
						<span class="ago">{describeAge(point.occurredOn, today)}</span>
					</span>
					{#if point.note}<span class="note">{point.note}</span>{/if}
				</li>
			{/each}
		</ul>
	{/if}

	{#if adding}
		<form
			method="POST"
			action="?/logTouchpoint"
			class="log"
			use:enhance={() =>
				async ({ result, update }) => {
					await update();
					// Stays open on failure so nothing typed is lost; closes on success
					// because logging two reach-outs in a row is rare.
					if (result.type === 'success') adding = false;
				}}
		>
			<input type="hidden" name="personId" value={personId} />
			<input type="date" name="occurredOn" value={today} aria-label="When" required />
			<input
				bind:this={noteEl}
				name="note"
				placeholder="Coffee, caught up on the Cadence launch"
				aria-label="What happened"
				autocomplete="off"
			/>
			<button type="submit" class="save">Log it</button>
			<button type="button" class="cancel" onclick={() => (adding = false)}>Cancel</button>
		</form>
	{:else}
		<button
			type="button"
			class="new"
			onclick={() => {
				adding = true;
				// The date is already right; the note is what you came to type.
				queueMicrotask(() => noteEl?.focus());
			}}
		>
			+ Log a reach-out
		</button>
	{/if}
</section>

<style>
	.reachouts {
		grid-column: 1 / -1;
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
		margin-top: 0.9rem;
		padding-top: 0.75rem;
		border-top: 1px solid var(--border);
	}
	h3 {
		margin: 0;
		font-size: 0.72rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: var(--muted);
	}
	ul {
		margin: 0;
		padding: 0;
		list-style: none;
		display: flex;
		flex-direction: column;
		gap: 0.2rem;
		max-height: 14rem;
		overflow-y: auto;
	}
	li {
		display: flex;
		align-items: baseline;
		gap: 0.5rem;
		font-size: 0.82rem;
	}
	.when {
		flex: none;
		font-size: 0.72rem;
		color: var(--muted);
	}
	.ago {
		opacity: 0.75;
	}
	.note {
		min-width: 0;
	}
	.log {
		display: flex;
		flex-wrap: wrap;
		gap: 0.35rem;
		align-items: center;
	}
	.log input {
		padding: 0.3rem 0.45rem;
		border: 1px solid var(--border);
		border-radius: var(--radius-s);
		background: var(--surface);
		font: inherit;
		font-size: 0.82rem;
		color: inherit;
	}
	.log input[name='note'] {
		flex: 1 1 12rem;
		min-width: 0;
	}
	.new {
		align-self: flex-start;
		border: none;
		background: none;
		padding: 0;
		font: inherit;
		font-size: 0.78rem;
		color: var(--muted);
		cursor: pointer;
	}
	.save {
		padding: 0.3rem 0.7rem;
		border: none;
		border-radius: var(--radius-s);
		background: var(--accent);
		color: var(--accent-ink);
		font: inherit;
		font-size: 0.78rem;
		font-weight: 600;
		cursor: pointer;
	}
	.cancel {
		border: none;
		background: none;
		padding: 0;
		font: inherit;
		font-size: 0.78rem;
		color: var(--muted);
		cursor: pointer;
	}
</style>
