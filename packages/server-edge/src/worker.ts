/**
 * Open Face Edge Server — Cloudflare Workers entry point.
 * Routes /{username}/* requests to per-user FaceRoom Durable Objects.
 * Serves static assets for non-API/non-WS requests.
 */

export { FaceRoom } from "./durable-object.js";

interface Env {
	FACE_ROOM: DurableObjectNamespace;
	FACE_REGISTRY?: KVNamespace;
	FACE_API_KEY: string;
	OPENCLAW_GATEWAY_URL: string;
	OPENCLAW_GATEWAY_TOKEN: string;
	OPENCLAW_SESSION_KEY: string;
	GITHUB_CLIENT_ID: string;
	GITHUB_CLIENT_SECRET: string;
}

/** Paths + common usernames that cannot be claimed */
const RESERVED = new Set([
	// System paths
	"api", "health", "dashboard", "open-face.js", "faces", "_headers",
	"index.html", "favicon.ico", "robots.txt",
	// App routes
	"account", "admin", "app", "auth", "billing", "blog", "cdn", "claim", "config",
	"default", "demo", "dev", "docs", "face", "gallery", "help", "info", "login",
	"logout", "new", "null", "open", "openface", "ping", "public",
	"register", "root", "settings", "signup", "static", "status",
	"support", "system", "test", "undefined", "user", "users", "www", "ws",
	// Common names people would squat
	"agent", "ai", "assistant", "bot", "chat", "claude", "gpt", "gemini",
	"copilot", "siri", "alexa", "cortana", "jarvis", "hal", "samantha",
	"god", "jesus", "satan", "devil", "hitler", "nazi",
	"fuck", "shit", "ass", "dick", "porn", "sex", "xxx",
	"official", "verified", "staff", "mod", "moderator", "owner",
	"openai", "anthropic", "google", "microsoft", "apple", "meta", "facebook",
	"twitter", "x", "instagram", "tiktok", "youtube", "twitch", "discord",
	"github", "gitlab", "npm", "cloudflare",
]);

/** Build CORS headers — supports credentials for openface.live cross-origin auth */
function corsHeaders(request?: Request): Record<string, string> {
	const origin = request?.headers.get("Origin") || "";
	// Allow credentials from openface.live and localhost dev
	const allowed = origin === "https://openface.live" || origin.startsWith("http://localhost");
	return {
		"Access-Control-Allow-Origin": allowed ? origin : "*",
		"Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
		"Access-Control-Allow-Headers": "Content-Type, Authorization",
		...(allowed ? { "Access-Control-Allow-Credentials": "true" } : {}),
	};
}

