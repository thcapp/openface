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

