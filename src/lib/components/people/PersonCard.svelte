<script lang="ts">
	import { flagColorVars } from '$lib/people/colors';
	import { contactHeat, describeAge, HEAT_LABEL } from '$lib/people/relative-date';
	import CompanyLogo from './CompanyLogo.svelte';
	import type { PersonView, FlagView, LogoView } from '$lib/people/types';

	let {
		person,
		flags,
		today,
		logo = null,
		onopen
	}: {
		person: PersonView;
		flags: FlagView[];
		logo?: LogoView | null;
		/** Passed in rather than read from the clock, so SSR and hydration agree. */
		today: string;
		onopen: (id: string) => void;
	} = $props();

	// Only for people you have actually met: someone on the wishlist has no
	// contact to have gone quiet on, and saying so would just be noise.
	let lastContact = $derived(
		person.status === 'met' ? describeAge(person.lastSpokeAt, today) : null
	);
	let heat = $derived(person.status === 'met' ? contactHeat(person.lastSpokeAt, today) : 'none');

	let subtitle = $derived([person.role, person.company].filter(Boolean).join(', '));
	let attached = $derived(flags.filter((f) => person.flagIds.includes(f.id)));
</script>

<button
	type="button"
	class="card"
	class:archived={Boolean(person.archivedAt)}
	onclick={() => onopen(person.id)}
>
	<span class="name">{person.name}</span>
	{#if subtitle}
		<span class="subtitle"><CompanyLogo {logo} size={13} />{subtitle}</span>
	{/if}

	{#if attached.length > 0}
		<span class="chips">
			{#each attached as flag (flag.id)}
				{@const vars = flagColorVars(flag.color)}
				<span class="chip" style="background:{vars.fill};border-color:{vars.border}">
					{flag.name}
				</span>
			{/each}
		</span>
	{/if}

	{#if person.notes}<span class="notes">{person.notes}</span>{/if}
	{#if person.status === 'met'}
		<span class="heat heat-{heat}" title={HEAT_LABEL[heat]}>
			{lastContact ?? 'No contact logged'}
		</span>
	{/if}
	{#if person.status === 'to_meet'}<span class="badge">Want to meet</span>{/if}
	{#if person.archivedAt}<span class="badge">Archived</span>{/if}
</button>

<style>
	.card {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 0.35rem;
		width: 100%;
		padding: 0.85rem;
		border: 1px solid var(--border, #e7e0d5);
		border-radius: 10px;
		background: var(--surface, #fff);
		text-align: left;
		font: inherit;
		color: inherit;
		cursor: pointer;
	}
	.card:hover {
		border-color: var(--border-strong, #d5c9b6);
	}
	.archived {
		opacity: 0.6;
	}
	.name {
		font-weight: 600;
	}
	.subtitle {
		display: flex;
		align-items: center;
		gap: 0.3rem;
		font-size: 0.78rem;
		color: var(--muted, #93897d);
	}
	.chips {
		display: flex;
		flex-wrap: wrap;
		gap: 0.25rem;
	}
	.chip {
		padding: 0.1rem 0.45rem;
		border: 1px solid transparent;
		border-radius: 999px;
		font-size: 0.68rem;
	}
	.notes {
		font-size: 0.78rem;
		line-height: 1.45;
		color: var(--muted, #6b6258);
		/* Three lines: enough to tell people apart, short enough to keep the grid
		   scannable. The full text is one click away in the modal. */
		display: -webkit-box;
		-webkit-line-clamp: 3;
		/* The standard property alongside the prefixed one. Browsers that support
		   it use this; the -webkit-box pair stays for the ones that do not. */
		line-clamp: 3;
		-webkit-box-orient: vertical;
		overflow: hidden;
	}
	/* A graded scale, not a switch: at a glance you want to see who is drifting,
	   not only who has already gone. The `title` carries the band's name, so the
	   meaning never rests on colour alone. */
	.heat {
		align-self: flex-start;
		padding: 0.05rem 0.45rem;
		border: 1px solid transparent;
		border-radius: 999px;
		font-size: 0.68rem;
	}
	.heat-none {
		color: var(--muted);
		opacity: 0.7;
	}
	.heat-fresh {
		background: var(--zone-sage-fill);
		border-color: var(--zone-sage-border);
	}
	.heat-recent {
		background: var(--zone-sky-fill);
		border-color: var(--zone-sky-border);
	}
	.heat-cooling {
		background: var(--zone-butter-fill);
		border-color: var(--zone-butter-border);
	}
	.heat-stale {
		background: var(--zone-clay-fill);
		border-color: var(--zone-clay-border);
		font-weight: 600;
	}
	.heat-cold {
		background: var(--danger-soft);
		border-color: var(--danger);
		color: var(--danger);
		font-weight: 600;
	}
	.badge {
		font-size: 0.65rem;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: var(--muted, #93897d);
	}
</style>
