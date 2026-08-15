<script lang="ts">
	import { untrack } from 'svelte';

	/**
	 * The scalar fields of a person, shared by the add dialog and the detail
	 * modal so the two can never drift apart — adding someone should show
	 * exactly what editing them shows.
	 *
	 * The notes field is the point of the record and gets the room to prove it;
	 * everything else folds away behind a summary. All the inputs stay in the
	 * DOM when collapsed, which matters because `updatePerson` overwrites the
	 * whole record — a field that did not post would be nulled.
	 *
	 * Flags are deliberately NOT here: attaching to a person who does not exist
	 * yet (staged, submitted with the form) and attaching to one who does
	 * (applied immediately) are genuinely different jobs.
	 */
	let {
		values,
		errorId = null,
		error = null,
		linkDates = false,
		detailsOpen = false
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
			status?: 'met' | 'to_meet' | null;
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
		/** Open on the add form, where you are filling these in; shut when reading. */
		detailsOpen?: boolean;
	} = $props();

	// Read once, untracked: both callers mount this fresh (inside an {#if}, and
	// the detail modal is additionally keyed per person), so `values` cannot
	// change underneath it — and re-syncing would overwrite what is being typed.
	let metOn = $state(untrack(() => values.metOn ?? ''));
	let lastSpokeAt = $state(untrack(() => values.lastSpokeAt ?? ''));
	let lastSpokeTouched = $state(false);
	let status = $state(untrack(() => values.status ?? 'met'));

	$effect(() => {
		if (linkDates && !lastSpokeTouched) lastSpokeAt = metOn;
	});

	// Someone you have only been meaning to meet has no meeting date and no
	// conversation to have gone quiet on, so the two date fields are hidden
	// rather than shown empty and vaguely accusing.
	let wishlist = $derived(status === 'to_meet');
</script>

<label class="wide">
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

<label class="wide notes">
	Who they are — what they work on, what they can help with, how you know them
	<textarea name="notes" placeholder="The part worth reading a year from now."
		>{values.notes ?? ''}</textarea
	>
</label>

<details class="wide details" open={detailsOpen}>
	<!-- A fixed label, not a summary of the fields inside. Rendering
	     "role · company · city" here read as the person's employer rather than as
	     the name of a section you can open. -->
	<summary><span class="summary-text">Contact details</span></summary>

	<div class="grid">
		<fieldset class="status wide">
			<legend>Have we met?</legend>
			<label class="radio">
				<input type="radio" name="status" value="met" bind:group={status} />
				Met them
			</label>
			<label class="radio">
				<input type="radio" name="status" value="to_meet" bind:group={status} />
				Want to meet them
			</label>
		</fieldset>

		<label>Role<input name="role" value={values.role ?? ''} autocomplete="off" /></label>
		<label>Company<input name="company" value={values.company ?? ''} autocomplete="off" /></label>
		<label>City<input name="city" value={values.city ?? ''} autocomplete="off" /></label>
		<label
			>LinkedIn<input
				name="linkedinUrl"
				value={values.linkedinUrl ?? ''}
				autocomplete="off"
			/></label
		>
		<label>Email<input name="email" value={values.email ?? ''} autocomplete="off" /></label>
		<label>Phone<input name="phone" value={values.phone ?? ''} autocomplete="off" /></label>
		<label class="wide">
			Where we met
			<input
				name="metAt"
				value={values.metAt ?? ''}
				placeholder="Ana's dinner party"
				autocomplete="off"
			/>
		</label>

		{#if wishlist}
			<!-- Submitted empty rather than omitted: the update action overwrites the
			     whole record, so leaving the keys out would keep stale dates on someone
			     moved back to the wishlist. -->
			<input type="hidden" name="metOn" value="" />
			<input type="hidden" name="lastSpokeAt" value="" />
		{:else}
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
		{/if}
	</div>
</details>

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
	/* The record's reason for existing. Tall by default and freely resizable,
	   because the useful version of this field is several paragraphs. */
	.notes textarea {
		min-height: 14rem;
		line-height: 1.55;
		resize: vertical;
	}
	.details {
		border: 1px solid var(--border);
		border-radius: var(--radius-s);
		background: var(--surface);
	}
	summary {
		padding: 0.45rem 0.6rem;
		font-size: 0.75rem;
		color: var(--muted);
		cursor: pointer;
		list-style-position: inside;
	}
	.summary-text {
		margin-left: 0.2rem;
	}
	.details[open] summary {
		border-bottom: 1px solid var(--border);
	}
	.grid {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 0.6rem;
		padding: 0.6rem;
	}
	.status-error {
		margin: 0;
		font-size: 0.72rem;
		color: var(--danger);
	}
	.status {
		display: flex;
		align-items: center;
		gap: 0.9rem;
		margin: 0;
		padding: 0.4rem 0.6rem;
		border: 1px solid var(--border);
		border-radius: var(--radius-s);
		font-size: 0.72rem;
		color: var(--muted);
	}
	.status legend {
		padding: 0 0.3rem;
	}
	.radio {
		flex-direction: row;
		align-items: center;
		gap: 0.3rem;
	}
	.radio input {
		width: auto;
		padding: 0;
	}
	@media (max-width: 640px) {
		.grid {
			grid-template-columns: 1fr;
		}
	}
</style>
