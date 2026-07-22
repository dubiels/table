<script lang="ts">
	import { enhance } from '$app/forms';
	import { ZONE_COLORS, ZONE_COLOR_KEYS, type ZoneColor } from '$lib/zones';

	let {
		zoneId,
		x,
		y,
		onclose
	}: { zoneId: string; x: number; y: number; onclose: () => void } = $props();

	let el = $state<HTMLDivElement | undefined>();

	function handleWindowPointerdown(e: PointerEvent) {
		if (el && !el.contains(e.target as Node)) onclose();
	}

	function handleWindowKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') onclose();
	}
</script>

<svelte:window onpointerdown={handleWindowPointerdown} onkeydown={handleWindowKeydown} />

<div class="zone-color-picker" bind:this={el} style="left:{x}px; top:{y}px;">
	{#each ZONE_COLOR_KEYS as key (key)}
		<form
			method="POST"
			action="?/updateZoneColor"
			use:enhance={() => {
				onclose();
			}}
		>
			<input type="hidden" name="id" value={zoneId} />
			<input type="hidden" name="color" value={key} />
			<button
				type="submit"
				class="swatch"
				style="background:{ZONE_COLORS[key as ZoneColor].fill}; border-color:{ZONE_COLORS[
					key as ZoneColor
				].border};"
				aria-label={key}
			></button>
		</form>
	{/each}
</div>

<style>
	.zone-color-picker {
		position: fixed;
		z-index: 50;
		display: flex;
		gap: 0.35rem;
		padding: 0.4rem;
		background: var(--surface-1, #fff);
		border: 1px solid var(--border-strong);
		border-radius: var(--radius-s);
		box-shadow: 0 4px 16px rgba(0, 0, 0, 0.15);
	}
	.swatch {
		width: 1.4rem;
		height: 1.4rem;
		border-radius: 50%;
		border: 2px solid;
		padding: 0;
		cursor: pointer;
	}
</style>
