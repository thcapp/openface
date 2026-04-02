/**
 * face-generator.ts — Procedural face pack generation from high-level inputs.
 *
 * Pure functions, no side effects, no DOM. Works in browser and Node/Bun.
 * Generates complete FaceDefinition objects from personality traits, archetypes,
 * or text descriptions using proportional rules, color theory, and an energy
 * function for quality validation.
 */

import type {
	BrowRenderer,
	EyeStyle,
	FaceDefinition,
	FaceEmotion,
	FaceState,
	HeadShape,
	MouthStyle,
} from "./types.js";
import { STATES, EMOTIONS } from "./types.js";
import { hexToRGB, rgbToHex } from "./math.js";

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function lerp(a: number, b: number, t: number): number {
	return a + (b - a) * t;
}

function clamp(val: number, min: number, max: number): number {
	return Math.max(min, Math.min(max, val));
}

// ---------------------------------------------------------------------------
// 1. Color Utilities (HSL)
// ---------------------------------------------------------------------------

/**
 * Convert HSL values to a hex color string.
 * @param h Hue in degrees (0-360)
 * @param s Saturation as percentage (0-100)
 * @param l Lightness as percentage (0-100)
 */
export function hslToHex(h: number, s: number, l: number): string {
	h = ((h % 360) + 360) % 360;
	s = clamp(s, 0, 100) / 100;
	l = clamp(l, 0, 100) / 100;

	const c = (1 - Math.abs(2 * l - 1)) * s;
	const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
	const m = l - c / 2;

	let r = 0, g = 0, b = 0;
	if (h < 60) { r = c; g = x; b = 0; }
	else if (h < 120) { r = x; g = c; b = 0; }
	else if (h < 180) { r = 0; g = c; b = x; }
	else if (h < 240) { r = 0; g = x; b = c; }
	else if (h < 300) { r = x; g = 0; b = c; }
	else { r = c; g = 0; b = x; }

	return rgbToHex(
		Math.round((r + m) * 255),
		Math.round((g + m) * 255),
		Math.round((b + m) * 255),
	);
}

/**
 * Convert a hex color string to HSL values.
 * @returns Tuple of [hue (0-360), saturation (0-100), lightness (0-100)]
 */
export function hexToHSL(hex: string): [number, number, number] {
	const [r, g, b] = hexToRGB(hex);
	const rn = r / 255;
	const gn = g / 255;
	const bn = b / 255;

	const max = Math.max(rn, gn, bn);
	const min = Math.min(rn, gn, bn);
	const delta = max - min;

	let h = 0;
	if (delta !== 0) {
		if (max === rn) h = 60 * (((gn - bn) / delta) % 6);
		else if (max === gn) h = 60 * ((bn - rn) / delta + 2);
		else h = 60 * ((rn - gn) / delta + 4);
	}
	if (h < 0) h += 360;

	const l = (max + min) / 2;
	const s = delta === 0 ? 0 : delta / (1 - Math.abs(2 * l - 1));

	return [Math.round(h * 10) / 10, Math.round(s * 1000) / 10, Math.round(l * 1000) / 10];
}

/**
 * Interpolate between two hex colors in HSL space (shortest hue path).
 * @param a Start color hex
 * @param b End color hex
 * @param t Interpolation factor (0-1)
 */
export function interpolateColorHSL(a: string, b: string, t: number): string {
	const [h1, s1, l1] = hexToHSL(a);
	const [h2, s2, l2] = hexToHSL(b);

	// Shortest hue path
	let dh = h2 - h1;
	if (dh > 180) dh -= 360;
	if (dh < -180) dh += 360;

	const h = ((h1 + dh * t) % 360 + 360) % 360;
	const s = lerp(s1, s2, t);
	const l = lerp(l1, l2, t);

	return hslToHex(h, s, l);
}

/**
 * Compute relative luminance of a hex color per WCAG 2.1.
 * @returns Luminance value (0-1)
 */
export function relativeLuminance(hex: string): number {
	const [r, g, b] = hexToRGB(hex);
	const toLinear = (c: number): number => {
		const s = c / 255;
		return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
	};
	return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
}

/**
 * Compute WCAG contrast ratio between two hex colors.
 * @returns Contrast ratio (1-21)
 */
export function contrastRatio(a: string, b: string): number {
	const la = relativeLuminance(a);
	const lb = relativeLuminance(b);
	const lighter = Math.max(la, lb);
	const darker = Math.min(la, lb);
	return (lighter + 0.05) / (darker + 0.05);
}

// ---------------------------------------------------------------------------
// 2. Palette Generator
// ---------------------------------------------------------------------------

/** Hue offsets from seed for each state. */
const STATE_HUE_OFFSETS: Record<FaceState, number> = {
	idle: 0,
	thinking: 70,
	speaking: 0,
	listening: -80,
	reacting: -170,
	puzzled: -185,
	alert: -200,
	working: 10,
	sleeping: 30,
	waiting: 0,
	loading: 0,
};

/** Saturation multipliers per state. */
const STATE_SAT_MULT: Record<FaceState, number> = {
	idle: 1.0,
	thinking: 0.9,
	speaking: 1.0,
	listening: 0.85,
	reacting: 0.95,
	puzzled: 0.8,
	alert: 0.9,
	working: 0.95,
	sleeping: 0.7,
	waiting: 0.4,
	loading: 0.3,
};

/** Fixed hue targets for emotions (cross-cultural psychological associations). */
const EMOTION_HUE_TARGETS: Record<FaceEmotion, number | null> = {
	neutral: null,
	happy: 48,
	sad: 230,
	confused: 25,
	excited: 15,
	concerned: 220,
	surprised: 55,
	playful: 330,
	frustrated: 0,
	skeptical: 30,
	determined: 130,
	embarrassed: 340,
	proud: 43,
};

/**
 * Generate state background colors from a seed hue.
 * @param seedHue Base hue (0-360)
 * @param saturation Base saturation (0-100)
 * @param lightness Base lightness (0-100)
 */
export function generateStateColors(
	seedHue: number,
	saturation: number,
	lightness: number,
): Record<FaceState, string> {
	const result = {} as Record<FaceState, string>;
	for (const state of STATES) {
		const h = (seedHue + STATE_HUE_OFFSETS[state] + 360) % 360;
		const s = saturation * STATE_SAT_MULT[state];
		result[state] = hslToHex(h, s, lightness);
	}
	return result;
}

/**
 * Generate emotion accent colors.
 * @param baseSaturation Saturation for emotion colors (0-100)
 * @param baseLightness Lightness for emotion colors (0-100)
 */
export function generateEmotionColors(
	baseSaturation: number,
	baseLightness: number,
): Record<FaceEmotion, string | null> {
	const result = {} as Record<FaceEmotion, string | null>;
	for (const emotion of EMOTIONS) {
		const hue = EMOTION_HUE_TARGETS[emotion];
		if (hue === null) {
			result[emotion] = null;
		} else {
			result[emotion] = hslToHex(hue, baseSaturation, baseLightness);
		}
	}
	return result;
}

/**
 * Generate a complete color palette from a seed hue.
 * @param seedHue Base hue (0-360)
 * @param saturation Base saturation (0-100)
 * @param lightness Base lightness (0-100)
 * @param darkFeatures Whether feature color should be light (for dark backgrounds)
 */
export function generateFullPalette(
	seedHue: number,
	saturation: number,
	lightness: number,
	darkFeatures: boolean,
): {
	feature: string;
	stateColors: Record<FaceState, string>;
	emotionColors: Record<FaceEmotion, string | null>;
	blush: string;
	specular: string;
	headFill: string;
	headStroke: string;
} {
	const stateColors = generateStateColors(seedHue, saturation, lightness);
	const emotionColors = generateEmotionColors(
		Math.min(saturation + 10, 100),
		clamp(lightness - 5, 20, 85),
	);

	const feature = darkFeatures ? "#E0E0E0" : "#111111";
	const blush = hslToHex(345, 85, 72);
	const specular = darkFeatures ? "#FFFFFF" : "#FFFFFF";
	const headFill = stateColors.idle;
	const headStroke = darkFeatures ? "#333333" : "#111111";

	return { feature, stateColors, emotionColors, blush, specular, headFill, headStroke };
}

// ---------------------------------------------------------------------------
// 3. Proportional System
// ---------------------------------------------------------------------------

/**
 * Generate proportional geometry from feature scale and variety parameters.
 * @param featureScale Overall feature size (0-1). Higher = larger features, tighter spacing.
 * @param variety Shape variety (0-1). Higher = more aspect ratio variation, wider mouth relative to spacing.
 */
