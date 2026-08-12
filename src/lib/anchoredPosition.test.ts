import { describe, it, expect } from 'vitest';
import { anchoredPosition, ANCHOR_GAP } from './anchoredPosition';

const viewport = { width: 1000, height: 800 };
const popup = { width: 200, height: 120 };

/** A trigger the size of the board's little round buttons. */
function anchorAt(right: number, top: number) {
	return { top, bottom: top + 18, right };
}

describe('anchoredPosition', () => {
	it('right-aligns the popup under its trigger', () => {
		const { x, y } = anchoredPosition(anchorAt(500, 100), popup, viewport);
		expect(x).toBe(300);
		expect(y).toBe(118 + ANCHOR_GAP);
	});

	it('pulls a popup opened near the right edge back inside the viewport', () => {
		const { x } = anchoredPosition(anchorAt(998, 100), popup, viewport);
		expect(x).toBe(viewport.width - popup.width - ANCHOR_GAP);
	});

	it('keeps a popup opened near the left edge off the edge', () => {
		const { x } = anchoredPosition(anchorAt(40, 100), popup, viewport);
		expect(x).toBe(ANCHOR_GAP);
	});

	it('flips above the trigger when the popup would not fit below', () => {
		const anchor = anchorAt(500, 740);
		const { y } = anchoredPosition(anchor, popup, viewport);
		expect(y).toBe(anchor.top - popup.height - ANCHOR_GAP);
	});

	it('flips a short popup early when it asks for slack below', () => {
		// 92px of room below: enough for the popup itself, short of the floor.
		const anchor = anchorAt(500, 690);
		const short = { width: 200, height: 60, minRoomBelow: 150 };
		expect(anchoredPosition(anchor, short, viewport).y).toBe(anchor.top - 60 - ANCHOR_GAP);
		// Without the floor the same popup is happy where it is.
		expect(anchoredPosition(anchor, { width: 200, height: 60 }, viewport).y).toBe(
			anchor.bottom + ANCHOR_GAP
		);
	});

	it('pins to the top rather than flipping off the screen', () => {
		// No room below, and not enough above either: the popup is taller than the
		// trigger's distance from the top of the window.
		const { y } = anchoredPosition(
			anchorAt(500, 40),
			{ width: 200, height: 400 },
			{ width: 1000, height: 200 }
		);
		expect(y).toBe(ANCHOR_GAP);
	});
});
