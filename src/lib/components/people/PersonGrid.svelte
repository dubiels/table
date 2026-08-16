<script lang="ts">
	import PersonCard from './PersonCard.svelte';
	import type { PersonView, FlagView } from '$lib/people/types';

	let {
		people,
		flags,
		hasAnyPeople,
		status = 'met',
		today,
		logos = {},
		onopen
	}: {
		people: PersonView[];
		flags: FlagView[];
		/** Distinguishes "no one yet" from "nothing matched", which want different copy. */
		hasAnyPeople: boolean;
		/** Which tab is showing, so an empty one explains itself in its own terms. */
		status?: 'met' | 'to_meet' | 'all';
		today: string;
		logos?: Record<string, { title: string; path: string; hex: string }>;
		onopen: (id: string) => void;
	} = $props();
</script>

{#if people.length > 0}
	<div class="grid">
		{#each people as person (person.id)}
			<PersonCard
				{person}
				{flags}
				{today}
				logo={person.company ? (logos[person.company] ?? null) : null}
				{onopen}
			/>
		{/each}
	</div>
{:else if hasAnyPeople}
	<p class="empty">No one matches. Try clearing the search or the flag filters.</p>
{:else if status === 'to_meet'}
	<p class="empty">
		No one on the list yet. This is for people you want to meet but haven't — add them with
		<strong>+ Add person</strong> and mark them <em>Want to meet them</em>.
	</p>
{:else}
	<p class="empty">
		No one here yet. Add the last person you talked to with <strong>+ Add person</strong> — a name is
		the only thing you have to fill in.
	</p>
{/if}

<style>
	.grid {
		display: grid;
		grid-template-columns: 1fr;
		gap: 0.75rem;
	}
	/* One column on a phone, four on a wide desktop. */
	@media (min-width: 640px) {
		.grid {
			grid-template-columns: repeat(2, 1fr);
		}
	}
	@media (min-width: 960px) {
		.grid {
			grid-template-columns: repeat(3, 1fr);
		}
	}
	@media (min-width: 1400px) {
		.grid {
			grid-template-columns: repeat(4, 1fr);
		}
	}
	.empty {
		max-width: 40ch;
		margin: 2.5rem auto;
		text-align: center;
		color: var(--muted, #93897d);
		line-height: 1.55;
	}
</style>
