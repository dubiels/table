<script lang="ts">
	import { enhance } from '$app/forms';
	import { page } from '$app/state';
	import { anchoredPosition } from '$lib/anchoredPosition';
	import { canSendToGoogle, NEEDS_DUE_DATE_MESSAGE } from '$lib/googleSync';

	let {
		x = 60,
		y = 60,
		anchor,
		zoneName,
		onclose
	}: {
		x?: number;
		y?: number;
		/** The + the popover opened from, which it hangs off and positions against. */
		anchor: HTMLElement;
		zoneName: string;
		onclose: () => void;
	} = $props();

	const STORAGE_KEY = 'table:gtasks-default';
	const POPOVER_WIDTH = 264;

	let dueDate = $state('');
	// Sticky, because pushing everything should cost one click ever rather than
	// one per task.
	let googleSync = $state(false);
	let gtasksConfigured = $derived(page.data.gtasksConfigured === true);
	// No task exists yet, so this is only ever the due-date rule — but it is read
	// from the shared helper so the board and the detail panel cannot come to
	// disagree about when Google will accept something.
	let canSync = $derived(canSendToGoogle({ dueDate }));

	let el = $state<HTMLDivElement | undefined>();
	let titleEl = $state<HTMLInputElement | undefined>();
	let dueDateEl = $state<HTMLInputElement | undefined>();

	// Set by a refused tick, never on open — the rule is stated in answer to an
	// attempt rather than sitting there from the moment the popover opens, which
	// is the same as not being read at all. Rendered against `canSync` too, so
	// typing a date clears it without anything having to reset the flag.
	let attemptedWithoutDate = $state(false);
	let failed = $state(false);

	// fixed, not absolute: the board scrolls and every box clips its overflow, so
	// a panel rendered inside the box would be cut off by it.
	let pos = $state({ x: 0, y: 0 });
	// Bound rather than measured on demand, so the one thing that changes the
	// popover's height — the due-date message appearing — re-places it instead of
	// leaving it hanging off the bottom of the window.
	let height = $state(0);

	$effect(() => place(height));

	function place(h: number) {
		pos = anchoredPosition(
			anchor.getBoundingClientRect(),
			{ width: POPOVER_WIDTH, height: h },
			{ width: window.innerWidth, height: window.innerHeight }
		);
	}

	// The whole form is visible from the moment the + is pressed, so the only
	// thing left to disclose is the caret.
	$effect(() => {
		titleEl?.focus();
	});

	// Reads no reactive state, so this runs once after mount to seed the sticky
	// preference. The server has no localStorage and renders it unticked.
	$effect(() => {
		try {
			googleSync = localStorage.getItem(STORAGE_KEY) === 'true';
		} catch {
			// Blocked storage: the checkbox still works, it just will not persist.
		}
	});

	function rememberGoogleSync(on: boolean) {
		googleSync = on;
		try {
			localStorage.setItem(STORAGE_KEY, String(on));
		} catch {
			// As above.
		}
	}

	function onSyncToggle(e: Event & { currentTarget: HTMLInputElement }) {
		if (!e.currentTarget.checked) {
			attemptedWithoutDate = false;
			rememberGoogleSync(false);
			return;
		}
		if (canSync) {
			attemptedWithoutDate = false;
			rememberGoogleSync(true);
			return;
		}
		// Refused rather than accepted-and-dropped: the server honours the opt-in
		// only alongside a due date, so a tick left standing here would promise a
		// push that never happens. The held preference is deliberately not
		// touched — this is a missing date, not a change of mind.
		e.currentTarget.checked = false;
		attemptedWithoutDate = true;
		dueDateEl?.focus();
	}

	function onWindowPointerdown(e: PointerEvent) {
		const target = e.target as Node;
		// The trigger is excluded so its own click can close the popover itself,
		// instead of this closing it and the click reopening it.
		if (el && !el.contains(target) && !anchor.contains(target)) onclose();
	}

	function onWindowKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') onclose();
	}
</script>

<svelte:window
	onpointerdown={onWindowPointerdown}
	onkeydown={onWindowKeydown}
	onresize={() => place(height)}
	onscrollcapture={() => place(height)}
/>

<!-- Follows the board rather than closing with it: a scroll or a resize is not a
     decision to abandon a half-typed task. -->
