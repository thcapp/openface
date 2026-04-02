/** Valid face states (activities). */
export const STATES = [
	"idle", "thinking", "speaking", "listening",
	"reacting", "puzzled", "alert", "working", "sleeping",
	"waiting", "loading",
] as const;
export type FaceState = (typeof STATES)[number];

/** Valid emotions (mood overlays). */
export const EMOTIONS = [
	"neutral", "happy", "sad", "confused",
	"excited", "concerned", "surprised", "playful",
	"frustrated", "skeptical", "determined", "embarrassed", "proud",
] as const;
export type FaceEmotion = (typeof EMOTIONS)[number];

/** Default state-to-color mapping. */
export const DEFAULT_STATE_COLORS: Record<FaceState, string> = {
	idle: "#4FC3F7", thinking: "#CE93D8", speaking: "#4FC3F7", listening: "#81C784",
	reacting: "#FFB74D", puzzled: "#FF8A65", alert: "#E57373", working: "#90CAF9",
	sleeping: "#7986CB", waiting: "#B0BEC5", loading: "#78909C",
};

/** Default emotion-to-color mapping (null = use state color). */
export const DEFAULT_EMOTION_COLORS: Record<FaceEmotion, string | null> = {
	neutral: null, happy: "#FFD54F", sad: "#7986CB", confused: "#FF8A65",
	excited: "#FF7043", concerned: "#B0BEC5", surprised: "#FFF176", playful: "#F48FB1",
	frustrated: "#EF5350", skeptical: "#BCAAA4", determined: "#66BB6A",
	embarrassed: "#F48FB1", proud: "#FFB300",
};

/** Target state — what the face is animating toward. */
export interface TargetState {
	state: FaceState;
	emotion: FaceEmotion;
	emotionSecondary: FaceEmotion;
	emotionBlend: number;
	intensity: number;
	amplitude: number;
	lookX: number;
	lookY: number;
	color: string | null;
	winkLeft: number;
	winkRight: number;
	progress: number | null;
}

/** Interpolated current values — what's actually being drawn. */
export interface CurrentState {
	amplitude: number;
	lookX: number;
	lookY: number;
	mouthOpen: number;
	browLeft: number;
	browRight: number;
	lidTop: number;
	shake: number;
	breathe: number;
	pulse: number;
	happiness: number;
	confusion: number;
	eyeScaleL: number;
	eyeScaleR: number;
	tilt: number;
	bounce: number;
	blushAlpha: number;
	winkL: number;
	winkR: number;
	squint: number;
	mouthWidth: number;
	mouthAsymmetry: number;
	/** Eye slope — tilts top bezier control points. Positive = inner up (angry), negative = inner down (sad). */
	eyeSlopeL: number;
	eyeSlopeR: number;
}

/** Eye rendering style. */
export type EyeStyle = "oval" | "round" | "rectangle" | "dot" | "almond" | "crescent" | "star" | "heart" | "cat" | "cross" | "diamond" | "semicircle";
/** Head/background silhouette style. */
export type HeadShape = "fullscreen" | "circle" | "rounded" | "oval" | "squircle" | "hexagon" | "diamond" | "egg" | "pill" | "shield" | "cloud" | "octagon";
/** Brow rendering style. */
export type BrowRenderer = "line" | "flat" | "block" | "none" | "arch" | "angled" | "thick" | "dot";
/** Eyelash/eyeliner style. */
export type EyelashStyle = "none" | "simple" | "thick" | "wing" | "bottom" | "full" | "spider";
/** Nose style. */
export type NoseStyle = "none" | "dot" | "line" | "triangle" | "L" | "button";
/** Eyelid rendering style. */
export type EyelidRenderer = "none" | "cover";
/** Body silhouette style. */
export type BodyShape = "capsule" | "trapezoid" | "roundedRect" | "blob";
/** Mouth shape style. */
export type MouthStyle = "curve" | "cat" | "slit" | "zigzag" | "pixel" | "circle" | "fang" | "smirk" | "wave" | "none";
/** Specular highlight shape. */
export type SpecularShape = "circle" | "star" | "crescent" | "dual" | "line" | "cross" | "ring" | "none";
/** Pupil shape. */
export type PupilShape = "circle" | "slit" | "star" | "heart" | "diamond" | "cross" | "ring" | "flower" | "spiral" | "none";

