<script lang="ts">
	// Shared by the Today and Canvas panels: both kick off a fetch that can only
	// be waited on, so both want the same glyph, the same size and the same spin.
	let {
		label,
		spinning = false,
		onclick
	}: {
		/** Names the action for assistive tech and the tooltip. */
		label: string;
		/** Spins the icon and blocks a second press while the fetch is in flight. */
		spinning?: boolean;
		onclick: () => void;
	} = $props();
</script>

<button
	type="button"
	class="refresh-btn"
	disabled={spinning}
	aria-label={label}
	title={label}
	{onclick}
>
	<svg
		class:spinning
		viewBox="0 0 24 24"
		width="18"
		height="18"
		fill="none"
		stroke="currentColor"
		stroke-width="2"
		stroke-linecap="round"
		stroke-linejoin="round"
		aria-hidden="true"
	>
		<polyline points="23 4 23 10 17 10" />
		<polyline points="1 20 1 14 7 14" />
		<path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
	</svg>
</button>

<style>
	.refresh-btn {
		flex-shrink: 0;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 28px;
		height: 28px;
		padding: 0;
		border: none;
		border-radius: 50%;
		background: transparent;
		color: var(--muted);
		line-height: 1;
		cursor: pointer;
		transition:
			background 0.15s ease,
			color 0.15s ease;
	}

	.refresh-btn:hover:not(:disabled) {
		background: var(--surface-2);
		color: var(--ink);
	}

	.refresh-btn:disabled {
		cursor: default;
	}

	/* The icon spins, not the button: a rotating hit target drags its focus ring
	   and tooltip anchor around with it. */
	.spinning {
		animation: refresh-spin 0.8s linear infinite;
	}

	@keyframes refresh-spin {
		to {
			transform: rotate(360deg);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.spinning {
			animation: none;
		}
	}
</style>
