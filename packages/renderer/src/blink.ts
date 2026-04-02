import type { FaceState } from "./types.js";
import { dlerp } from "./math.js";

export interface BlinkState {
	phase: "open" | "closing" | "closed" | "opening";
	timer: number;
	nextBlink: number;
	lid: number;
}

export interface MicroState {
	// Tier 1: micro-jitter (barely visible, constant)
	jitterTimer: number;
	nextJitter: number;
	jitterX: number;
	jitterY: number;
	// Tier 2: deliberate glance (visible, infrequent)
	glanceTimer: number;
	nextGlance: number;
	glanceX: number;
	glanceY: number;
	glanceHold: number;
	// Mouth twitch
	nextTwitch: number;
	timer: number;
}

/** Anticipation state for pre-movement on state transitions. */
export interface AnticipationState {
	active: boolean;
	elapsed: number;
	duration: number;
	/** Temporary target overrides during anticipation phase. */
	lidOffset: number;
	mouthOffset: number;
	browOffset: number;
	/** The state we're transitioning TO (applied after anticipation). */
	pendingState: FaceState | null;
}

/** Per-state blink intervals [min, max] in seconds. */
const BLINK_INTERVALS: Record<FaceState, [number, number] | null> = {
	idle: [2.5, 4.5],
	speaking: [1.8, 3.0],
	listening: [2.0, 4.0],
	thinking: [4.0, 8.0],
	working: [4.0, 8.0],
	reacting: [2.0, 3.5],
	puzzled: [3.0, 5.0],
	alert: [5.0, 10.0],
	sleeping: null, // no blinks
	waiting: [3.0, 6.0],
	loading: [2.0, 4.0],
};

/** Get blink interval range for a state. Returns null for sleeping (no blinks). */
export function getBlinkInterval(state: FaceState): [number, number] | null {
	return BLINK_INTERVALS[state] ?? [2.5, 4.5];
}

export function createBlinkState(): BlinkState {
	return { phase: "open", timer: 0, nextBlink: 3 + Math.random() * 4, lid: 1 };
}

export function createMicroState(): MicroState {
	return {
		jitterTimer: 0,
		nextJitter: 0.8 + Math.random() * 1.2,
		jitterX: 0,
		jitterY: 0,
		glanceTimer: 0,
		nextGlance: 8 + Math.random() * 17,
		glanceX: 0,
		glanceY: 0,
		glanceHold: 0,
		nextTwitch: 8 + Math.random() * 7,
		timer: 0,
	};
}

export function createAnticipationState(): AnticipationState {
	return {
		active: false,
		elapsed: 0,
		duration: 0,
		lidOffset: 0,
		mouthOffset: 0,
		browOffset: 0,
		pendingState: null,
	};
}

/**
 * Update blink with asymmetric speeds and per-state intervals.
 * Closing is ~2x faster than opening (matches human physiology).
 */
export function updateBlink(
	b: BlinkState,
	dt: number,
	reducedMotion: boolean,
	activeState: FaceState,
	animSpeed: number = 1.0,
	intervalOverride: [number, number] | null = null,
	doubleBlinkChance = 0.15,
): void {
	const interval = intervalOverride ?? getBlinkInterval(activeState);

	// No blinks during sleeping
	if (interval === null) {
		b.lid = dlerp(b.lid, 0, 0.15, dt);
		b.phase = "open";
		b.timer = 0;
		return;
	}

	b.timer += dt;

	// Asymmetric speeds: closing 0.55 (fast snap), opening 0.28 (slower reveal)
	const closingSpeed = reducedMotion ? 0.15 : 0.55;
	const openingSpeed = reducedMotion ? 0.15 : 0.28;

	switch (b.phase) {
		case "open":
			if (b.timer >= b.nextBlink) {
				b.phase = "closing";
				b.timer = 0;
			}
			b.lid = dlerp(b.lid, 1, openingSpeed, dt);
			break;
		case "closing":
			b.lid = dlerp(b.lid, 0, closingSpeed, dt);
			if (b.lid < 0.05) {
				b.phase = "closed";
				b.timer = 0;
			}
			break;
		case "closed":
			b.lid = 0;
			if (b.timer > 0.06) {
				b.phase = "opening";
				b.timer = 0;
			}
			break;
		case "opening":
			b.lid = dlerp(b.lid, 1, openingSpeed, dt);
			if (b.lid > 0.95) {
				b.phase = "open";
				b.timer = 0;
				b.nextBlink = reducedMotion
					? (4 + Math.random() * 6)
					: (interval[0] + Math.random() * (interval[1] - interval[0])) / animSpeed;
				// Occasional double-blink
				if (!reducedMotion && Math.random() < doubleBlinkChance) b.nextBlink = 0.3;
			}
			break;
	}
}