/** Legacy static CORS for backwards compatibility in internal helpers */
const CORS = {
	"Access-Control-Allow-Origin": "*",
	"Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
	"Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export default {
	async fetch(request: Request, env: Env): Promise<Response> {
		const url = new URL(request.url);
		const cors = corsHeaders(request);

		if (request.method === "OPTIONS") {
			return new Response(null, { status: 204, headers: cors });
		}

		// ── System endpoints ──
		if (url.pathname === "/health") {
			return Response.json({ ok: true, service: "openface-edge" }, { headers: cors });
		}

		// ── GitHub OAuth endpoints ──
		if (url.pathname === "/auth/login" && request.method === "GET") {
			return handleAuthLogin(env);
		}
		if (url.pathname === "/auth/callback" && request.method === "GET") {
			return handleAuthCallback(url, env);
		}
		if (url.pathname === "/auth/me" && request.method === "GET") {
			return handleAuthMe(request, env, cors);
		}
		if (url.pathname === "/auth/logout" && request.method === "POST") {
			return handleAuthLogout(request, env, cors);
		}

		// ── Claim API (Phase 3 — requires KV) ──
		if (url.pathname === "/api/claim" && request.method === "POST") {
			return handleClaim(request, env, cors);
		}
		if (url.pathname.startsWith("/api/check/")) {
			const username = url.pathname.slice("/api/check/".length).toLowerCase();
			return handleCheck(username, env);
		}

		// ── Gallery API ──
		if (url.pathname === "/api/gallery" && request.method === "POST") {
			return handleGallerySubmit(request, env, cors);
		}
		if (url.pathname === "/api/gallery" && request.method === "GET") {
			return handleGalleryList(env);
		}
		if (url.pathname.startsWith("/api/gallery/") && request.method === "GET") {
			const id = url.pathname.slice("/api/gallery/".length);
			return handleGalleryGet(id, env);
		}

		// ── Admin API ──
		if (url.pathname.startsWith("/api/admin/") && request.method !== "OPTIONS") {
			const token = getSessionToken(request);
			const session = token ? await getSession(token, env) : null;
			if (!isAdmin(session)) {
				return Response.json({ error: "Admin access required" }, { status: 403, headers: cors });
			}
			if (url.pathname === "/api/admin/gallery" && request.method === "GET") {
				return handleAdminGalleryList(env, cors);
			}
			if (url.pathname.startsWith("/api/admin/gallery/") && request.method === "DELETE") {
				const id = url.pathname.slice("/api/admin/gallery/".length);
				return handleAdminGalleryDelete(id, env, cors);
			}
			if (url.pathname.startsWith("/api/admin/gallery/") && request.method === "PUT") {
				const id = url.pathname.slice("/api/admin/gallery/".length);
				return handleAdminGalleryUpdate(request, id, env, cors);
			}
			if (url.pathname === "/api/admin/claims" && request.method === "GET") {
				return handleAdminClaimsList(env, cors);
			}
			if (url.pathname.startsWith("/api/admin/claims/") && request.method === "DELETE") {
				const username = url.pathname.slice("/api/admin/claims/".length);
				return handleAdminClaimDelete(username, env, cors);
			}
		}

		// ── Account API (authenticated user's own data) ──
		if (url.pathname.startsWith("/api/account/") && request.method !== "OPTIONS") {
			const token = getSessionToken(request);
			const session = token ? await getSession(token, env) : null;
			if (!session) {
				return Response.json({ error: "Login required" }, { status: 401, headers: cors });
			}
			if (url.pathname === "/api/account/claims" && request.method === "GET") {
				return handleAccountClaims(session.githubUser, env, cors);
			}
			if (url.pathname === "/api/account/gallery" && request.method === "GET") {
				return handleAccountGallery(session.githubUser, env, cors);
			}
			if (url.pathname.startsWith("/api/account/claims/") && request.method === "DELETE") {
				const username = url.pathname.slice("/api/account/claims/".length);
				return handleAccountClaimDelete(session.githubUser, username, env, cors);
			}
			if (url.pathname.startsWith("/api/account/gallery/") && request.method === "DELETE") {
				const id = url.pathname.slice("/api/account/gallery/".length);
				return handleAccountGalleryDelete(session.githubUser, id, env, cors);
			}
			if (url.pathname.endsWith("/regenerate-key") && request.method === "POST") {
				const username = url.pathname.slice("/api/account/claims/".length, -"/regenerate-key".length);
				return handleAccountRegenerateKey(session.githubUser, username, env, cors);
			}
			return Response.json({ error: "Not found" }, { status: 404, headers: cors });
		}

		// ── Extract username from path ──
		// /alice → username="alice"
		// /alice/ws/viewer → username="alice", rest="/ws/viewer"
		// /alice/api/state → username="alice", rest="/api/state"
		// /alice/dashboard → username="alice", rest="/dashboard"
		const pathParts = url.pathname.split("/").filter(Boolean);
		const firstSegment = pathParts[0]?.toLowerCase();

		// Root or reserved path → let static assets handle it
		if (!firstSegment || RESERVED.has(firstSegment) || firstSegment.includes(".")) {
			// Fall through to static assets (Cloudflare handles [assets])
			return fetch(request);
		}

		const username = firstSegment;
		const rest = "/" + pathParts.slice(1).join("/");

		// ── Auth check for mutation endpoints ──
		const needsAuth = rest.includes("/ws/agent") ||
			(rest === "/api/state" && request.method === "POST") ||
			rest === "/api/audio" ||
			rest === "/api/audio-done" ||
			rest === "/api/speak" ||
			(rest === "/api/config" && request.method === "PUT");

		if (needsAuth) {
			const authorized = await checkFaceAuth(request, url, username, env);
			if (!authorized) {
				return Response.json({ error: "Unauthorized" }, { status: 401, headers: CORS });
			}
		}

		// ── Config API — read/update persistent face settings ──
		if (rest === "/api/config" && request.method === "GET") {
			return handleGetConfig(username, env);
		}
		if (rest === "/api/config" && request.method === "PUT") {
			return handleUpdateConfig(request, username, env);
		}

		// ── Serve viewer/dashboard for GET on face root or /dashboard ──
		if (request.method === "GET" && (rest === "/" || rest === "")) {
			return serveFaceViewer(username, env);
		}
		if (request.method === "GET" && rest === "/dashboard") {
			return serveFaceDashboard(username, env);
		}

		// ── Route to Durable Object ──
		const id = env.FACE_ROOM.idFromName(username);
		const stub = env.FACE_ROOM.get(id);

		// Rewrite URL so the DO sees /ws/viewer, /api/state, etc. (not /alice/ws/viewer)
		const doUrl = new URL(request.url);
		doUrl.pathname = rest || "/";
		const doRequest = new Request(doUrl.toString(), request);
		return stub.fetch(doRequest);
	},
};

/** Check auth for a specific face — uses face-specific API key from KV, or global key as fallback */
async function checkFaceAuth(request: Request, url: URL, username: string, env: Env): Promise<boolean> {
	const auth = request.headers.get("authorization");
	const token = url.searchParams.get("token");
	const provided = auth?.startsWith("Bearer ") ? auth.slice(7) : token;

	if (!provided) return false;

	// Check face-specific key from KV
	if (env.FACE_REGISTRY) {
		try {
			const record = await env.FACE_REGISTRY.get(`face:${username}`, "json") as { apiKey?: string } | null;
			if (record?.apiKey && record.apiKey === provided) return true;
		} catch { /* KV unavailable, fall through */ }
	}

	// Fall back to global API key
	if (env.FACE_API_KEY && env.FACE_API_KEY === provided) return true;

	return false;
}