export function generateProportions(
	featureScale: number,
	variety: number,
): {
	eyeW: number;
	eyeH: number;
	eyeSpacing: number;
	eyeY: number;
	mouthW: number;
	mouthY: number;
	headW: number;
	headH: number;
	browVert: number;
} {
	featureScale = clamp(featureScale, 0, 1);
	variety = clamp(variety, 0, 1);

	// Base eye width scales with featureScale
	const eyeW = lerp(0.035, 0.11, featureScale);

	// Eye spacing inversely proportional to featureScale (larger features = tighter)
	const spacingRatio = lerp(2.2, 3.8, 1 - featureScale);
	const eyeSpacing = eyeW * spacingRatio;

	// Eye aspect ratio driven by variety
	const eyeH = eyeW * lerp(0.9, 1.8, variety);

	// Vertical eye position — larger features sit higher
	const eyeY = lerp(-0.03, -0.08, featureScale);

	// Mouth width proportional to eye spacing
	const mouthW = eyeSpacing * lerp(0.7, 1.1, variety);

	// Mouth vertical position relative to eyes
	const mouthY = Math.abs(eyeY) + eyeH * lerp(1.8, 2.5, variety);

	// Head must contain all features with margin
	const minHeadW = eyeSpacing + 4 * eyeW;
	const headW = Math.max(minHeadW, lerp(0.6, 0.95, featureScale));
	const headH = headW * lerp(0.9, 1.1, variety);

	// Brow position derived from eye height
	const browVert = 1.2 - (eyeH - 0.08) * 0.5;

	return { eyeW, eyeH, eyeSpacing, eyeY, mouthW, mouthY, headW, headH, browVert };
}

// ---------------------------------------------------------------------------
// 4. Personality -> Geometry
// ---------------------------------------------------------------------------

/** Personality trait values. */
export interface Personality {
	energy: number;
	expressiveness: number;
	warmth: number;
	stability: number;
	playfulness: number;
}

interface GeometryPatch {
	eyeStyle?: EyeStyle;
	headShape?: HeadShape;
	browRenderer?: BrowRenderer;
	mouthRenderer?: "fill" | "line";
	eyeH?: number;
	breathAmt?: number;
	headSway?: number;
	browRange?: number;
	blushAlpha?: number;
	blushEnabled?: boolean;
	emotionColorBlend?: number;
	lockEyes?: boolean;
	lockBrows?: boolean;
	eyeScaleMin?: number;
	eyeScaleMax?: number;
	doubleBlinkChance?: number;
	microEnabled?: boolean;
	microJitterRangeX?: number;
	microJitterRangeY?: number;
	animSpeed?: number;
	animRange?: number;
	warmthBias?: number;
	microFreqMult?: number;
	playMult?: number;
}

/**
 * Map personality traits to geometry modifications.
 * Mutates the provided geometry patch object in-place based on personality values.
 *
 * Rules from research:
 * - warmth > 0.7: round eyes, circle head, blush enabled
 * - warmth < 0.3: rectangle eyes, rounded head, no blush
 * - stability > 0.85: lock eyes/brows, narrow constraint ranges
 * - energy: eye height scale, breath amount, head sway
 * - expressiveness: brow range, blush alpha, emotionColorBlend
 * - playfulness: double blink chance, micro-expression range
 */
export function applyPersonalityToGeometry(
	personality: Personality,
	geom: GeometryPatch,
): void {
	const { energy, expressiveness, warmth, stability, playfulness } = personality;

	// --- Warmth → shape and organic details ---
	if (warmth > 0.7) {
		if (!geom.eyeStyle) geom.eyeStyle = "round";
		if (!geom.headShape) geom.headShape = "circle";
		geom.blushEnabled = true;
	} else if (warmth < 0.3) {
		if (!geom.eyeStyle) geom.eyeStyle = "rectangle";
		if (!geom.headShape) geom.headShape = "rounded";
		geom.blushEnabled = false;
	}
	// Mouth width bias from warmth (wider = friendlier) is handled via variety in proportions

	// --- Stability → feature locks and narrow ranges ---
	if (stability > 0.85) {
		geom.lockEyes = true;
		geom.lockBrows = true;
		geom.eyeScaleMin = 0.85;
		geom.eyeScaleMax = 1.15;
	}

	// --- Energy → physical scale and movement ---
	const eyeHScale = lerp(0.85, 1.15, energy);
	if (geom.eyeH !== undefined) geom.eyeH *= eyeHScale;
	geom.breathAmt = lerp(0.005, 0.035, energy);
	geom.headSway = lerp(0.003, 0.02, energy);

	// --- Expressiveness → brow range, blush, color blend ---
	geom.browRange = lerp(0.02, 0.07, expressiveness);
	geom.blushAlpha = lerp(0.05, 0.55, expressiveness);
	geom.emotionColorBlend = lerp(0.15, 0.75, expressiveness);

	// --- Playfulness → double blinks, micro-expression amplitude ---
	geom.doubleBlinkChance = lerp(0.05, 0.35, playfulness);
	geom.microEnabled = playfulness > 0.15;
	geom.microJitterRangeX = lerp(0.08, 0.25, playfulness);
	geom.microJitterRangeY = lerp(0.04, 0.15, playfulness);

	// --- Derived animation params from personality ---
	geom.animSpeed = lerp(0.6, 1.4, energy);
	geom.animRange = lerp(0.4, 1.6, expressiveness);
	geom.warmthBias = lerp(-0.15, 0.15, warmth);
	geom.microFreqMult = lerp(0.5, 2.0, 1 - stability);
	geom.playMult = lerp(0.5, 1.5, playfulness);
}

// ---------------------------------------------------------------------------
// 5. Archetype Definitions
// ---------------------------------------------------------------------------

/** Archetype — a named point in personality/style space. */
export interface Archetype {
	name: string;
	personality: Personality;
	style: {
		eyeStyle: EyeStyle;
		headShape: HeadShape;
		featureScale: number;
		colorSeedHue: number;
		colorSaturation: number;
		colorLightness: number;
		darkFeatures: boolean;
		browRenderer: BrowRenderer;
		mouthRenderer: "fill" | "line";
	};
}

/** Seven archetypes covering the design space. */
export const ARCHETYPES: Archetype[] = [
	{
		name: "Friendly Helper",
		personality: { energy: 0.6, expressiveness: 0.7, warmth: 0.85, stability: 0.5, playfulness: 0.5 },
		style: {
			eyeStyle: "round",
			headShape: "circle",
			featureScale: 0.5,
			colorSeedHue: 200,
			colorSaturation: 65,
			colorLightness: 70,
			darkFeatures: false,
			browRenderer: "line",
			mouthRenderer: "fill",
		},
	},
	{
		name: "Professional",
		personality: { energy: 0.3, expressiveness: 0.3, warmth: 0.4, stability: 0.9, playfulness: 0.15 },
		style: {
			eyeStyle: "oval",
			headShape: "rounded",
			featureScale: 0.4,
			colorSeedHue: 220,
			colorSaturation: 30,
			colorLightness: 35,
			darkFeatures: false,
			browRenderer: "line",
			mouthRenderer: "fill",
		},
	},
	{
		name: "Playful Companion",
		personality: { energy: 0.8, expressiveness: 0.85, warmth: 0.7, stability: 0.25, playfulness: 0.9 },
		style: {
			eyeStyle: "round",
			headShape: "circle",
			featureScale: 0.6,
			colorSeedHue: 330,
			colorSaturation: 70,
			colorLightness: 75,
			darkFeatures: false,
			browRenderer: "line",
			mouthRenderer: "fill",
		},
	},
	{
		name: "Technical Expert",
		personality: { energy: 0.7, expressiveness: 0.4, warmth: 0.15, stability: 0.9, playfulness: 0.1 },
		style: {
			eyeStyle: "rectangle",
			headShape: "rounded",
			featureScale: 0.45,
			colorSeedHue: 150,
			colorSaturation: 80,
			colorLightness: 25,
			darkFeatures: true,
			browRenderer: "flat",
			mouthRenderer: "fill",
		},
	},
	{
		name: "Cute Mascot",
		personality: { energy: 0.85, expressiveness: 0.95, warmth: 1.0, stability: 0.3, playfulness: 0.9 },
		style: {
			eyeStyle: "round",
			headShape: "circle",
			featureScale: 0.7,
			colorSeedHue: 340,
			colorSaturation: 60,
			colorLightness: 80,
			darkFeatures: false,
			browRenderer: "line",
			mouthRenderer: "fill",
		},
	},
	{
		name: "Calm Sage",
		personality: { energy: 0.15, expressiveness: 0.3, warmth: 0.8, stability: 0.95, playfulness: 0.1 },
		style: {
			eyeStyle: "dot",
			headShape: "circle",
			featureScale: 0.3,
			colorSeedHue: 140,
			colorSaturation: 30,
			colorLightness: 70,
			darkFeatures: false,
			browRenderer: "none",
			mouthRenderer: "line",
		},
	},
	{
		name: "Bold Mascot",
		personality: { energy: 0.7, expressiveness: 0.8, warmth: 0.6, stability: 0.5, playfulness: 0.6 },
		style: {
			eyeStyle: "oval",
			headShape: "circle",
			featureScale: 0.55,
			colorSeedHue: 45,
			colorSaturation: 75,
			colorLightness: 65,
			darkFeatures: false,
			browRenderer: "line",
			mouthRenderer: "fill",
		},
	},
];

