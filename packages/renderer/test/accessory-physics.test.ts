import { describe, expect, test } from "bun:test";
import {
	computeAntennaRestPoint,
	createAntennaPhysicsState,
	isAntennaPhysicsStateValid,
	resolveAntennaPhysicsConfig,
	resolveAccessoryPatch,
	simulateAntennaPhysicsStep,
	type AccessorySimulationFrame,
} from "../src/accessory-physics.js";
import type { AntennaAccessoryDefinition, TargetState } from "../src/types.js";

function makeTarget(): TargetState {
	return {
		state: "idle",
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

function makeFrame(): AccessorySimulationFrame {
	return {
		unit: 500,
		cx: 250,
		cy: 250,
		breathY: 0,
		stateTime: 0,
		reducedMotion: false,
		activeState: "idle",
		target: makeTarget(),
		current: {
			amplitude: 0.3,
			lookX: 0.1,
			lookY: -0.1,
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
		},
	};
}

function makeAccessory(): AntennaAccessoryDefinition {
	return {
		id: "ant",
		type: "antenna",
		anchor: { x: 0.18, y: -0.24 },
		segments: 7,
		segmentLength: 0.065,
		restAngle: 40,
		restCurve: 0.45,
		tipCurl: 0.3,
		thickness: { base: 0.015, tip: 0.004 },
		tipShape: "circle",
		tipSize: 0.012,
		symmetry: "none",
		physics: { enabled: true, stiffness: 0.75, damping: 0.9, gravity: 0.05, headInfluence: 1 },
	};
}

describe("resolveAccessoryPatch", () => {
	test("blends secondary emotion antenna shape overrides", () => {
		const accessory = makeAccessory();
		accessory.emotionOverrides = {
			happy: { restCurve: 0.2 },
			surprised: { restCurve: 0.8, tipCurl: 0.1 },
		};
		const target = makeTarget();
		target.emotion = "happy";
		target.emotionSecondary = "surprised";
		target.emotionBlend = 0.5;
		const patch = resolveAccessoryPatch(accessory, "idle", target);
		expect(patch.restCurve).toBe(0.5);
		expect(patch.tipCurl).toBe(0.1);
	});
});

describe("computeAntennaRestPoint", () => {
	test("produces outward mirrored tilt for left/right anchors", () => {
		const frame = makeFrame();
		const right = makeAccessory();
		const left = { ...makeAccessory(), id: "left", anchor: { x: -0.18, y: -0.24 } };
		const config = resolveAntennaPhysicsConfig(right, "idle", frame.target);
		const rightTip = computeAntennaRestPoint(right, config, frame, right.segments);
		const leftTip = computeAntennaRestPoint(left, config, frame, left.segments);
		expect(rightTip.x).toBeGreaterThan(frame.cx);
		expect(leftTip.x).toBeLessThan(frame.cx);
	});
});

describe("simulateAntennaPhysicsStep", () => {
	test("keeps points finite and chain lengths stable under many steps", () => {
		const frame = makeFrame();
		const accessory = makeAccessory();
		const config = resolveAntennaPhysicsConfig(accessory, "idle", frame.target);
		const state = createAntennaPhysicsState(accessory, frame);
		let ok = true;

		for (let i = 0; i < 900; i++) {
			frame.stateTime += 1 / 120;
			frame.current.lookX = Math.sin(i * 0.03) * 0.7;
			frame.current.amplitude = i % 60 < 30 ? 0.55 : 0.1;
			ok = simulateAntennaPhysicsStep(state, accessory, config, frame, 1 / 120);
			if (!ok) break;
		}
		expect(ok).toBe(true);
		expect(isAntennaPhysicsStateValid(state, accessory)).toBe(true);

		const segLen = frame.unit * accessory.segmentLength;
		for (let i = 1; i < state.points.length; i++) {
			const a = state.points[i - 1]!;
			const b = state.points[i]!;
			const dist = Math.hypot(b.x - a.x, b.y - a.y);
			expect(Math.abs(dist - segLen)).toBeLessThan(segLen * 0.14);
		}
	});

	test("rejects non-finite state and allows reset-by-recreate", () => {
		const frame = makeFrame();
		const accessory = makeAccessory();
		const state = createAntennaPhysicsState(accessory, frame);
		state.points[2]!.x = Number.NaN;
		expect(isAntennaPhysicsStateValid(state, accessory)).toBe(false);
		const reset = createAntennaPhysicsState(accessory, frame);
		expect(isAntennaPhysicsStateValid(reset, accessory)).toBe(true);
	});
});
