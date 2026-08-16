<script lang="ts">
	import { untrack } from 'svelte';
	import type { CityMatch } from '$lib/people/types';

	/**
	 * The city field: type freely, or pick a real place and have it standardised.
	 *
	 * Posts two controls — `city`, the visible text, and a hidden `cityId`. The id
	 * is the identity and the text is what you read; the server rewrites the text
	 * from the id whenever one is set, so the two can never describe different
	 * places.
	 *
	 * Unmatched input is deliberately allowed. Not everywhere someone lives is in
	 * GeoNames, and a picker that refused what it did not recognise would be worse
	 * than the plain text input this replaces. With JavaScript off this degrades
	 * to exactly that input, posting an empty `cityId` — which matters, because
	 * these are real form-action POSTs.
	 *
	 * A `<datalist>` cannot do this job: it has no async source and cannot carry
	 * an id back.
	 */
	let { city = null, cityId = null }: { city?: string | null; cityId?: number | null } = $props();

	// Read once, untracked, for the same reason PersonFields does: both callers
	// mount this fresh, and re-syncing would overwrite what is being typed.
	let text = $state(untrack(() => city ?? ''));
	let selectedId = $state<number | null>(untrack(() => cityId ?? null));

	let matches = $state<CityMatch[]>([]);
	let open = $state(false);
	let active = $state(-1);
	let inputEl = $state<HTMLInputElement | null>(null);

	/** Long enough that a fast typist does not fire a request per keystroke. */
	const DEBOUNCE_MS = 150;
	let timer: ReturnType<typeof setTimeout> | null = null;
	// Responses can land out of order; only the newest one may paint.
	let latest = 0;

	const listId = `city-options-${Math.random().toString(36).slice(2, 9)}`;

	async function fetchMatches(query: string) {
		const token = ++latest;
		try {
			const response = await fetch(`/api/cities?q=${encodeURIComponent(query)}`);
			if (!response.ok) return;
			const body = (await response.json()) as { cities: CityMatch[] };
			if (token !== latest) return;
			matches = body.cities;
			open = matches.length > 0;
			active = -1;
		} catch {
			// A failed lookup must not cost you the text you typed, so this is
			// silent — the field simply stops suggesting.
		}
	}

	function onInput() {
		// Editing after picking breaks the match: the id described the old text,
		// and leaving it attached is exactly the desync the server guards against.
		selectedId = null;
		if (timer) clearTimeout(timer);
		const query = text;
		if (query.trim().length < 2) {
			latest++;
			matches = [];
			open = false;
			return;
		}
		timer = setTimeout(() => fetchMatches(query), DEBOUNCE_MS);
	}

	function choose(match: CityMatch) {
		text = match.label;
		selectedId = match.id;
		matches = [];
		open = false;
		active = -1;
		inputEl?.focus();
	}

	function onKeydown(event: KeyboardEvent) {
		if (!open || matches.length === 0) return;
		if (event.key === 'ArrowDown') {
			event.preventDefault();
			active = (active + 1) % matches.length;
		} else if (event.key === 'ArrowUp') {
			event.preventDefault();
			active = active <= 0 ? matches.length - 1 : active - 1;
		} else if (event.key === 'Enter' && active >= 0) {
			// Only swallow Enter when a suggestion is actually highlighted —
			// otherwise it must still submit the form.
			event.preventDefault();
			choose(matches[active]);
		} else if (event.key === 'Escape') {
			open = false;
			active = -1;
		}
	}
</script>

<label class="field">
	City
	<div class="control">
		<input
			bind:this={inputEl}
			bind:value={text}
			name="city"
			autocomplete="off"
			role="combobox"
			aria-expanded={open}
			aria-controls={listId}
			aria-autocomplete="list"
			aria-activedescendant={active >= 0 ? `${listId}-${active}` : undefined}
			oninput={onInput}
			onkeydown={onKeydown}
			onfocus={() => {
				if (matches.length > 0) open = true;
			}}
			onblur={() => {
				// Deferred so a click on a suggestion lands before the list closes.
				setTimeout(() => (open = false), 120);
			}}
		/>
		<input type="hidden" name="cityId" value={selectedId ?? ''} />

		{#if open && matches.length > 0}
			<ul class="options" id={listId} role="listbox">
				{#each matches as match, i (match.id)}
					<li
						id="{listId}-{i}"
						role="option"
						aria-selected={i === active}
						class:active={i === active}
					>
						<button type="button" onmousedown={() => choose(match)}>
							<span class="name">{match.label}</span>
							{#if match.secondary}<span class="secondary">{match.secondary}</span>{/if}
						</button>
					</li>
				{/each}
			</ul>
		{/if}
	</div>
</label>

<style>
	.field {
		display: flex;
		flex-direction: column;
		gap: 0.2rem;
		font-size: 0.72rem;
		color: var(--muted);
	}
	.control {
		position: relative;
	}
	input {
		width: 100%;
		padding: 0.35rem 0.5rem;
		border: 1px solid var(--border);
		border-radius: var(--radius-s);
		background: var(--surface);
		font: inherit;
		font-size: 0.85rem;
		color: inherit;
	}
	.options {
		position: absolute;
		z-index: 20;
		top: calc(100% + 0.2rem);
		left: 0;
		right: 0;
		margin: 0;
		padding: 0.15rem;
		max-height: 14rem;
		overflow-y: auto;
		list-style: none;
		border: 1px solid var(--border);
		border-radius: var(--radius-s);
		background: var(--surface);
		box-shadow: 0 6px 18px rgb(0 0 0 / 0.12);
	}
	.options button {
		display: flex;
		flex-direction: column;
		gap: 0.05rem;
		width: 100%;
		padding: 0.3rem 0.4rem;
		border: 0;
		border-radius: var(--radius-s);
		background: none;
		font: inherit;
		text-align: left;
		color: inherit;
		cursor: pointer;
	}
	li.active button,
	.options button:hover {
		background: var(--hover, rgb(0 0 0 / 0.05));
	}
	.name {
		font-size: 0.82rem;
	}
	.secondary {
		font-size: 0.68rem;
		color: var(--muted);
	}
</style>
