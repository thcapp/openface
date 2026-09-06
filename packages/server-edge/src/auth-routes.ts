import {
	buildOAuthStateCookie,
	buildSessionCookie,
	clearOAuthStateCookie,
	clearSessionCookie,
	consumeOAuthState,
	getOAuthStateCookie,
	getSession,
	getSessionToken,
	isAdmin,
	oauthEnabled,
	pkceChallenge,
	putOAuthState,
	randomToken,
	safeReturnTo,
} from "./auth-session.js";

export interface AuthEnv {
	FACE_REGISTRY?: KVNamespace;
	GITHUB_CLIENT_ID: string;
	GITHUB_CLIENT_SECRET: string;
}

/** GET /auth/login — start a browser-bound, PKCE-protected OAuth flow */
export async function handleAuthLogin(request: Request, env: AuthEnv): Promise<Response> {
	if (!oauthEnabled(env)) {
		return Response.json({ error: "OAuth not configured" }, { status: 503 });
	}
	if (!env.FACE_REGISTRY) {
		return Response.json({ error: "Registry not configured" }, { status: 503 });
	}

	const returnTo = safeReturnTo(new URL(request.url).searchParams.get("returnTo"));

	// `state` is stored server-side and mirrored into an HttpOnly cookie. The callback
	// requires both to be present and equal, so a code obtained in someone else's
	// browser cannot be redeemed in this one.
	const state = randomToken();
	const verifier = randomToken();
	const challenge = await pkceChallenge(verifier);

	await putOAuthState(state, { verifier, returnTo, createdAt: new Date().toISOString() }, env);

	const params = new URLSearchParams({
		client_id: env.GITHUB_CLIENT_ID,
		redirect_uri: "https://oface.io/auth/callback",
		scope: "read:user",
		state,
		code_challenge: challenge,
		code_challenge_method: "S256",
	});

	return new Response(null, {
		status: 302,
		headers: {
			Location: `https://github.com/login/oauth/authorize?${params}`,
			"Set-Cookie": buildOAuthStateCookie(state),
		},
	});
}

/** GET /auth/callback — validate state, exchange code, create session */
export async function handleAuthCallback(request: Request, url: URL, env: AuthEnv): Promise<Response> {
	if (!oauthEnabled(env)) {
		return Response.json({ error: "OAuth not configured" }, { status: 503 });
	}
	if (!env.FACE_REGISTRY) {
		return Response.json({ error: "Registry not configured" }, { status: 503 });
	}

	const code = url.searchParams.get("code");
	const state = url.searchParams.get("state");
	if (!code || !state) {
		return new Response("Missing code or state parameter", { status: 400 });
	}

	// Everything below happens BEFORE the token endpoint is called, so an unsolicited
	// or replayed callback never spends a code.
	const cookieState = getOAuthStateCookie(request);
	if (!cookieState || cookieState !== state) {
		return new Response("OAuth state does not match this browser", {
			status: 400,
			headers: { "Set-Cookie": clearOAuthStateCookie() },
		});
	}

	// Single use: reading it removes it, so a captured callback URL is spent.
	const pending = await consumeOAuthState(state, env);
	if (!pending) {
		return new Response("OAuth state expired or already used", {
			status: 400,
			headers: { "Set-Cookie": clearOAuthStateCookie() },
		});
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
				code_verifier: pending.verifier,
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
	const sessionToken = Array.from(sessionBytes).map((b) => b.toString(16).padStart(2, "0")).join("");

	// Store session in KV with 7-day TTL
	const sessionData = {
		githubUser,
		githubAvatar,
		createdAt: new Date().toISOString(),
	};
	await env.FACE_REGISTRY.put(`session:${sessionToken}`, JSON.stringify(sessionData), {
		expirationTtl: 604800, // 7 days
	});

	// Set the cookie from the server so it can be HttpOnly. It was previously written
	// by page script, which put a seven-day session token within reach of any
	// same-origin script. Nothing in the site reads it — requests carry it
	// automatically — so there is no reason for script to see it.
	const headers = new Headers({ Location: pending.returnTo });
	headers.append("Set-Cookie", buildSessionCookie(sessionToken));
	headers.append("Set-Cookie", clearOAuthStateCookie());

	return new Response(null, { status: 302, headers });
}

/** GET /auth/me — check session, return user info */
export async function handleAuthMe(request: Request, env: AuthEnv, cors: Record<string, string>): Promise<Response> {
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
export async function handleAuthLogout(request: Request, env: AuthEnv, cors: Record<string, string>): Promise<Response> {
	const token = getSessionToken(request);
	if (token && env.FACE_REGISTRY) {
		try {
			await env.FACE_REGISTRY.delete(`session:${token}`);
		} catch { /* ignore */ }
	}

	return new Response(JSON.stringify({ ok: true }), {
		headers: {
			"Content-Type": "application/json",
			"Set-Cookie": clearSessionCookie(),
			...cors,
		},
	});
}

