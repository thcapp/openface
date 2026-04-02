import type {
	AccessoryDefinition,
	AccessoryOverridePatch,
	AccessoryPhysicsState,
	AntennaAccessoryDefinition,
	CurrentState,
	FaceState,
	TargetState,
} from "./types.js";

function clamp(val: number, min: number, max: number): number {
	return Math.max(min, Math.min(max, val));
}

function blendNumber(a: number | undefined, b: number | undefined, t: number): number | undefined {
	if (a === undefined && b === undefined) return undefined;
	if (a === undefined) return b;
	if (b === undefined) return a;
	return a + (b - a) * t;
}

export function resolveAccessoryPatch(
	accessory: AccessoryDefinition,
	activeState: FaceState,
	target: TargetState,
): AccessoryOverridePatch {
	const statePatch = accessory.stateOverrides?.[activeState];
	const primary = accessory.emotionOverrides?.[target.emotion];
	const secondary = accessory.emotionOverrides?.[target.emotionSecondary];
	const blend = clamp(target.emotionBlend, 0, 1);

	const patch: AccessoryOverridePatch = {};
	if (statePatch) Object.assign(patch, statePatch);
	if (primary) Object.assign(patch, primary);
	if (secondary && blend > 0) {
		if (secondary.color && blend >= 0.5) patch.color = secondary.color;
		if (secondary.tipColor && blend >= 0.5) patch.tipColor = secondary.tipColor;
		patch.tipSize = blendNumber(patch.tipSize, secondary.tipSize, blend);
		patch.lineWidth = blendNumber(patch.lineWidth, secondary.lineWidth, blend);
		patch.lensAlpha = blendNumber(patch.lensAlpha, secondary.lensAlpha, blend);
		patch.restAngle = blendNumber(patch.restAngle, secondary.restAngle, blend);
		patch.restCurve = blendNumber(patch.restCurve, secondary.restCurve, blend);
		patch.tipCurl = blendNumber(patch.tipCurl, secondary.tipCurl, blend);
		if (secondary.physics) {
			const merged = { ...(patch.physics ?? {}) };
			if (secondary.physics.enabled !== undefined && blend >= 0.5) merged.enabled = secondary.physics.enabled;
			merged.stiffness = blendNumber(merged.stiffness, secondary.physics.stiffness, blend);
			merged.damping = blendNumber(merged.damping, secondary.physics.damping, blend);
			merged.gravity = blendNumber(merged.gravity, secondary.physics.gravity, blend);
			merged.headInfluence = blendNumber(merged.headInfluence, secondary.physics.headInfluence, blend);
			patch.physics = merged;
		}
	}
	return patch;
}

export interface ResolvedAntennaPhysicsConfig {
	enabled: boolean;
	stiffness: number;
	damping: number;
	gravity: number;
	headInfluence: number;
	restAngle: number;
	restCurve: number;
	tipCurl: number;
}

export function resolveAntennaPhysicsConfig(
	accessory: AntennaAccessoryDefinition,
	activeState: FaceState,
	target: TargetState,
): ResolvedAntennaPhysicsConfig {
	const patch = resolveAccessoryPatch(accessory, activeState, target);
	return {
		enabled: patch.physics?.enabled ?? accessory.physics?.enabled ?? false,
		stiffness: clamp(patch.physics?.stiffness ?? accessory.physics?.stiffness ?? 0.45, 0, 1),
		damping: clamp(patch.physics?.damping ?? accessory.physics?.damping ?? 0.88, 0.5, 0.999),
		gravity: clamp(patch.physics?.gravity ?? accessory.physics?.gravity ?? 0.15, -1, 1),
		headInfluence: clamp(patch.physics?.headInfluence ?? accessory.physics?.headInfluence ?? 1, 0, 2),
		restAngle: clamp(patch.restAngle ?? accessory.restAngle ?? 0, -85, 85),
		restCurve: clamp(patch.restCurve ?? accessory.restCurve ?? 0, -1, 1),
		tipCurl: clamp(patch.tipCurl ?? accessory.tipCurl ?? 0, -1, 1),
	};
}

export interface AccessorySimulationFrame {
	unit: number;
	cx: number;
	cy: number;
	breathY: number;
	stateTime: number;
	reducedMotion: boolean;
	activeState: FaceState;
	target: TargetState;
	current: CurrentState;
}

function anchorX(accessory: AntennaAccessoryDefinition, frame: AccessorySimulationFrame): number {
	return frame.cx + frame.unit * accessory.anchor.x;
}

function anchorY(accessory: AntennaAccessoryDefinition, frame: AccessorySimulationFrame): number {
	return frame.cy + frame.unit * accessory.anchor.y + frame.breathY;
}

export function computeAntennaRestPoint(
	accessory: AntennaAccessoryDefinition,
	config: Pick<ResolvedAntennaPhysicsConfig, "restAngle" | "restCurve" | "tipCurl">,
	frame: AccessorySimulationFrame,
	index: number,
): { x: number; y: number } {
	const rootX = anchorX(accessory, frame);
	const rootY = anchorY(accessory, frame);
	const segments = Math.max(1, accessory.segments);
	const segLen = frame.unit * accessory.segmentLength;
	const side = accessory.anchor.x >= 0 ? 1 : -1;
	const t = clamp(index / segments, 0, 1);
	const angleRad = clamp(config.restAngle, -85, 85) * (Math.PI / 180);
	const dirX = side * Math.sin(angleRad);
	const dirY = -Math.cos(angleRad);
	const shaftCurve = config.restCurve * segLen * segments * (t * t);
	// Keep the shaft straighter near the base; apply curl mostly at the distal tip.
	const tipPhase = t <= 0.55 ? 0 : (t - 0.55) / 0.45;
	const tipCurlWeight = tipPhase * tipPhase * tipPhase;
	const curlBias = config.tipCurl * segLen * segments * tipCurlWeight;
	const curveX = side * shaftCurve - side * curlBias;
	const curveY = shaftCurve * 0.2 + curlBias * 0.16;

	return {
		x: rootX + dirX * segLen * index + curveX,
		y: rootY + dirY * segLen * index + curveY,
	};
}

