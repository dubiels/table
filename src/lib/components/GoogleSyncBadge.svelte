<script lang="ts">
	import { enhance } from '$app/forms';
	import { page } from '$app/state';
	import { toast } from '$lib/toast.svelte';
	import {
		googleSyncState,
		googleSyncIsOn,
		googleSyncLabel,
		googleSyncActionLabel,
		canSendToGoogle,
		NEEDS_DUE_DATE_MESSAGE
	} from '$lib/googleSync';
	import GoogleSyncGlyph from './GoogleSyncGlyph.svelte';
	import ConfirmBubble from './ConfirmBubble.svelte';

	let {
		task,
		interactive = false
	}: {
		task: {
			id: string;
			title: string;
			dueDate?: string | null;
			googleSync?: boolean;
			googleTaskId?: string | null;
			googleError?: string | null;
		};
		/** Whether this surface can change the state as well as report it. */
		interactive?: boolean;
	} = $props();

	// From the layout load, so this component does not have to be handed the flag
	// through every view that renders a card. Safe to read here: the card is only
	// ever rendered under the (app) route group, whose layout load always sets it.
	let gtasksConfigured = $derived(page.data.gtasksConfigured === true);

	// Not named `state`: that shadows the `$state` rune, which Svelte then reads
	// as a store subscription on this variable.
	let syncState = $derived(googleSyncState(task));
	let isOn = $derived(googleSyncIsOn(task));
	let label = $derived(googleSyncLabel(task));
	let action = $derived(googleSyncActionLabel(task));

	// With the integration off, nothing here can be acted on and no badge should
	// assert a sync that cannot run. On a surface that only reports — the history
	// list — the "off" ring is dropped too: a mark on every finished row is noise
	// when there is no control attached to it.
	let visible = $derived(gtasksConfigured && (interactive || syncState !== 'off'));

	let formEl = $state<HTMLFormElement | undefined>();
	let onInput = $state<HTMLInputElement | undefined>();
	let btnEl = $state<HTMLButtonElement | undefined>();
	let confirming = $state(false);

	// Set imperatively rather than through a bound value, because the submit has
	// to happen in the same tick as the decision: a bound input would still hold
	// the previous direction when `requestSubmit` reads the form.
	function submit(on: boolean) {
		if (!formEl || !onInput) return;
		onInput.value = on ? 'true' : 'false';
		formEl.requestSubmit();
	}

	function handleClick() {
		if (isOn) {
			// Switching off deletes the Google copy, so it asks once — the badge is
			// small and sits inside a card that is also a drag target.
			confirming = true;
			return;
		}
		// Refused before posting, so the answer is a message rather than a dead
		// click. The server enforces the same rule; this exists to explain it.
		if (!canSendToGoogle(task)) {
			toast(NEEDS_DUE_DATE_MESSAGE, 'error');
			return;
		}
		submit(true);
	}
</script>

{#if visible}
	{#if interactive}
		<!-- Click and keydown are stopped for the same reason the done toggle stops
		     them: the card is itself a role="button" that opens the detail panel,
		     and BentoView wraps it in a pointer handler that starts a drag. -->
		<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
		<form
			class="gmark"
			method="POST"
			action="/?/setTaskGoogleSync"
			bind:this={formEl}
			use:enhance={() =>
				async ({ result, update }) => {
					if (result.type === 'failure') {
						toast(String(result.data?.error ?? 'Could not change Google Tasks sync'), 'error');
						return;
					}
					await update();
				}}
			onclick={(e) => e.stopPropagation()}
			onkeydown={(e) => e.stopPropagation()}
		>
			<input type="hidden" name="id" value={task.id} />
			<input type="hidden" name="on" bind:this={onInput} value={isOn ? 'false' : 'true'} />
			<button
				type="button"
				class="gbtn"
				class:faint={syncState === 'off'}
				bind:this={btnEl}
				title={label}
				aria-label="{action} — {label}"
				onclick={handleClick}
			>
				<GoogleSyncGlyph state={syncState} />
			</button>
		</form>
	{:else}
		<span class="gmark gmark-static" title={label}>
			<GoogleSyncGlyph state={syncState} />
			<span class="sr-only">{label}</span>
		</span>
	{/if}
{/if}

{#if confirming && btnEl}
	<ConfirmBubble
		anchor={btnEl}
		copy="Remove “{task.title}” from Google Tasks? It stays on the board."
		confirmLabel="Remove"
		onconfirm={() => {
			confirming = false;
			submit(false);
		}}
		oncancel={() => (confirming = false)}
	/>
{/if}

<style>
	/* Positioned against the card, which is the only thing this badge is ever
	   drawn on. Centred on the card's full height rather than pinned to its top
	   edge, for the same reason the done toggle is: a card carrying a priority or
	   due chip is twice as tall as a bare one, and a fixed top inset reads as
	   sitting high on all of them. The 1rem right inset keeps it clear of the
	   zone dot, which stays in the corner. */
	.gmark {
		position: absolute;
		top: 50%;
		right: 1rem;
		transform: translateY(-50%);
		line-height: 0;
	}

	.gmark-static {
		display: inline-flex;
		padding: 0.15rem;
	}

	.gbtn {
		display: inline-flex;
		padding: 0.15rem;
		border: none;
		background: transparent;
		border-radius: 50%;
		cursor: pointer;
		/* The glyph is 11px; the padding is what makes it a target you can hit
		   without opening the detail panel by mistake. */
	}

	.gbtn:hover,
	.gbtn:focus-visible {
		background: var(--surface-2);
	}

	/* A ring on every unsynced card would shout as loudly as a real state, so it
	   sits back until the card is under the pointer or the badge has focus. */
	.faint {
		opacity: 0.4;
	}

	.gbtn.faint:hover,
	.gbtn.faint:focus-visible {
		opacity: 1;
	}

	.sr-only {
		position: absolute;
		width: 1px;
		height: 1px;
		padding: 0;
		overflow: hidden;
		clip-path: inset(50%);
		white-space: nowrap;
	}
</style>
