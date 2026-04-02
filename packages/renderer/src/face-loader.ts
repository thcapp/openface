import type {
	AccessoryDefinition,
	AccessoryEmotionOverrideMap,
	AccessoryOverridePatch,
	AccessoryStateOverrideMap,
	AntennaAccessoryDefinition,
	DecorationType,
	FaceDecoration,
	FaceDefinition,
	FaceEmotion,
	FaceGeometry,
	FaceState,
	PerEyeOverride,
} from "./types.js";
import { DEFAULT_EMOTION_COLORS, DEFAULT_STATE_COLORS, STATES, EMOTIONS } from "./types.js";

const MAX_ACCESSORIES = 8;
const MAX_ANTENNA_SEGMENTS = 8;
const MAX_DYNAMIC_ACCESSORY_POINTS = 64;

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function readNumber(value: unknown, fallback: number): number {
	return typeof value === "number" ? value : fallback;
}

function cloneOverridePatch(raw: unknown): AccessoryOverridePatch | undefined {
	if (!isRecord(raw)) return undefined;
	const next: AccessoryOverridePatch = {};
	if (typeof raw.color === "string") next.color = raw.color;
	if (typeof raw.tipColor === "string") next.tipColor = raw.tipColor;
	if (typeof raw.tipSize === "number") next.tipSize = raw.tipSize;
	if (typeof raw.lineWidth === "number") next.lineWidth = raw.lineWidth;
	if (typeof raw.lensAlpha === "number") next.lensAlpha = raw.lensAlpha;
	if (typeof raw.restAngle === "number") next.restAngle = raw.restAngle;
	if (typeof raw.restCurve === "number") next.restCurve = raw.restCurve;
	if (typeof raw.tipCurl === "number") next.tipCurl = raw.tipCurl;
	if (isRecord(raw.physics)) {
		const physics: AccessoryOverridePatch["physics"] = {};
		if (typeof raw.physics.enabled === "boolean") physics.enabled = raw.physics.enabled;
		if (typeof raw.physics.stiffness === "number") physics.stiffness = raw.physics.stiffness;
		if (typeof raw.physics.damping === "number") physics.damping = raw.physics.damping;
		if (typeof raw.physics.gravity === "number") physics.gravity = raw.physics.gravity;
		if (typeof raw.physics.headInfluence === "number") physics.headInfluence = raw.physics.headInfluence;
		next.physics = physics;
	}
	return Object.keys(next).length > 0 ? next : undefined;
}

function normalizeStateOverrides(raw: unknown): AccessoryStateOverrideMap | undefined {
	if (!isRecord(raw)) return undefined;
	const next: AccessoryStateOverrideMap = {};
	for (const state of STATES) {
		const patch = cloneOverridePatch(raw[state]);
		if (patch) next[state] = patch;
	}
	return Object.keys(next).length > 0 ? next : undefined;
}

function normalizeEmotionOverrides(raw: unknown): AccessoryEmotionOverrideMap | undefined {
	if (!isRecord(raw)) return undefined;
	const next: AccessoryEmotionOverrideMap = {};
	for (const emotion of EMOTIONS) {
		const patch = cloneOverridePatch(raw[emotion]);
		if (patch) next[emotion] = patch;
	}
	return Object.keys(next).length > 0 ? next : undefined;
}