/** Serve the face viewer HTML with the username's WebSocket URL injected */
async function serveFaceViewer(username: string, env: Env): Promise<Response> {
	// Check if face is claimed (if KV available)
	let facePack = "default";
	let claimed = true; // assume claimed if no KV

	if (env.FACE_REGISTRY) {
		try {
			const record = await env.FACE_REGISTRY.get(`face:${username}`, "json") as { face?: string } | null;
			if (record) {
				facePack = record.face || "default";
			} else {
				claimed = false;
			}
		} catch { /* KV unavailable */ }
	}

	if (!claimed) {
		return serveUnclaimedPage(username);
	}

	const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(username)} — Open Face</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { height: 100%; overflow: hidden; background: #0a0a0f; }
  open-face { width: 100%; height: 100%; display: block; }
</style>
</head>
<body>
<open-face
  id="face"
  server="wss://${escapeHtml(new URL("", "https://oface.io").host)}/${escapeHtml(username)}/ws/viewer"
  face="${escapeHtml(facePack)}"
  state="idle"
  emotion="neutral"
  audio-enabled
></open-face>
<script type="module" src="/open-face.js"></script>
<script>
  (function () {
    const params = new URLSearchParams(location.search);
    const face = document.getElementById("face");
    if (!face || !params.has("tts")) return;
    face.setAttribute("tts", "");
    const voice = params.get("tts-voice");
    const rate = params.get("tts-rate");
    const pitch = params.get("tts-pitch");
    if (voice) face.setAttribute("tts-voice", voice);
    if (rate) face.setAttribute("tts-rate", rate);
    if (pitch) face.setAttribute("tts-pitch", pitch);
  })();
</script>
</body>
</html>`;

	return new Response(html, {
		headers: { "Content-Type": "text/html; charset=utf-8", ...CORS },
	});
}

/** Serve dashboard pointing at a specific face */
async function serveFaceDashboard(username: string, env: Env): Promise<Response> {
	const wsUrl = `wss://oface.io/${username}/ws/viewer`;
	// Redirect to dashboard with server param
	return new Response(null, {
		status: 302,
		headers: { Location: `/dashboard?server=${encodeURIComponent(wsUrl)}&face=${encodeURIComponent(username)}` },
	});
}

