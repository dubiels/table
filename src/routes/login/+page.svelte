<script lang="ts">
	import { enhance } from '$app/forms';

	type LoginFormResult = {
		sent?: boolean;
		email?: string;
		error?: string;
		codeError?: 'invalid' | 'expired' | 'used' | 'locked';
	};
	let { form }: { form: LoginFormResult | null } = $props();
</script>

<div class="page">
	<div class="card">
		<h1>Table</h1>
		<p class="tagline">Everything on the table.</p>

		{#if form?.sent}
			<p class="status">Check {form.email} for a login link and a 6-digit code.</p>
			<form method="POST" action="?/code" use:enhance>
				<input type="hidden" name="email" value={form.email} />
				<label>
					<span>Code</span>
					<input class="code-input" name="code" inputmode="numeric" maxlength="6" required />
				</label>
				<button class="btn btn-primary" type="submit">Verify code</button>
			</form>
			{#if form?.codeError}
				<p class="status-error" role="alert">
					{#if form.codeError === 'locked'}
						Too many wrong attempts. Request a new link.
					{:else if form.codeError === 'expired'}
						That code expired. Request a new link.
					{:else}
						Wrong code, try again.
					{/if}
				</p>
			{/if}
		{:else}
			<form method="POST" action="?/request" use:enhance>
				<label>
					<span>Email</span>
					<input name="email" type="email" required />
				</label>
				<button class="btn btn-primary" type="submit">Send magic link</button>
			</form>
		{/if}

		{#if form?.error}
			<p class="status-error" role="alert">{form.error}</p>
		{/if}
	</div>
</div>

<style>
	.page {
		min-height: 100vh;
		display: flex;
		align-items: flex-start;
		justify-content: center;
		padding: 1rem;
		padding-top: 35vh;
	}

	.card {
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius-l);
		box-shadow: var(--shadow-card);
		padding: 2rem;
		width: min(380px, calc(100vw - 2rem));
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}

	.card h1 {
		font-family: var(--font-display);
		font-weight: 700;
		font-size: 1.6rem;
	}

	.tagline {
		color: var(--muted);
		margin-top: -0.5rem;
	}

	.status {
		color: var(--muted);
	}

	form {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}

	label {
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
	}

	label span {
		font-size: 0.78rem;
		color: var(--muted);
	}

	label input {
		width: 100%;
	}

	.code-input {
		font-size: 1.3rem;
		letter-spacing: 0.35em;
		text-align: center;
		font-variant-numeric: tabular-nums;
	}

	form .btn-primary {
		width: 100%;
	}

	.status-error {
		color: var(--danger);
		font-size: 0.85rem;
	}
</style>
