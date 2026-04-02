import type { AnticipationState, BlinkState, MicroState } from "./blink.js";
import { triggerAnticipation, updateAnticipation, updateBlink, updateMicro } from "./blink.js";
import { dlerp, saccadeLerp, softLimit } from "./math.js";
import type { CurrentState, FaceEmotion, FaceGeometry, FaceState, TargetState } from "./types.js";

export interface InterpolationContext {
	activeState: FaceState;
	activeEmotion: FaceEmotion;
	stateTime: number;
	lastLookAtElapsed: number;
	transitionElapsed: number;
	reducedMotion: boolean;
	anticipation: AnticipationState;
}

interface EmotionDeltas {
	happiness: number;
	browL: number;
	browR: number;
	blush: number;
	eyeScaleL: number;
	eyeScaleR: number;
	lidMult: number;
	tilt: number;
	mouthMin: number | null;
	mouthMax: number | null;
	mouthMult: number | null;
	squint: number;
	mouthWidth: number;
	mouthAsym: number;
	confusion: number;
	slopeL: number;
	slopeR: number;
}

function emptyDeltas(): EmotionDeltas {
	return {
		happiness: 0, browL: 0, browR: 0, blush: 0,
		eyeScaleL: 0, eyeScaleR: 0, lidMult: 1, tilt: 0,
		mouthMin: null, mouthMax: null, mouthMult: null,
		squint: 0, mouthWidth: 0, mouthAsym: 0, confusion: 0,
		slopeL: 0, slopeR: 0,
	};
}

/** Compute additive deltas for a single emotion. */
function computeEmotionDeltas(emo: FaceEmotion): EmotionDeltas {
	const d = emptyDeltas();

	switch (emo) {
		case "happy":
			d.happiness = 0.45; d.browL = 0.15; d.browR = 0.15;
			d.blush = 0.6; d.squint = 0.5;
			break;
		case "sad":
			d.happiness = -0.7; d.browL = 0.4; d.browR = 0.4;
			d.mouthMult = 0.5; d.mouthMax = 0.02;
			d.eyeScaleL = -0.1; d.eyeScaleR = -0.1;
			d.slopeL = -0.3; d.slopeR = -0.3;
			d.lidMult = 0.85;
			break;
		case "confused":
			d.confusion = 0.5; d.browL = -0.3; d.browR = 0.4;
			d.tilt = -0.03;
			break;
		case "excited":
			d.happiness = 0.5; d.browL = 0.4; d.browR = 0.4;
			d.blush = 0.7; d.eyeScaleL = 0.15; d.eyeScaleR = 0.15;
			break;
		case "concerned":
			d.happiness = -0.35; d.browL = 0.4; d.browR = 0.4;
			d.lidMult = 0.85; d.slopeL = -0.15; d.slopeR = -0.15;
			break;
		case "surprised":
			d.mouthMin = 0.5; d.happiness = 0;
			d.browL = 0.6; d.browR = 0.6;
			d.lidMult = 1.3; d.eyeScaleL = 0.35; d.eyeScaleR = 0.35;
			break;
		case "playful":
			d.happiness = 0.35; d.browL = 0.25; d.browR = -0.15;
			d.blush = 0.4; d.tilt = 0.04;
			d.mouthAsym = 0.3;
			break;
		case "frustrated":
			d.happiness = -0.4; d.browL = -0.6; d.browR = -0.6;
			d.mouthWidth = -0.3; d.lidMult = 0.8;
			d.slopeL = 0.4; d.slopeR = 0.4;
			break;
		case "skeptical":
			d.browL = -0.4; d.browR = 0.6;
			d.happiness = -0.15; d.tilt = -0.03;
			d.slopeL = 0.3; d.slopeR = -0.2;
			d.eyeScaleL = -0.1; d.eyeScaleR = 0.1;
			break;
		case "determined":
			d.browL = -0.35; d.browR = -0.35;
			d.lidMult = 0.8; d.mouthWidth = -0.2;
			d.slopeL = 0.25; d.slopeR = 0.25;
			break;
		case "embarrassed":
			d.blush = 0.9; d.happiness = 0.2;
			d.browL = -0.15; d.browR = 0.25; d.tilt = 0.05;
			d.eyeScaleL = -0.05; d.eyeScaleR = -0.05;
			break;
		case "proud":
			d.happiness = 0.45; d.browL = 0.15; d.browR = 0.15;
			d.lidMult = 0.9; d.tilt = -0.02;
			break;
		// "neutral" — no deltas
	}

	return d;
}