// ---------------------------------------------------------------------------
// 6. Energy Function (Quality Validator)
// ---------------------------------------------------------------------------

/**
 * Compute quality energy for a generated face. Lower is better.
 *
 * Terms:
 * - E_proportion: penalize spacing/eyeW outside 2.2-3.8, mouthW/spacing outside 0.7-1.1
 * - E_overlap: penalize features colliding vertically
 * - E_balance: penalize off-center feature centroid
 * - E_density: penalize feature area outside 15-35% of head area
 * - E_contrast: penalize feature color < 4.5:1 contrast against lightest state color
 *
 * @returns Energy score (0 = perfect, higher = worse)
 */
export function computeEnergy(
	geom: {
		eyeW: number;
		eyeH: number;
		eyeSpacing: number;
		eyeY: number;
		mouthW: number;
		mouthY: number;
		headW: number;
		headH: number;
		featureColor?: string;
	},
	palette: {
		stateColors?: Record<string, string>;
		feature?: string;
	},
): number {
	let energy = 0;

	const { eyeW, eyeH, eyeSpacing, eyeY, mouthW, mouthY, headW, headH } = geom;

	// E_proportion: spacing/eyeW ratio should be 2.2-3.8
	const spacingRatio = eyeW > 0 ? eyeSpacing / eyeW : 0;
	if (spacingRatio < 2.2) energy += (2.2 - spacingRatio) * 10;
	if (spacingRatio > 3.8) energy += (spacingRatio - 3.8) * 10;

	// E_proportion: mouthW/spacing ratio should be 0.7-1.1
	const mouthRatio = eyeSpacing > 0 ? mouthW / eyeSpacing : 0;
	if (mouthRatio < 0.7) energy += (0.7 - mouthRatio) * 10;
	if (mouthRatio > 1.1) energy += (mouthRatio - 1.1) * 10;

	// E_overlap: eye bottom must not overlap mouth top
	const eyeBottom = Math.abs(eyeY) + eyeH / 2;
	const mouthTop = mouthY - 0.02; // small buffer for mouth height
	if (eyeBottom > mouthTop) {
		energy += (eyeBottom - mouthTop) * 50;
	}

	// E_balance: feature centroid should be near vertical center
	// Eyes at eyeY, mouth at mouthY; centroid in normalized coords
	const featureCentroidY = (eyeY + mouthY) / 2;
	energy += Math.abs(featureCentroidY) * 5;

	// E_density: feature area / head area should be 15-35%
	const eyeArea = 2 * Math.PI * (eyeW / 2) * (eyeH / 2);
	const mouthArea = mouthW * 0.03; // approximate mouth area
	const featureArea = eyeArea + mouthArea;
	const headArea = Math.PI * (headW / 2) * (headH / 2);
	const density = headArea > 0 ? featureArea / headArea : 0;
	if (density < 0.15) energy += (0.15 - density) * 30;
	if (density > 0.35) energy += (density - 0.35) * 30;

	// E_contrast: feature color vs lightest state color
	const featureColor = geom.featureColor ?? palette.feature ?? "#111111";
	const stateColors = palette.stateColors ?? {};
	let lightestLum = 0;
	let lightestColor = "#FFFFFF";
	for (const color of Object.values(stateColors)) {
		const lum = relativeLuminance(color);
		if (lum > lightestLum) {
			lightestLum = lum;
			lightestColor = color;
		}
	}
	const contrast = contrastRatio(featureColor, lightestColor);
	if (contrast < 4.5) {
		energy += (4.5 - contrast) * 5;
	}

	// E_proportion: head must fit features
	const requiredHeadW = eyeSpacing + 4 * eyeW;
	if (headW < requiredHeadW) {
		energy += (requiredHeadW - headW) * 20;
	}

	return energy;
}

// ---------------------------------------------------------------------------
// 7. Main Generator
// ---------------------------------------------------------------------------

/**
 * Build default state overrides for a personality.
 * These set per-state mouth openness, brow positions, lid levels, etc.
 */
function buildStateOverrides(personality: Personality): Record<string, Record<string, unknown>> {
	const { energy, warmth, expressiveness, stability } = personality;

	const browBase = lerp(0.02, 0.08, expressiveness);
	const mouthBase = lerp(0.02, 0.1, energy);

	return {
		idle: {
			mouth: mouthBase,
			happiness: lerp(-0.05, 0.1, warmth),
			brows: [0, 0],
			lid: 1,
		},
		thinking: {
			mouth: 0.02,
			happiness: 0,
			lid: lerp(0.6, 0.85, stability),
			brows: [-browBase * 2, browBase * 5],
			tilt: lerp(0.01, 0.04, 1 - stability),
		},
		working: {
			mouth: 0.02,
			happiness: lerp(0, 0.15, warmth),
			lid: lerp(0.7, 0.9, stability),
			brows: [-browBase, -browBase],
			tilt: -0.01,
		},
		speaking: {
			happiness: lerp(0.05, 0.25, warmth),
			brows: [browBase, browBase],
		},
		listening: {
			mouth: 0.03,
			happiness: lerp(0, 0.15, warmth),
			lid: lerp(1.0, 1.2, expressiveness),
			brows: [browBase * 3, browBase * 3],
			tilt: lerp(0.01, 0.04, expressiveness),
		},
		reacting: {
			mouth: lerp(0.4, 0.8, expressiveness),
			happiness: lerp(0.1, 0.4, warmth),
			lid: 0.8,
			brows: [browBase * 2, browBase * 2],
		},
		puzzled: {
			mouth: 0.05,
			happiness: 0,
			confusion: 1,
			lid: 0.85,
			brows: [-browBase * 4, browBase * 6],
			tilt: lerp(-0.02, -0.05, expressiveness),
		},
		alert: {
			mouth: lerp(0.3, 0.6, energy),
			happiness: -0.3,
			lid: lerp(1.1, 1.4, energy),
			brows: [browBase * 7, browBase * 7],
			shake: lerp(8, 18, energy),
			bounce: lerp(1.02, 1.08, energy),
		},
		sleeping: {
			mouth: 0.02,
			happiness: 0,
			lid: 0,
			brows: [-browBase * 3, -browBase * 3],
			tilt: 0.02,
		},
		waiting: {
			mouth: 0.04,
			happiness: 0,
			lid: 1.05,
			brows: [browBase, browBase],
			tilt: 0,
		},
		loading: {
			mouth: 0.02,
			happiness: 0,
			lid: 0.5,
			brows: [-browBase, -browBase],
			tilt: 0,
		},
	};
}

/**
 * Build default emotion delta overrides for a personality.
 */
function buildEmotionDeltas(personality: Personality): Record<string, Record<string, unknown>> {
	const { expressiveness, warmth } = personality;
	const scale = lerp(0.5, 1.2, expressiveness);

	return {
		happy: {
			happiness: 0.3 * scale,
			brows: [0.1 * scale, 0.1 * scale],
			blush: lerp(0.2, 0.6, warmth),
			eyeScale: [0.05 * scale, 0.05 * scale],
		},
		sad: {
			happiness: -0.6 * scale,
			brows: [-0.3 * scale, -0.3 * scale],
			mouthCap: 0.5,
			eyeScale: [-0.05 * scale, -0.05 * scale],
		},
		confused: {
			confusion: 0.4 * scale,
			brows: [-0.2 * scale, 0.3 * scale],
		},
		excited: {
			happiness: 0.4 * scale,
			brows: [0.3 * scale, 0.3 * scale],
			blush: lerp(0.3, 0.7, warmth),
			eyeScale: [0.1 * scale, 0.1 * scale],
		},
		concerned: {
			happiness: -0.2 * scale,
			brows: [-0.3 * scale, -0.3 * scale],
			lidMult: 0.9,
		},
		surprised: {
			mouthMin: 0.4 * scale,
			happiness: 0,
			brows: [0.5 * scale, 0.5 * scale],
			lidMin: 1.2,
			eyeScale: [0.3 * scale, 0.3 * scale],
		},
		playful: {
			happiness: 0.3 * scale,
			brows: [0.2 * scale, -0.1 * scale],
			blush: lerp(0.1, 0.4, warmth),
			tilt: 0.03 * scale,
		},
		frustrated: {
			happiness: -0.3 * scale,
			brows: [-0.5 * scale, -0.5 * scale],
			mouthWidth: -0.2 * scale,
			lidMult: 0.85,
		},
		skeptical: {
			brows: [-0.3 * scale, 0.5 * scale],
			happiness: -0.1 * scale,
			tilt: -0.02 * scale,
		},
		determined: {
			brows: [-0.2 * scale, -0.2 * scale],
			lidMult: 0.9,
			mouthWidth: -0.1 * scale,
		},
		embarrassed: {
			blush: lerp(0.4, 0.9, warmth),
			happiness: 0.15 * scale,
			brows: [-0.1 * scale, 0.2 * scale],
			tilt: 0.04 * scale,
		},
		proud: {
			happiness: 0.35 * scale,
			brows: [0.1 * scale, 0.1 * scale],
			lidMult: 0.9,
			tilt: -0.02 * scale,
		},
	};
}

