import { describe, expect, test } from "bun:test";
import { dlerp, hexToRGB, rgbToHex, brighten } from "../src/math.js";

describe("dlerp", () => {
	test("returns current when speed is 0", () => {
		expect(dlerp(0.5, 1.0, 0, 1 / 60)).toBeCloseTo(0.5, 5);
	});

	test("approaches target over time", () => {
		let val = 0;
		for (let i = 0; i < 60; i++) val = dlerp(val, 1.0, 0.1, 1 / 60);
		expect(val).toBeGreaterThan(0.5);
		expect(val).toBeLessThan(1.0);
	});

	test("reaches target with high speed", () => {
		let val = 0;
		for (let i = 0; i < 60; i++) val = dlerp(val, 1.0, 0.5, 1 / 60);
		expect(val).toBeCloseTo(1.0, 2);
	});

	test("is frame-rate independent", () => {
		// 60 frames at 1/60s should roughly equal 30 frames at 1/30s
		let val60 = 0;
		for (let i = 0; i < 60; i++) val60 = dlerp(val60, 1.0, 0.1, 1 / 60);

		let val30 = 0;
		for (let i = 0; i < 30; i++) val30 = dlerp(val30, 1.0, 0.1, 1 / 30);

		expect(Math.abs(val60 - val30)).toBeLessThan(0.01);
	});
});

describe("hexToRGB", () => {
	test("converts standard hex colors", () => {
		expect(hexToRGB("#4FC3F7")).toEqual([79, 195, 247]);
		expect(hexToRGB("#000000")).toEqual([0, 0, 0]);
		expect(hexToRGB("#FFFFFF")).toEqual([255, 255, 255]);
		expect(hexToRGB("#FF0000")).toEqual([255, 0, 0]);
	});
});

describe("rgbToHex", () => {
	test("converts RGB back to hex", () => {
		expect(rgbToHex(79, 195, 247)).toBe("#4fc3f7");
		expect(rgbToHex(0, 0, 0)).toBe("#000000");
		expect(rgbToHex(255, 255, 255)).toBe("#ffffff");
	});

	test("rounds values", () => {
		expect(rgbToHex(79.4, 195.6, 247.2)).toBe("#4fc4f7");
	});
});

describe("brighten", () => {
	test("adds brightness clamped to 255", () => {
		expect(brighten(100, 200, 250, 20)).toEqual([120, 220, 255]);
	});

	test("clamps at 255", () => {
		expect(brighten(250, 250, 250, 20)).toEqual([255, 255, 255]);
	});
});
