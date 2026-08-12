<script lang="ts">
	// A one-question confirm anchored to whatever raised it. CategoryMenu has a
	// confirm step of its own, but it is welded to that menu's item list and its
	// own open/close lifecycle, so there is nothing there to lift.
	let {
		anchor,
		copy,
		confirmLabel,
		onconfirm,
		oncancel
	}: {
		anchor: HTMLElement;
		copy: string;
		confirmLabel: string;
		onconfirm: () => void;
		oncancel: () => void;
	} = $props();

	let el = $state<HTMLDivElement | undefined>();
	let cancelEl = $state<HTMLButtonElement | undefined>();

	// fixed, not absolute: the board scrolls and clips its overflow, so a bubble
	// positioned inside a card would be cut off by the box that owns it.
	let pos = $state({ x: 0, y: 0 });
	let height = $state(0);

	const WIDTH = 196;
	const GAP = 6;

	$effect(() => place(height));

	function place(h: number) {
		const a = anchor.getBoundingClientRect();
		// Centred on the anchor, then pulled back inside the viewport — a card in
		// the last column would otherwise hang off the edge.
		const x = Math.max(
			GAP,
			Math.min(a.left + a.width / 2 - WIDTH / 2, window.innerWidth - WIDTH - GAP)
		);
		const below = window.innerHeight - a.bottom;
		const y = below < h + GAP ? a.top - h - GAP : a.bottom + GAP;
		pos = { x, y: Math.max(GAP, y) };
	}

	// Focus lands on Cancel, never on the destructive button: a stray Enter on a
	// freshly-focused Remove is exactly the accident this exists to prevent.
	$effect(() => {
		cancelEl?.focus();
	});

	// Stopped at the bubble itself as well, because the bubble is a DOM
	// descendant of whatever anchored it: a press on the copy — the one part
	// that is not a button — would otherwise reach a board card's drag handler
	// and start dragging the task behind the question.
	function onWindowPointerdown(e: PointerEvent) {
		const target = e.target as Node;
		// The anchor is excluded so its own click can close this itself, rather
		// than this closing and the click reopening it.
		if (el && !el.contains(target) && !anchor.contains(target)) oncancel();
	}

	// Handled here rather than on the window, because everything this bubble can
	// be anchored to sits inside something with its own key handling: a card that
	// opens a detail panel on Enter, a modal that closes on Escape. Stopping the
	// event at the bubble keeps those from acting on a keypress meant for this
	// question — and focus is already inside, because opening moves it to Cancel.
	function onKeydown(e: KeyboardEvent) {
		e.stopPropagation();
		if (e.key === 'Escape') oncancel();
	}
</script>

<svelte:window onpointerdown={onWindowPointerdown} onresize={oncancel} onscrollcapture={oncancel} />

<div
	class="bubble"
	bind:this={el}
	bind:offsetHeight={height}
	style="left:{pos.x}px; top:{pos.y}px; width:{WIDTH}px;"
	role="dialog"
	tabindex="-1"
	aria-label={copy}
	onclick={(e) => e.stopPropagation()}
	onkeydown={onKeydown}
	onpointerdown={(e) => e.stopPropagation()}
>
	<p class="copy">{copy}</p>
	<div class="row">
		<button type="button" class="btn-danger" onclick={onconfirm}>{confirmLabel}</button>
		<button type="button" class="btn-plain" bind:this={cancelEl} onclick={oncancel}>Cancel</button>
	</div>
</div>

<style>
	.bubble {
		position: fixed;
		/* Above the drag ghost (60) and the category menu (70), below the panel
		   drawers (980), topbar (999) and task modal (1000). */
		z-index: 80;
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
		padding: 0.5rem;
		background: var(--surface);
		border: 1px solid var(--border-strong);
		border-radius: var(--radius-s);
		box-shadow: var(--shadow-card);
	}

	.copy {
		margin: 0;
		font-size: 0.82rem;
		line-height: 1.35;
		color: var(--muted);
	}

	.row {
		display: flex;
		gap: 0.35rem;
	}

	.btn-danger,
	.btn-plain {
		flex: 1;
		font-size: 0.82rem;
		font-weight: 600;
		padding: 0.32rem 0.4rem;
		border-radius: var(--radius-s);
		cursor: pointer;
	}

	.btn-danger {
		border: 1px solid var(--danger);
		background: var(--danger);
		color: var(--surface);
	}

	.btn-plain {
		border: 1px solid var(--border);
		background: transparent;
		color: var(--ink);
	}
</style>
