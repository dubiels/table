<script lang="ts">
	import { SvelteSet } from 'svelte/reactivity';
	import { enhance } from '$app/forms';
	import { toast } from '$lib/toast.svelte';
	import { parseVCards, type ParsedContact } from '$lib/people/vcard';

	let {
		existingNames,
		onclose
	}: {
		/** Lower-cased names already in the book, so duplicates can be pre-unticked. */
		existingNames: Set<string>;
		onclose: () => void;
	} = $props();

	let parsed = $state<ParsedContact[]>([]);
	// A SvelteSet is reactive in itself, so it is mutated in place rather than
	// reassigned — wrapping it in $state would be redundant.
	const chosen = new SvelteSet<number>();
	let status = $state<'met' | 'to_meet'>('met');
	let fileError = $state<string | null>(null);
	let importing = $state(false);

	function isDuplicate(contact: ParsedContact): boolean {
		return existingNames.has(contact.name.trim().toLowerCase());
	}

	async function onFile(e: Event & { currentTarget: HTMLInputElement }) {
		const file = e.currentTarget.files?.[0];
		if (!file) return;
		fileError = null;
		// Parsed in the browser: the file never leaves the machine until you have
		// seen exactly which entries are going in, which is the whole point of
		// the review step.
		const contacts = parseVCards(await file.text());
		if (contacts.length === 0) {
			parsed = [];
			fileError = 'No contacts found in that file. Export from Contacts.app as vCard (.vcf).';
			return;
		}
		parsed = contacts;
		// Everything except the apparent duplicates, so the common case is one
		// glance and a click rather than ticking two hundred boxes.
		chosen.clear();
		contacts.forEach((contact, i) => {
			if (!isDuplicate(contact)) chosen.add(i);
		});
	}

	function toggle(index: number) {
		if (chosen.has(index)) chosen.delete(index);
		else chosen.add(index);
	}

	let payload = $derived(
		JSON.stringify({ status, contacts: parsed.filter((_, i) => chosen.has(i)) })
	);

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') onclose();
	}
</script>

<svelte:window onkeydown={handleKeydown} />

<div class="backdrop" role="presentation" onclick={onclose}></div>