/**
 * Build default state eye scales for a personality.
 */
function buildStateScales(personality: Personality): Record<FaceState, [number, number]> {
	const e = personality.energy;
	const s = personality.stability;
	const range = lerp(0.1, 0.5, 1 - s);

	return {
		idle: [1.0, 1.0],
		thinking: [1.0 - range * 0.3, 1.0 - range * 0.3],
		speaking: [1.0, 1.0],
		listening: [1.0 + range * 0.6, 1.0 + range * 0.6],
		reacting: [1.0 + range * 1.0, 1.0 + range * 1.0],
		puzzled: [1.0 - range * 0.4, 1.0 + range * 0.6],
		alert: [1.0 + range * lerp(0.8, 1.5, e), 1.0 + range * lerp(0.8, 1.5, e)],
		working: [1.0 - range * 0.15, 1.0 - range * 0.15],
		sleeping: [1.0, 1.0],
		waiting: [1.0, 1.0],
		loading: [1.0 - range * 0.5, 1.0 - range * 0.5],
	};
}

/**
 * Generate a complete FaceDefinition from an archetype with optional variation.
 * @param archetype The archetype to generate from
 * @param variation Random variation amount (0 = exact archetype, 1 = maximum variation). Default 0.
 */
export function generateFromArchetype(archetype: Archetype, variation: number = 0): FaceDefinition {
	variation = clamp(variation, 0, 1);

	const { personality, style } = archetype;

	// 1. Generate proportions
	// When variation is exactly 0, use archetype values directly (no offsets)
	const featureScaleOffset = variation === 0 ? 0 : (variation * 0.2 - 0.1);
	const varietyOffset = variation === 0 ? 0 : (variation * 0.2 - 0.1);
	const v = style.featureScale + featureScaleOffset;
	const varietyParam = clamp(lerp(0.3, 0.7, personality.expressiveness) + varietyOffset, 0, 1);
	const props = generateProportions(clamp(v, 0, 1), varietyParam);

	// 2. Apply personality to geometry
	const geomPatch: GeometryPatch = {
		eyeStyle: style.eyeStyle,
		headShape: style.headShape,
		browRenderer: style.browRenderer,
		mouthRenderer: style.mouthRenderer,
		eyeH: props.eyeH,
	};
	applyPersonalityToGeometry(personality, geomPatch);

	// After personality application, geom.eyeH may have been scaled
	const finalEyeH = geomPatch.eyeH ?? props.eyeH;

	// 3. Generate palette
	// When variation is exactly 0, no hue offset
	const hueVariation = variation === 0 ? 0 : (variation * 30 - 15);
	const palette = generateFullPalette(
		style.colorSeedHue + hueVariation,
		style.colorSaturation,
		style.colorLightness,
		style.darkFeatures,
	);

	// 4. Build state overrides and emotion deltas
	const states = buildStateOverrides(personality);
	const emotionDeltas = buildEmotionDeltas(personality);
	const stateScales = buildStateScales(personality);

	// 5. Validate via energy function
	const energyScore = computeEnergy(
		{
			eyeW: props.eyeW,
			eyeH: finalEyeH,
			eyeSpacing: props.eyeSpacing,
			eyeY: props.eyeY,
			mouthW: props.mouthW,
			mouthY: props.mouthY,
			headW: props.headW,
			headH: props.headH,
			featureColor: palette.feature,
		},
		{ stateColors: palette.stateColors, feature: palette.feature },
	);

	// If energy is too high, try to fix proportions
	let adjustedMouthY = props.mouthY;
	if (energyScore > 5) {
		// Push mouth down to avoid overlap
		const eyeBottom = Math.abs(props.eyeY) + finalEyeH / 2;
		adjustedMouthY = Math.max(props.mouthY, eyeBottom + 0.03);
	}

	// 6. Build and return complete FaceDefinition
	// Resolve final style values from geomPatch (which was mutated by personality overrides)
	const resolvedEyeStyle = geomPatch.eyeStyle ?? style.eyeStyle;
	const resolvedHeadShape = geomPatch.headShape ?? style.headShape;
	const resolvedBrowRenderer = geomPatch.browRenderer ?? style.browRenderer;
	const resolvedMouthRenderer = geomPatch.mouthRenderer ?? style.mouthRenderer;

	// Dependent calculations use resolved values (after personality override)
	const browEnabled = resolvedBrowRenderer !== "none";
	const mouthStyle: MouthStyle = "curve";

	// Blink interval — lower energy = slower blinks
	const blinkMin = lerp(4.0, 2.0, personality.energy);
	const blinkMax = lerp(8.0, 4.5, personality.energy);

	// Lerp speeds modulated by personality
	const speedMult = geomPatch.animSpeed ?? 1.0;

	return {
		$schema: "https://openface.live/protocol/v1/face.schema.json",
		$type: "face",
		$version: "1.0.0",
		meta: {
			name: archetype.name,
			author: "face-generator",
			license: "MIT",
			description: `Generated from ${archetype.name} archetype`,
		},
		geometry: {
			head: {
				shape: resolvedHeadShape,
				width: props.headW,
				height: props.headH,
				verticalPosition: 0,
				radius: resolvedHeadShape === "rounded" ? 0.06 : 0.14,
				strokeWidth: style.darkFeatures ? 0.004 : 0.0045,
			},
			eyes: {
				style: resolvedEyeStyle,
				baseWidth: props.eyeW,
				baseHeight: finalEyeH,
				spacing: props.eyeSpacing,
				verticalPosition: props.eyeY,
				specular: {
					enabled: resolvedEyeStyle !== "dot",
					size: lerp(0.15, 0.30, personality.warmth),
					shiftX: 0.4,
					shiftY: 0.35,
					lookFollow: 0.16,
					alpha: resolvedEyeStyle === "dot" ? 0 : 1,
				},
				pupil: {
					enabled: resolvedEyeStyle === "oval" || resolvedEyeStyle === "round",
					size: lerp(0.18, 0.30, personality.warmth),
					shiftX: 0.5,
					shiftY: lerp(0.45, 0.38, personality.warmth),
					lookFollow: 0.82,
				},
				eyelid: {
					renderer: "none",
				},
				constraints: {
					scaleMin: geomPatch.eyeScaleMin ?? 0.6,
					scaleMax: geomPatch.eyeScaleMax ?? 1.6,
				},
				stateScales,
			},
			mouth: {
				width: props.mouthW,
				verticalPosition: adjustedMouthY,
				style: mouthStyle,
				speakingBase: 0.1,
				renderer: resolvedMouthRenderer,
				constraints: {
					openMin: 0,
					openMax: lerp(0.7, 1.0, personality.expressiveness),
					widthMin: lerp(-0.2, -0.4, personality.expressiveness),
					widthMax: lerp(0.2, 0.4, personality.expressiveness),
				},
			},
			brows: {
				enabled: browEnabled,
				baseThickness: 0.18,
				range: geomPatch.browRange ?? 0.05,
				curveRange: 0.025,
				verticalOffset: props.browVert,
				renderer: resolvedBrowRenderer,
				constraints: {
					min: lerp(-0.6, -1.0, personality.expressiveness),
					max: lerp(0.6, 1.0, personality.expressiveness),
				},
			},
			locks: {
				eyes: geomPatch.lockEyes ?? false,
				mouth: false,
				brows: geomPatch.lockBrows ?? false,
			},
			blush: {
				enabled: geomPatch.blushEnabled ?? true,
				maxAlpha: geomPatch.blushAlpha ?? 0.2,
				size: 0.6,
			},
		},
		palette: {
			feature: palette.feature,
			head: {
				fill: palette.headFill,
				stroke: palette.headStroke,
			},
			specular: palette.specular,
			blush: palette.blush,
			states: palette.stateColors as Partial<Record<FaceState, string>>,
			emotions: palette.emotionColors as Partial<Record<FaceEmotion, string | null>>,
		},
		animation: {
			breathAmount: geomPatch.breathAmt ?? 0.02,
			breathY: 0.012,
			headSway: geomPatch.headSway ?? 0.01,
			blinkInterval: [
				Math.round(blinkMin * 10) / 10,
				Math.round(blinkMax * 10) / 10,
			],
			doubleBlink: geomPatch.doubleBlinkChance ?? 0.15,
			colorSpeed: {
				default: 0.04 * speedMult,
				alert: 0.15 * speedMult,
				sleeping: 0.02,
			},
			lerp: {
				amplitude: 0.35 * speedMult,
				lookAt: lerp(0.03, 0.08, personality.energy),
				mouth: 0.3 * speedMult,
				happiness: lerp(0.08, 0.18, personality.warmth),
				confusion: 0.2 * speedMult,
				brows: 0.18 * speedMult,
				eyeScale: 0.12 * speedMult,
				tilt: 0.08 * speedMult,
				blush: 0.1,
				wink: 0.35,
				lid: 0.4,
			},
			microExpressions: {
				enabled: geomPatch.microEnabled ?? true,
				eyeDart: {
					interval: [
						lerp(12, 6, personality.energy),
						lerp(30, 18, personality.energy),
					],
					rangeX: geomPatch.microJitterRangeX ?? 0.4,
					rangeY: geomPatch.microJitterRangeY ?? 0.2,
					duration: lerp(0.4, 0.2, personality.energy),
				},
				mouthTwitch: {
					interval: [
						lerp(12, 6, personality.playfulness),
						lerp(20, 12, personality.playfulness),
					],
					range: lerp(0.05, 0.15, personality.expressiveness),
				},
			},
		},
		personality: { ...personality },
		states,
		emotionDeltas,
	};
}