export function createAntennaPhysicsState(
	accessory: AntennaAccessoryDefinition,
	frame: AccessorySimulationFrame,
): AccessoryPhysicsState {
	const config = resolveAntennaPhysicsConfig(accessory, frame.activeState, frame.target);
	const points = [];
	for (let i = 0; i <= accessory.segments; i++) {
		const rest = computeAntennaRestPoint(accessory, config, frame, i);
		points.push({ x: rest.x, y: rest.y, prevX: rest.x, prevY: rest.y });
	}
	return {
		id: accessory.id,
		type: "antenna",
		points,
	};
}

export function isAntennaPhysicsStateValid(
	state: AccessoryPhysicsState,
	accessory: AntennaAccessoryDefinition,
): boolean {
	if (state.type !== "antenna") return false;
	if (state.points.length !== accessory.segments + 1) return false;
	for (const p of state.points) {
		if (!Number.isFinite(p.x) || !Number.isFinite(p.y) || !Number.isFinite(p.prevX) || !Number.isFinite(p.prevY)) {
			return false;
		}
		if (Math.abs(p.x) > 1_000_000 || Math.abs(p.y) > 1_000_000) {
			return false;
		}
	}
	return true;
}

export function simulateAntennaPhysicsStep(
	state: AccessoryPhysicsState,
	accessory: AntennaAccessoryDefinition,
	config: ResolvedAntennaPhysicsConfig,
	frame: AccessorySimulationFrame,
	stepDt: number,
): boolean {
	if (state.type !== "antenna" || !config.enabled || !isAntennaPhysicsStateValid(state, accessory)) {
		return false;
	}
	const points = state.points;
	const rootX = anchorX(accessory, frame);
	const rootY = anchorY(accessory, frame);
	const segLen = frame.unit * accessory.segmentLength;
	const side = accessory.anchor.x >= 0 ? 1 : -1;
	const motionMul = frame.reducedMotion ? 0 : 1;
	const speechDrive = frame.activeState === "speaking" ? frame.current.amplitude : 0;
	const swayFreq = 1.2 + config.stiffness * 2.4;
	const lookDrive = frame.current.lookX * frame.unit * 0.012 * config.headInfluence;
	const oscillation = Math.sin(frame.stateTime * swayFreq + side * 0.9);
	const swayDrive = motionMul * oscillation * frame.unit * (0.002 + speechDrive * 0.02);
	const driveX = lookDrive + swayDrive;
	const alertLift = frame.activeState === "alert" ? -frame.unit * 0.012 : 0;
	const sleepDroop = frame.activeState === "sleeping" ? frame.unit * 0.03 : 0;
	const springPull = 0.02 + config.stiffness * 0.1;
	const gravityAcc = frame.unit * config.gravity * 0.14;
	const dtNorm = clamp(stepDt * 60, 0, 2);

	points[0]!.x = rootX;
	points[0]!.y = rootY;
	points[0]!.prevX = rootX;
	points[0]!.prevY = rootY;

	for (let i = 1; i < points.length; i++) {
		const p = points[i]!;
		const t = i / (points.length - 1);
		const vx = (p.x - p.prevX) * config.damping;
		const vy = (p.y - p.prevY) * config.damping;
		p.prevX = p.x;
		p.prevY = p.y;
		p.x += vx + driveX * t * (1 - config.stiffness * 0.2) * dtNorm;
		p.y += vy + gravityAcc * t * stepDt;

		const rest = computeAntennaRestPoint(accessory, config, frame, i);
		const restX = rest.x + driveX * t * t;
		const restY = rest.y + alertLift * t + sleepDroop * t * t;
		p.x += (restX - p.x) * springPull;
		p.y += (restY - p.y) * springPull;
	}

	const iterations = 2 + Math.round(config.stiffness * 3);
	for (let iter = 0; iter < iterations; iter++) {
		points[0]!.x = rootX;
		points[0]!.y = rootY;
		for (let i = 1; i < points.length; i++) {
			const a = points[i - 1]!;
			const b = points[i]!;
			const dx = b.x - a.x;
			const dy = b.y - a.y;
			const dist = Math.hypot(dx, dy);
			if (dist < 1e-5) continue;
			const diff = (dist - segLen) / dist;
			if (i === 1) {
				b.x -= dx * diff;
				b.y -= dy * diff;
			} else {
				const offsetX = dx * diff * 0.5;
				const offsetY = dy * diff * 0.5;
				a.x += offsetX;
				a.y += offsetY;
				b.x -= offsetX;
				b.y -= offsetY;
			}
		}
	}

	points[0]!.x = rootX;
	points[0]!.y = rootY;
	return isAntennaPhysicsStateValid(state, accessory);
}
