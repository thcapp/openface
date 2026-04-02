export type {
	AccessoryDefinition,
	AccessoryLayer,
	AccessoryPhysicsState,
	AccessoryType,
	CurrentState,
	DecorationType,
	EyelashStyle,
	FaceDecoration,
	FaceDefinition,
	FaceEmotion,
	FaceGeometry,
	FaceState,
	HeadShape,
	MouthStyle,
	NoseStyle,
	PerEyeOverride,
	SpecularShape,
	StateUpdate,
	StyleVariant,
	TargetState,
} from "./types.js";

export { STATES, EMOTIONS, DEFAULT_STATE_COLORS, DEFAULT_EMOTION_COLORS } from "./types.js";
export { dlerp, hexToRGB, rgbToHex } from "./math.js";
export { createDefaultGeometry, applyFaceDefinition, createStateColors, createEmotionColors } from "./face-loader.js";
export {
	hslToHex,
	hexToHSL,
	interpolateColorHSL,
	relativeLuminance,
	contrastRatio,
	generateStateColors as generateStateColorsFromSeed,
	generateEmotionColors as generateEmotionColorsFromSeed,
	generateFullPalette,
	generateProportions,
	applyPersonalityToGeometry,
	ARCHETYPES,
	computeEnergy,
	generateFromArchetype,
	generateFromPersonality,
	generateFromDescription,
	interpolatePacks,
	evolve,
} from "./face-generator.js";
export type { Archetype, Personality } from "./face-generator.js";

import { createAnticipationState, createBlinkState, createMicroState } from "./blink.js";
import type { AnticipationState, BlinkState, MicroState } from "./blink.js";
import { createColorState, drawFace } from "./draw.js";
import {
	createAntennaPhysicsState,
	isAntennaPhysicsStateValid,
	resolveAntennaPhysicsConfig,
	simulateAntennaPhysicsStep,
	type AccessorySimulationFrame,
} from "./accessory-physics.js";
import { hexToRGB } from "./math.js";
import type { ColorState } from "./draw.js";
import { applyFaceDefinition, createDefaultGeometry, createEmotionColors, createStateColors, normalizeFaceDefinition } from "./face-loader.js";
import { interpolate } from "./interpolation.js";
import type { InterpolationContext } from "./interpolation.js";
import type {
	AccessoryPhysicsState,
	CurrentState,
	FaceDefinition,
	FaceEmotion,
	FaceGeometry,
	FaceState,
	StateUpdate,
	StyleVariant,
	TargetState,
} from "./types.js";
import { EMOTIONS, STATES } from "./types.js";

function clamp(val: number, min: number, max: number): number {
	return Math.max(min, Math.min(max, val));
}

const ACCESSORY_PHYSICS_STEP_SEC = 1 / 120;
const ACCESSORY_PHYSICS_MAX_SUBSTEPS = 8;
const ACCESSORY_PHYSICS_RESET_DT_SEC = 0.25;

export interface FaceRendererOptions {
	/** Canvas element to render onto. */
	canvas: HTMLCanvasElement;
	/** Initial style variant. */
	style?: StyleVariant;
	/** Respect prefers-reduced-motion. */
	reducedMotion?: boolean;
	/** Draw debug guides (anchors/bounds) over features. */
	debugOverlay?: boolean;
}

/**
 * Core face renderer — framework-agnostic Canvas2D engine.
 *
 * Usage:
 * ```ts
 * const renderer = new FaceRenderer({ canvas: myCanvas });
 * renderer.start();
 * renderer.setState({ state: "thinking", emotion: "happy" });
 * ```
 */
export class FaceRenderer {
	private canvas: HTMLCanvasElement;
	private ctx: CanvasRenderingContext2D;
	private width = 0;
	private height = 0;
	private rafId: number | null = null;
	private lastTime = 0;

	// State
	private target: TargetState;
	private current: CurrentState;
	private interpCtx: InterpolationContext;
	private blink: BlinkState;
	private micro: MicroState;
	private colorState: ColorState;
	private geom: FaceGeometry;
	private stateColors: Record<string, string>;
	private emotionColors: Record<string, string | null>;
	private style: StyleVariant;
	private disconnected = false;
	private debugOverlay = false;
	private accessoryPhysics = new Map<string, AccessoryPhysicsState>();
	private accessoryPhysicsAccumulator = 0;

