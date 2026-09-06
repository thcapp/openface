import { describe, expect, test } from "bun:test";
import { serveFaceViewer } from "../src/face-routes.js";

const validPack = {
	meta: { name: "Published Design" },
	geometry: { eyes: { style: "star", baseWidth: 0.05, baseHeight: 0.1, spacing: 0.18 } },
	palette: { feature: "#FF00AA" },
};

function envWith(seed: Record<string, unknown>) {
	const kv = new Map<string, string>();
	for (const [k, v] of Object.entries(seed)) kv.set(k, JSON.stringify(v));
	return {
		FACE_REGISTRY: {
			get: async (k: string, _t?: string) => (kv.has(k) ? JSON.parse(kv.get(k) as string) : null),
			put: async () => {},
		},
		FACE_API_KEY: "",
		GITHUB_CLIENT_ID: "",
		GITHUB_CLIENT_SECRET: "",
	};
}

// biome-ignore lint/suspicious/noExplicitAny: test env double
const serve = (username: string, env: any) => serveFaceViewer(username, env, {});

/** The inline data block is conditional; the loader script always mentions its id. */
const DATA_BLOCK = '<script type="application/json" id="face-pack-data">';

describe("hosted viewer appearance resolution", () => {
	test("an unclaimed name gets the unclaimed page", async () => {
		const res = await serve("nobody", envWith({}));
		const html = await res.text();
		expect(html).toContain("Available on Open Face");
	});

	test("a bundled pack is passed by name and not inlined", async () => {
		const env = envWith({ "face:alice": { username: "alice", face: "kawaii" } });
		const html = await (await serve("alice", env)).text();
		expect(html).toContain('face="kawaii"');
		expect(html).not.toContain(DATA_BLOCK);
	});

	// The headline defect: a published gallery design rendered as Default.
	test("a gallery appearance is resolved and delivered inline", async () => {
		const env = envWith({
			"face:alice": { username: "alice", face: "gallery:abc123" },
			"gallery:abc123": { id: "abc123", name: "Published Design", pack: validPack },
		});
		const html = await (await serve("alice", env)).text();
		expect(html).toContain(DATA_BLOCK);
		expect(html).toContain("Published Design");
		expect(html).toContain("loadFaceDefinition");
	});

	test("an applied config appearance overrides the claim-time choice", async () => {
		const env = envWith({
			"face:alice": { username: "alice", face: "kawaii", config: { pack: { kind: "snapshot", pack: validPack } } },
		});
		const html = await (await serve("alice", env)).text();
		expect(html).toContain(DATA_BLOCK);
		expect(html).toContain("Published Design");
	});

	// A visible error is recoverable; the wrong character shown as success is not.
	test("an unresolvable appearance says so instead of silently substituting", async () => {
		const env = envWith({ "face:alice": { username: "alice", face: "gallery:missing" } });
		const html = await (await serve("alice", env)).text();
		expect(html).toContain("could not be loaded");
		expect(html).toContain("face-notice");
		expect(html).not.toContain(DATA_BLOCK);
	});

	test("a stored appearance that is not a valid face reports the failure", async () => {
		const env = envWith({
			"face:alice": { username: "alice", face: "gallery:broken" },
			"gallery:broken": { id: "broken", pack: { meta: {} } },
		});
		const html = await (await serve("alice", env)).text();
		expect(html).toContain("could not be loaded");
	});

	// A definition containing "</script>" must not be able to break out of its block.
	test("an inline definition cannot escape its script block", async () => {
		const hostile = structuredClone(validPack);
		hostile.meta.name = "</script><script>alert(1)</script>";
		const env = envWith({
			"face:alice": { username: "alice", face: "gallery:x1" },
			"gallery:x1": { id: "x1", pack: hostile },
		});
		const html = await (await serve("alice", env)).text();
		expect(html).not.toContain("</script><script>alert(1)");
		expect(html).toContain("\\u003c/script");
	});
});

describe("dashboard identity", () => {
	test("the redirect names the account explicitly, and keeps the legacy param", async () => {
		const { serveFaceDashboard } = await import("../src/face-routes.js");
		const res = serveFaceDashboard("alice");
		const loc = new URL(res.headers.get("Location") as string, "https://oface.io");

		expect(res.status).toBe(302);
		expect(loc.searchParams.get("user")).toBe("alice");
		expect(loc.searchParams.get("server")).toBe("wss://oface.io/alice/ws/viewer");
		// still sent so already-deployed dashboards do not regress
		expect(loc.searchParams.get("face")).toBe("alice");
	});
});
