import { describe, expect, test } from "bun:test";
import { claimHandler } from "../src/durable-object.js";

/**
 * These cover the ownership logic. The serialization itself is a Cloudflare
 * guarantee — handlers for one Durable Object id run one at a time — and is not
 * reproducible in a unit test; what is tested here is that the logic placed inside
 * that serialized region decides ownership correctly and leaves no partial state.
 */

function makeCtx(initial?: unknown) {
	const store = new Map<string, unknown>();
	if (initial) store.set("claim", initial);
	return {
		storage: {
			get: async (k: string) => store.get(k),
			put: async (k: string, v: unknown) => void store.set(k, v),
			delete: async (k: string) => void store.delete(k),
		},
		_store: store,
	};
}

function makeKv(seed?: Record<string, unknown>, opts: { failWrites?: boolean } = {}) {
	const kv = new Map<string, string>();
	if (seed) for (const [k, v] of Object.entries(seed)) kv.set(k, JSON.stringify(v));
	return {
		get: async (k: string, _t?: string) => (kv.has(k) ? JSON.parse(kv.get(k) as string) : null),
		put: async (k: string, v: string) => {
			if (opts.failWrites) throw new Error("KV unavailable");
			kv.set(k, v);
		},
		_kv: kv,
	};
}

const req = (body: unknown) =>
	new Request("https://face.internal/internal/claim", {
		method: "POST",
		body: JSON.stringify(body),
	});

// biome-ignore lint/suspicious/noExplicitAny: test doubles for the Workers runtime
const run = (ctx: any, env: any, body: unknown) => claimHandler(ctx, env, req(body));

describe("claim ownership", () => {
	test("a free username is claimed and written to both stores", async () => {
		const ctx = makeCtx();
		const kv = makeKv();
		const res = await run(ctx, { FACE_REGISTRY: kv }, { username: "alice", face: "default" });

		expect(res.status).toBe(200);
		const { record } = await res.json() as { record: { apiKey: string; username: string } };
		expect(record.username).toBe("alice");
		expect(record.apiKey).toStartWith("oface_ak_");
		expect(ctx._store.get("claim")).toBeTruthy();
		expect(kv._kv.has("face:alice")).toBe(true);
	});

	test("a second claim for the same name is refused", async () => {
		const ctx = makeCtx();
		const kv = makeKv();
		const first = await run(ctx, { FACE_REGISTRY: kv }, { username: "alice" });
		const second = await run(ctx, { FACE_REGISTRY: kv }, { username: "alice" });

		expect(first.status).toBe(200);
		expect(second.status).toBe(409);
	});

	// Exactly one owner, exactly one key — the property the KV version violated.
	test("only the first of many claims yields a key", async () => {
		const ctx = makeCtx();
		const kv = makeKv();
		const results = [];
		for (let i = 0; i < 5; i++) results.push(await run(ctx, { FACE_REGISTRY: kv }, { username: "alice" }));

		const ok = results.filter((r) => r.status === 200);
		expect(ok.length).toBe(1);
		expect(results.filter((r) => r.status === 409).length).toBe(4);

		const stored = ctx._store.get("claim") as { apiKey: string };
		const cached = JSON.parse(kv._kv.get("face:alice") as string) as { apiKey: string };
		expect(cached.apiKey).toBe(stored.apiKey);
	});

	test("a pre-existing KV claim is adopted, not displaced", async () => {
		const ctx = makeCtx();
		const kv = makeKv({ "face:alice": { username: "alice", apiKey: "oface_ak_original", face: "default" } });
		const res = await run(ctx, { FACE_REGISTRY: kv }, { username: "alice" });

		expect(res.status).toBe(409);
		// the original owner's key survives untouched
		const cached = JSON.parse(kv._kv.get("face:alice") as string) as { apiKey: string };
		expect(cached.apiKey).toBe("oface_ak_original");
	});

	test("a failed cache write releases the lock instead of stranding an owner", async () => {
		const ctx = makeCtx();
		const kv = makeKv(undefined, { failWrites: true });
		const res = await run(ctx, { FACE_REGISTRY: kv }, { username: "alice" });

		expect(res.status).toBe(503);
		// no lock left behind, so the name can still be claimed once KV recovers
		expect(ctx._store.get("claim")).toBeUndefined();
	});

	test("a malformed body is rejected", async () => {
		const ctx = makeCtx();
		const res = await run(ctx, { FACE_REGISTRY: makeKv() }, {});
		expect(res.status).toBe(400);
	});
});
