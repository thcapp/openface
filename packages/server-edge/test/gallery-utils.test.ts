import { describe, expect, test } from "bun:test";
import { randomSuffix, slugify } from "../src/gallery-utils.js";

describe("slugify", () => {
	test("normalizes names into URL-safe slugs", () => {
		expect(slugify("Space Lobster!!!")).toBe("space-lobster");
		expect(slugify("  A   B  C  ")).toBe("a-b-c");
	});

	test("caps slug length at 40 characters", () => {
		expect(slugify("a".repeat(80)).length).toBe(40);
	});
});

describe("randomSuffix", () => {
	test("returns requested length", () => {
		expect(randomSuffix(6)).toHaveLength(6);
		expect(randomSuffix(10)).toHaveLength(10);
	});

	test("returns lowercase alphanumeric characters", () => {
		expect(randomSuffix(20)).toMatch(/^[a-z0-9]{20}$/);
	});
});
