import { describe, expect, test } from "bun:test";
import { createDefaultState, mergeState, publicState, VALID_STATES, VALID_EMOTIONS } from "../src/state.js";

describe("createDefaultState", () => {
	test("returns idle/neutral defaults", () => {
		const s = createDefaultState();
		expect(s.state).toBe("idle");
		expect(s.emotion).toBe("neutral");
		expect(s.amplitude).toBe(0);
		expect(s.lookAt).toEqual({ x: 0, y: 0 });
		expect(s.color).toBeNull();
		expect(s.text).toBeNull();
		expect(s.winkLeft).toBe(0);
		expect(s.winkRight).toBe(0);
	});

	test("returns new field defaults", () => {
		const s = createDefaultState();
		expect(s.emotionSecondary).toBe("neutral");
		expect(s.emotionBlend).toBe(0);
		expect(s.intensity).toBe(1);
		expect(s.progress).toBeNull();
	});
});

describe("VALID_STATES", () => {
	test("contains all 11 states", () => {
		const expected = [
			"idle", "thinking", "speaking", "listening",
			"reacting", "puzzled", "alert", "working", "sleeping",
			"waiting", "loading",
		];
		for (const s of expected) {
			expect(VALID_STATES.has(s)).toBe(true);
		}
		expect(VALID_STATES.size).toBe(11);
	});
});

describe("VALID_EMOTIONS", () => {
	test("contains all 13 emotions", () => {
		const expected = [
			"neutral", "happy", "sad", "confused",
			"excited", "concerned", "surprised", "playful",
			"frustrated", "skeptical", "determined", "embarrassed", "proud",
		];
		for (const e of expected) {
			expect(VALID_EMOTIONS.has(e)).toBe(true);
		}
		expect(VALID_EMOTIONS.size).toBe(13);
	});
});

