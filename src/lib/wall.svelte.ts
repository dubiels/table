/**
 * Whether the wall is up.
 *
 * The button lives in the top bar and the view is rendered by the board page,
 * so the flag has to sit somewhere both can see. It is deliberately not part
 * of `table:view`: List and Bento are how you work at a desk, and going to the
 * wall and back must leave that choice exactly as it was.
 */

const WALL_KEY = 'table:wall';

let open = $state(false);

// Safari in private mode throws on both of these, and a remembered preference
// is never worth taking the page down over — the same reason the board wraps
// its own storage calls.
function read(): boolean {
	try {
		return localStorage.getItem(WALL_KEY) === 'on';
	} catch {
		return false;
	}
}

function write(value: boolean) {
	try {
		localStorage.setItem(WALL_KEY, value ? 'on' : 'off');
	} catch {
		// Not remembering is survivable.
	}
}

export const wallMode = {
	get open() {
		return open;
	},
	set(next: boolean) {
		open = next;
		write(next);
	},
	toggle() {
		this.set(!open);
	},
	/**
	 * Re-opens the wall the panel was left on. Called once the page is in the
	 * browser, so a reboot of the machine behind the Samsung comes back up on
	 * the wall rather than on someone's last desk view.
	 */
	restore() {
		open = read();
	}
};
