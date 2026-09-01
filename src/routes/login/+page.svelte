<script lang="ts">
	import { enhance } from '$app/forms';
	import Mascot from '$lib/components/Mascot.svelte';

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
		<header class="brand">
			<Mascot mood="wave" />
			<h1>Table</h1>
			<p class="tagline">Everything on the table.</p>
		</header>

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
		/* One gap between the card's sections: the wordmark block, a status line,
		   the form, an error. Nesting the three levels 0.4 / 0.85 / 1.35 is what
		   makes the grouping legible without any of them being measured. */
		gap: 1.35rem;
	}

	/* Flex containers do not collapse margins, so a paragraph's default `1em`
	   would be ADDED to the gap above and below it — which is what put a 2rem
	   chasm between the tagline and the form while every other gap was under
	   0.75rem, and what the negative margins here used to be fighting. */
	.card p {
		margin: 0;
	}

	/* The robot, the wordmark and the tagline are one thing, so they sit at the
	   tightest step of the scale and the card's gap separates them from the form
	   rather than from each other. */
	.brand {
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
	}

	.card h1 {
		font-family: var(--font-display);
		font-weight: 700;
		font-size: 1.6rem;
	}

	.tagline {
		color: var(--muted);
	}

	.status {
		color: var(--muted);
	}

	form {
		display: flex;
		flex-direction: column;
		gap: 0.85rem;
	}

	label {
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
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