/** Per-eye override — allows left/right eyes to differ (heterochromia, mixed styles). */
export interface PerEyeOverride {
	style?: EyeStyle;
	pupilShape?: PupilShape;
	pupilColor?: string;
	specularShape?: SpecularShape;
	specularSize?: number;
}
/** Body arm style. */
export type BodyArmStyle = "none" | "line" | "arc";
/** Face decoration type. */
export type DecorationType = "freckles" | "tears" | "sweat" | "scar" | "stripes" | "sparkles" | "bandaid" | "hearts" | "stars" | "lines";

/** A single face decoration entry. */
export interface FaceDecoration {
	type: DecorationType;
	enabled: boolean;
	color: string;
	alpha: number;
	size: number;
}

/** Accessory render layer. */
export type AccessoryLayer = "back" | "mid" | "front" | "overlay";
/** Accessory type. */
export type AccessoryType = "antenna" | "glasses";

export interface AccessoryOverridePatch {
	color?: string;
	tipColor?: string;
	tipSize?: number;
	lineWidth?: number;
	lensAlpha?: number;
	restAngle?: number;
	restCurve?: number;
	tipCurl?: number;
	physics?: Partial<AccessoryPhysicsConfig>;
}
export type AccessoryStateOverrideMap = Partial<Record<FaceState, AccessoryOverridePatch>>;
export type AccessoryEmotionOverrideMap = Partial<Record<FaceEmotion, AccessoryOverridePatch>>;

export interface AccessoryAnchor {
	x: number;
	y: number;
}

export interface AccessoryPhysicsConfig {
	enabled?: boolean;
	stiffness?: number;
	damping?: number;
	gravity?: number;
	headInfluence?: number;
}

interface AccessoryDefinitionBase {
	id: string;
	type: AccessoryType;
	enabled?: boolean;
	layer?: AccessoryLayer;
	anchor: AccessoryAnchor;
	color?: string;
	stateOverrides?: AccessoryStateOverrideMap;
	emotionOverrides?: AccessoryEmotionOverrideMap;
}

export interface AntennaAccessoryDefinition extends AccessoryDefinitionBase {
	type: "antenna";
	segments: number;
	segmentLength: number;
	/** Outward tilt in degrees from vertical-up (positive tilts away from center). */
	restAngle?: number;
	/** Additional outward arc bias for the resting curve (-1..1). */
	restCurve?: number;
	/** Near-tip inward curl amount (-1..1). */
	tipCurl?: number;
	thickness?: {
		base: number;
		tip: number;
	};
	tipShape?: "circle" | "diamond";
	tipSize?: number;
	tipColor?: string;
	symmetry?: "none" | "mirrorX";
	physics?: AccessoryPhysicsConfig;
}

export interface GlassesAccessoryDefinition extends AccessoryDefinitionBase {
	type: "glasses";
	shape: "round" | "rect";
	frameWidth?: number;
	frameHeight?: number;
	bridgeWidth?: number;
	lineWidth?: number;
	followEyes?: number;
	lensAlpha?: number;
}

export type AccessoryDefinition = AntennaAccessoryDefinition | GlassesAccessoryDefinition;

export interface AccessoryPhysicsPoint {
	x: number;
	y: number;
	prevX: number;
	prevY: number;
}

export interface AccessoryPhysicsState {
	id: string;
	type: AccessoryType;
	points: AccessoryPhysicsPoint[];
}

