import { describe, expect, test } from "bun:test";
import worker from "../src/worker.js";

const KEY = "face-key-alice";

/** Records every request that reaches the Durable Object. */
function makeEnv() {
	const doCalls: string[] = [];
	const env = {
		FACE_ROOM: {
			idFromName: (name: string) => ({ name }),
			get: () => ({
				fetch: (req: Request) => {
					doCalls.push(new URL(req.url).pathname);
					return Promise.resolve(Response.json({ reached: true }));
				},
			}),
		},
		FACE_REGISTRY: {
			get: async (key: string) => (key === "face:alice" ? { apiKey: KEY, face: "default" } : null),
		},
		FACE_API_KEY: "",
		OPENCLAW_GATEWAY_URL: "",
		OPENCLAW_GATEWAY_TOKEN: "",
		OPENCLAW_SESSION_KEY: "",
		GITHUB_CLIENT_ID: "",
		GITHUB_CLIENT_SECRET: "",
	};
	return { env, doCalls };
}

function req(path: string, init: RequestInit = {}) {
	return new Request(`https://oface.io${path}`, init);
}

const call = (path: string, init?: RequestInit) => {
	const { env, doCalls } = makeEnv();
	// biome-ignore lint/suspicious/noExplicitAny: test double for the Workers env
	return worker.fetch(req(path, init), env as any).then((res) => ({ res, doCalls }));
};

describe("auth gate / dispatcher agreement", () => {
	// The gate compared paths with === while the Durable Object matched with
	// endsWith(), so an inserted segment skipped auth and still hit the handler.
	const smuggled = [
		"/alice/extra/api/state",
		"/alice/x/y/api/state",
		"/alice/extra/api/audio",
		"/alice/extra/api/audio-done",
		"/alice/extra/api/speak",
		"/alice/extra/api/chat",
	];

	for (const path of smuggled) {
		test(`POST ${path} is rejected and never reaches the DO`, async () => {
			const { res, doCalls } = await call(path, { method: "POST", body: "{}" });
			expect(res.status).toBe(404);
			expect(doCalls).toEqual([]);
		});
	}

	test("/alice/agent does not get the agent role", async () => {
		const { res, doCalls } = await call("/alice/agent", {
			headers: { upgrade: "websocket" },
		});
		expect(res.status).toBe(404);
		expect(doCalls).toEqual([]);
	});

	test("/alice/ws/agent still requires the face key", async () => {
		const { res, doCalls } = await call("/alice/ws/agent", {
			headers: { upgrade: "websocket" },
		});
		expect(res.status).toBe(401);
		expect(doCalls).toEqual([]);
	});

	test("/alice/ws/agent with the key reaches the DO as the canonical path", async () => {
		const { res, doCalls } = await call(`/alice/ws/agent?token=${KEY}`, {
			headers: { upgrade: "websocket" },
		});
		expect(res.status).toBe(200);
		expect(doCalls).toEqual(["/ws/agent"]);
	});
});

describe("per-face auth", () => {
	test("POST /api/state without a key is 401", async () => {
		const { res, doCalls } = await call("/alice/api/state", { method: "POST", body: "{}" });
		expect(res.status).toBe(401);
		expect(doCalls).toEqual([]);
	});

	test("POST /api/state with the key reaches the DO", async () => {
		const { res, doCalls } = await call("/alice/api/state", {
			method: "POST",
			body: "{}",
			headers: { authorization: `Bearer ${KEY}` },
		});
		expect(res.status).toBe(200);
		expect(doCalls).toEqual(["/api/state"]);
	});

	test("POST /api/state with a wrong key is 401", async () => {
		const { res } = await call("/alice/api/state", {
			method: "POST",
			body: "{}",
			headers: { authorization: "Bearer nope" },
		});
		expect(res.status).toBe(401);
	});

	// /api/chat proxies to the OpenClaw gateway and previously had no gate at all.
	test("POST /api/chat without a key is 401", async () => {
		const { res, doCalls } = await call("/alice/api/chat", { method: "POST", body: "{}" });
		expect(res.status).toBe(401);
		expect(doCalls).toEqual([]);
	});

	test("POST /api/chat with the key reaches the DO", async () => {
		const { res, doCalls } = await call(`/alice/api/chat?token=${KEY}`, {
			method: "POST",
			body: "{}",
		});
		expect(res.status).toBe(200);
		expect(doCalls).toEqual(["/api/chat"]);
	});

	test("GET /api/state stays public", async () => {
		const { res, doCalls } = await call("/alice/api/state");
		expect(res.status).toBe(200);
		expect(doCalls).toEqual(["/api/state"]);
	});

	test("viewer WebSocket stays public", async () => {
		const { doCalls } = await call("/alice/ws/viewer", { headers: { upgrade: "websocket" } });
		expect(doCalls).toEqual(["/ws/viewer"]);
	});
});

