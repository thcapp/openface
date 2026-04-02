import { describe, expect, test } from "bun:test";
import { computeSceneFrame, computeSpecularCenter, resolveBrowRenderer, resolveFaceColor, resolveMouthRenderer } from "../src/draw.js";
import { createDefaultGeometry } from "../src/face-loader.js";

describe("computeSceneFrame", () => {
	test("keeps fullscreen packs at base scale when no bounded layers exist", () => {
		const geom = createDefaultGeometry();
		geom.headShape = "fullscreen";
		geom.bodyEnabled = false;
		geom.accessories = [];
		const frame = computeSceneFrame(1280, 720, geom);
		expect(frame.scale).toBe(1);
		expect(frame.unit).toBe(720);
		expect(frame.cx).toBe(640);
		expect(frame.cy).toBe(360);
	});

	test("shrinks and recenters when bounded head/body/accessories exceed safe frame", () => {
		const geom = createDefaultGeometry();
		geom.headShape = "rounded";
		geom.headW = 0.9;
		geom.headH = 0.9;
		geom.headY = -0.08;
		geom.bodyEnabled = true;
		geom.bodyW = 0.45;
		geom.bodyH = 0.36;
		geom.bodyAnchorY = 0.36;
		geom.bodyArmsEnabled = true;
		geom.bodyArmsStyle = "arc";
		geom.bodyArmsSpread = 0.34;
		geom.bodyArmsDrop = 0.22;
		geom.accessories = [
			{
				id: "ant",
				type: "antenna",
				anchor: { x: 0.18, y: -0.24 },
				segments: 7,
				segmentLength: 0.07,
				enabled: true,
				layer: "front",
			},
		];
		const frame = computeSceneFrame(640, 360, geom);
		expect(frame.scale).toBeLessThan(1);
		expect(frame.unit).toBeLessThan(360);
		expect(Math.abs(frame.cy - 180)).toBeLessThan(40);
		expect(frame.bounds.maxY).toBeGreaterThan(geom.headY + geom.headH * 0.5);
	});
});

describe("computeSpecularCenter", () => {
	test("uses pack specular shift as base position", () => {
		const center = computeSpecularCenter(
			"oval",
			100, 50, 20, 12, 10,
			0, 0,
			0.25, 0.25,
			0,
			4, 3,
		);
		expect(center.x).toBeLessThan(100);
		expect(center.y).toBeLessThan(50);
	});

	test("keeps specular inside eye bounds", () => {
		const center = computeSpecularCenter(
			"oval",
			100, 50, 20, 12, 10,
			1, 1,
			1, 1,
			1,
			4, 3,
		);
		expect(center.x).toBeLessThanOrEqual(116);
		expect(center.x).toBeGreaterThanOrEqual(84);
		expect(center.y).toBeLessThanOrEqual(57);
		expect(center.y).toBeGreaterThanOrEqual(41);
	});

	test("keeps oval specular center within curved eye profile", () => {
		const center = computeSpecularCenter(
			"oval",
			100, 50, 20, 6, 6,
			1, 1,
			1, 1,
			1,
			5, 2,
		);
		const dx = center.x - 100;
		const dy = center.y - 50;
		// Inside shrunken ellipse bounds (allow tiny floating error).
		const ellipseValue = (dx * dx) / (15 * 15) + (dy * dy) / (4 * 4);
		expect(ellipseValue).toBeLessThanOrEqual(1.0001);
	});

	test("supports decoupled gaze follow for pupil/specular separation", () => {
		const fixed = computeSpecularCenter(
			"oval",
			100, 50, 20, 12, 10,
			1, 0,
			0.5, 0.5,
			0,
			2, 2,
		);
		const following = computeSpecularCenter(
			"oval",
			100, 50, 20, 12, 10,
			1, 0,
			0.5, 0.5,
			1,
			2, 2,
		);
		expect(following.x).toBeLessThan(fixed.x);
		expect(following.y).toBe(fixed.y);
	});
});

describe("resolveFaceColor", () => {
	test("blends state and emotion palette colors by intensity and blend factor", () => {
		const color = resolveFaceColor(
			{
				state: "idle",
				emotion: "happy",
				emotionSecondary: "neutral",
				emotionBlend: 0,
				intensity: 1,
				amplitude: 0,
				lookX: 0,
				lookY: 0,
				color: null,
				winkLeft: 0,
				winkRight: 0,
				progress: null,
			},
			{ idle: "#000000" },
			{ neutral: null, happy: "#ffffff" },
			0.5,
		);
		expect(color).toBe("#808080");
	});

	test("returns explicit override color when provided", () => {
		const color = resolveFaceColor(
			{
				state: "idle",
				emotion: "happy",
				emotionSecondary: "neutral",
				emotionBlend: 0,
				intensity: 1,
				amplitude: 0,
				lookX: 0,
				lookY: 0,
				color: "#112233",
				winkLeft: 0,
				winkRight: 0,
				progress: null,
			},
			{ idle: "#000000" },
			{ neutral: null, happy: "#ffffff" },
			0.5,
		);
		expect(color).toBe("#112233");
	});
});

describe("resolveMouthRenderer", () => {
	test("uses emotion override to force fill over line base", () => {
		const geom = createDefaultGeometry();
		geom.mouthRenderer = "line";
		geom.mouthRendererByEmotion.excited = "fill";
		const renderer = resolveMouthRenderer(geom, "idle", "excited", "neutral", 0);
		expect(renderer).toBe("fill");
	});

	test("uses state override when emotion has no override", () => {
		const geom = createDefaultGeometry();
		geom.mouthRenderer = "line";
		geom.mouthRendererByState.alert = "fill";
		const renderer = resolveMouthRenderer(geom, "alert", "neutral", "neutral", 0);
		expect(renderer).toBe("fill");
	});
});

describe("resolveBrowRenderer", () => {
	test("uses brow state override first", () => {
		const geom = createDefaultGeometry();
		geom.browRenderer = "line";
		geom.browRendererByState.alert = "flat";
		geom.browRendererByEmotion.excited = "block";
		const renderer = resolveBrowRenderer(geom, "alert", "excited", "neutral", 0);
		expect(renderer).toBe("flat");
	});

	test("uses brow emotion override when state override is absent", () => {
		const geom = createDefaultGeometry();
		geom.browRenderer = "line";
		geom.browRendererByEmotion.skeptical = "block";
		const renderer = resolveBrowRenderer(geom, "idle", "skeptical", "neutral", 0);
		expect(renderer).toBe("block");
	});
});