/** Geometry parameters derived from face definition. */
export interface FaceGeometry {
	headShape: HeadShape;
	headW: number;
	headH: number;
	headY: number;
	headRadius: number;
	headStrokeW: number;
	eyeStyle: EyeStyle;
	eyeW: number;
	eyeH: number;
	eyeSpacing: number;
	eyeY: number;
	/** Per-state base eye scales [left, right]. */
	eyeStateScales: Record<FaceState, [number, number]>;
	specularEnabled: boolean;
	specularShape: SpecularShape;
	specularSize: number;
	specularShiftX: number;
	specularShiftY: number;
	specularLookFollow: number;
	specularAlpha: number;
	/** Per-eye overrides for left eye (side === -1). Empty = use shared values. */
	eyeLeftOverride: PerEyeOverride;
	/** Per-eye overrides for right eye (side === 1). Empty = use shared values. */
	eyeRightOverride: PerEyeOverride;
	mouthStyle: MouthStyle;
	mouthW: number;
	mouthY: number;
	speakBase: number;
	browThick: number;
	browRange: number;
	browCurve: number;
	browVert: number;
	browRenderer: BrowRenderer;
	browRendererByState: Partial<Record<FaceState, BrowRenderer>>;
	browRendererByEmotion: Partial<Record<FaceEmotion, BrowRenderer>>;
	lockEyes: boolean;
	lockMouth: boolean;
	lockBrows: boolean;
	eyeScaleMin: number;
	eyeScaleMax: number;
	mouthOpenMin: number;
	mouthOpenMax: number;
	mouthWidthMin: number;
	mouthWidthMax: number;
	browMin: number;
	browMax: number;
	pupilEnabled: boolean;
	pupilShape: PupilShape;
	pupilSize: number;
	pupilShiftX: number;
	pupilShiftY: number;
	pupilLookFollow: number;
	pupilColor: string;
	eyelidRenderer: EyelidRenderer;
	eyelidStrength: number;
	eyelidColor: string;
	eyelashStyle: EyelashStyle;
	blushAlpha: number;
	blushSize: number;
	noseStyle: NoseStyle;
	noseSize: number;
	noseVerticalPosition: number;
	noseColor: string;
	bodyEnabled: boolean;
	bodyAnchorX: number;
	bodyAnchorY: number;
	bodyShape: BodyShape;
	bodyW: number;
	bodyH: number;
	bodyRadius: number;
	bodyNeckEnabled: boolean;
	bodyNeckW: number;
	bodyNeckH: number;
	bodyNeckOffsetY: number;
	bodyShouldersEnabled: boolean;
	bodyShouldersW: number;
	bodyShouldersSlope: number;
	bodyShouldersThick: number;
	bodyArmsEnabled: boolean;
	bodyArmsStyle: BodyArmStyle;
	bodyArmsSpread: number;
	bodyArmsDrop: number;
	bodyArmsBend: number;
	bodyArmsThick: number;
	bodyMotionBreathFollow: number;
	bodyMotionTiltFollow: number;
	bodyMotionWeightShift: number;
	bodyMotionIdleSway: number;
	bodyMotionIdleSwayRate: number;
	bodyMotionSpeakingBob: number;
	bodyMaxTilt: number;
	bodyMaxShiftX: number;
	bodyMaxShiftY: number;
	breathAmt: number;
	breathY: number;
	headSway: number;
	colorSpeedDefault: number;
	colorSpeedAlert: number;
	colorSpeedSleeping: number;
	lerpAmplitude: number;
	lerpLookAt: number;
	lerpMouth: number;
	lerpHappiness: number;
	lerpConfusion: number;
	lerpBrows: number;
	lerpEyeScale: number;
	lerpTilt: number;
	lerpBlush: number;
	lerpWink: number;
	lerpLid: number;
	blinkIntervalOverride: [number, number] | null;
	doubleBlinkChance: number;
	microEnabled: boolean;
	microJitterInterval: [number, number];
	microJitterRangeX: number;
	microJitterRangeY: number;
	microGlanceInterval: [number, number];
	microGlanceRangeX: number;
	microGlanceRangeY: number;
	microGlanceHold: [number, number];
	microMouthTwitchInterval: [number, number];
	microMouthTwitchRange: number;
	stateOverrides: Partial<Record<FaceState, Record<string, unknown>>>;
	emotionOverrides: Partial<Record<FaceEmotion, Record<string, unknown>>>;
	featureColor: string;
	/** Per-feature colors — empty string means "use featureColor". */
	eyeFillColor: string;
	eyeStrokeColor: string;
	mouthFillColor: string;
	mouthStrokeColor: string;
	browColor: string;
	headFillColor: string | null;
	headStrokeColor: string | null;
	specularColor: string;
	blushColor: string;
	bodyFillColor: string;
	bodyStrokeColor: string;
	bodyNeckColor: string;
	bodyArmsColor: string;
	bodyShadowColor: string;
	bodyShadowAlpha: number;
	/** How much emotion colors override state colors (0 = state only, 1 = full override). */
	emotionColorBlend: number;
	// Personality — modulate animation behavior
	/** Animation speed multiplier (0.6x slow → 1.4x snappy). Maps from personality.energy. */
	animSpeed: number;
	/** Parameter range multiplier (0.4x subtle → 1.6x dramatic). Maps from personality.expressiveness. */
	animRange: number;
	/** Happiness baseline offset (-0.15 → +0.15). Maps from personality.warmth. */
	warmthBias: number;
	/** Inverse micro-expression frequency (0.5x more → 2x less). Maps from personality.stability. */
	microFreqMult: number;
	/** Asymmetry and sway amplitude multiplier. Maps from personality.playfulness. */
	playMult: number;