/** Scale all deltas by an intensity factor. */
function scaleDeltas(d: EmotionDeltas, intensity: number): EmotionDeltas {
	return {
		happiness: d.happiness * intensity,
		browL: d.browL * intensity,
		browR: d.browR * intensity,
		blush: d.blush * intensity,
		eyeScaleL: d.eyeScaleL * intensity,
		eyeScaleR: d.eyeScaleR * intensity,
		lidMult: 1 + (d.lidMult - 1) * intensity,
		tilt: d.tilt * intensity,
		mouthMin: d.mouthMin !== null ? d.mouthMin * intensity : null,
		mouthMax: d.mouthMax !== null ? d.mouthMax * intensity : null,
		mouthMult: d.mouthMult !== null ? 1 + (d.mouthMult - 1) * intensity : null,
		squint: d.squint * intensity,
		mouthWidth: d.mouthWidth * intensity,
		mouthAsym: d.mouthAsym * intensity,
		confusion: d.confusion * intensity,
		slopeL: d.slopeL * intensity,
		slopeR: d.slopeR * intensity,
	};
}

/** Blend two delta sets: primary * (1 - blend) + secondary * blend. */
function blendDeltas(a: EmotionDeltas, b: EmotionDeltas, blend: number): EmotionDeltas {
	const inv = 1 - blend;
	return {
		happiness: a.happiness * inv + b.happiness * blend,
		browL: a.browL * inv + b.browL * blend,
		browR: a.browR * inv + b.browR * blend,
		blush: a.blush * inv + b.blush * blend,
		eyeScaleL: a.eyeScaleL * inv + b.eyeScaleL * blend,
		eyeScaleR: a.eyeScaleR * inv + b.eyeScaleR * blend,
		lidMult: a.lidMult * inv + b.lidMult * blend,
		tilt: a.tilt * inv + b.tilt * blend,
		mouthMin: a.mouthMin !== null || b.mouthMin !== null
			? (a.mouthMin ?? 0) * inv + (b.mouthMin ?? 0) * blend
			: null,
		mouthMax: a.mouthMax !== null || b.mouthMax !== null
			? (a.mouthMax ?? 1) * inv + (b.mouthMax ?? 1) * blend
			: null,
		mouthMult: a.mouthMult !== null || b.mouthMult !== null
			? (a.mouthMult ?? 1) * inv + (b.mouthMult ?? 1) * blend
			: null,
		squint: a.squint * inv + b.squint * blend,
		mouthWidth: a.mouthWidth * inv + b.mouthWidth * blend,
		mouthAsym: a.mouthAsym * inv + b.mouthAsym * blend,
		confusion: a.confusion * inv + b.confusion * blend,
		slopeL: a.slopeL * inv + b.slopeL * blend,
		slopeR: a.slopeR * inv + b.slopeR * blend,
	};
}

function applyEmotionOverride(base: EmotionDeltas, raw: Record<string, unknown> | undefined): EmotionDeltas {
	if (!raw) return base;
	const next = { ...base };
	if (typeof raw.happiness === "number") next.happiness = raw.happiness;
	if (Array.isArray(raw.brows) && raw.brows.length === 2) {
		if (typeof raw.brows[0] === "number") next.browL = raw.brows[0];
		if (typeof raw.brows[1] === "number") next.browR = raw.brows[1];
	}
	if (typeof raw.browL === "number") next.browL = raw.browL;
	if (typeof raw.browR === "number") next.browR = raw.browR;
	if (typeof raw.blush === "number") next.blush = raw.blush;
	if (Array.isArray(raw.eyeScale) && raw.eyeScale.length === 2) {
		if (typeof raw.eyeScale[0] === "number") next.eyeScaleL = raw.eyeScale[0];
		if (typeof raw.eyeScale[1] === "number") next.eyeScaleR = raw.eyeScale[1];
	}
	if (typeof raw.eyeScaleL === "number") next.eyeScaleL = raw.eyeScaleL;
	if (typeof raw.eyeScaleR === "number") next.eyeScaleR = raw.eyeScaleR;
	if (typeof raw.lidMult === "number") next.lidMult = raw.lidMult;
	if (typeof raw.tilt === "number") next.tilt = raw.tilt;
	if (typeof raw.mouthMin === "number") next.mouthMin = raw.mouthMin;
	if (typeof raw.mouthMax === "number") next.mouthMax = raw.mouthMax;
	if (typeof raw.mouthMult === "number") next.mouthMult = raw.mouthMult;
	if (typeof raw.squint === "number") next.squint = raw.squint;
	if (typeof raw.mouthWidth === "number") next.mouthWidth = raw.mouthWidth;
	if (typeof raw.mouthAsym === "number") next.mouthAsym = raw.mouthAsym;
	if (typeof raw.confusion === "number") next.confusion = raw.confusion;
	if (typeof raw.slopeL === "number") next.slopeL = raw.slopeL;
	if (typeof raw.slopeR === "number") next.slopeR = raw.slopeR;
	return next;
}

