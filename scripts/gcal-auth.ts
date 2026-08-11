/**
 * One-time Google Calendar authorisation.
 *
 * Runs the consent flow against a loopback redirect and prints the refresh
 * token. Deliberately writes nothing: you paste the value into .env locally
 * and into `flyctl secrets set` for production, which keeps the credential out
 * of the repository like every other secret in this project.
 *
 * Usage: npm run gcal:auth
 */
import { createServer } from 'node:http';

const PORT = 8123;
const REDIRECT_URI = `http://localhost:${PORT}`;
const SCOPE = 'https://www.googleapis.com/auth/calendar.events.readonly';

const clientId = process.env.GCAL_CLIENT_ID;
const clientSecret = process.env.GCAL_CLIENT_SECRET;

if (!clientId || !clientSecret) {
	console.error('Set GCAL_CLIENT_ID and GCAL_CLIENT_SECRET in .env before running this.');
	process.exit(1);
}

const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
authUrl.searchParams.set('client_id', clientId);
authUrl.searchParams.set('redirect_uri', REDIRECT_URI);
authUrl.searchParams.set('response_type', 'code');
authUrl.searchParams.set('scope', SCOPE);
// Both are required. Without them Google returns an access token and no
// refresh token, and re-consenting is the only way to get one afterwards.
authUrl.searchParams.set('access_type', 'offline');
authUrl.searchParams.set('prompt', 'consent');

async function exchange(code: string): Promise<void> {
	const res = await fetch('https://oauth2.googleapis.com/token', {
		method: 'POST',
		headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
		body: new URLSearchParams({
			code,
			client_id: clientId!,
			client_secret: clientSecret!,
			redirect_uri: REDIRECT_URI,
			grant_type: 'authorization_code'
		})
	});

	const body = (await res.json()) as { refresh_token?: string; error_description?: string };
	if (!res.ok || !body.refresh_token) {
		console.error(`\nToken exchange failed: ${body.error_description ?? `HTTP ${res.status}`}`);
		process.exit(1);
	}

	console.log('\nAdd this to .env, and to your Fly secrets:\n');
	console.log(`GCAL_REFRESH_TOKEN=${body.refresh_token}\n`);
}

const server = createServer((req, res) => {
	const url = new URL(req.url ?? '/', REDIRECT_URI);
	const code = url.searchParams.get('code');
	const error = url.searchParams.get('error');

	if (!code && !error) {
		res.writeHead(404).end();
		return;
	}

	res.writeHead(200, { 'Content-Type': 'text/plain' });
	res.end(error ? `Authorisation failed: ${error}` : 'Authorised. Return to your terminal.');
	server.close();

	if (error) {
		console.error(`\nAuthorisation failed: ${error}`);
		process.exit(1);
	}
	void exchange(code!);
});

server.listen(PORT, () => {
	console.log('\nOpen this URL in the browser signed in to the calendar account:\n');
	console.log(`${authUrl}\n`);
	console.log(`Waiting for the redirect on ${REDIRECT_URI} ...`);
});
