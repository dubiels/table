<script lang="ts" generics="T extends string">
	// Generic over the option type so callers keep their narrow union
	// (e.g. 'blob' | 'list' | 'bento') through the two-way binding.
	let {
		value = $bindable(),
		options
	}: {
		value: T;
		options: Array<{ value: T; label: string }>;
	} = $props();
</script>

<div class="seg" role="tablist" aria-label="View">
	{#each options as opt (opt.value)}
		<button
			type="button"
			role="tab"
			aria-selected={value === opt.value}
			class="seg-btn"
			class:active={value === opt.value}
			onclick={() => (value = opt.value)}
		>
			{opt.label}
		</button>
	{/each}
</div>

<style>
	.seg {
		display: inline-flex;
		gap: 2px;
		padding: 3px;
		background: var(--surface-2);
		border-radius: 999px;
	}
	.seg-btn {
		border: none;
		background: transparent;
		color: var(--muted);
		font-size: 0.82rem;
		font-weight: 600;
		padding: 0.32rem 0.9rem;
		border-radius: 999px;
		cursor: pointer;
		transition:
			background 0.15s ease,
			color 0.15s ease,
			box-shadow 0.15s ease;
	}
	.seg-btn:hover {
		color: var(--ink);
	}
	.seg-btn.active {
		background: var(--surface);
		color: var(--ink);
		box-shadow: var(--shadow-card);
	}
</style>
