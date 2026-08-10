<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import { subscribeToPush } from '$lib/client/push';
	import { toast } from '$lib/toast.svelte';
	import { env } from '$env/dynamic/public';

	let { user, unreadCount }: { user: { email: string } | null; unreadCount: number } = $props();
	let menuOpen = $state(false);
	let syncing = $state(false);

	async function enableNotifications() {
		menuOpen = false;
		try {
			await subscribeToPush(env.PUBLIC_VAPID_PUBLIC_KEY ?? '');
			toast('Notifications enabled', 'success');
		} catch (err) {
			toast(`Could not enable notifications: ${(err as Error).message}`, 'error');
		}
	}

	async function syncNow() {
		menuOpen = false;
		syncing = true;
		try {
			const res = await fetch('/api/lms/sync', { method: 'POST' });
			const body = await res.json();
			if (!res.ok) {
				toast(body.error ?? 'Sync failed', 'error');
			} else {
				toast(
					`Synced — ${body.created} new, ${body.updated} updated${body.placedLoose ? ' (placed loose)' : ''}`,
					'success'
				);
				await invalidateAll();
			}
		} catch {
			toast('Sync failed', 'error');
		} finally {
			syncing = false;
		}
	}

	function onWindowClick(e: MouseEvent) {
		if (!menuOpen) return;
		const target = e.target as HTMLElement | null;
		if (!target?.closest('.user-menu')) menuOpen = false;
	}

	function onWindowKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape' && menuOpen) menuOpen = false;
	}
</script>

<svelte:window onclick={onWindowClick} onkeydown={onWindowKeydown} />

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

		{#if user}
			<div class="user-menu">
				<button
					type="button"
					class="avatar"
					aria-haspopup="menu"
					aria-expanded={menuOpen}
					aria-label="Account menu"
					onclick={() => (menuOpen = !menuOpen)}
				>
					{user.email.charAt(0).toUpperCase()}
				</button>

				{#if menuOpen}
					<div class="popover" role="menu">
						<div class="who">{user.email}</div>
						<div class="divider"></div>
						<button type="button" class="item" role="menuitem" disabled={syncing} onclick={syncNow}>
							{syncing ? 'Syncing…' : 'Sync assignments'}
						</button>
						<button type="button" class="item" role="menuitem" onclick={enableNotifications}>
							Enable notifications
						</button>
						<div class="divider"></div>
						<form method="POST" action="/logout">
							<button type="submit" class="item danger" role="menuitem">Log out</button>
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
		   (history, inbox); below the task modal's 1000 so it never covers it. */
		position: sticky;
		top: 0;
		z-index: 999;
		height: 52px;
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
		z-index: 1100;
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
