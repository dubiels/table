/**
 * Where a popup goes when it belongs to a button.
 *
 * The board scrolls and every box clips its overflow, so a panel positioned
 * inside the box that owns it would be cut off by that box. Both of the board's
 * popups are therefore `position: fixed` and placed against the viewport from
 * their trigger's rect — which is this calculation, kept in one place so the
 * category menu and the add-task popover cannot drift apart on where they open,
 * how they stay on screen, or when they flip above the button instead of below.
 */

/** The part of a DOMRect the placement actually reads. */
export interface AnchorRect {
	top: number;
	bottom: number;
	right: number;
}

export interface PopupSize {
	width: number;
	height: number;
	/**
	 * A floor on the room demanded below the anchor, for popups that should keep
	 * some slack rather than open into the last few pixels of the window.
	 *
	 * Opening downwards always requires the full height first; this only raises
	 * that bar, so a short popup can be made to flip above earlier than its own
	 * size would. Defaults to no floor.
	 */
	minRoomBelow?: number;
}

export interface ViewportSize {
	width: number;
	height: number;
}

/** Breathing room from the trigger and from the viewport edges alike. */
export const ANCHOR_GAP = 6;

/**
 * Top-left corner, in viewport coordinates, for a popup opened from `anchor`.
 *
 * Right-aligned under the trigger — both triggers sit at the right end of a box
 * header, so a popup wider than the button opens back across the box rather
 * than out past it — then pulled inside the viewport, because a box in the last
 * column would otherwise hang off the edge.
 */
export function anchoredPosition(
	anchor: AnchorRect,
	popup: PopupSize,
	viewport: ViewportSize
): { x: number; y: number } {
	const { width, height } = popup;

	const x = Math.max(
		ANCHOR_GAP,
		Math.min(anchor.right - width, viewport.width - width - ANCHOR_GAP)
	);

	const below = viewport.height - anchor.bottom;
	const y =
		below < Math.max(popup.minRoomBelow ?? 0, height + ANCHOR_GAP)
			? anchor.top - height - ANCHOR_GAP
			: anchor.bottom + ANCHOR_GAP;

	// Clamped last, so a popup taller than the room above it is pinned to the top
	// of the screen rather than flipped off it.
	return { x, y: Math.max(ANCHOR_GAP, y) };
}
