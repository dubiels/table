<script lang="ts">
	import type { GoogleSyncState } from '$lib/googleSync';

	// Drawn rather than set in type, like the topbar icons: a glyph would ignore
	// the colour that carries the state. Shared by the card badge and the legend
	// in the user menu, so the key shows the mark the board actually draws
	// instead of a hand-drawn copy of it that can quietly diverge.
	let { state, size = 11 }: { state: GoogleSyncState; size?: number } = $props();
</script>

<svg
	class="glyph glyph-{state}"
	viewBox="0 0 24 24"
	width={size}
	height={size}
	fill="none"
	stroke="currentColor"
	stroke-width="2.5"
	stroke-linecap="round"
	stroke-linejoin="round"
	aria-hidden="true"
>
	<circle cx="12" cy="12" r="9" />
	<!-- An empty ring for a task nobody opted in: the tick means "Google has
	     this", so drawing one in grey would say the opposite of the state. -->
	{#if state !== 'off'}
		<path d="M8 12.5l2.5 2.5L16 9.5" />
	{/if}
</svg>

<style>
	.glyph {
		display: block;
	}
	.glyph-off,
	.glyph-pending {
		color: var(--muted);
	}
	.glyph-synced {
		color: var(--ok);
	}
	.glyph-error {
		color: var(--danger);
	}
</style>