/** Page shown for unclaimed usernames */
function serveUnclaimedPage(username: string): Response {
	const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(username)} — Available on Open Face</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: system-ui, sans-serif; background: #0a0a0f; color: #e8e8f0; display: flex; align-items: center; justify-content: center; min-height: 100vh; }
  .card { text-align: center; max-width: 400px; padding: 2rem; }
  h1 { font-size: 1.5rem; margin-bottom: 0.5rem; }
  h1 span { color: #4FC3F7; }
  p { color: #9999b0; margin-bottom: 1.5rem; font-size: 0.95rem; }
  .face-preview { width: 160px; height: 160px; margin: 0 auto 1.5rem; border-radius: 16px; overflow: hidden; border: 1px solid #2a2a3f; }
  .face-preview open-face { width: 100%; height: 100%; }
  .btn { display: inline-block; background: #4FC3F7; color: #0a0a0f; font-weight: 700; padding: 0.6rem 1.5rem; border-radius: 6px; text-decoration: none; font-size: 0.9rem; }
  .btn:hover { opacity: 0.85; }
  .url { font-family: 'SF Mono', monospace; color: #4FC3F7; font-size: 0.85rem; margin-top: 1rem; }
</style>
</head>
<body>
<div class="card">
  <div class="face-preview">
    <open-face state="waiting" emotion="neutral" face="default"></open-face>
  </div>
  <h1><span>${escapeHtml(username)}</span> is available</h1>
  <p>This face hasn't been claimed yet. Make it yours.</p>
  <a class="btn" href="https://openface.live/docs/integration">Claim this face</a>
  <div class="url">oface.io/${escapeHtml(username)}</div>
</div>
<script type="module" src="/open-face.js"></script>
</body>
</html>`;

	return new Response(html, {
		status: 404,
		headers: { "Content-Type": "text/html; charset=utf-8", ...CORS },
	});
}

// ── GitHub OAuth handlers ──

/** Check if GitHub OAuth is configured */
const ADMIN_USERS = new Set(["thcllc"]);

function oauthEnabled(env: Env): boolean {
	return !!(env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET);
}

function isAdmin(session: { githubUser: string } | null): boolean {
	return !!session && ADMIN_USERS.has(session.githubUser);
}

/** Extract session token from cookie header */
function getSessionToken(request: Request): string | null {
	const cookie = request.headers.get("Cookie") || "";
	const match = cookie.match(/(?:^|;\s*)oface_session=([a-f0-9]{64})/);
	return match ? match[1] : null;
}

/** Look up a session in KV, return parsed data or null */
async function getSession(token: string, env: Env): Promise<{ githubUser: string; githubAvatar: string; createdAt: string } | null> {
	if (!env.FACE_REGISTRY || !token) return null;
	try {
		const data = await env.FACE_REGISTRY.get(`session:${token}`, "json") as { githubUser: string; githubAvatar: string; createdAt: string } | null;
		return data;
	} catch {
		return null;
	}
}

/** GET /auth/login — redirect to GitHub OAuth authorize URL */
function handleAuthLogin(env: Env): Response {
	if (!oauthEnabled(env)) {
		return Response.json({ error: "OAuth not configured" }, { status: 503 });
	}
	const params = new URLSearchParams({
		client_id: env.GITHUB_CLIENT_ID,
		redirect_uri: "https://oface.io/auth/callback",
		scope: "read:user",
	});
	return new Response(null, {
		status: 302,
		headers: { Location: `https://github.com/login/oauth/authorize?${params}` },
	});
}

/** GET /auth/callback — exchange code for token, create session */
async function handleAuthCallback(url: URL, env: Env): Promise<Response> {
	if (!oauthEnabled(env)) {
		return Response.json({ error: "OAuth not configured" }, { status: 503 });
	}
	if (!env.FACE_REGISTRY) {
		return Response.json({ error: "Registry not configured" }, { status: 503 });
	}

	const code = url.searchParams.get("code");
	if (!code) {
		return new Response("Missing code parameter", { status: 400 });
	}

	// Exchange code for access token
	let accessToken: string;
	try {
		const tokenRes = await fetch("https://github.com/login/oauth/access_token", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"Accept": "application/json",
			},
			body: JSON.stringify({
				client_id: env.GITHUB_CLIENT_ID,
				client_secret: env.GITHUB_CLIENT_SECRET,
				code,
			}),
		});
		const tokenData = await tokenRes.json() as { access_token?: string; error?: string };
		if (!tokenData.access_token) {
			return new Response(`GitHub OAuth error: ${tokenData.error || "no access token"}`, { status: 400 });
		}
		accessToken = tokenData.access_token;
	} catch {
		return new Response("Failed to exchange code for token", { status: 502 });
	}

	// Fetch GitHub user info
	let githubUser: string;
	let githubAvatar: string;
	try {
		const userRes = await fetch("https://api.github.com/user", {
			headers: {
				"Authorization": `Bearer ${accessToken}`,
				"User-Agent": "openface",
				"Accept": "application/json",
			},
		});
		if (!userRes.ok) {
			return new Response("Failed to fetch GitHub user info", { status: 502 });
		}
		const userData = await userRes.json() as { login?: string; avatar_url?: string };
		if (!userData.login) {
			return new Response("GitHub user data missing login", { status: 502 });
		}
		githubUser = userData.login;
		githubAvatar = userData.avatar_url || "";
	} catch {
		return new Response("Failed to fetch GitHub user info", { status: 502 });
	}

	// Generate session token (32 bytes = 64 hex chars)
	const sessionBytes = new Uint8Array(32);
	crypto.getRandomValues(sessionBytes);
	const sessionToken = Array.from(sessionBytes).map(b => b.toString(16).padStart(2, "0")).join("");

	// Store session in KV with 7-day TTL
	const sessionData = {
		githubUser,
		githubAvatar,
		createdAt: new Date().toISOString(),
	};
	await env.FACE_REGISTRY.put(`session:${sessionToken}`, JSON.stringify(sessionData), {
		expirationTtl: 604800, // 7 days
	});

	// Return HTML that sets cookie and redirects back to openface.live
	const html = `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><title>Signing in...</title></head>
<body>
<script>
document.cookie = "oface_session=${sessionToken}; path=/; max-age=604800; secure; samesite=none";
window.location.href = "https://openface.live";
</script>
<noscript><p>Signed in. <a href="https://openface.live">Continue</a></p></noscript>
</body></html>`;

	return new Response(html, {
		headers: { "Content-Type": "text/html; charset=utf-8" },
	});
}

/** GET /auth/me — check session, return user info */
async function handleAuthMe(request: Request, env: Env, cors: Record<string, string>): Promise<Response> {
	const token = getSessionToken(request);
	if (!token) {
		return Response.json({ authenticated: false }, { headers: cors });
	}

	const session = await getSession(token, env);
	if (!session) {
		return Response.json({ authenticated: false }, { headers: cors });
	}

	return Response.json({
		authenticated: true,
		user: session.githubUser,
		avatar: session.githubAvatar,
		admin: isAdmin(session),
	}, { headers: cors });
}

/** POST /auth/logout — delete session, clear cookie */
async function handleAuthLogout(request: Request, env: Env, cors: Record<string, string>): Promise<Response> {
	const token = getSessionToken(request);
	if (token && env.FACE_REGISTRY) {
		try {
			await env.FACE_REGISTRY.delete(`session:${token}`);
		} catch { /* ignore */ }
	}

	return new Response(JSON.stringify({ ok: true }), {
		headers: {
			"Content-Type": "application/json",
			"Set-Cookie": "oface_session=; path=/; max-age=0; secure; samesite=none",
			...cors,
		},
	});
}

// ── Claim handler ──

