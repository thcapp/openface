export interface SessionData {
	githubUser: string;
	githubAvatar: string;
	createdAt: string;
}

const ADMIN_USERS = new Set(["thcllc"]);

export function oauthEnabled(env: { GITHUB_CLIENT_ID: string; GITHUB_CLIENT_SECRET: string }): boolean {
	return !!(env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET);
}

export function isAdmin(session: SessionData | null): boolean {
	return !!session && ADMIN_USERS.has(session.githubUser);
}

export function getSessionToken(request: Request): string | null {
	const cookie = request.headers.get("Cookie") || "";
	const match = cookie.match(/(?:^|;\s*)oface_session=([a-f0-9]{64})/);
	return match ? match[1] : null;
}

export async function getSession(token: string, env: { FACE_REGISTRY?: KVNamespace }): Promise<SessionData | null> {
	if (!env.FACE_REGISTRY || !token) return null;
	try {
		const data = await env.FACE_REGISTRY.get(`session:${token}`, "json") as SessionData | null;
		return data;
	} catch {
		return null;
	}
}


// ── OAuth login hardening ──────────────────────────────────────────────────
//
// The login flow previously sent no `state`, so the callback accepted any code
// from anyone — a login-CSRF: an attacker could complete a flow with their own
// code and silently land a victim's browser in the attacker's account. The
// session cookie was also written by page script, so it could not be HttpOnly.

/** Short window between starting login and returning from GitHub. */
export const OAUTH_STATE_TTL_SECONDS = 600;
const SESSION_TTL_SECONDS = 604800;

/** Origins we will hand a session back to after login. */
const ALLOWED_RETURN_ORIGINS = new Set(["https://openface.live", "https://oface.io"]);
export const DEFAULT_RETURN_TO = "https://openface.live";

export interface OAuthStateData {
	/** PKCE code verifier, kept server-side and never shown to the browser. */
	verifier: string;
	/** Where to send the browser once the session exists. Already allowlisted. */
	returnTo: string;
	createdAt: string;
}

/** Only redirect to origins we control — an open redirect here would leak the session. */
export function safeReturnTo(raw: string | null | undefined): string {
	if (!raw) return DEFAULT_RETURN_TO;
	try {
		return ALLOWED_RETURN_ORIGINS.has(new URL(raw).origin) ? raw : DEFAULT_RETURN_TO;
	} catch {
		return DEFAULT_RETURN_TO;
	}
}

function randomHex(byteLength: number): string {
	const bytes = new Uint8Array(byteLength);
	crypto.getRandomValues(bytes);
	return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** 64 hex chars, matching the session/state cookie patterns. */
export function randomToken(): string {
	return randomHex(32);
}

/** S256 PKCE challenge for a verifier, base64url with no padding. */
export async function pkceChallenge(verifier: string): Promise<string> {
	const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
	let binary = "";
	for (const b of new Uint8Array(digest)) binary += String.fromCharCode(b);
	return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** The browser-binding half of the state check — an HttpOnly cookie set at login. */
export function getOAuthStateCookie(request: Request): string | null {
	const cookie = request.headers.get("Cookie") || "";
	const match = cookie.match(/(?:^|;\s*)oface_oauth=([a-f0-9]{64})/);
	return match ? match[1] : null;
}

// SameSite=Lax is enough: the callback is a top-level GET navigation from GitHub,
// which Lax permits, and it keeps the cookie off cross-site subrequests.
export function buildOAuthStateCookie(state: string): string {
	return `oface_oauth=${state}; Path=/auth; Max-Age=${OAUTH_STATE_TTL_SECONDS}; HttpOnly; Secure; SameSite=Lax`;
}

export function clearOAuthStateCookie(): string {
	return "oface_oauth=; Path=/auth; Max-Age=0; HttpOnly; Secure; SameSite=Lax";
}

// SameSite=None is required — openface.live calls oface.io cross-site with
// credentials. HttpOnly is safe because no page script reads this value.
export function buildSessionCookie(token: string): string {
	return `oface_session=${token}; Path=/; Max-Age=${SESSION_TTL_SECONDS}; HttpOnly; Secure; SameSite=None`;
}

export function clearSessionCookie(): string {
	return "oface_session=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=None";
}

export async function putOAuthState(
	state: string,
	data: OAuthStateData,
	env: { FACE_REGISTRY?: KVNamespace },
): Promise<void> {
	if (!env.FACE_REGISTRY) return;
	await env.FACE_REGISTRY.put(`oauthstate:${state}`, JSON.stringify(data), {
		expirationTtl: OAUTH_STATE_TTL_SECONDS,
	});
}

/**
 * Read a pending state and delete it, so a captured callback URL cannot be replayed.
 * KV has no compare-and-delete, so two truly simultaneous replays could both read
 * before either delete lands; the browser-bound cookie and short TTL are what make
 * that window uninteresting rather than the delete alone.
 */
export async function consumeOAuthState(
	state: string,
	env: { FACE_REGISTRY?: KVNamespace },
): Promise<OAuthStateData | null> {
	if (!env.FACE_REGISTRY) return null;
	const key = `oauthstate:${state}`;
	try {
		const data = await env.FACE_REGISTRY.get(key, "json") as OAuthStateData | null;
		if (data) await env.FACE_REGISTRY.delete(key);
		return data;
	} catch {
		return null;
	}
}