	// Callbacks
	private onStateChange: ((state: FaceState, prev: FaceState) => void) | null = null;

	constructor(options: FaceRendererOptions) {
		this.canvas = options.canvas;
		this.style = options.style ?? "classic";

		const needsAlpha = this.style === "minimal";
		this.ctx = this.canvas.getContext("2d", { alpha: needsAlpha })!;

		this.target = {
			state: "idle", emotion: "neutral",
			emotionSecondary: "neutral", emotionBlend: 0, intensity: 1.0,
			amplitude: 0, lookX: 0, lookY: 0, color: null,
			winkLeft: 0, winkRight: 0, progress: null,
		};
		this.current = {
			amplitude: 0, lookX: 0, lookY: 0, mouthOpen: 0,
			browLeft: 0, browRight: 0, lidTop: 1, shake: 0,
			breathe: 0, pulse: 0, happiness: 0, confusion: 0,
			eyeScaleL: 1, eyeScaleR: 1, tilt: 0, bounce: 1,
			blushAlpha: 0, winkL: 0, winkR: 0,
			squint: 0, mouthWidth: 0, mouthAsymmetry: 0, eyeSlopeL: 0, eyeSlopeR: 0,
		};
		this.interpCtx = {
			activeState: "idle",
			activeEmotion: "neutral",
			stateTime: 0,
			lastLookAtElapsed: 0,
			transitionElapsed: 0,
			reducedMotion: options.reducedMotion ?? false,
			anticipation: createAnticipationState(),
		};
		this.blink = createBlinkState();
		this.micro = createMicroState();
		this.colorState = createColorState();
		this.geom = createDefaultGeometry();
		this.stateColors = createStateColors();
		this.emotionColors = createEmotionColors();
		this.debugOverlay = !!options.debugOverlay;
	}

	private resetFaceConfig(): void {
		this.geom = createDefaultGeometry();
		this.stateColors = createStateColors();
		this.emotionColors = createEmotionColors();
		this.resetAccessoryPhysics();
	}

	private resetAccessoryPhysics(): void {
		this.accessoryPhysics.clear();
		this.accessoryPhysicsAccumulator = 0;
	}

	/** Start the animation loop. */
	start(): void {
		if (this.rafId !== null) return;
		this.lastTime = performance.now();
		this.rafId = requestAnimationFrame(this.loop);
	}

	/** Stop the animation loop. */
	stop(): void {
		if (this.rafId !== null) {
			cancelAnimationFrame(this.rafId);
			this.rafId = null;
		}
	}

	/** Whether the animation loop is running. */
	get running(): boolean {
		return this.rafId !== null;
	}

	/** Update canvas dimensions (call after resize). */
	resize(width: number, height: number): void {
		const dpr = typeof devicePixelRatio !== "undefined" ? devicePixelRatio : 1;
		this.canvas.width = width * dpr;
		this.canvas.height = height * dpr;
		this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
		this.width = width;
		this.height = height;
		this.resetAccessoryPhysics();
	}

	/** Apply a partial state update. */
	setState(update: StateUpdate): void {
		if (update.type === "reset") {
			this.target.state = "idle";
			this.target.emotion = "neutral";
			this.target.emotionSecondary = "neutral";
			this.target.emotionBlend = 0;
			this.target.intensity = 1.0;
			this.target.amplitude = 0;
			this.target.lookX = 0;
			this.target.lookY = 0;
			this.target.color = null;
			this.target.winkLeft = 0;
			this.target.winkRight = 0;
			this.target.progress = null;
			return;
		}
		if (update.state && STATES.includes(update.state)) this.target.state = update.state;
		if (update.emotion && EMOTIONS.includes(update.emotion)) this.target.emotion = update.emotion;
		if (update.emotionSecondary && EMOTIONS.includes(update.emotionSecondary)) this.target.emotionSecondary = update.emotionSecondary;
		if (update.emotionBlend !== undefined) this.target.emotionBlend = clamp(update.emotionBlend, 0, 1);
		if (update.intensity !== undefined) this.target.intensity = clamp(update.intensity, 0, 1);
		if (update.amplitude !== undefined) this.target.amplitude = clamp(update.amplitude, 0, 1);
		if (update.lookAt) {
			this.target.lookX = clamp(update.lookAt.x, -1, 1);
			this.target.lookY = clamp(update.lookAt.y, -1, 1);
			this.interpCtx.lastLookAtElapsed = 0;
		}
		if (update.color !== undefined) this.target.color = update.color;
		if (update.winkLeft !== undefined) this.target.winkLeft = clamp(update.winkLeft, 0, 1);
		if (update.winkRight !== undefined) this.target.winkRight = clamp(update.winkRight, 0, 1);
		if (update.progress !== undefined) this.target.progress = update.progress === null ? null : clamp(update.progress, 0, 1);
	}

