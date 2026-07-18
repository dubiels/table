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
		<p class="tagline">See what's on the table.</p>

		{#if form?.sent}
			<p>Check {form.email} for a login link and a 6-digit code.</p>
			<form method="POST" action="?/code" use:enhance>
				<input type="hidden" name="email" value={form.email} />
				<label>
					<span>Code</span>
					<input class="code-input" name="code" inputmode="numeric" maxlength="6" required />
				</label>
				<button class="btn btn-primary" type="submit">Verify code</button>
			</form>
			{#if form?.codeError}
				<p role="alert">
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
				<button class="btn btn-primary" type="submit">Send login link</button>
			</form>
		{/if}

		{#if form?.error}
			<p role="alert">{form.error}</p>
		{/if}
	</div>
</div>

<style>
	.page {
		min-height: 100vh;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 1rem;
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
		font-size: 2rem;
	}

	.tagline {
		color: var(--muted);
		margin-top: -0.5rem;
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
		text-align: center;
		letter-spacing: 0.3em;
		font-size: 1.2rem;
	}

	form .btn-primary {
		width: 100%;
	}

	[role='alert'] {
		color: var(--danger);
		font-size: 0.85rem;
	}
</style>
