import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createDefaultGeometry, applyFaceDefinition, createStateColors, createEmotionColors } from "../src/face-loader.js";
import type { FaceDefinition } from "../src/types.js";

describe("createDefaultGeometry", () => {
	test("returns default values", () => {
		const g = createDefaultGeometry();
		expect(g.headShape).toBe("fullscreen");
		expect(g.headW).toBe(0.82);
		expect(g.eyeW).toBe(0.06);
		expect(g.eyeH).toBe(0.08);
		expect(g.eyeSpacing).toBe(0.16);
		expect(g.featureColor).toBe("#111111");
		expect(g.headFillColor).toBeNull();
		expect(g.specularColor).toBe("#FFFFFF");
		expect(g.bodyEnabled).toBe(false);
		expect(g.bodyShape).toBe("capsule");
	});

	test("returns new object each call", () => {
		const a = createDefaultGeometry();
		const b = createDefaultGeometry();
		expect(a).not.toBe(b);
		a.eyeW = 999;
		expect(b.eyeW).toBe(0.06);
	});
});

describe("applyFaceDefinition", () => {
	test("overrides geometry from face def", () => {
		const geom = createDefaultGeometry();
		const stateColors = createStateColors();
		const emotionColors = createEmotionColors();

		const def: FaceDefinition = {
			meta: { name: "Test" },
			geometry: {
				eyes: {
					style: "rectangle",
					baseWidth: 0.08,
					baseHeight: 0.1,
					spacing: 0.2,
					verticalPosition: -0.03,
				},
				mouth: { width: 0.2, style: "curve" },
			},
			palette: {
				feature: "#222222",
				states: { idle: "#FF0000" },
			},
		};

		applyFaceDefinition(def, geom, stateColors, emotionColors);

		expect(geom.eyeW).toBe(0.08);
		expect(geom.eyeH).toBe(0.1);
		expect(geom.eyeSpacing).toBe(0.2);
		expect(geom.eyeY).toBe(-0.03);
		expect(geom.eyeStyle).toBe("rectangle");
		expect(geom.mouthW).toBe(0.2);
		expect(geom.featureColor).toBe("#222222");
		expect(stateColors.idle).toBe("#FF0000");
		// Unchanged values
		expect(stateColors.thinking).toBe("#CE93D8");
	});

	test("handles partial definitions", () => {
		const geom = createDefaultGeometry();
		const stateColors = createStateColors();
		const emotionColors = createEmotionColors();

		const def: FaceDefinition = {
			meta: { name: "Minimal" },
			geometry: {
				eyes: { style: "dot", baseWidth: 0.04, baseHeight: 0.04, spacing: 0.12 },
				mouth: { width: 0.1, style: "none" },
			},
			palette: { states: {} },
		};

		applyFaceDefinition(def, geom, stateColors, emotionColors);
		expect(geom.eyeW).toBe(0.04);
		// Brow defaults unchanged since no brows in def
		expect(geom.browThick).toBe(0.18);
	});

	test("rejects unsupported eye style values", () => {
		const geom = createDefaultGeometry();
		const stateColors = createStateColors();
		const emotionColors = createEmotionColors();

		const def = {
			meta: { name: "Legacy Narrow" },
			geometry: {
				eyes: { style: "narrow", baseWidth: 0.06, baseHeight: 0.08, spacing: 0.16 },
				mouth: { width: 0.1, style: "none" },
			},
			palette: { states: {} },
		} as unknown as FaceDefinition;

		expect(() => applyFaceDefinition(def, geom, stateColors, emotionColors)).toThrow(
			/Unsupported geometry\.eyes\.style/,
		);
	});

	test("applies head geometry and palette overrides", () => {
		const geom = createDefaultGeometry();
		const stateColors = createStateColors();
		const emotionColors = createEmotionColors();

		const def: FaceDefinition = {
			meta: { name: "Head Layer" },
			geometry: {
				shape: "fullscreen",
				head: {
					shape: "rounded",
					width: 0.78,
					height: 0.74,
					verticalPosition: -0.02,
					radius: 0.12,
					strokeWidth: 0.006,
				},
				eyes: { style: "oval", baseWidth: 0.06, baseHeight: 0.08, spacing: 0.16 },
				mouth: { width: 0.1, style: "curve" },
			},
			palette: {
				feature: "#1A1A1A",
				head: {
					fill: "#223344",
					stroke: "#445566",
				},
				states: {},
			},
		};

		applyFaceDefinition(def, geom, stateColors, emotionColors);
		expect(geom.headShape).toBe("rounded");
		expect(geom.headW).toBe(0.78);
		expect(geom.headH).toBe(0.74);
		expect(geom.headY).toBe(-0.02);
		expect(geom.headRadius).toBe(0.12);
		expect(geom.headStrokeW).toBe(0.006);
		expect(geom.headFillColor).toBe("#223344");
		expect(geom.headStrokeColor).toBe("#445566");
	});

	test("supports legacy geometry.shape as head shape alias", () => {
		const geom = createDefaultGeometry();
		const stateColors = createStateColors();
		const emotionColors = createEmotionColors();

		const def: FaceDefinition = {
			meta: { name: "Legacy Head Shape" },
			geometry: {
				shape: "circle",
				eyes: { style: "oval", baseWidth: 0.06, baseHeight: 0.08, spacing: 0.16 },
				mouth: { width: 0.1, style: "curve" },
			},
			palette: { states: {} },
		};

		applyFaceDefinition(def, geom, stateColors, emotionColors);
		expect(geom.headShape).toBe("circle");
	});

	test("rejects unsupported geometry.head.shape values", () => {
		const geom = createDefaultGeometry();
		const stateColors = createStateColors();
		const emotionColors = createEmotionColors();
		const def = {
			meta: { name: "Bad Head Shape" },
			geometry: {
				head: {
					shape: "triangle",
				},
				eyes: { style: "oval", baseWidth: 0.06, baseHeight: 0.08, spacing: 0.16 },
				mouth: { width: 0.1, style: "curve" },
			},
			palette: { states: {} },
		} as unknown as FaceDefinition;

		expect(() => applyFaceDefinition(def, geom, stateColors, emotionColors)).toThrow(
			/Unsupported geometry\.head\.shape/,
		);
	});

	test("applies specular shifts even when value is zero", () => {
		const geom = createDefaultGeometry();
		const stateColors = createStateColors();
		const emotionColors = createEmotionColors();

		const def: FaceDefinition = {
			meta: { name: "Zero Specular Shift" },
			geometry: {
				eyes: {
					style: "oval",
					baseWidth: 0.06,
					baseHeight: 0.08,
					spacing: 0.16,
					specular: { shiftX: 0, shiftY: 0 },
				},
				mouth: { width: 0.1, style: "none" },
			},
			palette: { states: {} },
		};

		geom.specularShiftX = 0.25;
		geom.specularShiftY = 0.25;
		applyFaceDefinition(def, geom, stateColors, emotionColors);
		expect(geom.specularShiftX).toBe(0);
		expect(geom.specularShiftY).toBe(0);
	});

	test("rejects deprecated geometry.eyes.highlight", () => {
		const geom = createDefaultGeometry();
		const stateColors = createStateColors();
		const emotionColors = createEmotionColors();

		const def = {
			meta: { name: "Deprecated Eyes Highlight" },
			geometry: {
				eyes: {
					style: "oval",
					baseWidth: 0.06,
					baseHeight: 0.08,
					spacing: 0.16,
					highlight: { size: 0.2 },
				},
				mouth: { width: 0.1, style: "none" },
			},
			palette: { states: {} },
		} as unknown as FaceDefinition;

		expect(() => applyFaceDefinition(def, geom, stateColors, emotionColors)).toThrow(
			/geometry\.eyes\.highlight has been removed/,
		);
	});

	test("rejects deprecated palette.highlight", () => {
		const geom = createDefaultGeometry();
		const stateColors = createStateColors();
		const emotionColors = createEmotionColors();

		const def = {
			meta: { name: "Deprecated Palette Highlight" },
			geometry: {
				eyes: { style: "oval", baseWidth: 0.06, baseHeight: 0.08, spacing: 0.16 },
				mouth: { width: 0.1, style: "none" },
			},
			palette: { states: {}, highlight: "#FFFFFF" },
		} as unknown as FaceDefinition;

		expect(() => applyFaceDefinition(def, geom, stateColors, emotionColors)).toThrow(
			/palette\.highlight has been removed/,
		);
	});

	test("applies animation tuning from face definition", () => {
		const geom = createDefaultGeometry();
		const stateColors = createStateColors();
		const emotionColors = createEmotionColors();

		const def: FaceDefinition = {
			meta: { name: "Anim Tuned" },
			geometry: {
				eyes: { style: "oval", baseWidth: 0.06, baseHeight: 0.08, spacing: 0.16 },
				mouth: { width: 0.1, style: "none" },
			},
			palette: { states: {} },
			animation: {
				blinkInterval: [1.5, 2.5],
				doubleBlink: 0.4,
				colorSpeed: { default: 0.09, alert: 0.2, sleeping: 0.01 },
				lerp: { mouth: 0.45, lookAt: 0.08, lid: 0.5 },
				microExpressions: {
					enabled: false,
					eyeDart: { interval: [4, 10], rangeX: 0.5, rangeY: 0.2, duration: 0.25 },
					mouthTwitch: { interval: [6, 11], range: 0.2 },
				},
			},
		};

		applyFaceDefinition(def, geom, stateColors, emotionColors);
		expect(geom.blinkIntervalOverride).toEqual([1.5, 2.5]);
		expect(geom.doubleBlinkChance).toBe(0.4);
		expect(geom.colorSpeedDefault).toBe(0.09);
		expect(geom.colorSpeedAlert).toBe(0.2);
		expect(geom.colorSpeedSleeping).toBe(0.01);
		expect(geom.lerpMouth).toBe(0.45);
		expect(geom.lerpLookAt).toBe(0.08);
		expect(geom.lerpLid).toBe(0.5);
		expect(geom.microEnabled).toBe(false);
		expect(geom.microGlanceInterval).toEqual([4, 10]);
		expect(geom.microMouthTwitchInterval).toEqual([6, 11]);
		expect(geom.microMouthTwitchRange).toBe(0.2);
	});

	test("stores state and emotion override maps from face definition", () => {
		const geom = createDefaultGeometry();
		const stateColors = createStateColors();
		const emotionColors = createEmotionColors();

		const def: FaceDefinition = {
			meta: { name: "Override Maps" },
			geometry: {
				eyes: { style: "oval", baseWidth: 0.06, baseHeight: 0.08, spacing: 0.16 },
				mouth: { width: 0.1, style: "none" },
			},
			palette: { states: {} },
			states: {
				idle: { mouth: 0.2, brows: [0.1, 0.1] },
			},
			emotionDeltas: {
				happy: { happiness: 0.9 },
			},
		};

		applyFaceDefinition(def, geom, stateColors, emotionColors);
		expect(geom.stateOverrides.idle).toEqual({ mouth: 0.2, brows: [0.1, 0.1] });
		expect(geom.emotionOverrides.happy).toEqual({ happiness: 0.9 });
	});

	test("applies body geometry and palette overrides", () => {
		const geom = createDefaultGeometry();
		const stateColors = createStateColors();
		const emotionColors = createEmotionColors();

		const def: FaceDefinition = {
			meta: { name: "Body Config" },
			geometry: {
				eyes: { style: "oval", baseWidth: 0.06, baseHeight: 0.08, spacing: 0.16 },
				mouth: { width: 0.1, style: "curve" },
				body: {
					enabled: true,
					anchor: { x: 0.03, y: 0.29 },
					shape: "roundedRect",
					width: 0.4,
					height: 0.34,
					radius: 0.06,
					neck: { enabled: true, width: 0.09, height: 0.06, offsetY: -0.2 },
					shoulders: { enabled: true, width: 0.5, slope: 0.07, thickness: 0.05 },
					arms: { enabled: true, style: "line", spread: 0.25, drop: 0.13, bend: 0.08, thickness: 0.02 },
					motion: { breathFollow: 0.6, tiltFollow: 0.5, weightShift: 0.3, idleSway: 0.15, idleSwayRate: 1.2, speakingBob: 0.2 },
					constraints: { maxTilt: 0.04, maxShiftX: 0.05, maxShiftY: 0.04 },
				},
			},
			palette: {
				feature: "#222222",
				states: {},
				body: {
					fill: "#334455",
					stroke: "#223344",
					neck: "#445566",
					arms: "#556677",
					shadow: "#000000",
					shadowAlpha: 0.24,
				},
			},
		};

		applyFaceDefinition(def, geom, stateColors, emotionColors);
		expect(geom.bodyEnabled).toBe(true);
		expect(geom.bodyAnchorX).toBe(0.03);
		expect(geom.bodyAnchorY).toBe(0.29);
		expect(geom.bodyShape).toBe("roundedRect");
		expect(geom.bodyW).toBe(0.4);
		expect(geom.bodyH).toBe(0.34);
		expect(geom.bodyRadius).toBe(0.06);
		expect(geom.bodyArmsStyle).toBe("line");
		expect(geom.bodyMotionIdleSwayRate).toBe(1.2);
		expect(geom.bodyMaxShiftX).toBe(0.05);
		expect(geom.bodyFillColor).toBe("#334455");
		expect(geom.bodyStrokeColor).toBe("#223344");
		expect(geom.bodyNeckColor).toBe("#445566");
		expect(geom.bodyArmsColor).toBe("#556677");
		expect(geom.bodyShadowAlpha).toBe(0.24);
	});

	test("body stroke/neck/arms colors follow feature color when not explicitly set", () => {
		const geom = createDefaultGeometry();
		const stateColors = createStateColors();
		const emotionColors = createEmotionColors();
		const def: FaceDefinition = {
			meta: { name: "Body Feature Follow" },
			geometry: {
				eyes: { style: "oval", baseWidth: 0.06, baseHeight: 0.08, spacing: 0.16 },
				mouth: { width: 0.1, style: "curve" },
				body: { enabled: true, shape: "capsule" },
			},
			palette: {
				feature: "#123456",
				states: {},
				body: { fill: "#334455" },
			},
		};

		applyFaceDefinition(def, geom, stateColors, emotionColors);
		expect(geom.bodyFillColor).toBe("#334455");
		expect(geom.bodyStrokeColor).toBe("#123456");
		expect(geom.bodyNeckColor).toBe("#123456");
		expect(geom.bodyArmsColor).toBe("#123456");
	});

	test("applies explicit mouth renderer mode", () => {
		const geom = createDefaultGeometry();
		const stateColors = createStateColors();
		const emotionColors = createEmotionColors();

		const lineDef: FaceDefinition = {
			meta: { name: "Line Mouth" },
			geometry: {
				eyes: { style: "oval", baseWidth: 0.06, baseHeight: 0.08, spacing: 0.16 },
				mouth: { width: 0.16, style: "curve", renderer: "line" },
			},
			palette: { states: {} },
		};
		applyFaceDefinition(lineDef, geom, stateColors, emotionColors);
		expect(geom.mouthRenderer).toBe("line");

		const fillDef: FaceDefinition = {
			meta: { name: "Fill Mouth" },
			geometry: {
				eyes: { style: "oval", baseWidth: 0.06, baseHeight: 0.08, spacing: 0.16 },
				mouth: { width: 0.16, style: "curve", renderer: "fill" },
			},
			palette: { states: {} },
		};
		applyFaceDefinition(fillDef, geom, stateColors, emotionColors);
		expect(geom.mouthRenderer).toBe("fill");
	});

	test("resets renderer maps correctly when switching between real face packs", () => {
		const root = resolve(import.meta.dir, "../../..");
		const classicDef = JSON.parse(readFileSync(resolve(root, "faces/community/classic.face.json"), "utf8")) as FaceDefinition;
		const defaultDef = JSON.parse(readFileSync(resolve(root, "faces/default.face.json"), "utf8")) as FaceDefinition;

		const geom = createDefaultGeometry();
		const stateColors = createStateColors();
		const emotionColors = createEmotionColors();

		applyFaceDefinition(classicDef, geom, stateColors, emotionColors);
		const classicStateMap = { ...(geom.mouthRendererByState ?? {}) };
		expect(Object.keys(classicStateMap).length).toBeGreaterThan(0);
		expect(geom.mouthRenderer).toBe("line");

		applyFaceDefinition(defaultDef, geom, stateColors, emotionColors);
		const expectedDefaultStateMap = (((defaultDef.geometry?.mouth as Record<string, unknown>)?.rendererByState as Record<string, string>) ?? {});
		const expectedDefaultEmotionMap = (((defaultDef.geometry?.mouth as Record<string, unknown>)?.rendererByEmotion as Record<string, string>) ?? {});
		expect(geom.mouthRenderer).toBe("fill");
		expect(geom.mouthRendererByState).toEqual(expectedDefaultStateMap);
		expect(geom.mouthRendererByEmotion).toEqual(expectedDefaultEmotionMap);
	});

	test("rejects deprecated geometry.mouth.speakingFill", () => {
		const geom = createDefaultGeometry();
		const stateColors = createStateColors();
		const emotionColors = createEmotionColors();

		const def = {
			meta: { name: "Classic Speaking Fill" },
			geometry: {
				eyes: { style: "oval", baseWidth: 0.06, baseHeight: 0.08, spacing: 0.16 },
				mouth: { width: 0.16, style: "curve", renderer: "line", speakingFill: true },
			},
			palette: { states: {} },
		} as unknown as FaceDefinition;

		expect(() => applyFaceDefinition(def, geom, stateColors, emotionColors)).toThrow(
			/geometry\.mouth\.speakingFill has been removed/,
		);
	});

	test("applies rendererByState mouth overrides", () => {
		const geom = createDefaultGeometry();
		const stateColors = createStateColors();
		const emotionColors = createEmotionColors();

		const def: FaceDefinition = {
			meta: { name: "Per-state Mouth" },
			geometry: {
				eyes: { style: "oval", baseWidth: 0.06, baseHeight: 0.08, spacing: 0.16 },
				mouth: {
					width: 0.16,
					style: "curve",
					renderer: "fill",
					rendererByState: { idle: "line", speaking: "fill", thinking: "line" },
				},
			},
			palette: { states: {} },
		};

		applyFaceDefinition(def, geom, stateColors, emotionColors);
		expect(geom.mouthRenderer).toBe("fill");
		expect(geom.mouthRendererByState.idle).toBe("line");
		expect(geom.mouthRendererByState.thinking).toBe("line");
		expect(geom.mouthRendererByState.speaking).toBe("fill");
	});

	test("applies rendererByEmotion mouth overrides", () => {
		const geom = createDefaultGeometry();
		const stateColors = createStateColors();
		const emotionColors = createEmotionColors();

		const def: FaceDefinition = {
			meta: { name: "Per-emotion Mouth" },
			geometry: {
				eyes: { style: "oval", baseWidth: 0.06, baseHeight: 0.08, spacing: 0.16 },
				mouth: {
					width: 0.16,
					style: "curve",
					renderer: "line",
					rendererByEmotion: { excited: "fill", surprised: "fill", skeptical: "line" },
				},
			},
			palette: { states: {} },
		};

		applyFaceDefinition(def, geom, stateColors, emotionColors);
		expect(geom.mouthRenderer).toBe("line");
		expect(geom.mouthRendererByEmotion.excited).toBe("fill");
		expect(geom.mouthRendererByEmotion.surprised).toBe("fill");
		expect(geom.mouthRendererByEmotion.skeptical).toBe("line");
	});

	test("applies brow renderer and per-state/per-emotion overrides", () => {
		const geom = createDefaultGeometry();
		const stateColors = createStateColors();
		const emotionColors = createEmotionColors();

		const def: FaceDefinition = {
			meta: { name: "Brow Renderers" },
			geometry: {
				eyes: { style: "oval", baseWidth: 0.06, baseHeight: 0.08, spacing: 0.16 },
				mouth: { width: 0.16, style: "curve" },
				brows: {
					enabled: true,
					renderer: "flat",
					rendererByState: { puzzled: "line", sleeping: "none" },
					rendererByEmotion: { skeptical: "block" },
				},
			},
			palette: { states: {} },
		};

		applyFaceDefinition(def, geom, stateColors, emotionColors);
		expect(geom.browRenderer).toBe("flat");
		expect(geom.browRendererByState.puzzled).toBe("line");
		expect(geom.browRendererByState.sleeping).toBe("none");
		expect(geom.browRendererByEmotion.skeptical).toBe("block");
	});

	test("maps brows.enabled=false to brow renderer none", () => {
		const geom = createDefaultGeometry();
		const stateColors = createStateColors();
		const emotionColors = createEmotionColors();

		const def: FaceDefinition = {
			meta: { name: "No Brows" },
			geometry: {
				eyes: { style: "oval", baseWidth: 0.06, baseHeight: 0.08, spacing: 0.16 },
				mouth: { width: 0.16, style: "curve" },
				brows: { enabled: false },
			},
			palette: { states: {} },
		};

		applyFaceDefinition(def, geom, stateColors, emotionColors);
		expect(geom.browRenderer).toBe("none");
	});

	test("applies locks and constraints from geometry", () => {
		const geom = createDefaultGeometry();
		const stateColors = createStateColors();
		const emotionColors = createEmotionColors();

		const def: FaceDefinition = {
			meta: { name: "Locks + Constraints" },
			geometry: {
				eyes: {
					style: "oval",
					baseWidth: 0.06,
					baseHeight: 0.08,
					spacing: 0.16,
					constraints: { scaleMin: 0.9, scaleMax: 1.2 },
				},
				mouth: {
					width: 0.16,
					style: "curve",
					constraints: { openMin: 0.05, openMax: 0.8, widthMin: -0.2, widthMax: 0.2 },
				},
				brows: {
					constraints: { min: -0.4, max: 0.6 },
				},
				locks: { eyes: true, mouth: false, brows: true },
			},
			palette: { states: {} },
		};

		applyFaceDefinition(def, geom, stateColors, emotionColors);
		expect(geom.lockEyes).toBe(true);
		expect(geom.lockMouth).toBe(false);
		expect(geom.lockBrows).toBe(true);
		expect(geom.eyeScaleMin).toBe(0.9);
		expect(geom.eyeScaleMax).toBe(1.2);
		expect(geom.mouthOpenMin).toBe(0.05);
		expect(geom.mouthOpenMax).toBe(0.8);
		expect(geom.mouthWidthMin).toBe(-0.2);
		expect(geom.mouthWidthMax).toBe(0.2);
		expect(geom.browMin).toBe(-0.4);
		expect(geom.browMax).toBe(0.6);
	});

	test("applies pupil, specular, and eyelid settings", () => {
		const geom = createDefaultGeometry();
		const stateColors = createStateColors();
		const emotionColors = createEmotionColors();

		const def: FaceDefinition = {
			meta: { name: "Eye Submodules" },
			geometry: {
				eyes: {
					style: "oval",
					baseWidth: 0.06,
					baseHeight: 0.08,
					spacing: 0.16,
					specular: { enabled: true, size: 0.16, shiftX: 0.3, shiftY: 0.25, lookFollow: 0.1, alpha: 0.9 },
					pupil: { enabled: true, size: 0.25, shiftX: 0.4, shiftY: 0.45, lookFollow: 0.9, color: "#112233" },
					eyelid: { renderer: "cover", strength: 0.7, color: "#223344" },
				},
				mouth: { width: 0.16, style: "curve" },
			},
			palette: { states: {} },
		};

		applyFaceDefinition(def, geom, stateColors, emotionColors);
		expect(geom.specularEnabled).toBe(true);
		expect(geom.specularSize).toBe(0.16);
		expect(geom.specularShiftX).toBe(0.3);
		expect(geom.specularShiftY).toBe(0.25);
		expect(geom.specularLookFollow).toBe(0.1);
		expect(geom.specularAlpha).toBe(0.9);
		expect(geom.pupilEnabled).toBe(true);
		expect(geom.pupilSize).toBe(0.25);
		expect(geom.pupilShiftX).toBe(0.4);
		expect(geom.pupilShiftY).toBe(0.45);
		expect(geom.pupilLookFollow).toBe(0.9);
		expect(geom.pupilColor).toBe("#112233");
		expect(geom.eyelidRenderer).toBe("cover");
		expect(geom.eyelidStrength).toBe(0.7);
		expect(geom.eyelidColor).toBe("#223344");
	});

	test("loads accessories and expands mirrorX antennas", () => {
		const geom = createDefaultGeometry();
		const stateColors = createStateColors();
		const emotionColors = createEmotionColors();

		const def: FaceDefinition = {
			meta: { name: "Accessories" },
			geometry: {
				eyes: { style: "oval", baseWidth: 0.06, baseHeight: 0.08, spacing: 0.16 },
				mouth: { width: 0.16, style: "curve" },
			},
			palette: { states: {} },
			accessories: [
				{
					id: "ant",
					type: "antenna",
					anchor: { x: 0.12, y: -0.18 },
					segments: 4,
					segmentLength: 0.06,
					restAngle: 35,
					restCurve: 0.4,
					tipCurl: 0.25,
					symmetry: "mirrorX",
					physics: { enabled: true },
				},
				{
					id: "glasses",
					type: "glasses",
					anchor: { x: 0, y: -0.02 },
					shape: "round",
					layer: "overlay",
				},
			],
		};

		applyFaceDefinition(def, geom, stateColors, emotionColors);
		expect(geom.accessories.length).toBe(3);
		expect(geom.accessories[0]?.id).toBe("ant");
		expect(geom.accessories[0]?.type).toBe("antenna");
		if (geom.accessories[0]?.type === "antenna") {
			expect(geom.accessories[0].restAngle).toBe(35);
			expect(geom.accessories[0].restCurve).toBe(0.4);
			expect(geom.accessories[0].tipCurl).toBe(0.25);
		}
		expect(geom.accessories[1]?.id).toBe("ant--mirror");
		expect(geom.accessories[1]?.anchor.x).toBe(-0.12);
		expect(geom.accessories[2]?.id).toBe("glasses");
	});

	test("rejects antenna rest pose values outside allowed ranges", () => {
		const geom = createDefaultGeometry();
		const stateColors = createStateColors();
		const emotionColors = createEmotionColors();
		const def = {
			meta: { name: "Bad Antenna Pose" },
			geometry: {
				eyes: { style: "oval", baseWidth: 0.06, baseHeight: 0.08, spacing: 0.16 },
				mouth: { width: 0.16, style: "curve" },
			},
			palette: { states: {} },
			accessories: [
				{
					id: "ant",
					type: "antenna",
					anchor: { x: 0.12, y: -0.18 },
					segments: 4,
					segmentLength: 0.06,
					restAngle: 99,
				},
			],
		} as unknown as FaceDefinition;

		expect(() => applyFaceDefinition(def, geom, stateColors, emotionColors)).toThrow(
			/restAngle must be between -85 and 85/,
		);
	});

	test("rejects duplicate accessory ids", () => {
		const geom = createDefaultGeometry();
		const stateColors = createStateColors();
		const emotionColors = createEmotionColors();

		const def = {
			meta: { name: "Dup Accessories" },
			geometry: {
				eyes: { style: "oval", baseWidth: 0.06, baseHeight: 0.08, spacing: 0.16 },
				mouth: { width: 0.16, style: "curve" },
			},
			palette: { states: {} },
			accessories: [
				{
					id: "dup",
					type: "glasses",
					anchor: { x: 0, y: 0 },
					shape: "round",
				},
				{
					id: "dup",
					type: "antenna",
					anchor: { x: 0.1, y: -0.1 },
					segments: 4,
					segmentLength: 0.05,
				},
			],
		} as unknown as FaceDefinition;

		expect(() => applyFaceDefinition(def, geom, stateColors, emotionColors)).toThrow(
			/duplicate id/,
		);
	});

	test("rejects accessories beyond maximum count", () => {
		const geom = createDefaultGeometry();
		const stateColors = createStateColors();
		const emotionColors = createEmotionColors();

		const accessories = Array.from({ length: 9 }, (_, i) => ({
			id: `g-${i}`,
			type: "glasses" as const,
			anchor: { x: 0, y: 0 },
			shape: "round" as const,
		}));
		const def = {
			meta: { name: "Too Many Accessories" },
			geometry: {
				eyes: { style: "oval", baseWidth: 0.06, baseHeight: 0.08, spacing: 0.16 },
				mouth: { width: 0.16, style: "curve" },
			},
			palette: { states: {} },
			accessories,
		} as unknown as FaceDefinition;

		expect(() => applyFaceDefinition(def, geom, stateColors, emotionColors)).toThrow(
			/exceeds max count/,
		);
	});

	test("rejects accessories that exceed dynamic point budget", () => {
		const geom = createDefaultGeometry();
		const stateColors = createStateColors();
		const emotionColors = createEmotionColors();

		const def = {
			meta: { name: "Accessory Point Overflow" },
			geometry: {
				eyes: { style: "oval", baseWidth: 0.06, baseHeight: 0.08, spacing: 0.16 },
				mouth: { width: 0.16, style: "curve" },
			},
			palette: { states: {} },
			accessories: [
				{ id: "a1", type: "antenna", anchor: { x: -0.2, y: -0.2 }, segments: 8, segmentLength: 0.05, physics: { enabled: true } },
				{ id: "a2", type: "antenna", anchor: { x: -0.1, y: -0.2 }, segments: 8, segmentLength: 0.05, physics: { enabled: true } },
				{ id: "a3", type: "antenna", anchor: { x: 0.0, y: -0.2 }, segments: 8, segmentLength: 0.05, physics: { enabled: true } },
				{ id: "a4", type: "antenna", anchor: { x: 0.1, y: -0.2 }, segments: 8, segmentLength: 0.05, physics: { enabled: true } },
				{ id: "a5", type: "antenna", anchor: { x: 0.2, y: -0.2 }, segments: 8, segmentLength: 0.05, physics: { enabled: true } },
				{ id: "a6", type: "antenna", anchor: { x: 0.3, y: -0.2 }, segments: 8, segmentLength: 0.05, physics: { enabled: true } },
				{ id: "a7", type: "antenna", anchor: { x: 0.4, y: -0.2 }, segments: 8, segmentLength: 0.05, physics: { enabled: true } },
				{ id: "a8", type: "antenna", anchor: { x: 0.5, y: -0.2 }, segments: 8, segmentLength: 0.05, physics: { enabled: true } },
			],
		} as unknown as FaceDefinition;

		expect(() => applyFaceDefinition(def, geom, stateColors, emotionColors)).toThrow(
			/dynamic point budget exceeded/,
		);
	});
});