function normalizeAccessory(raw: unknown, index: number): AccessoryDefinition {
	if (!isRecord(raw)) {
		throw new Error(`[openface] accessories[${index}] must be an object.`);
	}
	const id = raw.id;
	if (typeof id !== "string" || id.trim().length === 0) {
		throw new Error(`[openface] accessories[${index}].id must be a non-empty string.`);
	}
	const type = raw.type;
	if (type !== "antenna" && type !== "glasses") {
		throw new Error(`[openface] accessories[${index}].type "${String(type)}" is unsupported.`);
	}
	if (!isRecord(raw.anchor) || typeof raw.anchor.x !== "number" || typeof raw.anchor.y !== "number") {
		throw new Error(`[openface] accessories[${index}].anchor must be an object with numeric x/y.`);
	}
	const common = {
		id,
		type,
		enabled: typeof raw.enabled === "boolean" ? raw.enabled : true,
		layer: raw.layer === "back" || raw.layer === "mid" || raw.layer === "front" || raw.layer === "overlay"
			? raw.layer
			: "front",
		anchor: { x: raw.anchor.x, y: raw.anchor.y },
		color: typeof raw.color === "string" ? raw.color : undefined,
		stateOverrides: normalizeStateOverrides(raw.stateOverrides),
		emotionOverrides: normalizeEmotionOverrides(raw.emotionOverrides),
	} as const;

	if (type === "antenna") {
		if (!Number.isInteger(raw.segments)) {
			throw new Error(`[openface] accessories[${index}].segments must be an integer.`);
		}
		const segments = raw.segments;
		if (segments < 2 || segments > MAX_ANTENNA_SEGMENTS) {
			throw new Error(`[openface] accessories[${index}].segments must be between 2 and ${MAX_ANTENNA_SEGMENTS}.`);
		}
		if (typeof raw.segmentLength !== "number") {
			throw new Error(`[openface] accessories[${index}].segmentLength must be a number.`);
		}
		if (raw.segmentLength < 0.01 || raw.segmentLength > 0.15) {
			throw new Error(`[openface] accessories[${index}].segmentLength must be between 0.01 and 0.15.`);
		}
		if (raw.restAngle !== undefined && (typeof raw.restAngle !== "number" || raw.restAngle < -85 || raw.restAngle > 85)) {
			throw new Error(`[openface] accessories[${index}].restAngle must be between -85 and 85.`);
		}
		if (raw.restCurve !== undefined && (typeof raw.restCurve !== "number" || raw.restCurve < -1 || raw.restCurve > 1)) {
			throw new Error(`[openface] accessories[${index}].restCurve must be between -1 and 1.`);
		}
		if (raw.tipCurl !== undefined && (typeof raw.tipCurl !== "number" || raw.tipCurl < -1 || raw.tipCurl > 1)) {
			throw new Error(`[openface] accessories[${index}].tipCurl must be between -1 and 1.`);
		}
		let thickness: AntennaAccessoryDefinition["thickness"];
		if (isRecord(raw.thickness)) {
			const base = readNumber(raw.thickness.base, 0.012);
			const tip = readNumber(raw.thickness.tip, 0.006);
			thickness = { base, tip };
		}
		let physics: AntennaAccessoryDefinition["physics"];
		if (isRecord(raw.physics)) {
			physics = {
				enabled: typeof raw.physics.enabled === "boolean" ? raw.physics.enabled : false,
				stiffness: readNumber(raw.physics.stiffness, 0.4),
				damping: readNumber(raw.physics.damping, 0.85),
				gravity: readNumber(raw.physics.gravity, 0.15),
				headInfluence: readNumber(raw.physics.headInfluence, 1),
			};
		}
		return {
			...common,
			type: "antenna",
			segments,
			segmentLength: raw.segmentLength,
			restAngle: typeof raw.restAngle === "number" ? raw.restAngle : undefined,
			restCurve: typeof raw.restCurve === "number" ? raw.restCurve : undefined,
			tipCurl: typeof raw.tipCurl === "number" ? raw.tipCurl : undefined,
			thickness,
			tipShape: raw.tipShape === "circle" || raw.tipShape === "diamond" ? raw.tipShape : "circle",
			tipSize: typeof raw.tipSize === "number" ? raw.tipSize : 0.012,
			tipColor: typeof raw.tipColor === "string" ? raw.tipColor : undefined,
			symmetry: raw.symmetry === "mirrorX" ? "mirrorX" : "none",
			physics,
		};
	}

	if (raw.shape !== "round" && raw.shape !== "rect") {
		throw new Error(`[openface] accessories[${index}].shape must be \"round\" or \"rect\" for glasses.`);
	}
	return {
		...common,
		type: "glasses",
		shape: raw.shape,
		frameWidth: typeof raw.frameWidth === "number" ? raw.frameWidth : undefined,
		frameHeight: typeof raw.frameHeight === "number" ? raw.frameHeight : undefined,
		bridgeWidth: typeof raw.bridgeWidth === "number" ? raw.bridgeWidth : undefined,
		lineWidth: typeof raw.lineWidth === "number" ? raw.lineWidth : undefined,
		followEyes: typeof raw.followEyes === "number" ? raw.followEyes : undefined,
		lensAlpha: typeof raw.lensAlpha === "number" ? raw.lensAlpha : undefined,
	};
}

function mirrorAccessoryX(accessory: AccessoryDefinition): AccessoryDefinition {
	if (accessory.type !== "antenna") return accessory;
	return {
		...accessory,
		id: `${accessory.id}--mirror`,
		anchor: { x: -accessory.anchor.x, y: accessory.anchor.y },
		symmetry: "none",
	};
}

function normalizeAccessories(raw: unknown): AccessoryDefinition[] {
	if (!Array.isArray(raw) || raw.length === 0) return [];
	const normalized: AccessoryDefinition[] = [];
	const ids = new Set<string>();
	let dynamicPoints = 0;

	for (let i = 0; i < raw.length; i++) {
		const accessory = normalizeAccessory(raw[i], i);
		const toAdd = accessory.type === "antenna" && accessory.symmetry === "mirrorX"
			? [accessory, mirrorAccessoryX(accessory)]
			: [accessory];

		for (const entry of toAdd) {
			if (ids.has(entry.id)) {
				throw new Error(`[openface] accessories has duplicate id "${entry.id}".`);
			}
			ids.add(entry.id);
			normalized.push(entry);
			if (entry.type === "antenna" && entry.physics?.enabled) {
				dynamicPoints += entry.segments + 1;
			}
		}
	}

	if (normalized.length > MAX_ACCESSORIES) {
		throw new Error(`[openface] accessories exceeds max count of ${MAX_ACCESSORIES}.`);
	}
	if (dynamicPoints > MAX_DYNAMIC_ACCESSORY_POINTS) {
		throw new Error(`[openface] accessories dynamic point budget exceeded (${dynamicPoints} > ${MAX_DYNAMIC_ACCESSORY_POINTS}).`);
	}
	return normalized;
}

const VALID_DECORATION_TYPES: Set<string> = new Set([
	"freckles", "tears", "sweat", "scar", "stripes", "sparkles", "bandaid", "hearts", "stars", "lines",
]);
const MAX_DECORATIONS = 10;

function normalizeDecorations(raw: unknown): FaceDecoration[] {
	if (!Array.isArray(raw) || raw.length === 0) return [];
	const result: FaceDecoration[] = [];
	for (let i = 0; i < Math.min(raw.length, MAX_DECORATIONS); i++) {
		const entry = raw[i];
		if (!isRecord(entry)) continue;
		const type = entry.type;
		if (typeof type !== "string" || !VALID_DECORATION_TYPES.has(type)) continue;
		result.push({
			type: type as DecorationType,
			enabled: typeof entry.enabled === "boolean" ? entry.enabled : true,
			color: typeof entry.color === "string" ? entry.color : "#FF8A80",
			alpha: typeof entry.alpha === "number" ? Math.max(0, Math.min(1, entry.alpha)) : 0.5,
			size: typeof entry.size === "number" ? Math.max(0.1, Math.min(2, entry.size)) : 0.5,
		});
	}
	return result;
}

