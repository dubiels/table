<script lang="ts">
	import type { LogoView } from '$lib/people/types';
	let {
		logo,
		size = 16
	}: {
		/** Resolved server-side; null when the brand is not carried, which is common. */
		logo: LogoView | null;
		size?: number;
	} = $props();
</script>

{#if logo?.src}
	<!-- Bitmap overrides carry no alpha, so they sit on a light tile rather than
	     showing as a white square against the dark theme. -->
	<img class="tile" src={logo.src} alt="" width={size} height={size} />
{:else if logo?.path}
	<!-- The brand colour is the mark's own. `aria-hidden` because the company
	     name is always rendered beside it in text — announcing the logo too
	     would just repeat it. -->
	<svg
		viewBox="0 0 24 24"
		width={size}
		height={size}
		fill="#{logo.hex}"
		aria-hidden="true"
		class="logo"
	>
		<title>{logo.title}</title>
		<path d={logo.path} />
	</svg>
{/if}

<style>
	.logo,
	.tile {
		flex: none;
		vertical-align: -0.15em;
	}
	.tile {
		border-radius: 3px;
		background: #fff;
		object-fit: contain;
	}
	/* Marks that are near-black vanish on the dark theme. Lifting them to the
	   text colour keeps them legible; the handful of brands whose identity is
	   genuinely black read as monochrome either way. */
	:global(:root[data-theme='dark']) .logo[fill='#000000'],
	:global(:root[data-theme='dark']) .logo[fill='#181717'] {
		fill: currentColor;
	}
</style>