<div class="modal" role="dialog" aria-modal="true" aria-label="Import contacts">
	<header>
		<h2>Import from Contacts</h2>
		<button type="button" class="close" aria-label="Close" onclick={onclose}>✕</button>
	</header>

	<p class="how">
		In Contacts.app, select the people you want, then <strong>File → Export → Export vCard</strong>,
		and choose the <code>.vcf</code> here. Nothing is sent anywhere until you pick who to bring in.
	</p>

	<input type="file" accept=".vcf,text/vcard" onchange={onFile} aria-label="vCard file" />

	{#if fileError}<p class="status-error" role="alert">{fileError}</p>{/if}

	{#if parsed.length > 0}
		<form
			method="POST"
			action="?/importPeople"
			use:enhance={() => {
				importing = true;
				return async ({ result, update }) => {
					importing = false;
					if (result.type === 'success') {
						const data = result.data as { imported?: number; skipped?: number } | undefined;
						onclose();
						await update();
						const skipped = data?.skipped ? `, ${data.skipped} already here` : '';
						toast(`Imported ${data?.imported ?? 0} people${skipped}`, 'success');
						return;
					}
					await update();
					if (result.type === 'failure') {
						fileError = (result.data as { error?: string } | undefined)?.error ?? 'Import failed.';
					}
				};
			}}
		>
			<input type="hidden" name="payload" value={payload} />

			<fieldset class="status">
				<legend>Bring them in as</legend>
				<label><input type="radio" value="met" bind:group={status} /> People I've met</label>
				<label
					><input type="radio" value="to_meet" bind:group={status} /> People I want to meet</label
				>
			</fieldset>

			<p class="count">
				{chosen.size} of {parsed.length} selected
				{#if parsed.some(isDuplicate)}
					<span class="muted">— names already in your book start unticked</span>
				{/if}
			</p>

			<ul>
				{#each parsed as contact, i (i)}
					<li class:dupe={isDuplicate(contact)}>
						<label>
							<input type="checkbox" checked={chosen.has(i)} onchange={() => toggle(i)} />
							<span class="name">{contact.name}</span>
							{#if contact.company || contact.role}
								<span class="meta"
									>{[contact.role, contact.company].filter(Boolean).join(', ')}</span
								>
							{/if}
							{#if isDuplicate(contact)}<span class="meta">already here</span>{/if}
						</label>
					</li>
				{/each}
			</ul>

			<div class="actions">
				<button type="button" class="cancel" onclick={onclose}>Cancel</button>
				<button type="submit" class="save" disabled={importing || chosen.size === 0}>
					{importing ? 'Importing…' : `Import ${chosen.size}`}
				</button>
			</div>
		</form>
	{/if}
</div>

<style>
	.backdrop {
		position: fixed;
		inset: 0;
		z-index: 1000;
		background: var(--overlay);
	}
	.modal {
		position: fixed;
		z-index: 1001;
		inset: 4vh 50% auto auto;
		transform: translateX(50%);
		width: min(640px, 92vw);
		max-height: 92vh;
		overflow-y: auto;
		padding: 1.1rem 1.25rem;
		border: 1px solid var(--border);
		border-radius: var(--radius-l);
		background: var(--surface);
		box-shadow: var(--shadow-raised);
	}
	header {
		display: flex;
		align-items: center;
		margin-bottom: 0.5rem;
	}
	h2 {
		margin: 0;
		font-size: 1.05rem;
	}
	.close {
		margin-left: auto;
		border: none;
		background: none;
		font: inherit;
		color: var(--muted);
		cursor: pointer;
	}
	.how {
		margin: 0 0 0.75rem;
		font-size: 0.8rem;
		line-height: 1.5;
		color: var(--muted);
	}
	.status {
		display: flex;
		gap: 0.9rem;
		margin: 0.75rem 0 0.5rem;
		padding: 0.4rem 0.6rem;
		border: 1px solid var(--border);
		border-radius: var(--radius-s);
		font-size: 0.75rem;
		color: var(--muted);
	}
	.status legend {
		padding: 0 0.3rem;
	}
	.status label {
		display: flex;
		align-items: center;
		gap: 0.3rem;
	}
	.count {
		margin: 0 0 0.35rem;
		font-size: 0.75rem;
		color: var(--muted);
	}
	.muted {
		opacity: 0.8;
	}
	ul {
		margin: 0;
		padding: 0;
		list-style: none;
		max-height: 40vh;
		overflow-y: auto;
		border: 1px solid var(--border);
		border-radius: var(--radius-s);
	}
	li {
		border-bottom: 1px solid var(--border);
	}
	li:last-child {
		border-bottom: none;
	}
	li.dupe .name {
		color: var(--muted);
	}
	li label {
		display: flex;
		align-items: center;
		gap: 0.45rem;
		padding: 0.3rem 0.5rem;
		font-size: 0.82rem;
		cursor: pointer;
	}
	.meta {
		font-size: 0.72rem;
		color: var(--muted);
	}
	.status-error {
		margin: 0.5rem 0 0;
		font-size: 0.78rem;
		color: var(--danger);
	}
	.actions {
		display: flex;
		justify-content: flex-end;
		align-items: center;
		gap: 0.6rem;
		margin-top: 0.75rem;
	}
	.cancel {
		border: none;
		background: none;
		padding: 0.4rem 0.5rem;
		font: inherit;
		font-size: 0.82rem;
		color: var(--muted);
		cursor: pointer;
	}
	.save {
		padding: 0.4rem 1rem;
		border: none;
		border-radius: var(--radius-s);
		background: var(--accent);
		color: var(--accent-ink);
		font: inherit;
		font-weight: 600;
		cursor: pointer;
	}
	.save:disabled {
		opacity: 0.6;
		cursor: default;
	}
</style>
