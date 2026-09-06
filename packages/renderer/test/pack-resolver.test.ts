import { describe, expect, test } from "bun:test";
import { parsePackRef, resolvePack, serializePackRef, validatePack } from "../src/pack-resolver.js";

const validPack = {
	meta: { name: "Test Face" },
	geometry: { eyes: { style: "oval", baseWidth: 0.04, baseHeight: 0.12, spacing: 0.16 } },
	palette: { feature: "#111111" },
};

const source = (opts: { builtin?: unknown; gallery?: unknown; throws?: boolean } = {}) => ({
	builtin: async () => {
		if (opts.throws) throw new Error("network down");
		return opts.builtin ?? null;
	},
	gallery: async () => {
		if (opts.throws) throw new Error("network down");
		return opts.gallery ?? null;
	},
});

describe("validatePack", () => {
	test("accepts a structurally valid pack", () => {
		const r = validatePack(validPack);
		expect(r.ok).toBe(true);
	});

	test("does not mutate its input", () => {
		const input = structuredClone(validPack);
		const before = JSON.stringify(input);
		validatePack(input);
		expect(JSON.stringify(input)).toBe(before);
	});

	test("reports every missing section rather than the first", () => {
		const r = validatePack({});
		expect(r.ok).toBe(false);
		if (!r.ok) {
			expect(r.errors).toContain("meta is required");
			expect(r.errors).toContain("palette is required");
			expect(r.errors).toContain("geometry is required");
		}
	});

	test("rejects non-finite eye dimensions", () => {
		const bad = structuredClone(validPack);
		// biome-ignore lint/suspicious/noExplicitAny: deliberately invalid input
		(bad.geometry.eyes as any).baseWidth = Number.NaN;
		const r = validatePack(bad);
		expect(r.ok).toBe(false);
	});

	test("rejects non-objects", () => {
		for (const bad of [null, undefined, "default", 42, []]) {
			expect(validatePack(bad).ok).toBe(false);
		}
	});
});

describe("parsePackRef", () => {
	test("a bare string is a builtin, so existing records keep working", () => {
		expect(parsePackRef("default")).toEqual({ kind: "builtin", id: "default" });
	});

	test("a gallery: prefix is a gallery reference", () => {
		expect(parsePackRef("gallery:abc123")).toEqual({ kind: "gallery", id: "abc123" });
	});

	test("an inline definition becomes a snapshot", () => {
		const ref = parsePackRef(validPack);
		expect(ref?.kind).toBe("snapshot");
	});

	test("explicit refs round-trip through serialization", () => {
		for (const ref of [
			{ kind: "builtin", id: "kawaii" },
			{ kind: "gallery", id: "xyz789" },
		] as const) {
			expect(parsePackRef(serializePackRef(ref))).toEqual(ref);
		}
	});

	test("rejects ids that could escape their namespace", () => {
		for (const bad of ["../../etc/passwd", "gallery:../x", "UPPER", "has space", "", "  "]) {
			expect(parsePackRef(bad)).toBeNull();
		}
	});

	test("rejects an inline object that is not a valid face", () => {
		expect(parsePackRef({ meta: { name: "x" } })).toBeNull();
	});
});

describe("resolvePack", () => {
	test("a snapshot resolves without any fetch", async () => {
		const ref = parsePackRef(validPack);
		const r = await resolvePack(ref, source());
		expect(r.ok).toBe(true);
		if (r.ok) expect(r.pack.meta.name).toBe("Test Face");
	});

	test("a builtin resolves through the source", async () => {
		const r = await resolvePack({ kind: "builtin", id: "default" }, source({ builtin: validPack }));
		expect(r.ok).toBe(true);
	});

	// The gallery API returns the record with the definition nested under `pack`.
	test("a gallery record is unwrapped from its envelope", async () => {
		const r = await resolvePack(
			{ kind: "gallery", id: "abc" },
			source({ gallery: { id: "abc", name: "Published", pack: validPack } }),
		);
		expect(r.ok).toBe(true);
		if (r.ok) expect(r.pack.meta.name).toBe("Test Face");
	});

	// The whole point: never present a different character as success.
	test("a missing pack fails explicitly instead of falling back to Default", async () => {
		const r = await resolvePack({ kind: "gallery", id: "gone" }, source());
		expect(r.ok).toBe(false);
		if (!r.ok) expect(r.error).toContain("not found");
	});

	test("a fetch failure fails explicitly", async () => {
		const r = await resolvePack({ kind: "builtin", id: "default" }, source({ throws: true }));
		expect(r.ok).toBe(false);
		if (!r.ok) expect(r.error).toContain("Could not load");
	});

	test("a malformed stored pack fails with field detail", async () => {
		const r = await resolvePack({ kind: "gallery", id: "bad" }, source({ gallery: { pack: { meta: {} } } }));
		expect(r.ok).toBe(false);
		if (!r.ok) expect(r.error).toContain("not a valid face");
	});

	test("a null reference fails rather than defaulting", async () => {
		const r = await resolvePack(null, source({ builtin: validPack }));
		expect(r.ok).toBe(false);
	});
});
