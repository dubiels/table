<script lang="ts">
	import { linkedinHandle } from '$lib/people/linkedin';

	let {
		url,
		name,
		role = null,
		company = null
	}: {
		url: string;
		name: string;
		role?: string | null;
		company?: string | null;
	} = $props();

	let handle = $derived(linkedinHandle(url));
	let subtitle = $derived([role, company].filter(Boolean).join(', '));
</script>

<!-- Built from what we already store, not fetched. LinkedIn puts profiles behind
     an auth wall, sends X-Frame-Options so they cannot be framed, and answers an
     unauthenticated fetch with a login page rather than OpenGraph tags — so a
     real preview is not on offer from anyone, at any price. -->
<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- external absolute URL (a LinkedIn profile), not an app route -->
<a class="card" href={url} target="_blank" rel="noreferrer noopener">
	<svg class="glyph" viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
		<path
			fill="currentColor"
			d="M20.45 20.45h-3.56v-5.57c0-1.33-.02-3.04-1.85-3.04-1.85 0-2.13 1.45-2.13 2.94v5.67H9.35V9h3.41v1.56h.05c.48-.9 1.63-1.85 3.36-1.85 3.6 0 4.27 2.37 4.27 5.45v6.29zM5.34 7.43a2.06 2.06 0 1 1 0-4.13 2.06 2.06 0 0 1 0 4.13zm1.78 13.02H3.55V9h3.57v11.45zM22.22 0H1.77C.79 0 0 .77 0 1.72v20.56C0 23.23.79 24 1.77 24h20.45c.98 0 1.78-.77 1.78-1.72V1.72C24 .77 23.2 0 22.22 0z"
		/>
	</svg>

	<span class="text">
		<span class="name">{name}</span>
		{#if subtitle}<span class="subtitle">{subtitle}</span>{/if}
		<span class="handle">{handle ? `linkedin.com/in/${handle}` : url}</span>
	</span>

	<span class="go" aria-hidden="true">↗</span>
	<span class="sr">Opens in a new tab</span>
</a>

<style>
	.card {
		grid-column: 1 / -1;
		display: flex;
		align-items: center;
		gap: 0.7rem;
		padding: 0.6rem 0.75rem;
		border: 1px solid var(--border);
		border-radius: var(--radius-s);
		background: var(--zone-sky-fill);
		color: inherit;
		text-decoration: none;
	}
	.card:hover {
		border-color: var(--border-strong);
	}
	.glyph {
		flex: none;
		color: #0a66c2;
	}
	.text {
		display: flex;
		flex-direction: column;
		min-width: 0;
	}
	.name {
		font-size: 0.85rem;
		font-weight: 600;
	}
	.subtitle {
		font-size: 0.75rem;
		opacity: 0.8;
	}
	.handle {
		font-size: 0.7rem;
		opacity: 0.7;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.go {
		margin-left: auto;
		opacity: 0.6;
	}
	.sr {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip-path: inset(50%);
		white-space: nowrap;
	}
</style>