/**
 * Compute Euclidean distance between two personality vectors.
 */
function personalityDistance(a: Personality, b: Personality): number {
	return Math.sqrt(
		(a.energy - b.energy) ** 2 +
		(a.expressiveness - b.expressiveness) ** 2 +
		(a.warmth - b.warmth) ** 2 +
		(a.stability - b.stability) ** 2 +
		(a.playfulness - b.playfulness) ** 2,
	);
}

/**
 * Generate a FaceDefinition from personality traits, auto-selecting the closest archetype.
 * @param name Name for the generated face
 * @param personality Personality trait values
 * @param seedHue Optional color seed hue override (0-360)
 */
export function generateFromPersonality(
	name: string,
	personality: Personality,
	seedHue?: number,
): FaceDefinition {
	// Clamp all personality inputs to [0, 1]
	const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
	const clamped: Personality = {
		energy: clamp01(personality.energy),
		expressiveness: clamp01(personality.expressiveness),
		warmth: clamp01(personality.warmth),
		stability: clamp01(personality.stability),
		playfulness: clamp01(personality.playfulness),
	};

	// Find closest archetype
	let closest = ARCHETYPES[0];
	let minDist = Infinity;
	for (const arch of ARCHETYPES) {
		const dist = personalityDistance(clamped, arch.personality);
		if (dist < minDist) {
			minDist = dist;
			closest = arch;
		}
	}

	// Generate from closest archetype with personality overrides
	const modified: Archetype = {
		name,
		personality: { ...clamped },
		style: {
			...closest.style,
			colorSeedHue: seedHue ?? closest.style.colorSeedHue,
		},
	};

	const face = generateFromArchetype(modified, 0);

	// Post-generation validation: clamp derived values that could be invalid
	if (face.animation?.blinkInterval) {
		face.animation.blinkInterval[0] = Math.max(0.5, face.animation.blinkInterval[0]);
		face.animation.blinkInterval[1] = Math.max(face.animation.blinkInterval[0] + 0.5, face.animation.blinkInterval[1]);
	}
	if (face.geometry.mouth.constraints) {
		const mc = face.geometry.mouth.constraints;
		if (mc.widthMin !== undefined && mc.widthMax !== undefined && mc.widthMin > mc.widthMax) {
			const mid = (mc.widthMin + mc.widthMax) / 2;
			mc.widthMin = mid - 0.1;
			mc.widthMax = mid + 0.1;
		}
		if (mc.openMin !== undefined && mc.openMax !== undefined && mc.openMin > mc.openMax) {
			mc.openMin = 0;
		}
	}
	if (face.animation?.microExpressions?.eyeDart?.interval) {
		const edi = face.animation.microExpressions.eyeDart.interval;
		edi[0] = Math.max(1, edi[0]);
		edi[1] = Math.max(edi[0] + 1, edi[1]);
	}
	if (face.animation?.microExpressions?.mouthTwitch?.interval) {
		const mti = face.animation.microExpressions.mouthTwitch.interval;
		mti[0] = Math.max(1, mti[0]);
		mti[1] = Math.max(mti[0] + 1, mti[1]);
	}

	face.meta.name = name;
	face.meta.description = `Generated from personality traits (closest archetype: ${closest.name})`;
	return face;
}

/** Keyword-to-personality mappings for description-based generation. */
const KEYWORD_PERSONALITY_MAP: Record<string, Partial<Personality>> = {
	// Warmth
	friendly: { warmth: 0.85, expressiveness: 0.7 },
	warm: { warmth: 0.8 },
	cold: { warmth: 0.2 },
	cute: { warmth: 1.0, playfulness: 0.8, expressiveness: 0.9 },
	kawaii: { warmth: 1.0, playfulness: 0.9, expressiveness: 0.95, energy: 0.85 },
	approachable: { warmth: 0.75, expressiveness: 0.6 },

	// Energy
	energetic: { energy: 0.85 },
	calm: { energy: 0.2, stability: 0.85 },
	hyper: { energy: 0.95, playfulness: 0.8 },
	relaxed: { energy: 0.25, stability: 0.7 },
	slow: { energy: 0.15 },
	fast: { energy: 0.85 },
	sleepy: { energy: 0.1, stability: 0.6 },

	// Expressiveness
	expressive: { expressiveness: 0.85 },
	subtle: { expressiveness: 0.2 },
	dramatic: { expressiveness: 0.9, energy: 0.7 },
	minimal: { expressiveness: 0.15, stability: 0.9 },
	reserved: { expressiveness: 0.25, stability: 0.8 },
	bold: { expressiveness: 0.8, energy: 0.7 },

	// Stability
	stable: { stability: 0.9 },
	steady: { stability: 0.85 },
	chaotic: { stability: 0.15, playfulness: 0.8 },
	reliable: { stability: 0.9, warmth: 0.5 },

	// Playfulness
	playful: { playfulness: 0.85, energy: 0.7 },
	serious: { playfulness: 0.1, stability: 0.85 },
	fun: { playfulness: 0.8, warmth: 0.7 },
	silly: { playfulness: 0.95, stability: 0.2 },
	mischievous: { playfulness: 0.9, warmth: 0.5 },

	// Archetypes as keywords
	professional: { stability: 0.9, expressiveness: 0.3, energy: 0.3, playfulness: 0.15 },
	corporate: { stability: 0.9, expressiveness: 0.25, warmth: 0.35, playfulness: 0.1 },
	technical: { stability: 0.9, expressiveness: 0.4, warmth: 0.15, playfulness: 0.1 },
	robot: { warmth: 0.1, stability: 0.95, expressiveness: 0.35, playfulness: 0.1 },
	mechanical: { warmth: 0.1, stability: 0.9, energy: 0.7 },
	zen: { energy: 0.1, expressiveness: 0.2, warmth: 0.75, stability: 0.98, playfulness: 0.05 },
	mascot: { warmth: 0.8, expressiveness: 0.85, energy: 0.8, playfulness: 0.8 },
	assistant: { warmth: 0.7, expressiveness: 0.6, stability: 0.6, energy: 0.5 },
	companion: { warmth: 0.75, playfulness: 0.7, expressiveness: 0.7 },
	sage: { energy: 0.15, expressiveness: 0.3, warmth: 0.8, stability: 0.95 },
	wise: { energy: 0.2, warmth: 0.75, stability: 0.9 },
	cyberpunk: { energy: 0.9, expressiveness: 0.7, warmth: 0.3, stability: 0.5, playfulness: 0.6 },
	neon: { energy: 0.8, expressiveness: 0.7, warmth: 0.3 },
};

/** Keyword-to-hue mappings. */
const KEYWORD_HUE_MAP: Record<string, number> = {
	red: 0,
	orange: 30,
	yellow: 55,
	green: 120,
	teal: 170,
	cyan: 185,
	blue: 220,
	indigo: 250,
	purple: 280,
	violet: 290,
	pink: 330,
	magenta: 310,
	rose: 345,
	warm: 25,
	cool: 210,
	earth: 35,
	nature: 130,
	ocean: 200,
	sky: 200,
	forest: 140,
	sunset: 20,
	fire: 10,
	ice: 195,
	mint: 160,
	lavender: 270,
	coral: 15,
	gold: 45,
};