/** Claim a username (Phase 3 — requires KV). If OAuth is configured, requires session. */
async function handleClaim(request: Request, env: Env, cors: Record<string, string>): Promise<Response> {
	if (!env.FACE_REGISTRY) {
		return Response.json({ error: "Registry not configured" }, { status: 503, headers: cors });
	}

	// If OAuth is configured, require authentication
	let githubUser: string | undefined;
	if (oauthEnabled(env)) {
		const token = getSessionToken(request);
		if (!token) {
			return Response.json({ error: "Login required", loginUrl: "/auth/login" }, { status: 401, headers: cors });
		}
		const session = await getSession(token, env);
		if (!session) {
			return Response.json({ error: "Login required", loginUrl: "/auth/login" }, { status: 401, headers: cors });
		}
		githubUser = session.githubUser;
	}

	let body: { username?: string; face?: string };
	try {
		body = await request.json() as { username?: string; face?: string };
	} catch {
		return Response.json({ error: "Invalid JSON" }, { status: 400, headers: cors });
	}

	const username = body.username?.toLowerCase().replace(/[^a-z0-9-]/g, "");
	if (!username || username.length < 2 || username.length > 32) {
		return Response.json({ error: "Username must be 2-32 chars, lowercase alphanumeric + hyphens" }, { status: 400, headers: cors });
	}
	if (RESERVED.has(username)) {
		return Response.json({ error: "Username is reserved" }, { status: 409, headers: cors });
	}
	// Block usernames containing profanity substrings
	const blocked = ["fuck","shit","cunt","nigger","nigga","faggot","retard","porn","hentai","cock","pussy","bitch"];
	if (blocked.some(w => username.includes(w))) {
		return Response.json({ error: "Username not allowed" }, { status: 400, headers: cors });
	}
	// Block leading/trailing hyphens and double hyphens
	if (username.startsWith("-") || username.endsWith("-") || username.includes("--")) {
		return Response.json({ error: "Username cannot start/end with hyphens or contain double hyphens" }, { status: 400, headers: cors });
	}

	// Check if taken
	const existing = await env.FACE_REGISTRY.get(`face:${username}`);
	if (existing) {
		return Response.json({ error: "Username is taken" }, { status: 409, headers: cors });
	}

	// Generate API key
	const keyBytes = new Uint8Array(24);
	crypto.getRandomValues(keyBytes);
	const apiKey = "oface_ak_" + Array.from(keyBytes).map(b => b.toString(16).padStart(2, "0")).join("");

	const record: Record<string, unknown> = {
		username,
		face: body.face || "default",
		apiKey,
		createdAt: new Date().toISOString(),
		config: {},
	};

	// Attach GitHub user if authenticated
	if (githubUser) {
		record.githubUser = githubUser;
	}

	await env.FACE_REGISTRY.put(`face:${username}`, JSON.stringify(record));

	return Response.json({
		ok: true,
		username,
		apiKey,
		url: `https://oface.io/${username}`,
		wsUrl: `wss://oface.io/${username}/ws/viewer`,
		pushUrl: `https://oface.io/${username}/api/state`,
	}, { headers: cors });
}

/** Check username availability */
async function handleCheck(username: string, env: Env): Promise<Response> {
	if (!username || username.length < 2 || username.length > 32) {
		return Response.json({ available: false, reason: "invalid" }, { headers: CORS });
	}
	if (RESERVED.has(username)) {
		return Response.json({ available: false, reason: "reserved" }, { headers: CORS });
	}
	if (!env.FACE_REGISTRY) {
		// No KV = all usernames "available" (first-come when KV is added)
		return Response.json({ available: true }, { headers: CORS });
	}
	const existing = await env.FACE_REGISTRY.get(`face:${username}`);
	return Response.json({ available: !existing }, { headers: CORS });
}

/** Get face config (public) */
async function handleGetConfig(username: string, env: Env): Promise<Response> {
	if (!env.FACE_REGISTRY) {
		return Response.json({ face: "default", config: {} }, { headers: CORS });
	}
	try {
		const record = await env.FACE_REGISTRY.get(`face:${username}`, "json") as Record<string, unknown> | null;
		if (!record) {
			return Response.json({ error: "Not found" }, { status: 404, headers: CORS });
		}
		// Return public config (no apiKey)
		return Response.json({
			username: record.username,
			face: record.face || "default",
			config: record.config || {},
		}, { headers: CORS });
	} catch {
		return Response.json({ error: "Registry unavailable" }, { status: 503, headers: CORS });
	}
}

/** Update face config (auth required) */
async function handleUpdateConfig(request: Request, username: string, env: Env): Promise<Response> {
	if (!env.FACE_REGISTRY) {
		return Response.json({ error: "Registry not configured" }, { status: 503, headers: CORS });
	}
	try {
		const updates = await request.json() as Record<string, unknown>;
		const raw = await env.FACE_REGISTRY.get(`face:${username}`, "json") as Record<string, unknown> | null;
		if (!raw) {
			return Response.json({ error: "Not found" }, { status: 404, headers: CORS });
		}

		// Update allowed fields
		if (typeof updates.face === "string") raw.face = updates.face;
		if (updates.config && typeof updates.config === "object") {
			raw.config = { ...(raw.config as Record<string, unknown> || {}), ...updates.config };
		}

		await env.FACE_REGISTRY.put(`face:${username}`, JSON.stringify(raw));

		return Response.json({
			ok: true,
			username: raw.username,
			face: raw.face,
			config: raw.config,
		}, { headers: CORS });
	} catch {
		return Response.json({ error: "Invalid request" }, { status: 400, headers: CORS });
	}
}