function normalizeEyeStyle(style: string): FaceGeometry["eyeStyle"] {
	switch (style) {
		case "oval":
		case "round":
		case "rectangle":
		case "dot":
		case "almond":
		case "crescent":
		case "star":
		case "heart":
		case "cat":
		case "cross":
		case "diamond":
		case "semicircle":
			return style;
		default:
			throw new Error(`[openface] Unsupported geometry.eyes.style "${style}". Supported values: oval, round, rectangle, dot, almond, crescent, star, heart, cat, cross, diamond, semicircle.`);
	}
}

function normalizeHeadShape(shape: string): FaceGeometry["headShape"] {
	switch (shape) {
		case "fullscreen":
		case "circle":
		case "rounded":
		case "oval":
		case "squircle":
		case "hexagon":
		case "diamond":
		case "egg":
		case "pill":
		case "shield":
		case "cloud":
		case "octagon":
			return shape;
		default:
			throw new Error(`[openface] Unsupported geometry.head.shape "${shape}". Supported values: fullscreen, circle, rounded, oval, squircle, hexagon, diamond, egg, pill, shield, cloud, octagon.`);
	}
}

function normalizeMouthStyle(style: string): FaceGeometry["mouthStyle"] {
	switch (style) {
		case "curve":
		case "cat":
		case "slit":
		case "zigzag":
		case "pixel":
		case "circle":
		case "fang":
		case "smirk":
		case "wave":
		case "none":
			return style;
		default:
			return "curve";
	}
}

function normalizeSpecularShape(shape: string): FaceGeometry["specularShape"] {
	switch (shape) {
		case "circle":
		case "star":
		case "crescent":
		case "dual":
		case "line":
		case "cross":
		case "ring":
		case "none":
			return shape;
		default:
			return "circle";
	}
}

function normalizePupilShape(shape: string): FaceGeometry["pupilShape"] {
	switch (shape) {
		case "circle":
		case "slit":
		case "star":
		case "heart":
		case "diamond":
		case "cross":
		case "ring":
		case "flower":
		case "spiral":
		case "none":
			return shape;
		default:
			return "circle";
	}
}

function normalizePerEyeOverride(raw: unknown): PerEyeOverride {
	if (!isRecord(raw)) return {};
	const result: PerEyeOverride = {};
	if (typeof raw.style === "string") {
		try { result.style = normalizeEyeStyle(raw.style); } catch { /* ignore invalid */ }
	}
	if (typeof raw.pupilShape === "string") result.pupilShape = normalizePupilShape(raw.pupilShape);
	if (typeof raw.pupilColor === "string") result.pupilColor = raw.pupilColor;
	if (typeof raw.specularShape === "string") result.specularShape = normalizeSpecularShape(raw.specularShape);
	if (typeof raw.specularSize === "number") result.specularSize = raw.specularSize;
	return Object.keys(result).length > 0 ? result : {};
}