	/** Mouth rendering mode. "fill" = filled bezier shape. "line" = stroked curve (original MVP style). */
	mouthRenderer: "fill" | "line";
	/** Optional per-state mouth renderer overrides. */
	mouthRendererByState: Partial<Record<FaceState, "fill" | "line">>;
	/** Optional per-emotion mouth renderer overrides. */
	mouthRendererByEmotion: Partial<Record<FaceEmotion, "fill" | "line">>;
	accessories: AccessoryDefinition[];
	decorations: FaceDecoration[];
}

/** Style variant for rendering. */
export type StyleVariant = "classic" | "gradient" | "minimal";

/** Incoming state update message (all fields optional). */
export interface StateUpdate {
	state?: FaceState;
	emotion?: FaceEmotion;
	emotionSecondary?: FaceEmotion;
	emotionBlend?: number;
	intensity?: number;
	amplitude?: number;
	lookAt?: { x: number; y: number };
	color?: string | null;
	winkLeft?: number;
	winkRight?: number;
	progress?: number | null;
	text?: string | null;
	textDuration?: number;
	detail?: string | null;
	type?: "state" | "reset" | "ping" | "pong";
}

/** Face definition loaded from .face.json. */
export interface FaceDefinition {
	$schema?: string;
	$type?: "face";
	$version?: string;
	meta: {
		name: string;
		author?: string;
		license?: string;
		description?: string;
	};
	geometry: {
		/** Legacy alias for geometry.head.shape. */
		shape?: HeadShape;
		head?: {
			shape?: HeadShape;
			width?: number;
			height?: number;
			verticalPosition?: number;
			radius?: number;
			strokeWidth?: number;
		};
		eyes: {
			style: EyeStyle;
			baseWidth: number;
			baseHeight: number;
			spacing: number;
			verticalPosition?: number;
			specular?: {
				enabled?: boolean;
				shape?: SpecularShape;
				size?: number;
				shiftX?: number;
				shiftY?: number;
				lookFollow?: number;
				alpha?: number;
			};
			pupil?: {
				enabled?: boolean;
				shape?: PupilShape;
				size?: number;
				shiftX?: number;
				shiftY?: number;
				lookFollow?: number;
				color?: string;
			};
			eyelid?: {
				renderer?: EyelidRenderer;
				strength?: number;
				color?: string;
			};
			eyelash?: {
				style?: EyelashStyle;
			};
			constraints?: {
				scaleMin?: number;
				scaleMax?: number;
			};
			stateScales?: Partial<Record<FaceState, [number, number]>>;
			leftOverride?: Partial<PerEyeOverride>;
			rightOverride?: Partial<PerEyeOverride>;
		};
		mouth: {
			width: number;
			verticalPosition?: number;
			style: MouthStyle;
			speakingBase?: number;
			renderer?: "fill" | "line";
			rendererByState?: Partial<Record<FaceState, "fill" | "line">>;
			rendererByEmotion?: Partial<Record<FaceEmotion, "fill" | "line">>;
			constraints?: {
				openMin?: number;
				openMax?: number;
				widthMin?: number;
				widthMax?: number;
			};
		};
		brows?: {
			enabled?: boolean;
			baseThickness?: number;
			range?: number;
			curveRange?: number;
			verticalOffset?: number;
			renderer?: BrowRenderer;
			rendererByState?: Partial<Record<FaceState, BrowRenderer>>;
			rendererByEmotion?: Partial<Record<FaceEmotion, BrowRenderer>>;
			constraints?: {
				min?: number;
				max?: number;
			};
		};
		locks?: {
			eyes?: boolean;
			mouth?: boolean;
			brows?: boolean;
		};
		blush?: {
			enabled?: boolean;
			maxAlpha?: number;
			size?: number;
		};
		nose?: {
			style?: NoseStyle;
			size?: number;
			verticalPosition?: number;
			color?: string;
		};
		body?: {
			enabled?: boolean;
			anchor?: {
				x?: number;
				y?: number;
			};
			shape?: BodyShape;
			width?: number;
			height?: number;
			radius?: number;
			neck?: {
				enabled?: boolean;
				width?: number;
				height?: number;
				offsetY?: number;
			};
			shoulders?: {
				enabled?: boolean;
				width?: number;
				slope?: number;
				thickness?: number;
			};
			arms?: {
				enabled?: boolean;
				style?: BodyArmStyle;
				spread?: number;
				drop?: number;
				bend?: number;
				thickness?: number;
			};
			motion?: {
				breathFollow?: number;
				tiltFollow?: number;
				weightShift?: number;
				idleSway?: number;
				idleSwayRate?: number;
				speakingBob?: number;
			};
			constraints?: {
				maxTilt?: number;
				maxShiftX?: number;
				maxShiftY?: number;
			};
		};
	};
	palette: {
		feature?: string;
		eyeFill?: string;
		eyeStroke?: string;
		mouthFill?: string;
		mouthStroke?: string;
		browFill?: string;
		head?: {
			fill?: string;
			stroke?: string;
		};
		specular?: string;
		blush?: string;
		nose?: string;
		body?: {
			fill?: string;
			stroke?: string;
			neck?: string;
			arms?: string;
			shadow?: string;
			shadowAlpha?: number;
		};
		states: Partial<Record<FaceState, string>>;
		emotions?: Partial<Record<FaceEmotion, string | null>>;
	};
	animation?: {
		breathAmount?: number;
		breathY?: number;
		headSway?: number;
		blinkInterval?: [number, number];
		doubleBlink?: number;
		colorSpeed?: Record<string, number>;
		lerp?: Record<string, number>;
		microExpressions?: {
			enabled?: boolean;
			eyeDart?: { interval?: [number, number]; rangeX?: number; rangeY?: number; duration?: number };
			mouthTwitch?: { interval?: [number, number]; range?: number };
		};
	};
	personality?: {
		energy?: number;
		expressiveness?: number;
		warmth?: number;
		stability?: number;
		playfulness?: number;
	};
	accessories?: AccessoryDefinition[];
	decorations?: Array<{
		type: string;
		enabled?: boolean;
		color?: string;
		alpha?: number;
		size?: number;
	}>;
	states?: Record<string, Record<string, unknown>>;
	emotionDeltas?: Record<string, Record<string, unknown>>;
}