/**
 * Two-tier micro-expression system.
 *
 * Tier 1 (micro-jitter): every 0.8-2.0s, amplitude 0.03-0.08, duration 0.1s.
 *   Barely visible constant movement that prevents the face from looking "dead."
 *
 * Tier 2 (deliberate glance): every 8-25s, amplitude 0.25-0.40, held 0.5-1.5s.
 *   Visible gaze shifts that make the face appear to notice things.
 *
 * Returns { dartX, dartY, happinessDelta } for the caller to apply.
 */
export function updateMicro(
	m: MicroState,
	dt: number,
	active: boolean,
	microFreqMult: number = 1.0,
	config?: {
		jitterInterval?: [number, number];
		jitterRangeX?: number;
		jitterRangeY?: number;
		glanceInterval?: [number, number];
		glanceRangeX?: number;
		glanceRangeY?: number;
		glanceHold?: [number, number];
		mouthTwitchInterval?: [number, number];
		mouthTwitchRange?: number;
	},
): { dartX: number; dartY: number; happinessDelta: number } {
	if (!active) return { dartX: 0, dartY: 0, happinessDelta: 0 };
	const jitterInterval = config?.jitterInterval ?? [0.8, 2.0];
	const glanceInterval = config?.glanceInterval ?? [8, 25];
	const glanceHold = config?.glanceHold ?? [0.5, 1.5];
	const twitchInterval = config?.mouthTwitchInterval ?? [8, 15];
	const jitterRangeX = config?.jitterRangeX ?? 0.16;
	const jitterRangeY = config?.jitterRangeY ?? 0.08;
	const glanceRangeX = config?.glanceRangeX ?? 0.8;
	const glanceRangeY = config?.glanceRangeY ?? 0.4;
	const mouthTwitchRange = config?.mouthTwitchRange ?? 0.1;

	m.timer += dt;
	let happinessDelta = 0;

	// --- Tier 1: micro-jitter ---
	m.jitterTimer += dt;
	if (m.jitterTimer >= m.nextJitter) {
		m.jitterX = (Math.random() - 0.5) * jitterRangeX;
		m.jitterY = (Math.random() - 0.5) * jitterRangeY;
		m.jitterTimer = 0;
		m.nextJitter = (jitterInterval[0] + Math.random() * (jitterInterval[1] - jitterInterval[0])) * microFreqMult;
	}
	// Rapid decay — jitter is a quick flick
	m.jitterX = dlerp(m.jitterX, 0, 0.3, dt);
	m.jitterY = dlerp(m.jitterY, 0, 0.3, dt);

	// --- Tier 2: deliberate glance ---
	m.glanceTimer += dt;
	if (m.glanceHold > 0) {
		// Holding a glance position
		m.glanceHold -= dt;
		if (m.glanceHold <= 0) {
			// Release glance — drift back
			m.glanceX = 0;
			m.glanceY = 0;
		}
	} else if (m.glanceTimer >= m.nextGlance) {
		m.glanceX = (Math.random() - 0.5) * glanceRangeX;
		m.glanceY = (Math.random() - 0.5) * glanceRangeY;
		m.glanceHold = glanceHold[0] + Math.random() * (glanceHold[1] - glanceHold[0]);
		m.glanceTimer = 0;
		m.nextGlance = (glanceInterval[0] + Math.random() * (glanceInterval[1] - glanceInterval[0])) * microFreqMult;
	}

	// --- Mouth twitch ---
	if (m.timer > m.nextTwitch) {
		happinessDelta = (Math.random() - 0.5) * mouthTwitchRange;
		m.nextTwitch = m.timer + (twitchInterval[0] + Math.random() * (twitchInterval[1] - twitchInterval[0])) * microFreqMult;
	}

	return {
		dartX: m.jitterX + m.glanceX,
		dartY: m.jitterY + m.glanceY,
		happinessDelta,
	};
}