/** Create default geometry. */
export function createDefaultGeometry(): FaceGeometry {
	return {
		headShape: "fullscreen",
		headW: 0.82,
		headH: 0.82,
		headY: 0,
		headRadius: 0.14,
		headStrokeW: 0,
		eyeStyle: "oval", eyeW: 0.06, eyeH: 0.08, eyeSpacing: 0.16, eyeY: -0.05,
		eyeStateScales: {
			idle: [1.0, 1.0],
			thinking: [0.9, 0.9],
			speaking: [1.0, 1.0],
			listening: [1.2, 1.2],
			reacting: [1.35, 1.35],
			puzzled: [0.85, 1.2],
			alert: [1.5, 1.5],
			working: [0.95, 0.95],
			sleeping: [1.0, 1.0],
			waiting: [1.0, 1.0],
			loading: [0.8, 0.8],
		},
		specularEnabled: true, specularShape: "circle", specularSize: 0.22, specularShiftX: 0.4, specularShiftY: 0.35, specularLookFollow: 0.16, specularAlpha: 1,
		eyeLeftOverride: {}, eyeRightOverride: {},
		pupilEnabled: false, pupilShape: "circle", pupilSize: 0.22, pupilShiftX: 0.5, pupilShiftY: 0.5, pupilLookFollow: 0.8, pupilColor: "#111111",
		eyelidRenderer: "none", eyelidStrength: 0.5, eyelidColor: "#111111",
		eyelashStyle: "none",
		mouthStyle: "curve", mouthW: 0.16, mouthY: 0.13, speakBase: 0.1,
		browThick: 0.18, browRange: 0.05, browCurve: 0.025, browVert: 1.2,
		browRenderer: "line",
		browRendererByState: {},
		browRendererByEmotion: {},
			lockEyes: false, lockMouth: false, lockBrows: false,
			eyeScaleMin: 0.6, eyeScaleMax: 1.6,
			mouthOpenMin: 0, mouthOpenMax: 1,
			mouthWidthMin: -0.5, mouthWidthMax: 0.5,
			browMin: -1, browMax: 1,
			blushAlpha: 0.2, blushSize: 0.6,
			noseStyle: "none", noseSize: 0.5, noseVerticalPosition: 0, noseColor: "",
			bodyEnabled: false,
			bodyAnchorX: 0,
			bodyAnchorY: 0.26,
			bodyShape: "capsule",
			bodyW: 0.34,
			bodyH: 0.3,
			bodyRadius: 0.08,
			bodyNeckEnabled: true,
			bodyNeckW: 0.1,
			bodyNeckH: 0.05,
			bodyNeckOffsetY: -0.18,
			bodyShouldersEnabled: true,
			bodyShouldersW: 0.44,
			bodyShouldersSlope: 0.08,
			bodyShouldersThick: 0.06,
			bodyArmsEnabled: true,
			bodyArmsStyle: "arc",
			bodyArmsSpread: 0.22,
			bodyArmsDrop: 0.12,
			bodyArmsBend: 0.1,
			bodyArmsThick: 0.028,
			bodyMotionBreathFollow: 0.75,
			bodyMotionTiltFollow: 0.55,
			bodyMotionWeightShift: 0.4,
			bodyMotionIdleSway: 0.2,
			bodyMotionIdleSwayRate: 0.8,
			bodyMotionSpeakingBob: 0.25,
			bodyMaxTilt: 0.05,
			bodyMaxShiftX: 0.06,
			bodyMaxShiftY: 0.05,
			breathAmt: 0.02, breathY: 0.012, headSway: 0.01,
			colorSpeedDefault: 0.04, colorSpeedAlert: 0.15, colorSpeedSleeping: 0.02,
			lerpAmplitude: 0.35, lerpLookAt: 0.04, lerpMouth: 0.3, lerpHappiness: 0.12, lerpConfusion: 0.2,
		lerpBrows: 0.18, lerpEyeScale: 0.12, lerpTilt: 0.08, lerpBlush: 0.1, lerpWink: 0.35, lerpLid: 0.4,
		blinkIntervalOverride: null, doubleBlinkChance: 0.15,
		microEnabled: true,
		microJitterInterval: [0.8, 2.0], microJitterRangeX: 0.16, microJitterRangeY: 0.08,
		microGlanceInterval: [8, 25], microGlanceRangeX: 0.8, microGlanceRangeY: 0.4, microGlanceHold: [0.5, 1.5],
			microMouthTwitchInterval: [8, 15], microMouthTwitchRange: 0.1,
			stateOverrides: {},
			emotionOverrides: {},
			featureColor: "#111111",
			eyeFillColor: "",
			eyeStrokeColor: "",
			mouthFillColor: "",
			mouthStrokeColor: "",
			browColor: "",
			headFillColor: null,
			headStrokeColor: null,
			specularColor: "#FFFFFF",
			blushColor: "#FF8A80",
			bodyFillColor: "#1F2937",
			bodyStrokeColor: "#111111",
			bodyNeckColor: "#111111",
			bodyArmsColor: "#111111",
			bodyShadowColor: "#000000",
			bodyShadowAlpha: 0.16,
			emotionColorBlend: 0.5,
			animSpeed: 1.0, animRange: 1.0, warmthBias: 0, microFreqMult: 1.0, playMult: 1.0,
			mouthRenderer: "fill",
		mouthRendererByState: {},
		mouthRendererByEmotion: {},
		accessories: [],
		decorations: [],
	};
}

/** Fill in missing palette/stateScales entries so old face packs work with new states and emotions. */
export function normalizeFaceDefinition(def: FaceDefinition): void {
	// Ensure all states have a palette color
	if (def.palette.states) {
		for (const s of STATES) {
			if (!(s in def.palette.states) && s in DEFAULT_STATE_COLORS) {
				(def.palette.states as Record<string, string>)[s] = DEFAULT_STATE_COLORS[s];
			}
		}
	}

	// Ensure all emotions have a palette color
	if (!def.palette.emotions) {
		def.palette.emotions = { ...DEFAULT_EMOTION_COLORS };
	} else {
		for (const e of EMOTIONS) {
			if (!(e in def.palette.emotions) && e in DEFAULT_EMOTION_COLORS) {
				(def.palette.emotions as Record<string, string | null>)[e] = DEFAULT_EMOTION_COLORS[e];
			}
		}
	}

	// Ensure all states have stateScales entries (default to [1.0, 1.0])
	if (def.geometry.eyes.stateScales) {
		for (const s of STATES) {
			if (!(s in def.geometry.eyes.stateScales)) {
				(def.geometry.eyes.stateScales as Record<string, [number, number]>)[s] = [1.0, 1.0];
			}
		}
	}
}