<div
	class="popover"
	bind:this={el}
	bind:offsetHeight={height}
	style="left:{pos.x}px; top:{pos.y}px; width:{POPOVER_WIDTH}px;"
	role="dialog"
	aria-label="New task in {zoneName}"
>
	<p class="where">New task in <strong>{zoneName}</strong></p>

	<form
		method="POST"
		action="?/createTask"
		use:enhance={() =>
			async ({ update, result }) => {
				await update();
				if (result.type === 'success') onclose();
				else failed = true;
			}}
	>
		<input type="hidden" name="x" value={x} />
		<input type="hidden" name="y" value={y} />

		<input
			name="title"
			placeholder="Add something to the table…"
			aria-label="Task title"
			required
			bind:this={titleEl}
		/>

		<div class="fields">
			<label>
				<span>Due</span>
				<input type="date" name="dueDate" bind:value={dueDate} bind:this={dueDateEl} />
			</label>
			<label>
				<span>Priority</span>
				<select name="priority">
					<option value="">None</option>
					<option value="low">Low</option>
					<option value="med">Medium</option>
					<option value="high">High</option>
				</select>
			</label>
		</div>

		{#if gtasksConfigured}
			<!-- Shown ticked only when it can actually be honoured, so a held
			     preference never claims a push the server is about to drop. Typing a
			     date ticks it back by itself. -->
			<label class="gsync">
				<input
					type="checkbox"
					name="googleSync"
					checked={googleSync && canSync}
					onchange={onSyncToggle}
				/>
				<span>Also add to Google Tasks</span>
			</label>
			{#if attemptedWithoutDate && !canSync}
				<p class="hint hint-error" role="alert">{NEEDS_DUE_DATE_MESSAGE}</p>
			{/if}
		{/if}

		{#if failed}
			<p class="hint hint-error" role="alert">That did not save. Try again?</p>
		{/if}

		<div class="actions">
			<button class="btn btn-ghost btn-small" type="button" onclick={onclose}>Cancel</button>
			<button class="btn btn-primary btn-small" type="submit">Add</button>
		</div>
	</form>
</div>

<style>
	.popover {
		position: fixed;
		/* Level with the category menu: above the drag ghost (60), below the panel
		   drawers (980), topbar (999) and task modal (1000). */
		z-index: 70;
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
		padding: 0.55rem;
		background: var(--surface);
		border: 1px solid var(--border-strong);
		border-radius: var(--radius-s);
		box-shadow: var(--shadow-card);
	}

	/* The form no longer sits inside the box it fills, so it has to say where the
	   task is going to land. */
	.where {
		margin: 0;
		font-size: 0.72rem;
		color: var(--muted);
	}

	.where strong {
		color: var(--ink);
		font-weight: 600;
	}

	form {
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
	}

	/* minmax(0, …) rather than a bare 1fr: a date input's intrinsic width is wider
	   than half this popover, and an auto minimum would let it push the priority
	   select out past the edge. */
	.fields {
		display: grid;
		grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
		gap: 0.4rem;
	}

	.fields label {
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
		min-width: 0;
	}

	.fields span {
		font-size: 0.72rem;
		color: var(--muted);
	}

	/* Both controls fill their column instead of standing at their intrinsic
	   widths, so the pair lines up whatever the browser's date input measures. */
	.fields input,
	.fields select {
		width: 100%;
		min-width: 0;
		font-size: 0.82rem;
		padding: 0.3rem 0.4rem;
	}

	.gsync {
		display: flex;
		align-items: flex-start;
		gap: 0.4rem;
		font-size: 0.75rem;
		color: var(--muted);
		line-height: 1.35;
	}

	/* The tickbox holds its size and sits on the first line of a label that may
	   wrap, rather than drifting to the middle of two lines. */
	.gsync input {
		flex-shrink: 0;
		margin: 0.1rem 0 0;
	}

	.hint {
		margin: 0;
		font-size: 0.72rem;
		line-height: 1.35;
		color: var(--muted);
	}

	.hint-error {
		color: var(--danger);
	}

	.actions {
		display: flex;
		justify-content: flex-end;
		gap: 0.35rem;
		padding-top: 0.1rem;
	}

	/* The pills are sized for the topbar; in here they would be most of the
	   popover. */
	.btn-small {
		padding: 0.3rem 0.85rem;
		font-size: 0.82rem;
	}
</style>