/**
 * Generate a FaceDefinition from a natural language description.
 * Uses simple keyword matching to extract personality and color values.
 * @param name Name for the generated face
 * @param description Natural language description (e.g. "a friendly, warm blue face")
 */
export function generateFromDescription(name: string, description: string): FaceDefinition {
	const words = description.toLowerCase().replace(/[^a-z0-9\s-]/g, "").split(/\s+/);

	// Collect all trait deltas from matched keywords first (order-independent)
	const traitSums: Personality = { energy: 0, expressiveness: 0, warmth: 0, stability: 0, playfulness: 0 };
	const traitCounts: Record<keyof Personality, number> = { energy: 0, expressiveness: 0, warmth: 0, stability: 0, playfulness: 0 };

	for (const word of words) {
		const mapping = KEYWORD_PERSONALITY_MAP[word];
		if (mapping) {
			for (const [key, val] of Object.entries(mapping)) {
				const k = key as keyof Personality;
				traitSums[k] += val;
				traitCounts[k]++;
			}
		}
	}

	// Average all collected traits; fall back to 0.5 (neutral) for unmatched traits
	const accum: Personality = {
		energy: traitCounts.energy > 0 ? traitSums.energy / traitCounts.energy : 0.5,
		expressiveness: traitCounts.expressiveness > 0 ? traitSums.expressiveness / traitCounts.expressiveness : 0.5,
		warmth: traitCounts.warmth > 0 ? traitSums.warmth / traitCounts.warmth : 0.5,
		stability: traitCounts.stability > 0 ? traitSums.stability / traitCounts.stability : 0.5,
		playfulness: traitCounts.playfulness > 0 ? traitSums.playfulness / traitCounts.playfulness : 0.5,
	};

	// Extract hue from color keywords
	let seedHue: number | undefined;
	for (const word of words) {
		if (word in KEYWORD_HUE_MAP) {
			seedHue = KEYWORD_HUE_MAP[word];
			break; // Use first color keyword found
		}
	}

	return generateFromPersonality(name, accum, seedHue);
}

// ---------------------------------------------------------------------------
// 8. Pack Interpolation
// ---------------------------------------------------------------------------

/**
 * Merge rendererByState and rendererByEmotion maps from two geometry sections.
 * Keys are merged; values snap at t=0.5.
 */
function mergeRendererByMaps(
	aGeom: { rendererByState?: Partial<Record<string, string>>; rendererByEmotion?: Partial<Record<string, string>> },
	bGeom: { rendererByState?: Partial<Record<string, string>>; rendererByEmotion?: Partial<Record<string, string>> },
	t: number,
): { rendererByState?: Partial<Record<string, string>>; rendererByEmotion?: Partial<Record<string, string>> } {
	const result: { rendererByState?: Partial<Record<string, string>>; rendererByEmotion?: Partial<Record<string, string>> } = {};

	if (aGeom.rendererByState || bGeom.rendererByState) {
		const merged: Record<string, string> = {};
		const allKeys = new Set([
			...Object.keys(aGeom.rendererByState ?? {}),
			...Object.keys(bGeom.rendererByState ?? {}),
		]);
		for (const key of allKeys) {
			const va = aGeom.rendererByState?.[key];
			const vb = bGeom.rendererByState?.[key];
			merged[key] = t < 0.5 ? (va ?? vb!) : (vb ?? va!);
		}
		result.rendererByState = merged;
	}

	if (aGeom.rendererByEmotion || bGeom.rendererByEmotion) {
		const merged: Record<string, string> = {};
		const allKeys = new Set([
			...Object.keys(aGeom.rendererByEmotion ?? {}),
			...Object.keys(bGeom.rendererByEmotion ?? {}),
		]);
		for (const key of allKeys) {
			const va = aGeom.rendererByEmotion?.[key];
			const vb = bGeom.rendererByEmotion?.[key];
			merged[key] = t < 0.5 ? (va ?? vb!) : (vb ?? va!);
		}
		result.rendererByEmotion = merged;
	}

	return result;
}

/**
 * Interpolate between two FaceDefinitions.
 * - Numeric fields: linear lerp
 * - Colors: HSL interpolation (shortest hue path)
 * - Categoricals (eye style, head shape, renderers): snap at t=0.5
 * - State overrides: merge keys, interpolate numeric values
 *
 * @param a Start face definition
 * @param b End face definition
 * @param t Interpolation factor (0 = a, 1 = b)
 */
