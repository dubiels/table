<script lang="ts">
	import { toasts, dismissToast } from '$lib/toast.svelte';
</script>

<div class="toasts" role="status" aria-live="polite">
	{#each toasts as t (t.id)}
		<div class="toast" class:success={t.tone === 'success'} class:error={t.tone === 'error'}>
			{t.message}
			{#if t.action}
				<button
					type="button"
					class="action"
					onclick={() => {
						t.action?.run();
						dismissToast(t.id);
					}}
				>
					{t.action.label}
				</button>
			{/if}
		</div>
	{/each}
</div>

<style>
	.toasts {
		position: fixed;
		left: 50%;
		bottom: 1.5rem;
		transform: translateX(-50%);
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.5rem;
		/* Above the task detail modal (1000) so a failed save is never hidden. */
		z-index: 2000;
		pointer-events: none;
	}

	.toast {
		max-width: min(90vw, 30rem);
		padding: 0.5rem 1rem;
		background: var(--surface);
		border: 1px solid var(--border-strong);
		border-radius: 999px;
		box-shadow: var(--shadow-raised);
		font-size: 0.88rem;
		font-weight: 500;
		text-align: center;
		animation: toast-in 160ms ease-out;
		display: inline-flex;
		align-items: center;
		gap: 0.6rem;
	}

	.action {
		/* Only the button re-enables pointer events, so the pill itself stays
		   click-through exactly as before. */
		pointer-events: auto;
		border: none;
		background: none;
		/* Only this button is hit-testable (the pill itself stays click-through),
		   so a bit of padding here costs nothing and keeps the tap target off the
		   floor of the 24x24 minimum — bare text was landing around 30x20. */
		padding: 0.25rem 0.4rem;
		margin: -0.25rem -0.4rem;
		font: inherit;
		font-weight: 600;
		color: var(--accent);
		text-decoration: underline;
		cursor: pointer;
	}

	.toast.success {
		color: var(--ok);
	}

	.toast.error {
		color: var(--danger);
	}

	@keyframes toast-in {
		from {
			opacity: 0;
			transform: translateY(8px);
		}
		to {
			opacity: 1;
			transform: translateY(0);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.toast {
			animation: none;
		}
	}
</style>
