import { describe, expect, test } from "bun:test";
import { createAnticipationState, createBlinkState, createMicroState } from "../src/blink.js";
import { createDefaultGeometry } from "../src/face-loader.js";
import { interpolate, type InterpolationContext } from "../src/interpolation.js";
import type { CurrentState, TargetState } from "../src/types.js";

function makeCurrent(): CurrentState {
	return {
		amplitude: 0,
		lookX: 0,
		lookY: 0,
		mouthOpen: 0,
		browLeft: 0,
		browRight: 0,
		lidTop: 1,
		shake: 0,
		breathe: 0,
		pulse: 0,
		happiness: 0,
		confusion: 0,
		eyeScaleL: 1,
		eyeScaleR: 1,
		tilt: 0,
		bounce: 1,
		blushAlpha: 0,
		winkL: 0,
		winkR: 0,
		squint: 0,
		mouthWidth: 0,
		mouthAsymmetry: 0,
		eyeSlopeL: 0,
		eyeSlopeR: 0,
	};
}

function makeTarget(): TargetState {
	return {
		state: "thinking",
		emotion: "neutral",
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
	};
}

describe("interpolate", () => {
	function fixture(reducedMotion = true) {
		const current = makeCurrent();
		const target = { ...makeTarget(), state: "idle" as const } as TargetState;
		const geom = createDefaultGeometry();
		const ctx: InterpolationContext = {
			activeState: "idle", activeEmotion: "neutral", stateTime: 0,
			lastLookAtElapsed: 0, transitionElapsed: 1, reducedMotion,
			anticipation: createAnticipationState(),
		};
		const blink = createBlinkState();
		blink.nextBlink = 1000;
		const micro = createMicroState();
		const step = (frames = 240, dt = 1 / 120) => {
			for (let i = 0; i < frames; i++) interpolate(current, target, ctx, blink, micro, geom, dt);
		};
		return { current, target, geom, ctx, micro, step };
	}

	test("preserves neutral zero and exact authored pose values", () => {
		const { current, geom, step } = fixture();
		geom.stateOverrides.idle = { mouth: 0, lid: 1, eyeScale: [1, 1] };
		step();
		expect(current.confusion).toBe(0);
		expect(current.squint).toBe(0);
		expect(current.blushAlpha).toBe(0);
		expect(current.mouthOpen).toBe(0);
		expect(current.eyeScaleL).toBe(1);
		expect(current.eyeScaleR).toBe(1);
		expect(current.lidTop).toBe(1);
	});

	test("keeps fixed constraints finite through anticipation and fast transitions", () => {
		const { current, target, geom, step } = fixture(false);
		geom.eyeScaleMin = geom.eyeScaleMax = 1;
		geom.browMin = geom.browMax = 0;
		geom.mouthOpenMin = geom.mouthOpenMax = 0;
		geom.mouthWidthMin = geom.mouthWidthMax = 0;
		geom.animSpeed = 1.4;
		geom.lerpMouth = geom.lerpBrows = geom.lerpEyeScale = 1;
		for (const state of ["alert", "speaking", "thinking", "idle"] as const) {
			target.state = state;
			target.emotion = "excited";
			target.amplitude = 1;
			for (let frame = 0; frame < 40; frame++) {
				step(1);
				expect(Object.values(current).every(Number.isFinite)).toBe(true);
				expect(current.eyeScaleL).toBe(1);
				expect(current.browLeft).toBe(0);
				expect(current.mouthOpen).toBe(0);
				expect(current.mouthWidth).toBe(0);
			}
		}
	});

	test("applies feature locks after gaze, coupling, and emotion idle motion", () => {
		const { current, target, geom, step } = fixture(false);
		geom.lockEyes = geom.lockBrows = geom.lockMouth = true;
		geom.stateOverrides.idle = { mouth: 0, brows: [0, 0], eyeScale: [1, 1] };
		target.lookX = 1;
		target.lookY = -1;
		target.emotion = "playful";
		step(600);
		expect(current.eyeScaleL).toBe(1);
		expect(current.eyeScaleR).toBe(1);
		expect(current.eyeSlopeL).toBe(0);
		expect(current.eyeSlopeR).toBe(0);
		expect(current.browLeft).toBe(0);
		expect(current.browRight).toBe(0);
		expect(current.mouthOpen).toBe(0);
	});

	test("does not accumulate micro-expression offsets into persistent gaze", () => {
		const { current, target, micro, step } = fixture(false);
		target.lookX = 0.95;
		target.lookY = -0.95;
		micro.nextJitter = micro.nextGlance = 0;
		const command = structuredClone(target);
		step(1200);
		expect(target).toEqual(command);
		expect(Math.abs(current.lookX)).toBeLessThanOrEqual(1);
		expect(Math.abs(current.lookY)).toBeLessThanOrEqual(1);
		target.state = "thinking";
		step(600);
		expect(target.lookX).toBe(command.lookX);
		expect(target.lookY).toBe(command.lookY);
	});

	test("uses geometry eyeStateScales for base state eye targets", () => {
		const geom = createDefaultGeometry();
		geom.eyeStateScales.thinking = [0.65, 1.35];

		const current = makeCurrent();
		const target = makeTarget();
		const ctx = {
			activeState: "idle" as const,
			activeEmotion: "neutral" as const,
			stateTime: 0,
			lastLookAtElapsed: 0,
			transitionElapsed: 0,
			reducedMotion: true,
			anticipation: createAnticipationState(),
		};
		const blink = createBlinkState();
		const micro = createMicroState();

		for (let i = 0; i < 30; i++) {
			interpolate(current, target, ctx, blink, micro, geom, 1 / 60);
		}

		expect(current.eyeScaleL).toBeLessThan(0.95);
		expect(current.eyeScaleR).toBeGreaterThan(1.05);
	});

	test("applies state overrides from geometry", () => {
		const geom = createDefaultGeometry();
		geom.stateOverrides.idle = { mouth: 0.4, brows: [0.2, 0.2] };

		const current = makeCurrent();
		const target = { ...makeTarget(), state: "idle" as const };
		const ctx = {
			activeState: "thinking" as const,
			activeEmotion: "neutral" as const,
			stateTime: 0,
			lastLookAtElapsed: 0,
			transitionElapsed: 0,
			reducedMotion: true,
			anticipation: createAnticipationState(),
		};
		const blink = createBlinkState();
		const micro = createMicroState();

		for (let i = 0; i < 30; i++) {
			interpolate(current, target, ctx, blink, micro, geom, 1 / 60);
		}

		expect(current.mouthOpen).toBeGreaterThan(0.2);
		expect(current.browLeft).toBeGreaterThan(0.05);
	});

	test("applies emotion delta overrides from geometry", () => {
		const geom = createDefaultGeometry();
		geom.emotionOverrides.happy = { happiness: -0.8 };

		const current = makeCurrent();
		const target = { ...makeTarget(), state: "idle" as const, emotion: "happy" as const };
		const ctx = {
			activeState: "idle" as const,
			activeEmotion: "neutral" as const,
			stateTime: 0,
			lastLookAtElapsed: 0,
			transitionElapsed: 0,
			reducedMotion: true,
			anticipation: createAnticipationState(),
		};
		const blink = createBlinkState();
		const micro = createMicroState();

		for (let i = 0; i < 30; i++) {
			interpolate(current, target, ctx, blink, micro, geom, 1 / 60);
		}

		expect(current.happiness).toBeLessThan(0);
	});

	test("respects feature locks for eyes, mouth, and brows", () => {
		const geom = createDefaultGeometry();
		geom.lockEyes = true;
		geom.lockMouth = true;
		geom.lockBrows = true;
		geom.eyeStateScales.alert = [1.4, 1.4];

		const current = makeCurrent();
		const target = { ...makeTarget(), state: "alert" as const, emotion: "excited" as const, amplitude: 1 };
		const ctx = {
			activeState: "idle" as const,
			activeEmotion: "neutral" as const,
			stateTime: 0,
			lastLookAtElapsed: 0,
			transitionElapsed: 0,
			reducedMotion: true,
			anticipation: createAnticipationState(),
		};
		const blink = createBlinkState();
		const micro = createMicroState();

		for (let i = 0; i < 30; i++) interpolate(current, target, ctx, blink, micro, geom, 1 / 60);

		// Eyes still follow state baseline when locked.
		expect(current.eyeScaleL).toBeGreaterThan(1.1);
		// Mouth lock prevents large excited/alert openness.
		expect(current.mouthOpen).toBeLessThan(0.75);
		// Brow lock prevents exaggerated emotion offsets.
		expect(Math.abs(current.browLeft)).toBeLessThan(0.9);
	});

	test("applies geometry constraints to eye, mouth, and brow ranges", () => {
		const geom = createDefaultGeometry();
		geom.eyeScaleMin = 0.95;
		geom.eyeScaleMax = 1.05;
		geom.mouthOpenMin = 0;
		geom.mouthOpenMax = 0.2;
		geom.browMin = -0.1;
		geom.browMax = 0.1;
		geom.mouthWidthMin = -0.05;
		geom.mouthWidthMax = 0.05;

		const current = makeCurrent();
		const target = { ...makeTarget(), state: "alert" as const, emotion: "frustrated" as const, amplitude: 1 };
		const ctx = {
			activeState: "idle" as const,
			activeEmotion: "neutral" as const,
			stateTime: 0,
			lastLookAtElapsed: 0,
			transitionElapsed: 0,
			reducedMotion: true,
			anticipation: createAnticipationState(),
		};
		const blink = createBlinkState();
		const micro = createMicroState();

		for (let i = 0; i < 30; i++) interpolate(current, target, ctx, blink, micro, geom, 1 / 60);

		expect(current.eyeScaleL).toBeLessThanOrEqual(1.06);
		expect(current.eyeScaleL).toBeGreaterThanOrEqual(0.94);
		expect(current.mouthOpen).toBeLessThanOrEqual(0.22);
		expect(current.browLeft).toBeLessThanOrEqual(0.12);
		expect(current.browLeft).toBeGreaterThanOrEqual(-0.12);
	});
});