	/** Load a face definition (from parsed .face.json). */
	loadFace(def: FaceDefinition): void {
		normalizeFaceDefinition(def);
		// Reset pack-derived config so previous face traits cannot leak across swaps.
		this.resetFaceConfig();
		applyFaceDefinition(def, this.geom, this.stateColors, this.emotionColors);

		// Reset interpolated state — snap to neutral so old pack values don't linger
		this.current.lookX = 0;
		this.current.lookY = 0;
		this.current.eyeScaleL = 1;
		this.current.eyeScaleR = 1;
		this.current.browLeft = 0;
		this.current.browRight = 0;
		this.current.happiness = 0;
		this.current.confusion = 0;
		this.current.squint = 0;
		this.current.mouthWidth = 0;
		this.current.mouthAsymmetry = 0;
		this.current.blushAlpha = 0;
		this.current.tilt = 0;
		this.current.shake = 0;
		this.current.bounce = 1;
		this.current.winkL = 0;
		this.current.winkR = 0;
		this.current.eyeSlopeL = 0;
		this.current.eyeSlopeR = 0;

		// Snap color to new pack's idle color
		const idleColor = this.stateColors.idle || "#4FC3F7";
		const [r, g, b] = hexToRGB(idleColor);
		this.colorState.r = r;
		this.colorState.g = g;
		this.colorState.b = b;

		// Reset blink and micro-expressions
		this.blink = createBlinkState();
		this.micro = createMicroState();
		this.resetAccessoryPhysics();
	}

	/** Reset to built-in default face configuration (no external face pack needed). */
	resetFace(): void {
		this.resetFaceConfig();
		this.current.lookX = 0;
		this.current.lookY = 0;
		this.current.eyeScaleL = 1;
		this.current.eyeScaleR = 1;
		this.current.browLeft = 0;
		this.current.browRight = 0;
		this.current.happiness = 0;
		this.current.confusion = 0;
		this.current.squint = 0;
		this.current.mouthWidth = 0;
		this.current.mouthAsymmetry = 0;
		this.current.blushAlpha = 0;
		this.current.tilt = 0;
		this.current.shake = 0;
		this.current.bounce = 1;
		this.current.winkL = 0;
		this.current.winkR = 0;
		this.current.eyeSlopeL = 0;
		this.current.eyeSlopeR = 0;
		const idleColor = this.stateColors.idle || "#4FC3F7";
		const [r, g, b] = hexToRGB(idleColor);
		this.colorState.r = r;
		this.colorState.g = g;
		this.colorState.b = b;
		this.blink = createBlinkState();
		this.micro = createMicroState();
		this.resetAccessoryPhysics();
	}

	private buildAccessorySimulationFrame(): AccessorySimulationFrame | null {
		if (!this.width || !this.height) return null;
		const unit = Math.min(this.width, this.height);
		const cx = this.width / 2 + (this.interpCtx.reducedMotion ? 0 : this.current.shake * Math.sin(this.interpCtx.stateTime * 40 * Math.PI * 2));
		const cy = this.height / 2;
		const breathY = this.current.breathe * unit * this.geom.breathY;
		return {
			unit,
			cx,
			cy,
			breathY,
			stateTime: this.interpCtx.stateTime,
			reducedMotion: this.interpCtx.reducedMotion,
			activeState: this.interpCtx.activeState,
			target: this.target,
			current: this.current,
		};
	}

