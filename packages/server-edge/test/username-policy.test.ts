import { describe, expect, test } from "bun:test";
import { isReservedPathSegment, normalizeUsername, validateClaimUsername } from "../src/username-policy.js";

describe("normalizeUsername", () => {
	test("normalizes to lowercase alphanumeric and hyphen", () => {
		expect(normalizeUsername("Hello.World_123")).toBe("helloworld123");
		expect(normalizeUsername("MY-FACE")).toBe("my-face");
	});
});

describe("validateClaimUsername", () => {
	test("accepts a valid username", () => {
		expect(validateClaimUsername("my-face-1")).toEqual({ ok: true, username: "my-face-1" });
	});

	test("rejects invalid username lengths and malformed hyphens", () => {
		expect(validateClaimUsername("a")).toMatchObject({ ok: false, reason: "invalid" });
		expect(validateClaimUsername("-face")).toMatchObject({ ok: false, reason: "invalid" });
		expect(validateClaimUsername("face-")).toMatchObject({ ok: false, reason: "invalid" });
		expect(validateClaimUsername("face--pack")).toMatchObject({ ok: false, reason: "invalid" });
	});

	test("rejects reserved and blocked usernames", () => {
		expect(validateClaimUsername("api")).toMatchObject({ ok: false, reason: "reserved" });
		expect(validateClaimUsername("my-fuck-face")).toMatchObject({ ok: false, reason: "blocked" });
	});
});

describe("isReservedPathSegment", () => {
	test("detects reserved route segments", () => {
		expect(isReservedPathSegment("auth")).toBe(true);
		expect(isReservedPathSegment("openface")).toBe(true);
		expect(isReservedPathSegment("valid-name")).toBe(false);
	});
});