// ── Gallery API handlers ──

const GALLERY_TAGS = new Set([
	"minimal", "dark", "cute", "mechanical", "warm", "spooky", "retro",
	"accessible", "bold", "organic", "cosmic", "expressive",
]);

/** Slugify a name for use as gallery ID */
function slugify(name: string): string {
	return name
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-|-$/g, "")
		.slice(0, 40);
}

/** Generate a short random suffix */
function randomSuffix(len = 6): string {
	const bytes = new Uint8Array(len);
	crypto.getRandomValues(bytes);
	return Array.from(bytes).map(b => b.toString(36).slice(-1)).join("");
}

/** Simple IP-based rate limit check: max 10 submissions per IP per hour */
async function checkGalleryRateLimit(request: Request, env: Env): Promise<boolean> {
	if (!env.FACE_REGISTRY) return true; // no KV = no rate limit
	const ip = request.headers.get("CF-Connecting-IP") || request.headers.get("x-forwarded-for") || "unknown";
	const key = `ratelimit:gallery:${ip}`;
	try {
		const raw = await env.FACE_REGISTRY.get(key);
		const count = raw ? parseInt(raw, 10) : 0;
		if (count >= 10) return false;
		await env.FACE_REGISTRY.put(key, String(count + 1), { expirationTtl: 3600 });
		return true;
	} catch {
		return true; // fail open
	}
}

/** POST /api/gallery — submit a pack to the community gallery */
async function handleGallerySubmit(request: Request, env: Env, cors: Record<string, string>): Promise<Response> {
	if (!env.FACE_REGISTRY) {
		return Response.json({ error: "Registry not configured" }, { status: 503, headers: cors });
	}

	// Rate limit
	const allowed = await checkGalleryRateLimit(request, env);
	if (!allowed) {
		return Response.json({ error: "Rate limit exceeded. Max 10 submissions per hour." }, { status: 429, headers: cors });
	}

	// Check auth — authenticated users get GitHub username as author
	let authenticatedUser: string | null = null;
	if (oauthEnabled(env)) {
		const token = getSessionToken(request);
		if (token) {
			const session = await getSession(token, env);
			if (session) authenticatedUser = session.githubUser;
		}
	}

	let body: { name?: string; author?: string; description?: string; tags?: string[]; pack?: Record<string, unknown> };
	try {
		body = await request.json() as typeof body;
	} catch {
		return Response.json({ error: "Invalid JSON" }, { status: 400, headers: cors });
	}

	// Validate name
	const name = (body.name || "").trim();
	if (name.length < 2 || name.length > 50) {
		return Response.json({ error: "Name must be 2-50 characters" }, { status: 400, headers: cors });
	}

	// Determine author — authenticated user's GitHub name overrides client-provided value
	let author: string;
	let authorType: "github" | "anonymous";
	if (authenticatedUser) {
		author = authenticatedUser;
		authorType = "github";
	} else {
		author = (body.author || "").trim();
		if (author.length < 2 || author.length > 50) {
			return Response.json({ error: "Author must be 2-50 characters" }, { status: 400, headers: cors });
		}
		authorType = "anonymous";
	}

	// Validate tags
	const tags = Array.isArray(body.tags) ? body.tags.filter(t => typeof t === "string" && GALLERY_TAGS.has(t)) : [];
	if (tags.length === 0) {
		return Response.json({ error: "At least one valid tag is required" }, { status: 400, headers: cors });
	}

	// Validate pack
	const pack = body.pack;
	if (!pack || typeof pack !== "object" || !pack.meta || !pack.geometry || !pack.palette) {
		return Response.json({ error: "Pack must include meta, geometry, and palette" }, { status: 400, headers: cors });
	}

	const description = (body.description || "").trim().slice(0, 300);

	// Generate gallery ID
	const slug = slugify(name);
	const id = slug ? `${slug}-${randomSuffix()}` : randomSuffix(10);

	const record = {
		id,
		name,
		author,
		authorType,
		description,
		tags,
		pack,
		createdAt: new Date().toISOString(),
		downloads: 0,
	};

	// Store the full record
	await env.FACE_REGISTRY.put(`gallery:${id}`, JSON.stringify(record));

	// Store in the gallery index (lightweight listing entry without full pack)
	const indexEntry = { id, name, author, authorType, description, tags, createdAt: record.createdAt, downloads: 0 };
	try {
		const rawIndex = await env.FACE_REGISTRY.get("gallery:__index__");
		const index: unknown[] = rawIndex ? JSON.parse(rawIndex) : [];
		index.push(indexEntry);
		await env.FACE_REGISTRY.put("gallery:__index__", JSON.stringify(index));
	} catch {
		// If index is corrupted, start fresh
		await env.FACE_REGISTRY.put("gallery:__index__", JSON.stringify([indexEntry]));
	}

	return Response.json({
		ok: true,
		id,
		url: `https://openface.live/packs#${id}`,
	}, { status: 201, headers: cors });
}

