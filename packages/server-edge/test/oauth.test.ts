import { afterEach, describe, expect, test } from "bun:test";
import { handleAuthCallback, handleAuthLogin } from "../src/auth-routes.js";
import {
	buildOAuthStateCookie,
	buildSessionCookie,
	getOAuthStateCookie,
	pkceChallenge,
	safeReturnTo,
} from "../src/auth-session.js";

function makeKv(seed: Record<string, unknown> = {}) {
	const kv = new Map<string, string>();
	for (const [k, v] of Object.entries(seed)) kv.set(k, JSON.stringify(v));
	return {
		get: async (k: string, _t?: string) => (kv.has(k) ? JSON.parse(kv.get(k) as string) : null),
		put: async (k: string, v: string) => void kv.set(k, v),
		delete: async (k: string) => void kv.delete(k),
		_kv: kv,
	};
}

const env = (kv: ReturnType<typeof makeKv>) => ({
	FACE_REGISTRY: kv,
	GITHUB_CLIENT_ID: "cid",
	GITHUB_CLIENT_SECRET: "csecret",
});

const realFetch = globalThis.fetch;
afterEach(() => {
	globalThis.fetch = realFetch;
});

/** Records whether the OAuth token endpoint was reached at all. */
function trackFetch() {
	const calls: string[] = [];
	// biome-ignore lint/suspicious/noExplicitAny: deliberate fetch stub
	(globalThis as any).fetch = async (input: any) => {
		calls.push(String(input));
		return new Response(JSON.stringify({ access_token: "t" }), {
			headers: { "Content-Type": "application/json" },
		});
	};
	return calls;
}

