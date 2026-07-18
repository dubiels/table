<script lang="ts">
	import { enhance } from '$app/forms';
	let { form } = $props();
</script>

<h1>Log in to Table</h1>

{#if form?.sent}
	<p>Check {form.email} for a login link and a 6-digit code.</p>
	<form method="POST" action="?/code" use:enhance>
		<input type="hidden" name="email" value={form.email} />
		<label>Code: <input name="code" inputmode="numeric" maxlength="6" required /></label>
		<button type="submit">Verify code</button>
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
		<label>Email: <input name="email" type="email" required /></label>
		<button type="submit">Send login link</button>
	</form>
{/if}
