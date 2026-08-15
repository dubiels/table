/**
 * Reading a stored LinkedIn URL for display.
 *
 * There is no way to render a real preview of a profile: LinkedIn puts them
 * behind an auth wall, sends `X-Frame-Options` so they cannot be framed, and
 * answers an unauthenticated fetch with a login interstitial rather than
 * OpenGraph tags. So the card is built from what we already hold, and the
 * handle is the one piece of the URL worth surfacing — it is how you tell at a
 * glance that the link points at the person you think it does.
 */

/**
 * The vanity handle from a profile URL — `devonreyes` for
 * `https://www.linkedin.com/in/devonreyes/`.
 *
 * Returns null for anything that is not a profile URL, including company pages
 * and posts, so the card can fall back to showing the raw link rather than
 * inventing a handle.
 */
export function linkedinHandle(url: string | null | undefined): string | null {
	if (!url) return null;
	// Tolerates a stored value with no scheme; `normalizeLinkedinUrl` adds one on
	// save, but a row written before that existed may not have it.
	const match = /(?:^|\/\/|\.)linkedin\.com\/in\/([^/?#]+)/i.exec(url.trim());
	if (!match) return null;
	const handle = decodeURIComponent(match[1]).trim();
	return handle || null;
}