describe("CORS credentialed origins", () => {
	// Preflight is answered by the worker itself, so these headers are the worker's
	// own — a DO-routed response would carry the Durable Object's headers instead.
	const cors = async (origin: string) => {
		const { res } = await call("/alice/api/state", { method: "OPTIONS", headers: { Origin: origin } });
		return {
			allowOrigin: res.headers.get("Access-Control-Allow-Origin"),
			credentials: res.headers.get("Access-Control-Allow-Credentials"),
		};
	};

	test("openface.live is trusted", async () => {
		expect(await cors("https://openface.live")).toEqual({
			allowOrigin: "https://openface.live",
			credentials: "true",
		});
	});

	test("localhost dev with a port is trusted", async () => {
		expect(await cors("http://localhost:5173")).toEqual({
			allowOrigin: "http://localhost:5173",
			credentials: "true",
		});
	});

	// startsWith("http://localhost") also matched registrable attacker domains.
	for (const origin of [
		"http://localhost.attacker.invalid",
		"http://localhost-evil.example",
		"https://openface.live.attacker.invalid",
	]) {
		test(`${origin} gets no credentialed reflection`, async () => {
			const { allowOrigin, credentials } = await cors(origin);
			expect(allowOrigin).toBe("*");
			expect(credentials).toBeNull();
		});
	}
});

describe("owner session auth is scoped to configuration", () => {
	const SESSION = "f".repeat(64);

	function ownerEnv() {
		const doCalls: string[] = [];
		const kv: Record<string, unknown> = {
			"face:alice": { username: "alice", apiKey: KEY, githubUser: "alice-gh" },
			[`session:${SESSION}`]: { githubUser: "alice-gh", githubAvatar: "", createdAt: "now" },
		};
		return {
			doCalls,
			env: {
				FACE_ROOM: {
					idFromName: (name: string) => ({ name }),
					get: () => ({
						fetch: (req: Request) => {
							doCalls.push(new URL(req.url).pathname);
							return Promise.resolve(Response.json({ reached: true }));
						},
					}),
				},
				FACE_REGISTRY: {
					get: async (k: string) => kv[k] ?? null,
					put: async () => {},
				},
				FACE_API_KEY: "",
				OPENCLAW_GATEWAY_URL: "",
				OPENCLAW_GATEWAY_TOKEN: "",
				OPENCLAW_SESSION_KEY: "",
				// OAuth configured, so session auth is live
				GITHUB_CLIENT_ID: "cid",
				GITHUB_CLIENT_SECRET: "csecret",
			},
		};
	}

	const asOwner = (path: string, init: RequestInit = {}) => {
		const { env, doCalls } = ownerEnv();
		const headers = { ...(init.headers || {}), Cookie: `oface_session=${SESSION}` };
		// biome-ignore lint/suspicious/noExplicitAny: test env double
		return worker.fetch(req(path, { ...init, headers }), env as any).then((res) => ({ res, doCalls }));
	};

	test("the owner may configure their own face with only a session", async () => {
		const { res } = await asOwner("/alice/api/config", {
			method: "PUT",
			body: JSON.stringify({ face: "kawaii" }),
			headers: { "Content-Type": "application/json" },
		});
		expect(res.status).toBe(200);
	});

	// The control plane must stay key-only — a browser session must never drive a face.
	for (const [path, method] of [
		["/alice/api/state", "POST"],
		["/alice/api/speak", "POST"],
		["/alice/api/audio", "POST"],
		["/alice/api/chat", "POST"],
		["/alice/ws/agent", "GET"],
	] as const) {
		test(`a session alone cannot reach ${method} ${path}`, async () => {
			const { res, doCalls } = await asOwner(path, { method, body: method === "GET" ? undefined : "{}" });
			expect(res.status).toBe(401);
			expect(doCalls).toEqual([]);
		});
	}

	test("a session belonging to someone else is refused", async () => {
		const { env, doCalls } = ownerEnv();
		// biome-ignore lint/suspicious/noExplicitAny: test env double
		(env.FACE_REGISTRY as any).get = async (k: string) =>
			k === "face:alice"
				? { username: "alice", apiKey: KEY, githubUser: "someone-else" }
				: { githubUser: "alice-gh", githubAvatar: "", createdAt: "now" };
		const res = await worker.fetch(
			req("/alice/api/config", {
				method: "PUT",
				body: JSON.stringify({ face: "kawaii" }),
				headers: { Cookie: `oface_session=${SESSION}`, "Content-Type": "application/json" },
			}),
			// biome-ignore lint/suspicious/noExplicitAny: test env double
			env as any,
		);
		expect(res.status).toBe(401);
		expect(doCalls).toEqual([]);
	});

	test("an unresolvable appearance is rejected rather than stored", async () => {
		const { res } = await asOwner("/alice/api/config", {
			method: "PUT",
			body: JSON.stringify({ face: "../../etc/passwd" }),
			headers: { "Content-Type": "application/json" },
		});
		expect(res.status).toBe(400);
	});
});