export function interpolatePacks(a: FaceDefinition, b: FaceDefinition, t: number): FaceDefinition {
	t = clamp(t, 0, 1);

	const lerpN = (va: number | undefined, vb: number | undefined, fallback: number): number => {
		return lerp(va ?? fallback, vb ?? fallback, t);
	};

	const lerpColor = (ca: string | undefined, cb: string | undefined, fallback: string): string => {
		return interpolateColorHSL(ca ?? fallback, cb ?? fallback, t);
	};

	const snapStr = <T extends string>(va: T | undefined, vb: T | undefined, fallback: T): T => {
		const av = va ?? fallback;
		const bv = vb ?? fallback;
		return t < 0.5 ? av : bv;
	};

	// Interpolate state color maps
	const stateColors: Partial<Record<FaceState, string>> = {};
	for (const state of STATES) {
		const ca = a.palette.states[state];
		const cb = b.palette.states[state];
		if (ca && cb) {
			stateColors[state] = interpolateColorHSL(ca, cb, t);
		} else {
			stateColors[state] = ca ?? cb;
		}
	}

	// Interpolate emotion color maps
	const emotionColors: Partial<Record<FaceEmotion, string | null>> = {};
	for (const emotion of EMOTIONS) {
		const ca = a.palette.emotions?.[emotion];
		const cb = b.palette.emotions?.[emotion];
		if (ca && cb) {
			emotionColors[emotion] = interpolateColorHSL(ca, cb, t);
		} else if (ca === null || cb === null) {
			emotionColors[emotion] = t < 0.5 ? ca ?? null : cb ?? null;
		} else {
			emotionColors[emotion] = ca ?? cb ?? null;
		}
	}

	// Interpolate state overrides (merge keys, lerp numeric values)
	const mergedStates: Record<string, Record<string, unknown>> = {};
	const allStateKeys = new Set([
		...Object.keys(a.states ?? {}),
		...Object.keys(b.states ?? {}),
	]);
	for (const key of allStateKeys) {
		const sa = (a.states ?? {})[key] ?? {};
		const sb = (b.states ?? {})[key] ?? {};
		const merged: Record<string, unknown> = {};
		const allFields = new Set([...Object.keys(sa), ...Object.keys(sb)]);
		for (const field of allFields) {
			const va = sa[field];
			const vb = sb[field];
			if (typeof va === "number" && typeof vb === "number") {
				merged[field] = lerp(va, vb, t);
			} else if (Array.isArray(va) && Array.isArray(vb) && va.length === vb.length) {
				merged[field] = va.map((v: unknown, i: number) =>
					typeof v === "number" && typeof vb[i] === "number" ? lerp(v, vb[i] as number, t) : t < 0.5 ? v : vb[i],
				);
			} else {
				merged[field] = t < 0.5 ? (va ?? vb) : (vb ?? va);
			}
		}
		mergedStates[key] = merged;
	}

	// Interpolate emotion deltas
	const mergedEmotionDeltas: Record<string, Record<string, unknown>> = {};
	const allEmotionKeys = new Set([
		...Object.keys(a.emotionDeltas ?? {}),
		...Object.keys(b.emotionDeltas ?? {}),
	]);
	for (const key of allEmotionKeys) {
		const ea = (a.emotionDeltas ?? {})[key] ?? {};
		const eb = (b.emotionDeltas ?? {})[key] ?? {};
		const merged: Record<string, unknown> = {};
		const allFields = new Set([...Object.keys(ea), ...Object.keys(eb)]);
		for (const field of allFields) {
			const va = ea[field];
			const vb = eb[field];
			if (typeof va === "number" && typeof vb === "number") {
				merged[field] = lerp(va, vb, t);
			} else if (Array.isArray(va) && Array.isArray(vb) && va.length === vb.length) {
				merged[field] = va.map((v: unknown, i: number) =>
					typeof v === "number" && typeof vb[i] === "number" ? lerp(v, vb[i] as number, t) : t < 0.5 ? v : vb[i],
				);
			} else {
				merged[field] = t < 0.5 ? (va ?? vb) : (vb ?? va);
			}
		}
		mergedEmotionDeltas[key] = merged;
	}

	// Interpolate stateScales
	const stateScalesA = a.geometry.eyes.stateScales ?? {};
	const stateScalesB = b.geometry.eyes.stateScales ?? {};
	const mergedScales: Partial<Record<FaceState, [number, number]>> = {};
	for (const state of STATES) {
		const sa = stateScalesA[state] ?? [1.0, 1.0];
		const sb = stateScalesB[state] ?? [1.0, 1.0];
		mergedScales[state] = [lerp(sa[0], sb[0], t), lerp(sa[1], sb[1], t)];
	}

	// Interpolate personality
	const persA = a.personality ?? { energy: 0.5, expressiveness: 0.5, warmth: 0.5, stability: 0.5, playfulness: 0.5 };
	const persB = b.personality ?? { energy: 0.5, expressiveness: 0.5, warmth: 0.5, stability: 0.5, playfulness: 0.5 };

	return {
		$schema: "https://openface.live/protocol/v1/face.schema.json",
		$type: "face",
		$version: "1.0.0",
		meta: {
			name: t < 0.5 ? a.meta.name : b.meta.name,
			author: "face-generator",
			license: "MIT",
			description: `Interpolation between ${a.meta.name} and ${b.meta.name} at t=${t.toFixed(2)}`,
		},
		geometry: {
			head: {
				shape: snapStr(a.geometry.head?.shape, b.geometry.head?.shape, "circle"),
				width: lerpN(a.geometry.head?.width, b.geometry.head?.width, 0.82),
				height: lerpN(a.geometry.head?.height, b.geometry.head?.height, 0.82),
				verticalPosition: lerpN(a.geometry.head?.verticalPosition, b.geometry.head?.verticalPosition, 0),
				radius: lerpN(a.geometry.head?.radius, b.geometry.head?.radius, 0.14),
				strokeWidth: lerpN(a.geometry.head?.strokeWidth, b.geometry.head?.strokeWidth, 0),
			},
			eyes: {
				style: snapStr(a.geometry.eyes.style, b.geometry.eyes.style, "oval"),
				baseWidth: lerp(a.geometry.eyes.baseWidth, b.geometry.eyes.baseWidth, t),
				baseHeight: lerp(a.geometry.eyes.baseHeight, b.geometry.eyes.baseHeight, t),
				spacing: lerp(a.geometry.eyes.spacing, b.geometry.eyes.spacing, t),
				verticalPosition: lerpN(a.geometry.eyes.verticalPosition, b.geometry.eyes.verticalPosition, -0.05),
				specular: {
					enabled: t < 0.5
						? (a.geometry.eyes.specular?.enabled ?? true)
						: (b.geometry.eyes.specular?.enabled ?? true),
					size: lerpN(a.geometry.eyes.specular?.size, b.geometry.eyes.specular?.size, 0.22),
					shiftX: lerpN(a.geometry.eyes.specular?.shiftX, b.geometry.eyes.specular?.shiftX, 0.4),
					shiftY: lerpN(a.geometry.eyes.specular?.shiftY, b.geometry.eyes.specular?.shiftY, 0.35),
					lookFollow: lerpN(a.geometry.eyes.specular?.lookFollow, b.geometry.eyes.specular?.lookFollow, 0.16),
					alpha: lerpN(a.geometry.eyes.specular?.alpha, b.geometry.eyes.specular?.alpha, 1),
				},
				pupil: {
					enabled: t < 0.5
						? (a.geometry.eyes.pupil?.enabled ?? false)
						: (b.geometry.eyes.pupil?.enabled ?? false),
					size: lerpN(a.geometry.eyes.pupil?.size, b.geometry.eyes.pupil?.size, 0.22),
					shiftX: lerpN(a.geometry.eyes.pupil?.shiftX, b.geometry.eyes.pupil?.shiftX, 0.5),
					shiftY: lerpN(a.geometry.eyes.pupil?.shiftY, b.geometry.eyes.pupil?.shiftY, 0.5),
					lookFollow: lerpN(a.geometry.eyes.pupil?.lookFollow, b.geometry.eyes.pupil?.lookFollow, 0.8),
				},
				constraints: {
					scaleMin: lerpN(a.geometry.eyes.constraints?.scaleMin, b.geometry.eyes.constraints?.scaleMin, 0.6),
					scaleMax: lerpN(a.geometry.eyes.constraints?.scaleMax, b.geometry.eyes.constraints?.scaleMax, 1.6),
				},
				stateScales: mergedScales as Partial<Record<FaceState, [number, number]>>,
			},
			mouth: {
				width: lerp(a.geometry.mouth.width, b.geometry.mouth.width, t),
				verticalPosition: lerpN(a.geometry.mouth.verticalPosition, b.geometry.mouth.verticalPosition, 0.13),
				style: snapStr(a.geometry.mouth.style, b.geometry.mouth.style, "curve"),
				speakingBase: lerpN(a.geometry.mouth.speakingBase, b.geometry.mouth.speakingBase, 0.1),
				renderer: snapStr(a.geometry.mouth.renderer, b.geometry.mouth.renderer, "fill"),
				...mergeRendererByMaps(a.geometry.mouth, b.geometry.mouth, t),
				constraints: {
					openMin: lerpN(a.geometry.mouth.constraints?.openMin, b.geometry.mouth.constraints?.openMin, 0),
					openMax: lerpN(a.geometry.mouth.constraints?.openMax, b.geometry.mouth.constraints?.openMax, 1),
					widthMin: lerpN(a.geometry.mouth.constraints?.widthMin, b.geometry.mouth.constraints?.widthMin, -0.5),
					widthMax: lerpN(a.geometry.mouth.constraints?.widthMax, b.geometry.mouth.constraints?.widthMax, 0.5),
				},
			},
			brows: {
				enabled: t < 0.5 ? (a.geometry.brows?.enabled ?? true) : (b.geometry.brows?.enabled ?? true),
				baseThickness: lerpN(a.geometry.brows?.baseThickness, b.geometry.brows?.baseThickness, 0.18),
				range: lerpN(a.geometry.brows?.range, b.geometry.brows?.range, 0.05),
				curveRange: lerpN(a.geometry.brows?.curveRange, b.geometry.brows?.curveRange, 0.025),
				verticalOffset: lerpN(a.geometry.brows?.verticalOffset, b.geometry.brows?.verticalOffset, 1.2),
				renderer: snapStr(a.geometry.brows?.renderer, b.geometry.brows?.renderer, "line"),
				...mergeRendererByMaps(a.geometry.brows ?? {}, b.geometry.brows ?? {}, t),
				constraints: {
					min: lerpN(a.geometry.brows?.constraints?.min, b.geometry.brows?.constraints?.min, -1),
					max: lerpN(a.geometry.brows?.constraints?.max, b.geometry.brows?.constraints?.max, 1),
				},
			},
			locks: {
				eyes: t < 0.5
					? (a.geometry.locks?.eyes ?? false)
					: (b.geometry.locks?.eyes ?? false),
				mouth: t < 0.5
					? (a.geometry.locks?.mouth ?? false)
					: (b.geometry.locks?.mouth ?? false),
				brows: t < 0.5
					? (a.geometry.locks?.brows ?? false)
					: (b.geometry.locks?.brows ?? false),
			},
			blush: {
				enabled: t < 0.5
					? (a.geometry.blush?.enabled ?? true)
					: (b.geometry.blush?.enabled ?? true),
				maxAlpha: lerpN(a.geometry.blush?.maxAlpha, b.geometry.blush?.maxAlpha, 0.2),
				size: lerpN(a.geometry.blush?.size, b.geometry.blush?.size, 0.6),
			},
			// Snap body at t=0.5 (complex nested structure)
			...(a.geometry.body || b.geometry.body
				? { body: t < 0.5 ? (a.geometry.body ?? b.geometry.body) : (b.geometry.body ?? a.geometry.body) }
				: {}),
		},
		// Snap accessories at t=0.5
		...(a.accessories || b.accessories
			? { accessories: t < 0.5 ? (a.accessories ?? b.accessories) : (b.accessories ?? a.accessories) }
			: {}),
		palette: {
			feature: lerpColor(a.palette.feature, b.palette.feature, "#111111"),
			head: {
				fill: lerpColor(a.palette.head?.fill, b.palette.head?.fill, "#4FC3F7"),
				stroke: lerpColor(a.palette.head?.stroke, b.palette.head?.stroke, "#111111"),
			},
			specular: lerpColor(a.palette.specular, b.palette.specular, "#FFFFFF"),
			blush: lerpColor(a.palette.blush, b.palette.blush, "#FF8A80"),
			// Snap palette.body at t=0.5 (complex nested structure)
			...(a.palette.body || b.palette.body
				? { body: t < 0.5 ? (a.palette.body ?? b.palette.body) : (b.palette.body ?? a.palette.body) }
				: {}),
			states: stateColors,
			emotions: emotionColors,
		},
		animation: {
			breathAmount: lerpN(a.animation?.breathAmount, b.animation?.breathAmount, 0.02),
			breathY: lerpN(a.animation?.breathY, b.animation?.breathY, 0.012),
			headSway: lerpN(a.animation?.headSway, b.animation?.headSway, 0.01),
			blinkInterval: [
				lerpN(a.animation?.blinkInterval?.[0], b.animation?.blinkInterval?.[0], 2.5),
				lerpN(a.animation?.blinkInterval?.[1], b.animation?.blinkInterval?.[1], 4.5),
			],
			doubleBlink: lerpN(a.animation?.doubleBlink, b.animation?.doubleBlink, 0.15),
			colorSpeed: {
				default: lerpN(
					a.animation?.colorSpeed?.default as number | undefined,
					b.animation?.colorSpeed?.default as number | undefined,
					0.04,
				),
				alert: lerpN(
					a.animation?.colorSpeed?.alert as number | undefined,
					b.animation?.colorSpeed?.alert as number | undefined,
					0.15,
				),
				sleeping: lerpN(
					a.animation?.colorSpeed?.sleeping as number | undefined,
					b.animation?.colorSpeed?.sleeping as number | undefined,
					0.02,
				),
			},
			lerp: {
				amplitude: lerpN(
					a.animation?.lerp?.amplitude as number | undefined,
					b.animation?.lerp?.amplitude as number | undefined,
					0.35,
				),
				lookAt: lerpN(
					a.animation?.lerp?.lookAt as number | undefined,
					b.animation?.lerp?.lookAt as number | undefined,
					0.04,
				),
				mouth: lerpN(
					a.animation?.lerp?.mouth as number | undefined,
					b.animation?.lerp?.mouth as number | undefined,
					0.3,
				),
				happiness: lerpN(
					a.animation?.lerp?.happiness as number | undefined,
					b.animation?.lerp?.happiness as number | undefined,
					0.12,
				),
				confusion: lerpN(
					a.animation?.lerp?.confusion as number | undefined,
					b.animation?.lerp?.confusion as number | undefined,
					0.2,
				),
				brows: lerpN(
					a.animation?.lerp?.brows as number | undefined,
					b.animation?.lerp?.brows as number | undefined,
					0.18,
				),
				eyeScale: lerpN(
					a.animation?.lerp?.eyeScale as number | undefined,
					b.animation?.lerp?.eyeScale as number | undefined,
					0.12,
				),
				tilt: lerpN(
					a.animation?.lerp?.tilt as number | undefined,
					b.animation?.lerp?.tilt as number | undefined,
					0.08,
				),
				blush: lerpN(
					a.animation?.lerp?.blush as number | undefined,
					b.animation?.lerp?.blush as number | undefined,
					0.1,
				),
				wink: lerpN(
					a.animation?.lerp?.wink as number | undefined,
					b.animation?.lerp?.wink as number | undefined,
					0.35,
				),
				lid: lerpN(
					a.animation?.lerp?.lid as number | undefined,
					b.animation?.lerp?.lid as number | undefined,
					0.4,
				),
			},
			microExpressions: {
				enabled: t < 0.5
					? (a.animation?.microExpressions?.enabled ?? true)
					: (b.animation?.microExpressions?.enabled ?? true),
				eyeDart: {
					interval: [
						lerpN(
							a.animation?.microExpressions?.eyeDart?.interval?.[0],
							b.animation?.microExpressions?.eyeDart?.interval?.[0],
							8,
						),
						lerpN(
							a.animation?.microExpressions?.eyeDart?.interval?.[1],
							b.animation?.microExpressions?.eyeDart?.interval?.[1],
							20,
						),
					],
					rangeX: lerpN(
						a.animation?.microExpressions?.eyeDart?.rangeX,
						b.animation?.microExpressions?.eyeDart?.rangeX,
						0.4,
					),
					rangeY: lerpN(
						a.animation?.microExpressions?.eyeDart?.rangeY,
						b.animation?.microExpressions?.eyeDart?.rangeY,
						0.2,
					),
				},
				mouthTwitch: {
					interval: [
						lerpN(
							a.animation?.microExpressions?.mouthTwitch?.interval?.[0],
							b.animation?.microExpressions?.mouthTwitch?.interval?.[0],
							8,
						),
						lerpN(
							a.animation?.microExpressions?.mouthTwitch?.interval?.[1],
							b.animation?.microExpressions?.mouthTwitch?.interval?.[1],
							15,
						),
					],
					range: lerpN(
						a.animation?.microExpressions?.mouthTwitch?.range,
						b.animation?.microExpressions?.mouthTwitch?.range,
						0.1,
					),
				},
			},
		},
		personality: {
			energy: lerp(persA.energy ?? 0.5, persB.energy ?? 0.5, t),
			expressiveness: lerp(persA.expressiveness ?? 0.5, persB.expressiveness ?? 0.5, t),
			warmth: lerp(persA.warmth ?? 0.5, persB.warmth ?? 0.5, t),
			stability: lerp(persA.stability ?? 0.5, persB.stability ?? 0.5, t),
			playfulness: lerp(persA.playfulness ?? 0.5, persB.playfulness ?? 0.5, t),
		},
		states: mergedStates,
		emotionDeltas: mergedEmotionDeltas,
	};
}

