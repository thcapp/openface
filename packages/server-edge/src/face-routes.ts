import { getSession, getSessionToken, oauthEnabled } from "./auth-session.js";
import { validateClaimUsername } from "./username-policy.js";
import { renderUnclaimedHtml, renderViewerHtml } from "./viewer-pages.js";

export interface FaceRoutesEnv {
	FACE_REGISTRY?: KVNamespace;
	FACE_API_KEY: string;
	GITHUB_CLIENT_ID: string;
	GITHUB_CLIENT_SECRET: string;
}

/** Check auth for a specific face — uses face-specific API key from KV, or global key as fallback */
export async function checkFaceAuth(request: Request, url: URL, username: string, env: FaceRoutesEnv): Promise<boolean> {
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
export async function serveFaceViewer(username: string, env: FaceRoutesEnv, cors: Record<string, string>): Promise<Response> {
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
		return serveUnclaimedPage(username, cors);
	}

	const html = renderViewerHtml(username, facePack, new URL("", "https://oface.io").host);
	return new Response(html, {
		headers: { "Content-Type": "text/html; charset=utf-8", ...cors },
	});
}

/** Serve dashboard pointing at a specific face */
export function serveFaceDashboard(username: string): Response {
	const wsUrl = `wss://oface.io/${username}/ws/viewer`;
	// Redirect to dashboard with server param
	return new Response(null, {
		status: 302,
		headers: { Location: `/dashboard?server=${encodeURIComponent(wsUrl)}&face=${encodeURIComponent(username)}` },
	});
}

/** Page shown for unclaimed usernames */
function serveUnclaimedPage(username: string, cors: Record<string, string>): Response {
	const html = renderUnclaimedHtml(username);
	return new Response(html, {
		status: 404,
		headers: { "Content-Type": "text/html; charset=utf-8", ...cors },
	});
}

/** Claim a username. If OAuth is configured, requires session. */
export async function handleClaim(request: Request, env: FaceRoutesEnv, cors: Record<string, string>): Promise<Response> {
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

	const usernameValidation = validateClaimUsername(body.username);
	if (!usernameValidation.ok) {
		return Response.json({ error: usernameValidation.error }, { status: usernameValidation.status, headers: cors });
	}
	const username = usernameValidation.username;

	// Check if taken
	const existing = await env.FACE_REGISTRY.get(`face:${username}`);
	if (existing) {
		return Response.json({ error: "Username is taken" }, { status: 409, headers: cors });
	}

	// Generate API key
	const keyBytes = new Uint8Array(24);
	crypto.getRandomValues(keyBytes);
	const apiKey = "oface_ak_" + Array.from(keyBytes).map((b) => b.toString(16).padStart(2, "0")).join("");

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
export async function handleCheck(username: string, env: FaceRoutesEnv, cors: Record<string, string>): Promise<Response> {
	const usernameValidation = validateClaimUsername(username);
	if (!usernameValidation.ok) {
		return Response.json({ available: false, reason: usernameValidation.reason }, { headers: cors });
	}
	username = usernameValidation.username;
	if (!env.FACE_REGISTRY) {
		// No KV = all usernames "available" (first-come when KV is added)
		return Response.json({ available: true }, { headers: cors });
	}
	const existing = await env.FACE_REGISTRY.get(`face:${username}`);
	return Response.json({ available: !existing }, { headers: cors });
}

/** Get face config (public) */
export async function handleGetConfig(username: string, env: FaceRoutesEnv, cors: Record<string, string>): Promise<Response> {
	if (!env.FACE_REGISTRY) {
		return Response.json({ face: "default", config: {} }, { headers: cors });
	}
	try {
		const record = await env.FACE_REGISTRY.get(`face:${username}`, "json") as Record<string, unknown> | null;
		if (!record) {
			return Response.json({ error: "Not found" }, { status: 404, headers: cors });
		}
		// Return public config (no apiKey)
		return Response.json({
			username: record.username,
			face: record.face || "default",
			config: record.config || {},
		}, { headers: cors });
	} catch {
		return Response.json({ error: "Registry unavailable" }, { status: 503, headers: cors });
	}
}

/** Update face config (auth required) */
export async function handleUpdateConfig(
	request: Request,
	username: string,
	env: FaceRoutesEnv,
	cors: Record<string, string>,
): Promise<Response> {
	if (!env.FACE_REGISTRY) {
		return Response.json({ error: "Registry not configured" }, { status: 503, headers: cors });
	}
	try {
		const updates = await request.json() as Record<string, unknown>;
		const raw = await env.FACE_REGISTRY.get(`face:${username}`, "json") as Record<string, unknown> | null;
		if (!raw) {
			return Response.json({ error: "Not found" }, { status: 404, headers: cors });
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
		}, { headers: cors });
	} catch {
		return Response.json({ error: "Invalid request" }, { status: 400, headers: cors });
	}
}