/** GET /api/gallery — list all gallery packs (metadata only, no full pack JSON) */
async function handleGalleryList(env: Env): Promise<Response> {
	if (!env.FACE_REGISTRY) {
		return Response.json([], { headers: CORS });
	}

	try {
		const rawIndex = await env.FACE_REGISTRY.get("gallery:__index__");
		const index = rawIndex ? JSON.parse(rawIndex) : [];
		return Response.json(index, { headers: CORS });
	} catch {
		return Response.json([], { headers: CORS });
	}
}

/** GET /api/gallery/:id — get a single gallery pack (full pack JSON) */
async function handleGalleryGet(id: string, env: Env): Promise<Response> {
	if (!id || id.length > 60) {
		return Response.json({ error: "Invalid gallery ID" }, { status: 400, headers: CORS });
	}

	if (!env.FACE_REGISTRY) {
		return Response.json({ error: "Registry not configured" }, { status: 503, headers: CORS });
	}

	try {
		const raw = await env.FACE_REGISTRY.get(`gallery:${id}`, "json") as Record<string, unknown> | null;
		if (!raw) {
			return Response.json({ error: "Not found" }, { status: 404, headers: CORS });
		}

		// Increment download counter (fire-and-forget)
		const downloads = (typeof raw.downloads === "number" ? raw.downloads : 0) + 1;
		raw.downloads = downloads;
		env.FACE_REGISTRY.put(`gallery:${id}`, JSON.stringify(raw)).catch(() => {});

		return Response.json(raw, { headers: CORS });
	} catch {
		return Response.json({ error: "Registry unavailable" }, { status: 503, headers: CORS });
	}
}

// ── Admin handlers ──

// ── Account API handlers ──

async function handleAccountClaims(githubUser: string, env: Env, cors: Record<string, string>): Promise<Response> {
	if (!env.FACE_REGISTRY) return Response.json([], { headers: cors });
	try {
		const list = await env.FACE_REGISTRY.list({ prefix: "face:" });
		const claims = [];
		for (const key of list.keys) {
			const data = await env.FACE_REGISTRY.get(key.name, "json") as Record<string, unknown> | null;
			if (data && data.githubUser === githubUser) {
				claims.push({
					username: data.username,
					face: data.face,
					apiKey: data.apiKey,
					createdAt: data.createdAt,
					config: data.config || null,
				});
			}
		}
		return Response.json(claims, { headers: cors });
	} catch {
		return Response.json([], { headers: cors });
	}
}

async function handleAccountGallery(githubUser: string, env: Env, cors: Record<string, string>): Promise<Response> {
	if (!env.FACE_REGISTRY) return Response.json([], { headers: cors });
	try {
		const index = await env.FACE_REGISTRY.get("gallery:__index__", "json") as Record<string, unknown>[] | null;
		const mine = (index || []).filter(p => p.author === githubUser && p.authorType === "github");
		return Response.json(mine, { headers: cors });
	} catch {
		return Response.json([], { headers: cors });
	}
}

async function handleAccountClaimDelete(githubUser: string, username: string, env: Env, cors: Record<string, string>): Promise<Response> {
	if (!env.FACE_REGISTRY) return Response.json({ error: "No registry" }, { status: 503, headers: cors });
	try {
		const data = await env.FACE_REGISTRY.get(`face:${username}`, "json") as Record<string, unknown> | null;
		if (!data) return Response.json({ error: "Not found" }, { status: 404, headers: cors });
		if (data.githubUser !== githubUser) return Response.json({ error: "Not yours" }, { status: 403, headers: cors });
		await env.FACE_REGISTRY.delete(`face:${username}`);
		return Response.json({ ok: true, deleted: username }, { headers: cors });
	} catch {
		return Response.json({ error: "Failed" }, { status: 500, headers: cors });
	}
}

async function handleAccountGalleryDelete(githubUser: string, id: string, env: Env, cors: Record<string, string>): Promise<Response> {
	if (!env.FACE_REGISTRY) return Response.json({ error: "No registry" }, { status: 503, headers: cors });
	try {
		const record = await env.FACE_REGISTRY.get(`gallery:${id}`, "json") as Record<string, unknown> | null;
		if (!record) return Response.json({ error: "Not found" }, { status: 404, headers: cors });
		if (record.author !== githubUser || record.authorType !== "github") {
			return Response.json({ error: "Not yours" }, { status: 403, headers: cors });
		}
		await env.FACE_REGISTRY.delete(`gallery:${id}`);
		const index = await env.FACE_REGISTRY.get("gallery:__index__", "json") as Record<string, unknown>[] | null;
		if (index) {
			const filtered = index.filter((p: Record<string, unknown>) => p.id !== id);
			await env.FACE_REGISTRY.put("gallery:__index__", JSON.stringify(filtered));
		}
		return Response.json({ ok: true, deleted: id }, { headers: cors });
	} catch {
		return Response.json({ error: "Failed" }, { status: 500, headers: cors });
	}
}