describe("PKCE challenge", () => {
	// RFC 7636 appendix B known-answer vector.
	test("matches the RFC 7636 S256 vector", async () => {
		const challenge = await pkceChallenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk");
		expect(challenge).toBe("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
	});

	test("is base64url with no padding", async () => {
		const challenge = await pkceChallenge("some-verifier-value");
		expect(challenge).not.toContain("+");
		expect(challenge).not.toContain("/");
		expect(challenge).not.toContain("=");
	});
});

describe("return target allowlist", () => {
	test("keeps origins we control", () => {
		expect(safeReturnTo("https://openface.live/builder")).toBe("https://openface.live/builder");
	});

	// An open redirect here would hand the session to whoever asked.
	test("rejects foreign origins", () => {
		expect(safeReturnTo("https://attacker.invalid/steal")).toBe("https://openface.live");
		expect(safeReturnTo("javascript:alert(1)")).toBe("https://openface.live");
		expect(safeReturnTo(null)).toBe("https://openface.live");
	});
});

describe("cookies", () => {
	test("session cookie is HttpOnly, Secure and cross-site capable", () => {
		const c = buildSessionCookie("a".repeat(64));
		expect(c).toContain("HttpOnly");
		expect(c).toContain("Secure");
		expect(c).toContain("SameSite=None");
	});

	test("state cookie is HttpOnly and scoped to /auth", () => {
		const c = buildOAuthStateCookie("b".repeat(64));
		expect(c).toContain("HttpOnly");
		expect(c).toContain("Path=/auth");
	});

	test("state cookie is parsed back out of a Cookie header", () => {
		const state = "c".repeat(64);
		const req = new Request("https://oface.io/auth/callback", {
			headers: { Cookie: `other=1; oface_oauth=${state}; more=2` },
		});
		expect(getOAuthStateCookie(req)).toBe(state);
	});
});

describe("login", () => {
	test("issues state, PKCE challenge and a bound cookie", async () => {
		const kv = makeKv();
		const res = await handleAuthLogin(
			new Request("https://oface.io/auth/login"),
			// biome-ignore lint/suspicious/noExplicitAny: test env double
			env(kv) as any,
		);
		expect(res.status).toBe(302);

		const location = new URL(res.headers.get("Location") as string);
		const state = location.searchParams.get("state") as string;
		expect(state).toMatch(/^[a-f0-9]{64}$/);
		expect(location.searchParams.get("code_challenge_method")).toBe("S256");
		expect(location.searchParams.get("code_challenge")).toBeTruthy();

		// bound to this browser, and the verifier stays server-side
		expect(res.headers.get("Set-Cookie")).toContain(`oface_oauth=${state}`);
		expect(location.searchParams.get("code_verifier")).toBeNull();
		expect(kv._kv.has(`oauthstate:${state}`)).toBe(true);
	});

	test("an allowlisted returnTo is carried through login", async () => {
		const kv = makeKv();
		const res = await handleAuthLogin(
			new Request("https://oface.io/auth/login?returnTo=https://openface.live/builder"),
			// biome-ignore lint/suspicious/noExplicitAny: test env double
			env(kv) as any,
		);
		const state = new URL(res.headers.get("Location") as string).searchParams.get("state") as string;
		const stored = JSON.parse(kv._kv.get(`oauthstate:${state}`) as string);
		expect(stored.returnTo).toBe("https://openface.live/builder");
	});
});

describe("callback state validation", () => {
	const STATE = "d".repeat(64);
	const pending = { verifier: "v", returnTo: "https://openface.live", createdAt: "now" };

	const callback = (opts: { query: string; cookie?: string; kv: ReturnType<typeof makeKv> }) => {
		const url = new URL(`https://oface.io/auth/callback${opts.query}`);
		const req = new Request(url.toString(), {
			headers: opts.cookie ? { Cookie: opts.cookie } : {},
		});
		// biome-ignore lint/suspicious/noExplicitAny: test env double
		return handleAuthCallback(req, url, env(opts.kv) as any);
	};

	// The property that matters: an unsolicited callback must never spend a code.
	test("a missing state never reaches the token endpoint", async () => {
		const calls = trackFetch();
		const res = await callback({ query: "?code=abc", kv: makeKv() });
		expect(res.status).toBe(400);
		expect(calls).toEqual([]);
	});

	test("a state with no matching browser cookie never reaches the token endpoint", async () => {
		const calls = trackFetch();
		const kv = makeKv({ [`oauthstate:${STATE}`]: pending });
		const res = await callback({ query: `?code=abc&state=${STATE}`, kv });
		expect(res.status).toBe(400);
		expect(calls).toEqual([]);
	});

	test("a cookie that disagrees with the query never reaches the token endpoint", async () => {
		const calls = trackFetch();
		const kv = makeKv({ [`oauthstate:${STATE}`]: pending });
		const res = await callback({
			query: `?code=abc&state=${STATE}`,
			cookie: `oface_oauth=${"e".repeat(64)}`,
			kv,
		});
		expect(res.status).toBe(400);
		expect(calls).toEqual([]);
	});

	test("an unknown or expired state never reaches the token endpoint", async () => {
		const calls = trackFetch();
		const res = await callback({
			query: `?code=abc&state=${STATE}`,
			cookie: `oface_oauth=${STATE}`,
			kv: makeKv(), // nothing stored
		});
		expect(res.status).toBe(400);
		expect(calls).toEqual([]);
	});

	// Replay: the same captured callback URL must not work twice.
	test("state is single use", async () => {
		trackFetch();
		const kv = makeKv({ [`oauthstate:${STATE}`]: pending });
		expect(kv._kv.has(`oauthstate:${STATE}`)).toBe(true);

		await callback({ query: `?code=abc&state=${STATE}`, cookie: `oface_oauth=${STATE}`, kv });
		expect(kv._kv.has(`oauthstate:${STATE}`)).toBe(false);

		const calls = trackFetch();
		const replay = await callback({
			query: `?code=abc&state=${STATE}`,
			cookie: `oface_oauth=${STATE}`,
			kv,
		});
		expect(replay.status).toBe(400);
		expect(calls).toEqual([]);
	});
});
