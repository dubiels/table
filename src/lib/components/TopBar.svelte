<script lang="ts">
	import { invalidate, invalidateAll } from '$app/navigation';
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import { browser } from '$app/environment';
	import { subscribeToPush } from '$lib/client/push';
	import { toast } from '$lib/toast.svelte';
	import { env } from '$env/dynamic/public';

	let { user, unreadCount }: { user: { email: string } | null; unreadCount: number } = $props();
	let menuOpen = $state(false);
	let syncing = $state(false);
	let digesting = $state(false);
	let avatarEl = $state<HTMLButtonElement | null>(null);

	// Seeded from the DOM rather than from localStorage: the pre-paint script in
	// app.html has already read storage and set the attribute, so the attribute is
	// the single place both agree on. A writable $derived rather than $state
	// because the server has no theme to read and renders the light glyph — the
	// derived re-evaluates during hydration and corrects it. Its only dependency
	// is `browser`, which never changes, so a toggle's write is never clobbered.
	let dark = $derived(browser && document.documentElement.dataset.theme === 'dark');

	function toggleTheme() {
		dark = !dark;
		if (dark) document.documentElement.dataset.theme = 'dark';
		else delete document.documentElement.dataset.theme;
		try {
			if (dark) localStorage.setItem('table:theme', 'dark');
			else localStorage.removeItem('table:theme');
		} catch {
			// Blocked storage: the theme still flips, it just will not persist.
		}
	}

	function closeMenu(refocus = false) {
		if (!menuOpen) return;
		menuOpen = false;
		if (refocus) avatarEl?.focus();
	}

	async function enableNotifications() {
		closeMenu();
		try {
			// Without this the empty key reaches pushManager.subscribe(), which
			// fails base64 decoding and reports a bare InvalidCharacterError.
			const vapidKey = env.PUBLIC_VAPID_PUBLIC_KEY ?? '';
			if (!vapidKey) throw new Error('Push is not configured on this server');
			await subscribeToPush(vapidKey);
			toast('Notifications enabled', 'success');
		} catch (err) {
			toast(`Could not enable notifications: ${(err as Error).message}`, 'error');
		}
	}

	type ApiBody = {
		error?: string;
		ok?: boolean;
		created?: number;
		updated?: number;
	};

	// A proxy error or a crashed route answers with an HTML page; res.json() would
	// throw and lose the status we could have reported instead.
	async function readJson(res: Response): Promise<ApiBody | null> {
		if (!res.headers.get('content-type')?.includes('application/json')) return null;
		try {
			return (await res.json()) as ApiBody;
		} catch {
			return null;
		}
	}

	async function syncNow() {
		closeMenu();
		syncing = true;
		toast('Syncing assignments…');
		try {
			const res = await fetch('/api/lms/sync', { method: 'POST' });
			const body = await readJson(res);
			if (!res.ok) {
				toast(body?.error ?? `Sync failed (HTTP ${res.status})`, 'error');
			} else if (!body) {
				toast('Sync failed — unexpected response', 'error');
			} else {
				toast(`Synced — ${body.created} new, ${body.updated} updated`, 'success');
				await invalidateAll();
			}
		} catch {
			toast('Sync failed', 'error');
		} finally {
			syncing = false;
		}
	}

	async function sendDigest() {
		closeMenu();
		digesting = true;
		toast('Sending digest…');
		try {
			const res = await fetch('/api/digest/run', { method: 'POST' });
			const body = await readJson(res);
			if (!res.ok) {
				toast(body?.error ?? `Digest failed (HTTP ${res.status})`, 'error');
			} else if (!body?.ok) {
				toast('Digest failed — unexpected response', 'error');
			} else {
				toast('Digest sent — check the inbox', 'success');
				// The layout load depends on this key and nothing else invalidates
				// it, so without this the unread badge ignores the digest we just
				// wrote until the next full page load.
				await invalidate('app:notifications');
			}
		} catch {
			toast('Digest failed', 'error');
		} finally {
			digesting = false;
		}
	}

	// Capture phase, not the bubble phase: cards in the canvas and rows in the
	// list view stopPropagation() on their own clicks, so a bubble-phase window
	// listener would never see them and the menu would stay stuck open.
	$effect(() => {
		function onDocumentClick(e: MouseEvent) {
			if (!menuOpen) return;
			const target = e.target as HTMLElement | null;
			if (!target?.closest('.user-menu')) closeMenu();
		}
		document.addEventListener('click', onDocumentClick, true);
		return () => document.removeEventListener('click', onDocumentClick, true);
	});

	function onWindowKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape' && menuOpen) closeMenu(true);
	}
</script>

<svelte:window onkeydown={onWindowKeydown} />