async function handleAccountRegenerateKey(githubUser: string, username: string, env: Env, cors: Record<string, string>): Promise<Response> {
	if (!env.FACE_REGISTRY) return Response.json({ error: "No registry" }, { status: 503, headers: cors });
	try {
		const data = await env.FACE_REGISTRY.get(`face:${username}`, "json") as Record<string, unknown> | null;
		if (!data) return Response.json({ error: "Not found" }, { status: 404, headers: cors });
		if (data.githubUser !== githubUser) return Response.json({ error: "Not yours" }, { status: 403, headers: cors });
		const bytes = new Uint8Array(24);
		crypto.getRandomValues(bytes);
		const newKey = "oface_ak_" + Array.from(bytes).map(b => b.toString(16).padStart(2, "0")).join("");
		data.apiKey = newKey;
		await env.FACE_REGISTRY.put(`face:${username}`, JSON.stringify(data));
		return Response.json({ ok: true, username, apiKey: newKey }, { headers: cors });
	} catch {
		return Response.json({ error: "Failed" }, { status: 500, headers: cors });
	}
}

// ── Admin API handlers ──

async function handleAdminGalleryList(env: Env, cors: Record<string, string>): Promise<Response> {
	if (!env.FACE_REGISTRY) return Response.json([], { headers: cors });
	try {
		const index = await env.FACE_REGISTRY.get("gallery:__index__", "json") as unknown[] | null;
		return Response.json(index || [], { headers: cors });
	} catch {
		return Response.json([], { headers: cors });
	}
}

async function handleAdminGalleryDelete(id: string, env: Env, cors: Record<string, string>): Promise<Response> {
	if (!env.FACE_REGISTRY) return Response.json({ error: "No registry" }, { status: 503, headers: cors });
	try {
		await env.FACE_REGISTRY.delete(`gallery:${id}`);
		const index = await env.FACE_REGISTRY.get("gallery:__index__", "json") as Record<string, unknown>[] | null;
		if (index) {
			const filtered = index.filter((p: Record<string, unknown>) => p.id !== id);
			await env.FACE_REGISTRY.put("gallery:__index__", JSON.stringify(filtered));
		}
		return Response.json({ ok: true, deleted: id }, { headers: cors });
	} catch {
		return Response.json({ error: "Failed" }, { status: 500, headers: cors });
	}
}

async function handleAdminGalleryUpdate(request: Request, id: string, env: Env, cors: Record<string, string>): Promise<Response> {
	if (!env.FACE_REGISTRY) return Response.json({ error: "No registry" }, { status: 503, headers: cors });
	try {
		const updates = await request.json() as Record<string, unknown>;
		const raw = await env.FACE_REGISTRY.get(`gallery:${id}`, "json") as Record<string, unknown> | null;
		if (!raw) return Response.json({ error: "Not found" }, { status: 404, headers: cors });
		if (typeof updates.featured === "boolean") raw.featured = updates.featured;
		if (typeof updates.name === "string") raw.name = updates.name;
		if (typeof updates.description === "string") raw.description = updates.description;
		if (Array.isArray(updates.tags)) raw.tags = updates.tags;
		await env.FACE_REGISTRY.put(`gallery:${id}`, JSON.stringify(raw));
		const index = await env.FACE_REGISTRY.get("gallery:__index__", "json") as Record<string, unknown>[] | null;
		if (index) {
			const entry = index.find((p: Record<string, unknown>) => p.id === id);
			if (entry) {
				if (typeof updates.featured === "boolean") entry.featured = updates.featured;
				if (typeof updates.name === "string") entry.name = updates.name;
				if (typeof updates.description === "string") entry.description = updates.description;
				if (Array.isArray(updates.tags)) entry.tags = updates.tags;
				await env.FACE_REGISTRY.put("gallery:__index__", JSON.stringify(index));
			}
		}
		return Response.json({ ok: true, id }, { headers: cors });
	} catch {
		return Response.json({ error: "Failed" }, { status: 500, headers: cors });
	}
}

async function handleAdminClaimsList(env: Env, cors: Record<string, string>): Promise<Response> {
	if (!env.FACE_REGISTRY) return Response.json([], { headers: cors });
	try {
		const list = await env.FACE_REGISTRY.list({ prefix: "face:" });
		const claims = [];
		for (const key of list.keys) {
			const data = await env.FACE_REGISTRY.get(key.name, "json") as Record<string, unknown> | null;
			if (data) {
				claims.push({
					username: data.username,
					face: data.face,
					githubUser: data.githubUser || null,
					createdAt: data.createdAt,
				});
			}
		}
		return Response.json(claims, { headers: cors });
	} catch {
		return Response.json([], { headers: cors });
	}
}

async function handleAdminClaimDelete(username: string, env: Env, cors: Record<string, string>): Promise<Response> {
	if (!env.FACE_REGISTRY) return Response.json({ error: "No registry" }, { status: 503, headers: cors });
	try {
		await env.FACE_REGISTRY.delete(`face:${username}`);
		return Response.json({ ok: true, deleted: username }, { headers: cors });
	} catch {
		return Response.json({ error: "Failed" }, { status: 500, headers: cors });
	}
}

function escapeHtml(s: string): string {
	return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
