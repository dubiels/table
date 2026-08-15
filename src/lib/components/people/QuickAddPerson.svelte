<script lang="ts">
	import { enhance } from '$app/forms';

	let nameEl = $state<HTMLInputElement | null>(null);
	let saving = $state(false);
</script>

<!-- The capture path. Everything about it is tuned for speed: a name is the only
     requirement, the note is optional, and focus returns to the name field so a
     run of people can be entered without touching the mouse. -->
<form
	method="POST"
	action="?/createPerson"
	class="quick-add"
	use:enhance={() => {
		saving = true;
		return async ({ update }) => {
			await update();
			saving = false;
			nameEl?.focus();
		};
	}}
>
	<input
		bind:this={nameEl}
		name="name"
		placeholder="Who did you meet?"
		required
		autocomplete="off"
		class="name"
	/>
	<input name="notes" placeholder="Who are they? (optional)" autocomplete="off" class="note" />
	<button type="submit" disabled={saving}>{saving ? 'Adding…' : 'Add'}</button>
</form>

<style>
	.quick-add {
		display: flex;
		gap: 0.5rem;
		margin-bottom: 1rem;
	}
	input {
		padding: 0.45rem 0.65rem;
		border: 1px solid var(--border, #e2dace);
		border-radius: 7px;
		background: var(--surface, #fff);
		font: inherit;
		color: inherit;
	}
	.name {
		flex: 0 1 16rem;
	}
	.note {
		flex: 1 1 auto;
		min-width: 0;
	}
	button {
		padding: 0.45rem 0.9rem;
		border: none;
		border-radius: 7px;
		background: var(--accent, #6f7f5f);
		color: #fff;
		font: inherit;
		font-weight: 600;
		cursor: pointer;
	}
	button:disabled {
		opacity: 0.6;
		cursor: default;
	}
	@media (max-width: 640px) {
		.quick-add {
			flex-wrap: wrap;
		}
		.name {
			flex: 1 1 100%;
		}
	}
</style>