<header class="topbar">
	<a class="brand" href={resolve('/')}>Table</a>

	<nav>
		<a class="nav-link" class:current={page.url.pathname === '/inbox'} href={resolve('/inbox')}>
			Inbox
			{#if unreadCount > 0}<span class="badge">{unreadCount}</span>{/if}
		</a>
		<a class="nav-link" class:current={page.url.pathname === '/history'} href={resolve('/history')}>
			History
		</a>

		<button
			type="button"
			class="theme-toggle"
			aria-label={dark ? 'Switch to light theme' : 'Switch to dark theme'}
			title={dark ? 'Switch to light theme' : 'Switch to dark theme'}
			onclick={toggleTheme}
		>
			<!-- U+FE0E asks for the text glyph: without it some platforms substitute a
			     color emoji sun that ignores the button's color. -->
			{dark ? '☀︎' : '☾︎'}
		</button>

		{#if user}
			<div class="user-menu">
				<button
					type="button"
					class="avatar"
					bind:this={avatarEl}
					aria-haspopup="true"
					aria-expanded={menuOpen}
					aria-label="Account menu"
					onclick={() => (menuOpen = !menuOpen)}
				>
					{user.email.charAt(0).toUpperCase()}
				</button>

				{#if menuOpen}
					<div class="popover">
						<div class="who">{user.email}</div>
						<div class="divider"></div>
						<button type="button" class="item" disabled={syncing} onclick={syncNow}>
							Sync assignments
						</button>
						<button type="button" class="item" disabled={digesting} onclick={sendDigest}>
							Send digest now
						</button>
						<button type="button" class="item" onclick={enableNotifications}>
							Enable notifications
						</button>
						<div class="divider"></div>
						<form method="POST" action="/logout">
							<button type="submit" class="item danger">Log out</button>
						</form>
					</div>
				{/if}
			</div>
		{/if}
	</nav>
</header>

<style>
	.topbar {
		flex-shrink: 0;
		/* Sticky so the shell stays reachable on the pages that scroll the body
		   (history, inbox). This z-index also opens a stacking context, so it is
		   the ceiling for everything inside — including the popover — and 999
		   keeps all of it under the task modal's 1000. */
		position: sticky;
		top: 0;
		z-index: 999;
		height: var(--topbar-height);
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		padding: 0 1.5rem;
		background: var(--bg);
		border-bottom: 1px solid var(--border);
	}

	.brand {
		font-family: var(--font-display);
		font-weight: 700;
		font-size: 1.05rem;
		letter-spacing: -0.022em;
		color: var(--ink);
		text-decoration: none;
	}

	nav {
		display: flex;
		align-items: center;
		gap: 1rem;
	}

	.nav-link {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
		color: var(--muted);
		text-decoration: none;
		font-size: 0.88rem;
		font-weight: 500;
		transition: color 0.15s ease;
	}

	.nav-link:hover,
	.nav-link.current {
		color: var(--ink);
	}

	.badge {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-width: 1.1rem;
		height: 1.1rem;
		padding: 0 0.3rem;
		border-radius: 999px;
		background: var(--accent);
		color: var(--accent-ink);
		font-size: 0.68rem;
		font-weight: 700;
		line-height: 1;
	}

	.theme-toggle {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 26px;
		height: 26px;
		padding: 0;
		border: none;
		border-radius: 50%;
		background: transparent;
		color: var(--muted);
		font-size: 0.95rem;
		line-height: 1;
		cursor: pointer;
		transition:
			background 0.15s ease,
			color 0.15s ease;
	}

	.theme-toggle:hover {
		background: var(--surface-2);
		color: var(--ink);
	}

	.user-menu {
		position: relative;
	}

	.avatar {
		width: 30px;
		height: 30px;
		display: flex;
		align-items: center;
		justify-content: center;
		border: none;
		border-radius: 50%;
		background: var(--accent);
		color: var(--accent-ink);
		font-family: var(--font-display);
		font-size: 0.8rem;
		font-weight: 700;
		cursor: pointer;
		transition: background 0.15s ease;
	}

	.avatar:hover {
		background: var(--accent-hover);
	}

	.popover {
		position: absolute;
		top: calc(100% + 0.5rem);
		right: 0;
		min-width: 220px;
		padding: 0.35rem;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius-m);
		box-shadow: var(--shadow-raised);
	}

	.who {
		padding: 0.4rem 0.6rem;
		color: var(--muted);
		font-size: 0.78rem;
		overflow-wrap: anywhere;
	}

	.divider {
		height: 1px;
		margin: 0.3rem 0;
		background: var(--border);
	}

	.item {
		display: block;
		width: 100%;
		padding: 0.45rem 0.6rem;
		border: none;
		border-radius: var(--radius-s);
		background: transparent;
		color: var(--ink);
		font-size: 0.88rem;
		text-align: left;
		cursor: pointer;
		transition:
			background 0.15s ease,
			color 0.15s ease;
	}

	.item:hover:not(:disabled) {
		background: var(--surface-2);
	}

	.item:disabled {
		color: var(--muted);
		cursor: default;
	}

	.item.danger {
		color: var(--danger);
	}

	.item.danger:hover {
		background: var(--danger-soft);
	}

	@media (max-width: 720px) {
		.topbar {
			padding: 0 1rem;
		}
		nav {
			gap: 0.85rem;
		}
	}
</style>
