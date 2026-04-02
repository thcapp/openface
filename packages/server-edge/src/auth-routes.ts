import { getSession, getSessionToken, isAdmin, oauthEnabled } from "./auth-session.js";

export interface AuthEnv {
	FACE_REGISTRY?: KVNamespace;
	GITHUB_CLIENT_ID: string;
	GITHUB_CLIENT_SECRET: string;
}

/** GET /auth/login — redirect to GitHub OAuth authorize URL */
export function handleAuthLogin(env: AuthEnv): Response {
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
export async function handleAuthCallback(url: URL, env: AuthEnv): Promise<Response> {
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
			"Set-Cookie": "oface_session=; path=/; max-age=0; secure; samesite=none",
			...cors,
		},
	});
}