// ---------------------------------------------------------------------------
// 9. Evolutionary Generator
// ---------------------------------------------------------------------------

/**
 * Mutate a FaceDefinition by adding small Gaussian noise to numeric personality
 * traits and regenerating the face.
 */
function mutateFace(face: FaceDefinition, mutationRate: number = 0.1): FaceDefinition {
	const pers = face.personality ?? { energy: 0.5, expressiveness: 0.5, warmth: 0.5, stability: 0.5, playfulness: 0.5 };

	// Box-Muller for Gaussian noise
	const gaussRandom = (): number => {
		const u1 = Math.random();
		const u2 = Math.random();
		return Math.sqrt(-2 * Math.log(u1 || 0.001)) * Math.cos(2 * Math.PI * u2);
	};

	const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

	const mutated: Personality = {
		energy: clamp01((pers.energy ?? 0.5) + gaussRandom() * mutationRate),
		expressiveness: clamp01((pers.expressiveness ?? 0.5) + gaussRandom() * mutationRate),
		warmth: clamp01((pers.warmth ?? 0.5) + gaussRandom() * mutationRate),
		stability: clamp01((pers.stability ?? 0.5) + gaussRandom() * mutationRate),
		playfulness: clamp01((pers.playfulness ?? 0.5) + gaussRandom() * mutationRate),
	};

	return generateFromPersonality(face.meta.name + " (mutant)", mutated);
}

/**
 * Evolve a population of faces using ratings as fitness.
 * Top 50% survive (elitism), children generated via crossover + mutation.
 * Validates offspring via computeEnergy().
 *
 * @param population Current generation of faces
 * @param ratings Fitness scores (higher = better), same length as population
 * @returns New population of same size
 */
export function evolve(population: FaceDefinition[], ratings: number[]): FaceDefinition[] {
	if (population.length === 0) return [];
	if (population.length !== ratings.length) {
		throw new Error(`Population size (${population.length}) must match ratings length (${ratings.length})`);
	}

	// Sort by rating (highest first)
	const indexed = population.map((face, i) => ({ face, rating: ratings[i] }));
	indexed.sort((a, b) => b.rating - a.rating);

	// Top 50% survive (elitism)
	const survivorCount = Math.max(1, Math.ceil(population.length / 2));
	const survivors = indexed.slice(0, survivorCount).map(e => e.face);

	const newPop: FaceDefinition[] = [...survivors];

	// Fill remaining slots with children
	while (newPop.length < population.length) {
		// Random parents from survivors
		const parentA = survivors[Math.floor(Math.random() * survivors.length)];
		const parentB = survivors[Math.floor(Math.random() * survivors.length)];

		// Crossover at t=0.5
		let child = interpolatePacks(parentA, parentB, 0.5);

		// Mutation
		child = mutateFace(child, 0.15);

		// Validate — reject if energy is extreme, retry once
		const energy = computeEnergy(
			{
				eyeW: child.geometry.eyes.baseWidth,
				eyeH: child.geometry.eyes.baseHeight,
				eyeSpacing: child.geometry.eyes.spacing,
				eyeY: child.geometry.eyes.verticalPosition ?? -0.05,
				mouthW: child.geometry.mouth.width,
				mouthY: child.geometry.mouth.verticalPosition ?? 0.13,
				headW: child.geometry.head?.width ?? 0.82,
				headH: child.geometry.head?.height ?? 0.82,
				featureColor: child.palette.feature,
			},
			{ stateColors: child.palette.states as Record<string, string>, feature: child.palette.feature },
		);

		if (energy > 20) {
			// Retry with less mutation
			child = mutateFace(parentA, 0.05);
		}

		newPop.push(child);
	}

	return newPop;
}