/** Apply a face definition to geometry and color maps. */
export function applyFaceDefinition(
	def: FaceDefinition,
	geom: FaceGeometry,
	stateColors: Record<string, string>,
	emotionColors: Record<string, string | null>,
): void {
	// Reset to default baseline each load so pack switches cannot leak geometry/renderer config.
	const defaults = createDefaultGeometry();
	Object.assign(geom, defaults);
	for (const k of Object.keys(stateColors)) delete stateColors[k];
	for (const k of Object.keys(emotionColors)) delete emotionColors[k];
	Object.assign(stateColors, DEFAULT_STATE_COLORS);
	Object.assign(emotionColors, DEFAULT_EMOTION_COLORS);

	const g = def.geometry;
	const e = g.eyes;
	const m = g.mouth;
	const b = g.brows;
	const bl = g.blush;
	const a = def.animation;
	const p = def.palette;
	const eyesRecord = e as Record<string, unknown>;
	const mouthRecord = m as Record<string, unknown>;
	const paletteRecord = p as Record<string, unknown>;
	const headRecord = (g as Record<string, unknown>).head;
	const bodyRecord = (g as Record<string, unknown>).body;
	const headPaletteRecord = paletteRecord.head;
	const bodyPaletteRecord = paletteRecord.body;
	let bodyStrokeExplicit = false;
	let bodyNeckExplicit = false;
	let bodyArmsExplicit = false;

	if ("highlight" in eyesRecord) {
		throw new Error("[openface] geometry.eyes.highlight has been removed. Use geometry.eyes.specular.");
	}
	if ("highlight" in paletteRecord) {
		throw new Error("[openface] palette.highlight has been removed. Use palette.specular.");
	}
	if ("speakingFill" in mouthRecord) {
		throw new Error("[openface] geometry.mouth.speakingFill has been removed. Use geometry.mouth.rendererByState.speaking = \"fill\".");
	}

	// Colors
	if (p.states) Object.assign(stateColors, p.states);
	if (p.emotions) Object.assign(emotionColors, p.emotions);

	// Head geometry (legacy geometry.shape + new geometry.head.*)
	if (g.shape !== undefined) geom.headShape = normalizeHeadShape(String(g.shape));
	if (headRecord && typeof headRecord === "object") {
		const head = headRecord as Record<string, unknown>;
		if (head.shape !== undefined) geom.headShape = normalizeHeadShape(String(head.shape));
		if (typeof head.width === "number") geom.headW = head.width;
		if (typeof head.height === "number") geom.headH = head.height;
		if (typeof head.verticalPosition === "number") geom.headY = head.verticalPosition;
		if (typeof head.radius === "number") geom.headRadius = head.radius;
		if (typeof head.strokeWidth === "number") geom.headStrokeW = head.strokeWidth;
	}

	// Eye geometry
	geom.eyeStyle = normalizeEyeStyle(String(e.style));
	if (e.baseWidth) geom.eyeW = e.baseWidth;
	if (e.baseHeight) geom.eyeH = e.baseHeight;
	if (e.spacing) geom.eyeSpacing = e.spacing;
	if (e.verticalPosition !== undefined) geom.eyeY = e.verticalPosition;
	if (e.stateScales) {
		for (const s of STATES) {
			const scale = e.stateScales[s];
			if (!scale || scale.length !== 2) continue;
			geom.eyeStateScales[s] = [scale[0], scale[1]];
		}
	}
	if (eyesRecord.specular && typeof eyesRecord.specular === "object") {
		const specular = eyesRecord.specular as Record<string, unknown>;
		if (typeof specular.enabled === "boolean") geom.specularEnabled = specular.enabled;
		if (typeof specular.shape === "string") geom.specularShape = normalizeSpecularShape(specular.shape as string);
		if (typeof specular.size === "number") geom.specularSize = specular.size;
		if (typeof specular.shiftX === "number") geom.specularShiftX = specular.shiftX;
		if (typeof specular.shiftY === "number") geom.specularShiftY = specular.shiftY;
		if (typeof specular.lookFollow === "number") geom.specularLookFollow = specular.lookFollow;
		if (typeof specular.alpha === "number") geom.specularAlpha = specular.alpha;
	}
	if (eyesRecord.pupil && typeof eyesRecord.pupil === "object") {
		const pupil = eyesRecord.pupil as Record<string, unknown>;
		if (typeof pupil.enabled === "boolean") geom.pupilEnabled = pupil.enabled;
		if (typeof pupil.shape === "string") geom.pupilShape = pupil.shape as FaceGeometry["pupilShape"];
		if (typeof pupil.size === "number") geom.pupilSize = pupil.size;
		if (typeof pupil.shiftX === "number") geom.pupilShiftX = pupil.shiftX;
		if (typeof pupil.shiftY === "number") geom.pupilShiftY = pupil.shiftY;
		if (typeof pupil.lookFollow === "number") geom.pupilLookFollow = pupil.lookFollow;
		if (typeof pupil.color === "string") geom.pupilColor = pupil.color;
	}
	if (eyesRecord.eyelid && typeof eyesRecord.eyelid === "object") {
		const eyelid = eyesRecord.eyelid as Record<string, unknown>;
		if (eyelid.renderer === "none" || eyelid.renderer === "cover") geom.eyelidRenderer = eyelid.renderer;
		if (typeof eyelid.strength === "number") geom.eyelidStrength = eyelid.strength;
		if (typeof eyelid.color === "string") geom.eyelidColor = eyelid.color;
	}
	if (eyesRecord.eyelash && typeof eyesRecord.eyelash === "object") {
		const eyelash = eyesRecord.eyelash as Record<string, unknown>;
		if (typeof eyelash.style === "string") {
			const s = eyelash.style;
			if (s === "none" || s === "simple" || s === "thick" || s === "wing" || s === "bottom" || s === "full" || s === "spider") {
				geom.eyelashStyle = s;
			}
		}
	}
	if (eyesRecord.constraints && typeof eyesRecord.constraints === "object") {
		const c = eyesRecord.constraints as Record<string, unknown>;
		if (typeof c.scaleMin === "number") geom.eyeScaleMin = c.scaleMin;
		if (typeof c.scaleMax === "number") geom.eyeScaleMax = c.scaleMax;
	}
	// Per-eye overrides (heterochromia, mixed styles)
	geom.eyeLeftOverride = normalizePerEyeOverride(eyesRecord.leftOverride);
	geom.eyeRightOverride = normalizePerEyeOverride(eyesRecord.rightOverride);

	// Mouth geometry + style + renderer
	if (typeof m.style === "string") geom.mouthStyle = normalizeMouthStyle(m.style);
	if (mouthRecord.renderer === "line") geom.mouthRenderer = "line";
	if (mouthRecord.renderer === "fill") geom.mouthRenderer = "fill";
	geom.mouthRendererByState = {};
	geom.mouthRendererByEmotion = {};
	const byState = mouthRecord.rendererByState;
	if (byState && typeof byState === "object") {
		for (const s of STATES) {
			const v = (byState as Record<string, unknown>)[s];
			if (v === "fill" || v === "line") geom.mouthRendererByState[s] = v;
		}
	}
	const byEmotion = mouthRecord.rendererByEmotion;
	if (byEmotion && typeof byEmotion === "object") {
		for (const eKey of EMOTIONS) {
			const v = (byEmotion as Record<string, unknown>)[eKey];
			if (v === "fill" || v === "line") geom.mouthRendererByEmotion[eKey] = v;
		}
	}
	if (m.width) geom.mouthW = m.width;
	if (m.verticalPosition !== undefined) geom.mouthY = m.verticalPosition;
	if (m.speakingBase !== undefined) geom.speakBase = m.speakingBase;
	if (mouthRecord.constraints && typeof mouthRecord.constraints === "object") {
		const c = mouthRecord.constraints as Record<string, unknown>;
		if (typeof c.openMin === "number") geom.mouthOpenMin = c.openMin;
		if (typeof c.openMax === "number") geom.mouthOpenMax = c.openMax;
		if (typeof c.widthMin === "number") geom.mouthWidthMin = c.widthMin;
		if (typeof c.widthMax === "number") geom.mouthWidthMax = c.widthMax;
	}

	// Brow geometry
	if (b) {
		const browRendererVal = (b as Record<string, unknown>).renderer;
		if (browRendererVal === "line" || browRendererVal === "flat" || browRendererVal === "block" || browRendererVal === "none" || browRendererVal === "arch" || browRendererVal === "angled" || browRendererVal === "thick" || browRendererVal === "dot") {
			geom.browRenderer = browRendererVal;
		}
		// Backward compatibility: enabled=false disables brows.
		if ((b as Record<string, unknown>).enabled === false) geom.browRenderer = "none";
		if ((b as Record<string, unknown>).enabled === true && geom.browRenderer === "none") geom.browRenderer = "line";
		if (b.baseThickness !== undefined) geom.browThick = b.baseThickness;
		if (b.range !== undefined) geom.browRange = b.range;
		if (b.curveRange !== undefined) geom.browCurve = b.curveRange;
		if (b.verticalOffset !== undefined) geom.browVert = b.verticalOffset;
		geom.browRendererByState = {};
		geom.browRendererByEmotion = {};
		const byState = (b as Record<string, unknown>).rendererByState;
		if (byState && typeof byState === "object") {
			for (const s of STATES) {
				const v = (byState as Record<string, unknown>)[s];
				if (v === "line" || v === "flat" || v === "block" || v === "none" || v === "arch" || v === "angled" || v === "thick" || v === "dot") geom.browRendererByState[s] = v;
			}
		}
		const byEmotion = (b as Record<string, unknown>).rendererByEmotion;
		if (byEmotion && typeof byEmotion === "object") {
			for (const eKey of EMOTIONS) {
				const v = (byEmotion as Record<string, unknown>)[eKey];
				if (v === "line" || v === "flat" || v === "block" || v === "none" || v === "arch" || v === "angled" || v === "thick" || v === "dot") geom.browRendererByEmotion[eKey] = v;
			}
		}
		if ((b as Record<string, unknown>).constraints && typeof (b as Record<string, unknown>).constraints === "object") {
			const c = (b as Record<string, unknown>).constraints as Record<string, unknown>;
			if (typeof c.min === "number") geom.browMin = c.min;
			if (typeof c.max === "number") geom.browMax = c.max;
		}
	}
	const locks = (g as Record<string, unknown>).locks;
	if (locks && typeof locks === "object") {
		const l = locks as Record<string, unknown>;
		if (typeof l.eyes === "boolean") geom.lockEyes = l.eyes;
		if (typeof l.mouth === "boolean") geom.lockMouth = l.mouth;
		if (typeof l.brows === "boolean") geom.lockBrows = l.brows;
	}

	// Blush
	if (bl) {
		if (bl.maxAlpha !== undefined) geom.blushAlpha = bl.maxAlpha;
		if (bl.size !== undefined) geom.blushSize = bl.size;
	}

	// Nose
	const noseRecord = (g as Record<string, unknown>).nose;
	if (noseRecord && typeof noseRecord === "object") {
		const nose = noseRecord as Record<string, unknown>;
		if (typeof nose.style === "string") {
			const s = nose.style;
			if (s === "none" || s === "dot" || s === "line" || s === "triangle" || s === "L" || s === "button") {
				geom.noseStyle = s;
			}
		}
		if (typeof nose.size === "number") geom.noseSize = nose.size;
		if (typeof nose.verticalPosition === "number") geom.noseVerticalPosition = nose.verticalPosition;
		if (typeof nose.color === "string") geom.noseColor = nose.color;
	}
	// Nose palette color
	const nosePaletteColor = paletteRecord.nose;
	if (typeof nosePaletteColor === "string") geom.noseColor = nosePaletteColor;

	if (bodyRecord && typeof bodyRecord === "object") {
		const body = bodyRecord as Record<string, unknown>;
		geom.bodyEnabled = typeof body.enabled === "boolean" ? body.enabled : true;
		if (isRecord(body.anchor)) {
			if (typeof body.anchor.x === "number") geom.bodyAnchorX = body.anchor.x;
			if (typeof body.anchor.y === "number") geom.bodyAnchorY = body.anchor.y;
		}
		if (body.shape === "capsule" || body.shape === "trapezoid" || body.shape === "roundedRect" || body.shape === "blob") {
			geom.bodyShape = body.shape;
		}
		if (typeof body.width === "number") geom.bodyW = body.width;
		if (typeof body.height === "number") geom.bodyH = body.height;
		if (typeof body.radius === "number") geom.bodyRadius = body.radius;
		if (isRecord(body.neck)) {
			if (typeof body.neck.enabled === "boolean") geom.bodyNeckEnabled = body.neck.enabled;
			if (typeof body.neck.width === "number") geom.bodyNeckW = body.neck.width;
			if (typeof body.neck.height === "number") geom.bodyNeckH = body.neck.height;
			if (typeof body.neck.offsetY === "number") geom.bodyNeckOffsetY = body.neck.offsetY;
		}
		if (isRecord(body.shoulders)) {
			if (typeof body.shoulders.enabled === "boolean") geom.bodyShouldersEnabled = body.shoulders.enabled;
			if (typeof body.shoulders.width === "number") geom.bodyShouldersW = body.shoulders.width;
			if (typeof body.shoulders.slope === "number") geom.bodyShouldersSlope = body.shoulders.slope;
			if (typeof body.shoulders.thickness === "number") geom.bodyShouldersThick = body.shoulders.thickness;
		}
		if (isRecord(body.arms)) {
			if (typeof body.arms.enabled === "boolean") geom.bodyArmsEnabled = body.arms.enabled;
			if (body.arms.style === "none" || body.arms.style === "line" || body.arms.style === "arc") {
				geom.bodyArmsStyle = body.arms.style;
			}
			if (typeof body.arms.spread === "number") geom.bodyArmsSpread = body.arms.spread;
			if (typeof body.arms.drop === "number") geom.bodyArmsDrop = body.arms.drop;
			if (typeof body.arms.bend === "number") geom.bodyArmsBend = body.arms.bend;
			if (typeof body.arms.thickness === "number") geom.bodyArmsThick = body.arms.thickness;
		}
		if (geom.bodyArmsStyle === "none") geom.bodyArmsEnabled = false;
		if (isRecord(body.motion)) {
			if (typeof body.motion.breathFollow === "number") geom.bodyMotionBreathFollow = body.motion.breathFollow;
			if (typeof body.motion.tiltFollow === "number") geom.bodyMotionTiltFollow = body.motion.tiltFollow;
			if (typeof body.motion.weightShift === "number") geom.bodyMotionWeightShift = body.motion.weightShift;
			if (typeof body.motion.idleSway === "number") geom.bodyMotionIdleSway = body.motion.idleSway;
			if (typeof body.motion.idleSwayRate === "number") geom.bodyMotionIdleSwayRate = body.motion.idleSwayRate;
			if (typeof body.motion.speakingBob === "number") geom.bodyMotionSpeakingBob = body.motion.speakingBob;
		}
		if (isRecord(body.constraints)) {
			if (typeof body.constraints.maxTilt === "number") geom.bodyMaxTilt = body.constraints.maxTilt;
			if (typeof body.constraints.maxShiftX === "number") geom.bodyMaxShiftX = body.constraints.maxShiftX;
			if (typeof body.constraints.maxShiftY === "number") geom.bodyMaxShiftY = body.constraints.maxShiftY;
		}
	}

	// Animation
	if (a) {
		if (a.breathAmount !== undefined) geom.breathAmt = a.breathAmount;
		if (a.breathY !== undefined) geom.breathY = a.breathY;
		if (a.headSway !== undefined) geom.headSway = a.headSway;
		if (a.blinkInterval && a.blinkInterval.length === 2) {
			geom.blinkIntervalOverride = [a.blinkInterval[0], a.blinkInterval[1]];
		}
		if (a.doubleBlink !== undefined) geom.doubleBlinkChance = a.doubleBlink;
		if (a.colorSpeed) {
			const cs = a.colorSpeed as Record<string, number>;
			if (cs.default !== undefined) geom.colorSpeedDefault = cs.default;
			if (cs.alert !== undefined) geom.colorSpeedAlert = cs.alert;
			if (cs.sleeping !== undefined) geom.colorSpeedSleeping = cs.sleeping;
		}
		if (a.lerp) {
			const l = a.lerp as Record<string, number>;
			if (l.amplitude !== undefined) geom.lerpAmplitude = l.amplitude;
			if (l.lookAt !== undefined) geom.lerpLookAt = l.lookAt;
			if (l.mouth !== undefined) geom.lerpMouth = l.mouth;
			if (l.happiness !== undefined) geom.lerpHappiness = l.happiness;
			if (l.confusion !== undefined) geom.lerpConfusion = l.confusion;
			if (l.brows !== undefined) geom.lerpBrows = l.brows;
			if (l.eyeScale !== undefined) geom.lerpEyeScale = l.eyeScale;
			if (l.tilt !== undefined) geom.lerpTilt = l.tilt;
			if (l.blush !== undefined) geom.lerpBlush = l.blush;
			if (l.wink !== undefined) geom.lerpWink = l.wink;
			if (l.lid !== undefined) geom.lerpLid = l.lid;
		}
		if (a.microExpressions) {
			const me = a.microExpressions;
			if (me.enabled !== undefined) geom.microEnabled = me.enabled;
			if (me.eyeDart?.interval && me.eyeDart.interval.length === 2) {
				geom.microGlanceInterval = [me.eyeDart.interval[0], me.eyeDart.interval[1]];
				geom.microJitterInterval = [Math.max(0.1, me.eyeDart.interval[0] * 0.1), Math.max(0.2, me.eyeDart.interval[1] * 0.1)];
			}
			if (me.eyeDart?.rangeX !== undefined) geom.microGlanceRangeX = me.eyeDart.rangeX * 2;
			if (me.eyeDart?.rangeY !== undefined) geom.microGlanceRangeY = me.eyeDart.rangeY * 2;
			if (me.eyeDart?.duration !== undefined) {
				const d = me.eyeDart.duration;
				geom.microGlanceHold = [Math.max(0.1, d * 0.7), Math.max(0.2, d * 1.7)];
			}
			if (me.mouthTwitch?.interval && me.mouthTwitch.interval.length === 2) {
				geom.microMouthTwitchInterval = [me.mouthTwitch.interval[0], me.mouthTwitch.interval[1]];
			}
			if (me.mouthTwitch?.range !== undefined) geom.microMouthTwitchRange = me.mouthTwitch.range;
		}
	}

	// Palette colors
	if (p.feature) geom.featureColor = p.feature;
	// Per-feature colors (empty string = use featureColor)
	if (typeof p.eyeFill === "string") geom.eyeFillColor = p.eyeFill;
	if (typeof p.eyeStroke === "string") geom.eyeStrokeColor = p.eyeStroke;
	if (typeof p.mouthFill === "string") geom.mouthFillColor = p.mouthFill;
	if (typeof p.mouthStroke === "string") geom.mouthStrokeColor = p.mouthStroke;
	if (typeof p.browFill === "string") geom.browColor = p.browFill;
	if (headPaletteRecord && typeof headPaletteRecord === "object") {
		const headPalette = headPaletteRecord as Record<string, unknown>;
		if (typeof headPalette.fill === "string") geom.headFillColor = headPalette.fill;
		if (typeof headPalette.stroke === "string") geom.headStrokeColor = headPalette.stroke;
	}
	if (p.specular) geom.specularColor = p.specular;
	if (p.blush) geom.blushColor = p.blush;
	if (bodyPaletteRecord && typeof bodyPaletteRecord === "object") {
		const bodyPalette = bodyPaletteRecord as Record<string, unknown>;
		if (typeof bodyPalette.fill === "string") geom.bodyFillColor = bodyPalette.fill;
		if (typeof bodyPalette.stroke === "string") {
			geom.bodyStrokeColor = bodyPalette.stroke;
			bodyStrokeExplicit = true;
		}
		if (typeof bodyPalette.neck === "string") {
			geom.bodyNeckColor = bodyPalette.neck;
			bodyNeckExplicit = true;
		}
		if (typeof bodyPalette.arms === "string") {
			geom.bodyArmsColor = bodyPalette.arms;
			bodyArmsExplicit = true;
		}
		if (typeof bodyPalette.shadow === "string") geom.bodyShadowColor = bodyPalette.shadow;
		if (typeof bodyPalette.shadowAlpha === "number") geom.bodyShadowAlpha = bodyPalette.shadowAlpha;
	}
	// Keep feature-follow defaults unless explicitly overridden.
	if (!(eyesRecord.pupil && typeof (eyesRecord.pupil as Record<string, unknown>).color === "string")) {
		geom.pupilColor = geom.featureColor;
	}
	if (!(eyesRecord.eyelid && typeof (eyesRecord.eyelid as Record<string, unknown>).color === "string")) {
		geom.eyelidColor = geom.featureColor;
	}
	if (!geom.headStrokeColor && geom.headStrokeW > 0) {
		geom.headStrokeColor = geom.featureColor;
	}
	if (!bodyStrokeExplicit) geom.bodyStrokeColor = geom.featureColor;
	if (!bodyNeckExplicit) geom.bodyNeckColor = geom.featureColor;
	if (!bodyArmsExplicit) geom.bodyArmsColor = geom.featureColor;
	if (paletteRecord.emotionColorBlend !== undefined) {
		geom.emotionColorBlend = paletteRecord.emotionColorBlend as number;
	}

	// Personality → animation behavior
	const pers = def.personality;
	if (pers) {
		// energy (0-1) → animSpeed (0.6-1.4)
		if (pers.energy !== undefined) geom.animSpeed = 0.6 + pers.energy * 0.8;
		// expressiveness (0-1) → animRange (0.4-1.6)
		if (pers.expressiveness !== undefined) geom.animRange = 0.4 + pers.expressiveness * 1.2;
		// warmth (0-1) → warmthBias (-0.15 to +0.15)
		if (pers.warmth !== undefined) geom.warmthBias = (pers.warmth - 0.5) * 0.3;
		// stability (0-1) → microFreqMult (2.0x less at high stability, 0.5x more at low)
		if (pers.stability !== undefined) geom.microFreqMult = 0.5 + pers.stability * 1.5;
		// playfulness (0-1) → playMult (0.5-1.5)
		if (pers.playfulness !== undefined) geom.playMult = 0.5 + pers.playfulness;
	}

	geom.stateOverrides = def.states ? { ...def.states } : {};
	geom.emotionOverrides = def.emotionDeltas ? { ...(def.emotionDeltas as Record<string, Record<string, unknown>>) } : {};
	geom.accessories = normalizeAccessories((def as Record<string, unknown>).accessories);
	geom.decorations = normalizeDecorations((def as Record<string, unknown>).decorations);
}

/** Create default state colors. */
export function createStateColors(): Record<FaceState, string> {
	return { ...DEFAULT_STATE_COLORS };
}

/** Create default emotion colors. */
export function createEmotionColors(): Record<FaceEmotion, string | null> {
	return { ...DEFAULT_EMOTION_COLORS };
}