/**
 * Trigger anticipation for a state transition.
 * Queues a brief opposite-direction prep phase before the real transition.
 */
export function triggerAnticipation(
	ant: AnticipationState,
	fromState: FaceState,
	toState: FaceState,
): void {
	// Skip anticipation for trivial transitions or from sleeping
	if (fromState === toState || fromState === "sleeping") return;

	ant.active = true;
	ant.elapsed = 0;
	ant.pendingState = toState;

	// Duration and offsets depend on what we're transitioning TO
	switch (toState) {
		case "alert":
			// Squint before snapping wide — "flinch before startle"
			ant.duration = 0.10; // 100ms
			ant.lidOffset = -0.3;
			ant.mouthOffset = -0.05;
			ant.browOffset = -0.2;
			break;
		case "speaking":
			// Tighten mouth before opening
			ant.duration = 0.08; // 80ms
			ant.lidOffset = 0;
			ant.mouthOffset = -0.08;
			ant.browOffset = 0;
			break;
		case "reacting":
			// Brief freeze then burst
			ant.duration = 0.06; // 60ms
			ant.lidOffset = -0.1;
			ant.mouthOffset = -0.05;
			ant.browOffset = -0.15;
			break;
		case "thinking":
			// Slight widening before narrowing into focus
			ant.duration = 0.08;
			ant.lidOffset = 0.1;
			ant.mouthOffset = 0;
			ant.browOffset = 0.1;
			break;
		case "sleeping":
			// Brief heavy blink before settling
			ant.duration = 0.12; // 120ms
			ant.lidOffset = -0.5;
			ant.mouthOffset = 0;
			ant.browOffset = -0.1;
			break;
		default:
			// Subtle generic anticipation
			ant.duration = 0.06;
			ant.lidOffset = -0.05;
			ant.mouthOffset = 0;
			ant.browOffset = -0.05;
			break;
	}
}

/**
 * Update anticipation phase. Returns current offsets to apply.
 * When anticipation completes, sets active=false so the caller can apply final targets.
 */
export function updateAnticipation(
	ant: AnticipationState,
	dt: number,
): { lidOffset: number; mouthOffset: number; browOffset: number; complete: boolean } {
	if (!ant.active) {
		return { lidOffset: 0, mouthOffset: 0, browOffset: 0, complete: false };
	}

	ant.elapsed += dt;

	if (ant.elapsed >= ant.duration) {
		// Anticipation phase complete — caller should now apply final state targets
		ant.active = false;
		ant.pendingState = null;
		return { lidOffset: 0, mouthOffset: 0, browOffset: 0, complete: true };
	}

	// Ease-in the anticipation offset (ramp up then cut)
	const progress = ant.elapsed / ant.duration;
	const ease = Math.sin(progress * Math.PI); // peaks at midpoint

	return {
		lidOffset: ant.lidOffset * ease,
		mouthOffset: ant.mouthOffset * ease,
		browOffset: ant.browOffset * ease,
		complete: false,
	};
}