describe("mergeState", () => {
	test("merges valid state", () => {
		const s = createDefaultState();
		mergeState(s, { state: "thinking" });
		expect(s.state).toBe("thinking");
	});

	test("merges valid emotion", () => {
		const s = createDefaultState();
		mergeState(s, { emotion: "happy" });
		expect(s.emotion).toBe("happy");
	});

	test("rejects invalid state", () => {
		const s = createDefaultState();
		mergeState(s, { state: "invalid" });
		expect(s.state).toBe("idle");
	});

	test("rejects invalid emotion", () => {
		const s = createDefaultState();
		mergeState(s, { emotion: "angry" });
		expect(s.emotion).toBe("neutral");
	});

	test("clamps amplitude", () => {
		const s = createDefaultState();
		mergeState(s, { amplitude: 1.5 });
		expect(s.amplitude).toBe(1);
		mergeState(s, { amplitude: -0.5 });
		expect(s.amplitude).toBe(0);
	});

	test("clamps lookAt", () => {
		const s = createDefaultState();
		mergeState(s, { lookAt: { x: 2, y: -3 } });
		expect(s.lookAt.x).toBe(1);
		expect(s.lookAt.y).toBe(-1);
	});

	test("validates hex color", () => {
		const s = createDefaultState();
		mergeState(s, { color: "#FF0000" });
		expect(s.color).toBe("#FF0000");

		mergeState(s, { color: "not-a-color" });
		expect(s.color).toBe("#FF0000"); // unchanged

		mergeState(s, { color: null });
		expect(s.color).toBeNull();
	});

	test("preserves full text without truncation", () => {
		const s = createDefaultState();
		mergeState(s, { text: "a".repeat(300) });
		expect(s.text?.length).toBe(300);
	});

	test("handles reset", () => {
		const s = createDefaultState();
		mergeState(s, { state: "speaking", emotion: "happy", amplitude: 0.8, intensity: 0.5 });
		expect(s.state).toBe("speaking");
		expect(s.intensity).toBe(0.5);

		mergeState(s, { type: "reset" });
		expect(s.state).toBe("idle");
		expect(s.emotion).toBe("neutral");
		expect(s.amplitude).toBe(0);
		expect(s.intensity).toBe(1);
		expect(s.emotionSecondary).toBe("neutral");
		expect(s.emotionBlend).toBe(0);
		expect(s.progress).toBeNull();
	});

	test("merges partial lookAt", () => {
		const s = createDefaultState();
		mergeState(s, { lookAt: { x: 0.5 } });
		expect(s.lookAt.x).toBe(0.5);
		expect(s.lookAt.y).toBe(0); // unchanged
	});

	test("clamps wink values", () => {
		const s = createDefaultState();
		mergeState(s, { winkLeft: 1.5, winkRight: -0.5 });
		expect(s.winkLeft).toBe(1);
		expect(s.winkRight).toBe(0);
	});

	// New states
	test("accepts waiting state", () => {
		const s = createDefaultState();
		mergeState(s, { state: "waiting" });
		expect(s.state).toBe("waiting");
	});

	test("accepts loading state", () => {
		const s = createDefaultState();
		mergeState(s, { state: "loading" });
		expect(s.state).toBe("loading");
	});

	// New emotions
	test("accepts frustrated emotion", () => {
		const s = createDefaultState();
		mergeState(s, { emotion: "frustrated" });
		expect(s.emotion).toBe("frustrated");
	});

	test("accepts skeptical emotion", () => {
		const s = createDefaultState();
		mergeState(s, { emotion: "skeptical" });
		expect(s.emotion).toBe("skeptical");
	});

	test("accepts determined emotion", () => {
		const s = createDefaultState();
		mergeState(s, { emotion: "determined" });
		expect(s.emotion).toBe("determined");
	});

	test("accepts embarrassed emotion", () => {
		const s = createDefaultState();
		mergeState(s, { emotion: "embarrassed" });
		expect(s.emotion).toBe("embarrassed");
	});

	test("accepts proud emotion", () => {
		const s = createDefaultState();
		mergeState(s, { emotion: "proud" });
		expect(s.emotion).toBe("proud");
	});

	// intensity
	test("merges intensity", () => {
		const s = createDefaultState();
		mergeState(s, { intensity: 0.5 });
		expect(s.intensity).toBe(0.5);
	});

	test("clamps intensity to 0-1", () => {
		const s = createDefaultState();
		mergeState(s, { intensity: 1.5 });
		expect(s.intensity).toBe(1);
		mergeState(s, { intensity: -0.3 });
		expect(s.intensity).toBe(0);
	});

	// progress
	test("merges progress", () => {
		const s = createDefaultState();
		mergeState(s, { progress: 0.65 });
		expect(s.progress).toBe(0.65);
	});

	test("clamps progress to 0-1", () => {
		const s = createDefaultState();
		mergeState(s, { progress: 2.0 });
		expect(s.progress).toBe(1);
		mergeState(s, { progress: -1.0 });
		expect(s.progress).toBe(0);
	});

	test("clears progress with null", () => {
		const s = createDefaultState();
		mergeState(s, { progress: 0.5 });
		expect(s.progress).toBe(0.5);
		mergeState(s, { progress: null });
		expect(s.progress).toBeNull();
	});

	// emotionSecondary
	test("merges valid emotionSecondary", () => {
		const s = createDefaultState();
		mergeState(s, { emotionSecondary: "happy" });
		expect(s.emotionSecondary).toBe("happy");
	});

	test("rejects invalid emotionSecondary", () => {
		const s = createDefaultState();
		mergeState(s, { emotionSecondary: "bogus" });
		expect(s.emotionSecondary).toBe("neutral");
	});

	test("accepts new emotions as emotionSecondary", () => {
		const s = createDefaultState();
		mergeState(s, { emotionSecondary: "proud" });
		expect(s.emotionSecondary).toBe("proud");
	});

	// emotionBlend
	test("merges emotionBlend", () => {
		const s = createDefaultState();
		mergeState(s, { emotionBlend: 0.7 });
		expect(s.emotionBlend).toBe(0.7);
	});

	test("clamps emotionBlend to 0-1", () => {
		const s = createDefaultState();
		mergeState(s, { emotionBlend: 5.0 });
		expect(s.emotionBlend).toBe(1);
		mergeState(s, { emotionBlend: -2.0 });
		expect(s.emotionBlend).toBe(0);
	});

	// Compound updates
	test("handles compound update with all new fields", () => {
		const s = createDefaultState();
		mergeState(s, {
			state: "working",
			emotion: "determined",
			emotionSecondary: "frustrated",
			emotionBlend: 0.3,
			intensity: 0.8,
			progress: 0.45,
		});
		expect(s.state).toBe("working");
		expect(s.emotion).toBe("determined");
		expect(s.emotionSecondary).toBe("frustrated");
		expect(s.emotionBlend).toBe(0.3);
		expect(s.intensity).toBe(0.8);
		expect(s.progress).toBe(0.45);
	});
});

describe("publicState", () => {
	test("excludes _ts", () => {
		const s = createDefaultState();
		const pub = publicState(s);
		expect("_ts" in pub).toBe(false);
		expect(pub.state).toBe("idle");
	});

	test("includes new fields", () => {
		const s = createDefaultState();
		mergeState(s, { intensity: 0.6, progress: 0.3, emotionSecondary: "happy", emotionBlend: 0.5 });
		const pub = publicState(s);
		expect(pub.intensity).toBe(0.6);
		expect(pub.progress).toBe(0.3);
		expect(pub.emotionSecondary).toBe("happy");
		expect(pub.emotionBlend).toBe(0.5);
	});
});