	private updateAccessoryPhysics(dt: number, rawDt: number): void {
		if (!this.geom.accessories.length || !this.width || !this.height) {
			this.resetAccessoryPhysics();
			return;
		}
		if (rawDt > ACCESSORY_PHYSICS_RESET_DT_SEC) {
			this.resetAccessoryPhysics();
		}

		const frame = this.buildAccessorySimulationFrame();
		if (!frame) return;

		const activeAntennaIds = new Set<string>();
		for (const accessory of this.geom.accessories) {
			if (accessory.enabled === false || accessory.type !== "antenna") continue;
			const physics = resolveAntennaPhysicsConfig(accessory, this.interpCtx.activeState, this.target);
			if (!physics.enabled) continue;
			activeAntennaIds.add(accessory.id);
		}

		if (!activeAntennaIds.size) {
			this.resetAccessoryPhysics();
			return;
		}
		for (const id of this.accessoryPhysics.keys()) {
			if (!activeAntennaIds.has(id)) this.accessoryPhysics.delete(id);
		}

		this.accessoryPhysicsAccumulator = Math.min(
			this.accessoryPhysicsAccumulator + dt,
			ACCESSORY_PHYSICS_STEP_SEC * ACCESSORY_PHYSICS_MAX_SUBSTEPS,
		);

		let steps = Math.floor(this.accessoryPhysicsAccumulator / ACCESSORY_PHYSICS_STEP_SEC);
		if (steps <= 0) return;
		steps = Math.min(steps, ACCESSORY_PHYSICS_MAX_SUBSTEPS);
		this.accessoryPhysicsAccumulator -= steps * ACCESSORY_PHYSICS_STEP_SEC;

		for (let stepIndex = 0; stepIndex < steps; stepIndex++) {
			const stepTime = ACCESSORY_PHYSICS_STEP_SEC * (stepIndex + 1);
			const stepFrame: AccessorySimulationFrame = {
				...frame,
				stateTime: frame.stateTime - dt + stepTime,
			};

			for (const accessory of this.geom.accessories) {
				if (accessory.enabled === false || accessory.type !== "antenna") continue;
				const physics = resolveAntennaPhysicsConfig(accessory, this.interpCtx.activeState, this.target);
				if (!physics.enabled) {
					this.accessoryPhysics.delete(accessory.id);
					continue;
				}

				let state = this.accessoryPhysics.get(accessory.id);
				if (!state || !isAntennaPhysicsStateValid(state, accessory)) {
					state = createAntennaPhysicsState(accessory, stepFrame);
					this.accessoryPhysics.set(accessory.id, state);
				}

				const ok = simulateAntennaPhysicsStep(
					state,
					accessory,
					physics,
					stepFrame,
					ACCESSORY_PHYSICS_STEP_SEC,
				);
				if (!ok) {
					this.accessoryPhysics.set(accessory.id, createAntennaPhysicsState(accessory, stepFrame));
				}
			}
		}
	}

	/** Set the rendering style variant. */
	setStyle(style: StyleVariant): void {
		this.style = style;
		const needsAlpha = style === "minimal";
		this.ctx = this.canvas.getContext("2d", { alpha: needsAlpha })!;
	}

	/** Mark as disconnected (shows overlay). */
	setDisconnected(disconnected: boolean): void {
		this.disconnected = disconnected;
	}

	/** Update reduced-motion preference reactively. */
	setReducedMotion(reduced: boolean): void {
		this.interpCtx.reducedMotion = reduced;
	}

	setDebugOverlay(enabled: boolean): void {
		this.debugOverlay = enabled;
	}

	/** Register a callback for state changes. */
	onStateChanged(cb: (state: FaceState, prev: FaceState) => void): void {
		this.onStateChange = cb;
	}

	/** Get current target state. */
	getState(): Readonly<TargetState> {
		return this.target;
	}

	/** Get current active state name. */
	get activeState(): FaceState {
		return this.interpCtx.activeState;
	}

	// --- Animation loop ---

	private loop = (now: number): void => {
		const rawDt = (now - this.lastTime) / 1000;
		const dt = Math.min(rawDt, 0.1);
		this.lastTime = now;

		const prevState = this.interpCtx.activeState;
		const changed = interpolate(
			this.current, this.target, this.interpCtx,
			this.blink, this.micro, this.geom, dt,
		);
		if (changed && this.onStateChange) {
			this.onStateChange(this.interpCtx.activeState, prevState);
		}
		this.updateAccessoryPhysics(dt, rawDt);

		drawFace(
			this.ctx, this.width, this.height,
			this.current, this.target, this.geom,
			this.colorState, this.interpCtx.activeState,
			this.interpCtx.stateTime, this.style, dt,
			this.stateColors, this.emotionColors,
			this.disconnected,
			this.interpCtx.reducedMotion,
			this.geom.emotionColorBlend,
			this.debugOverlay,
			this.accessoryPhysics,
		);

		this.rafId = requestAnimationFrame(this.loop);
	};
}
