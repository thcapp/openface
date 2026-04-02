/**
 * Open Face Edge Server — Cloudflare Workers entry point.
 * Routes /{username}/* requests to per-user FaceRoom Durable Objects.
 * Serves static assets for non-API/non-WS requests.
 */

import { getSession, getSessionToken, isAdmin } from "./auth-session.js";
import { isReservedPathSegment } from "./username-policy.js";
import { handleAuthCallback, handleAuthLogin, handleAuthLogout, handleAuthMe } from "./auth-routes.js";
import { handleGalleryGet, handleGalleryList, handleGallerySubmit } from "./gallery-routes.js";
import {
	handleAccountClaimDelete,
	handleAccountClaims,
	handleAccountGallery,
	handleAccountGalleryDelete,
	handleAccountRegenerateKey,
	handleAdminClaimDelete,
	handleAdminClaimsList,
	handleAdminGalleryDelete,
	handleAdminGalleryList,
	handleAdminGalleryUpdate,
} from "./account-admin-routes.js";
import {
	checkFaceAuth,
	handleCheck,
	handleClaim,
	handleGetConfig,
	handleUpdateConfig,
	serveFaceDashboard,
	serveFaceViewer,
} from "./face-routes.js";

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
			return handleCheck(username, env, cors);
		}

		// ── Gallery API ──
		if (url.pathname === "/api/gallery" && request.method === "POST") {
			return handleGallerySubmit(request, env, cors);
		}
		if (url.pathname === "/api/gallery" && request.method === "GET") {
			return handleGalleryList(env, cors);
		}
		if (url.pathname.startsWith("/api/gallery/") && request.method === "GET") {
			const id = url.pathname.slice("/api/gallery/".length);
			return handleGalleryGet(id, env, cors);
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
		if (!firstSegment || isReservedPathSegment(firstSegment) || firstSegment.includes(".")) {
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
				return Response.json({ error: "Unauthorized" }, { status: 401, headers: cors });
			}
		}

		// ── Config API — read/update persistent face settings ──
		if (rest === "/api/config" && request.method === "GET") {
			return handleGetConfig(username, env, cors);
		}
		if (rest === "/api/config" && request.method === "PUT") {
			return handleUpdateConfig(request, username, env, cors);
		}

		// ── Serve viewer/dashboard for GET on face root or /dashboard ──
		if (request.method === "GET" && (rest === "/" || rest === "")) {
			return serveFaceViewer(username, env, cors);
		}
		if (request.method === "GET" && rest === "/dashboard") {
			return serveFaceDashboard(username);
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