/**
 * Interpolate current state toward target state.
 * This is the core "feel" of the face — how it transitions between expressions.
 * Returns true if the active state changed (for event dispatch).
 */
export function interpolate(
	current: CurrentState,
	target: TargetState,
	ctx: InterpolationContext,
	blink: BlinkState,
	micro: MicroState,
	geom: FaceGeometry,
	dt: number,
): boolean {
	const s = target.state;
	let stateChanged = false;

	// State or emotion transition — track for unified speed boost
	if (ctx.activeState !== s || ctx.activeEmotion !== target.emotion) {
		ctx.transitionElapsed = 0;
		ctx.activeEmotion = target.emotion;
	}

	// State transition
	if (ctx.activeState !== s) {
		triggerAnticipation(ctx.anticipation, ctx.activeState, s);
		ctx.activeState = s;
		ctx.stateTime = 0;
		stateChanged = true;

		if (!ctx.reducedMotion) {
			if (s === "alert") current.shake = 15;
			if (s === "alert" || s === "reacting") current.bounce = 1.06;
		}
		// Dampen lingering values on transition
		current.confusion *= 0.2;
		current.happiness *= 0.2;
		current.pulse *= 0.1;
		current.browLeft *= 0.2;
		current.browRight *= 0.2;
	}
	ctx.stateTime += dt;
	ctx.lastLookAtElapsed += dt;
	ctx.transitionElapsed += dt;

	// Anticipation offsets (pre-movement on state transitions)
	const antOffsets = updateAnticipation(ctx.anticipation, dt);

	// Smooth continuous values
	current.amplitude = dlerp(current.amplitude, target.amplitude, geom.lerpAmplitude * geom.animSpeed, dt);
	const lookSaccade = Math.min(0.6, Math.max(0.2, geom.lerpLookAt * 8));
	current.lookX = saccadeLerp(current.lookX, target.lookX, dt, 0.3, lookSaccade, geom.lerpLookAt);
	current.lookY = saccadeLerp(current.lookY, target.lookY, dt, 0.3, lookSaccade, geom.lerpLookAt);

	// Breathing
	current.breathe = ctx.reducedMotion
		? 0.5
		: Math.sin(ctx.stateTime * (s === "sleeping" ? 0.8 : 1.5)) * 0.5 + 0.5;

	// Pulse (thinking/working/waiting/loading indicator dots)
	const pulseTarget = (s === "thinking" || s === "working" || s === "waiting" || s === "loading")
		? 0.5 + Math.sin(ctx.stateTime * 3) * 0.5
		: 0;
	current.pulse = dlerp(current.pulse, pulseTarget, 0.15 * geom.animSpeed, dt);

	// Shake decay
	current.shake *= Math.pow(0.85, dt * 60);
	if (Math.abs(current.shake) < 0.5) current.shake = 0;

	// Bounce decay
	current.bounce = dlerp(current.bounce, 1.0, 0.15, dt);

	// State-specific targets
	let mouthTarget = 0;
	let lidTarget = 1;
	let happyTarget = 0;
	let confusionTarget = 0;
	let browLTarget = 0;
	let browRTarget = 0;
	const stateEyeScales = geom.eyeStateScales[s] ?? [1, 1];
	let eyeScaleLTarget = stateEyeScales[0];
	let eyeScaleRTarget = stateEyeScales[1];
	let tiltTarget = 0;
	let blushTarget = 0;
	let squintTarget = 0;
	let mouthWidthTarget = 0;
	let mouthAsymTarget = 0;
	let slopeLTarget = 0;
	let slopeRTarget = 0;

	switch (s) {
		case "idle":
			mouthTarget = 0.08;
			tiltTarget = ctx.reducedMotion ? 0 : Math.sin(ctx.stateTime * 0.3) * geom.headSway * geom.playMult;
			break;
		case "thinking":
			mouthTarget = 0.02;
			lidTarget = 0.7;
			browLTarget = -0.2;
			browRTarget = 0.5;
			tiltTarget = 0.02;
			// Auto-gaze when no external lookAt push
			if (ctx.lastLookAtElapsed > 2) {
				target.lookX = 0.3 + Math.sin(ctx.stateTime * 0.7) * 0.15;
				target.lookY = -0.3 + Math.cos(ctx.stateTime * 0.5) * 0.1;
			}
			break;
		case "working":
			mouthTarget = 0.02;
			happyTarget = 0.1;
			lidTarget = 0.8;
			browLTarget = -0.1;
			browRTarget = -0.1;
			tiltTarget = -0.01;
			break;
		case "speaking":
			mouthTarget = 0.1 + current.amplitude * 0.75 + Math.sin(ctx.stateTime * 12) * current.amplitude * 0.12;
			happyTarget = 0.15;
			browLTarget = 0.1;
			browRTarget = 0.1;
			break;
		case "listening":
			mouthTarget = 0.03;
			happyTarget = 0.1;
			lidTarget = 1.15;
			browLTarget = 0.3;
			browRTarget = 0.3;
			tiltTarget = 0.03;
			break;
		case "reacting":
			mouthTarget = 0.7;
			happyTarget = 0.3;
			lidTarget = 0.8;
			browLTarget = 0.2;
			browRTarget = 0.2;
			break;
		case "puzzled":
			mouthTarget = 0.05;
			confusionTarget = 1;
			lidTarget = 0.85;
			browLTarget = -0.4;
			browRTarget = 0.6;
			tiltTarget = -0.04;
			break;
		case "alert":
			mouthTarget = 0.55;
			happyTarget = -0.3;
			lidTarget = 1.3;
			browLTarget = 0.7;
			browRTarget = 0.7;
			break;
		case "sleeping":
			mouthTarget = 0.02;
			lidTarget = 0;
			browLTarget = -0.3;
			browRTarget = -0.3;
			tiltTarget = 0.02;
			break;
		case "waiting":
			// Still (no head sway), eyes open, occasional glance toward input, subtle pulse
			mouthTarget = 0.04;
			lidTarget = 1.0;
			// Occasional subtle glance toward lower-left (input area)
			if (!ctx.reducedMotion && ctx.lastLookAtElapsed > 3) {
				const glanceCycle = Math.sin(ctx.stateTime * 0.4);
				if (glanceCycle > 0.7) {
					target.lookX = -0.2;
					target.lookY = 0.15;
				}
			}
			break;
		case "loading": {
			// Eyes gradually opening, sequential dot animation via pulse
			const openProgress = Math.min(1, ctx.stateTime / 2.0);
			lidTarget = 0.3 + openProgress * 0.7;
			mouthTarget = 0.02;
			browLTarget = -0.1 + openProgress * 0.1;
			browRTarget = -0.1 + openProgress * 0.1;
			break;
		}
	}

	const stateOverride = geom.stateOverrides[s];
	if (stateOverride) {
		if (typeof stateOverride.mouth === "number") mouthTarget = stateOverride.mouth;
		if (typeof stateOverride.lid === "number") lidTarget = stateOverride.lid;
		if (typeof stateOverride.happiness === "number") happyTarget = stateOverride.happiness;
		if (typeof stateOverride.confusion === "number") confusionTarget = stateOverride.confusion;
		if (typeof stateOverride.tilt === "number") tiltTarget = stateOverride.tilt;
		if (Array.isArray(stateOverride.brows) && stateOverride.brows.length === 2) {
			if (typeof stateOverride.brows[0] === "number") browLTarget = stateOverride.brows[0];
			if (typeof stateOverride.brows[1] === "number") browRTarget = stateOverride.brows[1];
		}
		if (Array.isArray(stateOverride.eyeScale) && stateOverride.eyeScale.length === 2) {
			if (typeof stateOverride.eyeScale[0] === "number") eyeScaleLTarget = stateOverride.eyeScale[0];
			if (typeof stateOverride.eyeScale[1] === "number") eyeScaleRTarget = stateOverride.eyeScale[1];
		}
	}
	const baseMouthTarget = mouthTarget;
	const baseBrowLTarget = browLTarget;
	const baseBrowRTarget = browRTarget;
	const baseEyeScaleLTarget = eyeScaleLTarget;
	const baseEyeScaleRTarget = eyeScaleRTarget;
	const baseSlopeLTarget = slopeLTarget;
	const baseSlopeRTarget = slopeRTarget;
	const baseConfusionTarget = confusionTarget;
	const baseMouthWidthTarget = mouthWidthTarget;
	const baseMouthAsymTarget = mouthAsymTarget;
	const baseSquintTarget = squintTarget;

	// Personality warmth bias — baseline happiness offset
	happyTarget += geom.warmthBias;

	// --- Compute emotion deltas with intensity and blend ---
	const intensity = target.intensity;
	let primaryDeltas = computeEmotionDeltas(target.emotion);
	primaryDeltas = applyEmotionOverride(primaryDeltas, geom.emotionOverrides[target.emotion]);
	primaryDeltas = scaleDeltas(primaryDeltas, intensity);

	let deltas: EmotionDeltas;
	if (target.emotionSecondary !== "neutral" && target.emotionBlend > 0) {
		let secondaryDeltas = computeEmotionDeltas(target.emotionSecondary);
		secondaryDeltas = applyEmotionOverride(secondaryDeltas, geom.emotionOverrides[target.emotionSecondary]);
		secondaryDeltas = scaleDeltas(secondaryDeltas, intensity);
		deltas = blendDeltas(primaryDeltas, secondaryDeltas, target.emotionBlend);
	} else {
		deltas = primaryDeltas;
	}

	// Scale emotion range by personality expressiveness
	deltas = scaleDeltas(deltas, geom.animRange);

	// Apply emotion deltas to targets
	happyTarget += deltas.happiness;
	browLTarget += deltas.browL;
	browRTarget += deltas.browR;
	blushTarget = deltas.blush;
	eyeScaleLTarget += deltas.eyeScaleL;
	eyeScaleRTarget += deltas.eyeScaleR;
	lidTarget *= deltas.lidMult;
	tiltTarget += deltas.tilt;
	confusionTarget += deltas.confusion;
	squintTarget += deltas.squint;
	mouthWidthTarget += deltas.mouthWidth;
	mouthAsymTarget += deltas.mouthAsym;
	slopeLTarget += deltas.slopeL;
	slopeRTarget += deltas.slopeR;

	if (deltas.mouthMin !== null) {
		mouthTarget = Math.max(mouthTarget, deltas.mouthMin);
	}
	if (deltas.mouthMax !== null) {
		mouthTarget = Math.min(mouthTarget, deltas.mouthMax);
	}
	if (deltas.mouthMult !== null) {
		mouthTarget = mouthTarget * deltas.mouthMult + 0.02;
	}

	// Feature locks preserve pack identity under state/emotion turbulence.
	if (geom.lockEyes) {
		eyeScaleLTarget = baseEyeScaleLTarget;
		eyeScaleRTarget = baseEyeScaleRTarget;
		slopeLTarget = baseSlopeLTarget;
		slopeRTarget = baseSlopeRTarget;
		squintTarget = baseSquintTarget;
	}
	if (geom.lockBrows) {
		browLTarget = baseBrowLTarget;
		browRTarget = baseBrowRTarget;
		confusionTarget = baseConfusionTarget;
	}
	if (geom.lockMouth) {
		mouthTarget = baseMouthTarget;
		mouthWidthTarget = baseMouthWidthTarget;
		mouthAsymTarget = baseMouthAsymTarget;
	}

	// Emotion-specific idle variations (from ESP32/Vector research)
	// These layer on top of the base state, making each emotion feel alive differently
	if (!ctx.reducedMotion && (s === "idle" || s === "listening" || s === "waiting")) {
		const t = ctx.stateTime;
		const emo = target.emotion;
		const pm = geom.playMult;
		if (emo === "frustrated" || emo === "determined") {
			// Slight tremble — fast small oscillation
			tiltTarget += Math.sin(t * 8) * 0.003 * pm;
			browLTarget += Math.sin(t * 6) * 0.02 * pm;
		}
		if (emo === "excited" || emo === "happy") {
			// Gentle bounce — slow vertical bob
			eyeScaleLTarget += Math.sin(t * 2.5) * 0.03 * pm;
			eyeScaleRTarget += Math.sin(t * 2.5) * 0.03 * pm;
		}
		if (emo === "sad" || emo === "concerned") {
			// Slow droop — eyes and brows drift down slightly
			browLTarget += Math.sin(t * 0.4) * 0.03 * pm - 0.02;
			browRTarget += Math.sin(t * 0.4) * 0.03 * pm - 0.02;
		}
		if (emo === "playful") {
			// Asymmetric sway — head and brows move independently
			tiltTarget += Math.sin(t * 1.2) * 0.015 * pm;
			browLTarget += Math.sin(t * 1.8) * 0.04 * pm;
			browRTarget += Math.sin(t * 1.3) * 0.04 * pm;
		}
		if (emo === "skeptical") {
			// One brow twitches periodically
			browRTarget += Math.sin(t * 3) * 0.03 * pm;
		}
	}

	// Curiosity-mode gaze scaling — eyes grow slightly when looking toward edges
	if (!ctx.reducedMotion) {
		const gazeIntensity = Math.sqrt(current.lookX * current.lookX + current.lookY * current.lookY);
		eyeScaleLTarget += gazeIntensity * 0.04;
		eyeScaleRTarget += gazeIntensity * 0.04;
	}

	// ── Proportional relationships — features react to each other ──
	// Brows respond to eye scale (eyes shrink → brows lower proportionally)
	browLTarget -= (eyeScaleLTarget - 1) * 0.15;
	browRTarget -= (eyeScaleRTarget - 1) * 0.15;
	// Slope reinforced by squint and brow direction
	slopeLTarget += squintTarget * 0.15;
	slopeRTarget += squintTarget * 0.15;
	const browMid = (browLTarget + browRTarget) / 2;
	slopeLTarget -= browMid * 0.08;
	slopeRTarget -= browMid * 0.08;
	// Blush tracks happiness
	blushTarget = Math.max(blushTarget, Math.max(0, happyTarget) * 0.25);
	// Confusion drives brow asymmetry
	browLTarget -= confusionTarget * 0.08;
	browRTarget += confusionTarget * 0.08;
	// Gaze parallax — eyes compress when looking sideways
	const gazeLen = Math.sqrt(current.lookX * current.lookX + current.lookY * current.lookY);
	eyeScaleLTarget -= gazeLen * 0.05;
	eyeScaleRTarget -= gazeLen * 0.05;
	// Per-eye asymmetry from gaze direction
	eyeScaleLTarget += current.lookX * 0.05;
	eyeScaleRTarget -= current.lookX * 0.05;
	// Squint reduces apparent lid
	lidTarget *= (1 - squintTarget * 0.15);

	// ── Soft limiting — smooth compression, no hard clips ──
	const eyeMin = Math.min(geom.eyeScaleMin, geom.eyeScaleMax);
	const eyeMax = Math.max(geom.eyeScaleMin, geom.eyeScaleMax);
	const browMin = Math.min(geom.browMin, geom.browMax);
	const browMax = Math.max(geom.browMin, geom.browMax);
	const mouthOpenMin = Math.min(geom.mouthOpenMin, geom.mouthOpenMax);
	const mouthOpenMax = Math.max(geom.mouthOpenMin, geom.mouthOpenMax);
	const mouthWidthMin = Math.min(geom.mouthWidthMin, geom.mouthWidthMax);
	const mouthWidthMax = Math.max(geom.mouthWidthMin, geom.mouthWidthMax);

	eyeScaleLTarget = softLimit(eyeScaleLTarget, eyeMin, eyeMax);
	eyeScaleRTarget = softLimit(eyeScaleRTarget, eyeMin, eyeMax);
	browLTarget = softLimit(browLTarget, browMin, browMax);
	browRTarget = softLimit(browRTarget, browMin, browMax);
	happyTarget = softLimit(happyTarget, -1, 1);
	confusionTarget = softLimit(confusionTarget, 0, 1);
	lidTarget = softLimit(lidTarget, 0, 1.5);
	tiltTarget = softLimit(tiltTarget, -0.08, 0.08);
	blushTarget = softLimit(blushTarget, 0, 1);
	squintTarget = softLimit(squintTarget, 0, 0.8);
	mouthTarget = softLimit(mouthTarget, mouthOpenMin, mouthOpenMax);
	mouthWidthTarget = softLimit(mouthWidthTarget, mouthWidthMin, mouthWidthMax);
	mouthAsymTarget = softLimit(mouthAsymTarget, -0.5, 0.5);
	slopeLTarget = softLimit(slopeLTarget, -0.6, 0.6);
	slopeRTarget = softLimit(slopeRTarget, -0.6, 0.6);

	// Micro-expressions (only in idle/listening when motion is allowed)
	const microActive = geom.microEnabled && !ctx.reducedMotion && (s === "idle" || s === "listening");
	const microResult = updateMicro(micro, dt, microActive, geom.microFreqMult, {
		jitterInterval: geom.microJitterInterval,
		jitterRangeX: geom.microJitterRangeX,
		jitterRangeY: geom.microJitterRangeY,
		glanceInterval: geom.microGlanceInterval,
		glanceRangeX: geom.microGlanceRangeX,
		glanceRangeY: geom.microGlanceRangeY,
		glanceHold: geom.microGlanceHold,
		mouthTwitchInterval: geom.microMouthTwitchInterval,
		mouthTwitchRange: geom.microMouthTwitchRange,
	});
	happyTarget += microResult.happinessDelta;

	// Apply micro dart offsets to lookAt targets
	target.lookX += microResult.dartX;
	target.lookY += microResult.dartY;

	// Apply anticipation offsets to targets
	lidTarget += antOffsets.lidOffset;
	mouthTarget += antOffsets.mouthOffset;
	browLTarget += antOffsets.browOffset;
	browRTarget += antOffsets.browOffset;

	// Unified transition speed — all params accelerate together for 300ms after change
	const spd = geom.animSpeed;
	const transitionBoost = ctx.transitionElapsed < 0.3 ? 1.5 : 1.0;
	const ts = spd * transitionBoost;

	current.mouthOpen = dlerp(current.mouthOpen, mouthTarget, geom.lerpMouth * ts, dt);
	current.happiness = dlerp(current.happiness, happyTarget, geom.lerpHappiness * ts, dt);
	current.confusion = dlerp(current.confusion, confusionTarget, geom.lerpConfusion * ts, dt);
	current.browLeft = dlerp(current.browLeft, browLTarget, geom.lerpBrows * ts, dt);
	current.browRight = dlerp(current.browRight, browRTarget, geom.lerpBrows * ts, dt);
	current.eyeScaleL = dlerp(current.eyeScaleL, eyeScaleLTarget, geom.lerpEyeScale * ts, dt);
	current.eyeScaleR = dlerp(current.eyeScaleR, eyeScaleRTarget, geom.lerpEyeScale * ts, dt);
	current.tilt = dlerp(current.tilt, tiltTarget, geom.lerpTilt * ts, dt);
	current.blushAlpha = dlerp(current.blushAlpha, blushTarget, geom.lerpBlush * ts, dt);
	current.winkL = dlerp(current.winkL, target.winkLeft || 0, geom.lerpWink * ts, dt);
	current.winkR = dlerp(current.winkR, target.winkRight || 0, geom.lerpWink * ts, dt);
	current.squint = dlerp(current.squint, squintTarget, 0.12 * ts, dt);
	current.mouthWidth = dlerp(current.mouthWidth, mouthWidthTarget, 0.15 * ts, dt);
	current.mouthAsymmetry = dlerp(current.mouthAsymmetry, mouthAsymTarget, 0.15 * ts, dt);
	current.eyeSlopeL = dlerp(current.eyeSlopeL, slopeLTarget, 0.12 * ts, dt);
	current.eyeSlopeR = dlerp(current.eyeSlopeR, slopeRTarget, 0.12 * ts, dt);

	// Blink (interval scaled by animSpeed)
	updateBlink(
		blink,
		dt,
		ctx.reducedMotion,
		ctx.activeState,
		spd,
		geom.blinkIntervalOverride,
		geom.doubleBlinkChance,
	);
	const blinkLid = ctx.activeState === "sleeping" ? 0 : blink.lid;
	current.lidTop = dlerp(current.lidTop, Math.min(lidTarget, blinkLid), geom.lerpLid * ts, dt);

	return stateChanged;
}
