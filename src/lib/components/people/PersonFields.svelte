<script lang="ts">
	import { untrack } from 'svelte';

	/**
	 * The scalar fields of a person, shared by the add dialog and the detail
	 * modal so the two can never drift apart — adding someone should show
	 * exactly what editing them shows.
	 *
	 * Flags are deliberately NOT here: attaching to a person who does not exist
	 * yet (staged, submitted with the form) and attaching to one who does
	 * (applied immediately) are genuinely different jobs.
	 */
	let {
		values,
		errorId = null,
		error = null,
		linkDates = false
	}: {
		values: {
			name?: string | null;
			role?: string | null;
			company?: string | null;
			city?: string | null;
			linkedinUrl?: string | null;
			email?: string | null;
			phone?: string | null;
			metAt?: string | null;
			metOn?: string | null;
			lastSpokeAt?: string | null;
			notes?: string | null;
		};
		/** Id the name field points at with aria-describedby while `error` is set. */
		errorId?: string | null;
		error?: string | null;
		/**
		 * When adding, "last spoke" trails "when we met" until it is touched —
		 * meeting someone is the first time you spoke to them. When editing, the
		 * two are independent: correcting a meeting date must not silently rewrite
		 * a conversation that was deliberately recorded.
		 */
		linkDates?: boolean;
	} = $props();

	// Read once, untracked: both callers mount this fresh (inside an {#if}, and
	// the detail modal is additionally keyed per person), so `values` cannot
	// change underneath it — and re-syncing would overwrite what is being typed.
	let metOn = $state(untrack(() => values.metOn ?? ''));
	let lastSpokeAt = $state(untrack(() => values.lastSpokeAt ?? ''));
	let lastSpokeTouched = $state(false);

	$effect(() => {
		if (linkDates && !lastSpokeTouched) lastSpokeAt = metOn;
	});
</script>

<label>
	Name
	<input
		name="name"
		value={values.name ?? ''}
		required
		autocomplete="off"
		aria-invalid={error !== null}
		aria-describedby={error && errorId ? errorId : undefined}
	/>
	{#if error && errorId}
		<span class="status-error" role="alert" id={errorId}>{error}</span>
	{/if}
</label>
<label>Role<input name="role" value={values.role ?? ''} autocomplete="off" /></label>
<label>Company<input name="company" value={values.company ?? ''} autocomplete="off" /></label>
<label>City<input name="city" value={values.city ?? ''} autocomplete="off" /></label>
<label
	>LinkedIn<input name="linkedinUrl" value={values.linkedinUrl ?? ''} autocomplete="off" /></label
>
<label>Email<input name="email" value={values.email ?? ''} autocomplete="off" /></label>
<label>Phone<input name="phone" value={values.phone ?? ''} autocomplete="off" /></label>
<label>
	Where we met
	<input
		name="metAt"
		value={values.metAt ?? ''}
		placeholder="Ana's dinner party"
		autocomplete="off"
	/>
</label>
<label>When we met<input type="date" name="metOn" bind:value={metOn} /></label>
<label>
	Last spoke
	<input
		type="date"
		name="lastSpokeAt"
		bind:value={lastSpokeAt}
		oninput={() => (lastSpokeTouched = true)}
	/>
</label>
<label class="wide">
	Who they are
	<textarea
		name="notes"
		rows="5"
		placeholder="What they work on, what they can help with, how you know them"
		>{values.notes ?? ''}</textarea
	>
</label>

<style>
	label {
		display: flex;
		flex-direction: column;
		gap: 0.2rem;
		font-size: 0.72rem;
		color: var(--muted);
	}
	.wide {
		grid-column: 1 / -1;
	}
	input,
	textarea {
		padding: 0.35rem 0.5rem;
		border: 1px solid var(--border);
		border-radius: var(--radius-s);
		background: var(--surface);
		font: inherit;
		font-size: 0.85rem;
		color: inherit;
	}
	.status-error {
		margin: 0;
		font-size: 0.72rem;
		color: var(--danger);
	}
</style>
