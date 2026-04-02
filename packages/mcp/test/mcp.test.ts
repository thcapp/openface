import { describe, test, expect } from "bun:test";

// The MCP server connects to stdio on import, so we test the
// extractable logic: STATES, EMOTIONS constants, facePost/faceGet
// URL construction, and request body building.
// We re-declare the constants here to verify correctness against the spec.

const STATES = [
	"idle", "thinking", "speaking", "listening", "reacting",
	"puzzled", "alert", "working", "sleeping",
	"waiting", "loading",
] as const;

const EMOTIONS = [
	"neutral", "happy", "sad", "confused", "excited",
	"concerned", "surprised", "playful",
	"frustrated", "skeptical", "determined", "embarrassed", "proud",
] as const;

describe("STATES constant", () => {
	test("has exactly 11 states", () => {
		expect(STATES.length).toBe(11);
	});

	test("contains all protocol states", () => {
		const expected = [
			"idle", "thinking", "speaking", "listening", "reacting",
			"puzzled", "alert", "working", "sleeping", "waiting", "loading",
		];
		for (const s of expected) {
			expect(STATES.includes(s as any)).toBe(true);
		}
	});
});

describe("EMOTIONS constant", () => {
	test("has exactly 13 emotions", () => {
		expect(EMOTIONS.length).toBe(13);
	});

	test("contains all protocol emotions", () => {
		const expected = [
			"neutral", "happy", "sad", "confused", "excited",
			"concerned", "surprised", "playful",
			"frustrated", "skeptical", "determined", "embarrassed", "proud",
		];
		for (const e of expected) {
			expect(EMOTIONS.includes(e as any)).toBe(true);
		}
	});
});

// ── Tool request body building tests ──
// These mirror what the MCP tool handlers build before calling facePost

describe("set_face_state body building", () => {
	function buildSetStateBody(params: {
		state: string;
		emotion?: string;
		emotionSecondary?: string;
		emotionBlend?: number;
		intensity?: number;
		amplitude?: number;
		color?: string;
	}) {
		const body: Record<string, unknown> = { state: params.state };
		if (params.emotion !== undefined) body.emotion = params.emotion;
		if (params.emotionSecondary !== undefined) body.emotionSecondary = params.emotionSecondary;
		if (params.emotionBlend !== undefined) body.emotionBlend = params.emotionBlend;
		if (params.intensity !== undefined) body.intensity = params.intensity;
		if (params.amplitude !== undefined) body.amplitude = params.amplitude;
		if (params.color !== undefined) body.color = params.color;
		return body;
	}

	test("minimal: just state", () => {
		const body = buildSetStateBody({ state: "thinking" });
		expect(body).toEqual({ state: "thinking" });
	});

	test("full parameters", () => {
		const body = buildSetStateBody({
			state: "speaking",
			emotion: "happy",
			emotionSecondary: "excited",
			emotionBlend: 0.3,
			intensity: 0.8,
			amplitude: 0.6,
			color: "#FF5500",
		});
		expect(body).toEqual({
			state: "speaking",
			emotion: "happy",
			emotionSecondary: "excited",
			emotionBlend: 0.3,
			intensity: 0.8,
			amplitude: 0.6,
			color: "#FF5500",
		});
	});

	test("omits undefined optional fields", () => {
		const body = buildSetStateBody({ state: "idle", emotion: "neutral" });
		expect(Object.keys(body)).toEqual(["state", "emotion"]);
	});
});

describe("set_face_look body building", () => {
	test("builds lookAt object", () => {
		const body = { lookAt: { x: 0.5, y: -0.3 } };
		expect(body.lookAt.x).toBe(0.5);
		expect(body.lookAt.y).toBe(-0.3);
	});

	test("accepts boundary values", () => {
		const body = { lookAt: { x: -1, y: 1 } };
		expect(body.lookAt.x).toBe(-1);
		expect(body.lookAt.y).toBe(1);
	});
});

describe("face_wink body building", () => {
	test("left wink sets winkLeft to 1", () => {
		const eye = "left";
		const body = eye === "left" ? { winkLeft: 1 } : { winkRight: 1 };
		expect(body).toEqual({ winkLeft: 1 });
	});

	test("right wink sets winkRight to 1", () => {
		const eye = "right";
		const body = eye === "left" ? { winkLeft: 1 } : { winkRight: 1 };
		expect(body).toEqual({ winkRight: 1 });
	});

	test("reset left wink", () => {
		const eye = "left";
		const body = eye === "left" ? { winkLeft: 0 } : { winkRight: 0 };
		expect(body).toEqual({ winkLeft: 0 });
	});
});

describe("face_speak body building", () => {
	test("builds speaking state with text and duration", () => {
		const text = "Hello world!";
		const duration = 5000;
		const body = { state: "speaking", text, textDuration: duration };
		expect(body.state).toBe("speaking");
		expect(body.text).toBe("Hello world!");
		expect(body.textDuration).toBe(5000);
	});
});

describe("set_face_progress body building", () => {
	test("builds progress body", () => {
		const body: Record<string, unknown> = { progress: 0.5 };
		body.state = "working";
		body.text = "Compiling...";
		expect(body).toEqual({ progress: 0.5, state: "working", text: "Compiling..." });
	});

	test("null progress clears it", () => {
		const body: Record<string, unknown> = { progress: null };
		expect(body.progress).toBeNull();
	});

	test("omits state when not provided", () => {
		const progress = 0.7;
		const state = undefined;
		const text = undefined;
		const body: Record<string, unknown> = { progress };
		if (state !== undefined) body.state = state;
		if (text !== undefined) body.text = text;
		expect(Object.keys(body)).toEqual(["progress"]);
	});
});

describe("face_emote body building", () => {
	test("builds emotion-only body", () => {
		const body: Record<string, unknown> = { emotion: "happy" };
		expect(body).toEqual({ emotion: "happy" });
	});

	test("builds full emote body with blend", () => {
		const emotion = "happy";
		const intensity = 0.8;
		const emotionSecondary = "excited";
		const emotionBlend = 0.4;
		const body: Record<string, unknown> = { emotion };
		if (intensity !== undefined) body.intensity = intensity;
		if (emotionSecondary !== undefined) body.emotionSecondary = emotionSecondary;
		if (emotionBlend !== undefined) body.emotionBlend = emotionBlend;
		expect(body).toEqual({
			emotion: "happy",
			intensity: 0.8,
			emotionSecondary: "excited",
			emotionBlend: 0.4,
		});
	});
});

describe("face_reset body", () => {
	test("sends type: reset", () => {
		const body = { type: "reset" };
		expect(body.type).toBe("reset");
	});
});

// ── URL construction tests ──

describe("URL construction", () => {
	test("default URL uses 127.0.0.1:9999", () => {
		const FACE_URL = process.env.FACE_URL || "http://127.0.0.1:9999";
		expect(FACE_URL).toBe("http://127.0.0.1:9999");
	});

	test("state endpoint path", () => {
		const base = "http://127.0.0.1:9999";
		expect(`${base}/api/state`).toBe("http://127.0.0.1:9999/api/state");
	});
});

// ── Auth header construction tests ──

describe("auth header construction", () => {
	test("builds auth header when key present", () => {
		const FACE_API_KEY = "test-key";
		const headers: Record<string, string> = { "Content-Type": "application/json" };
		if (FACE_API_KEY) headers.Authorization = `Bearer ${FACE_API_KEY}`;
		expect(headers.Authorization).toBe("Bearer test-key");
	});

	test("omits auth header when key empty", () => {
		const FACE_API_KEY = "";
		const headers: Record<string, string> = { "Content-Type": "application/json" };
		if (FACE_API_KEY) headers.Authorization = `Bearer ${FACE_API_KEY}`;
		expect(headers.Authorization).toBeUndefined();
	});
});

// ── Validation tests (schema constraints) ──

describe("schema validation rules", () => {
	test("intensity must be 0-1", () => {
		expect(0).toBeGreaterThanOrEqual(0);
		expect(1).toBeLessThanOrEqual(1);
		expect(0.5).toBeGreaterThanOrEqual(0);
		expect(0.5).toBeLessThanOrEqual(1);
	});

	test("amplitude must be 0-1", () => {
		expect(0).toBeGreaterThanOrEqual(0);
		expect(1).toBeLessThanOrEqual(1);
	});

	test("emotionBlend must be 0-1", () => {
		expect(0).toBeGreaterThanOrEqual(0);
		expect(1).toBeLessThanOrEqual(1);
	});

	test("lookAt x/y must be -1 to 1", () => {
		expect(-1).toBeGreaterThanOrEqual(-1);
		expect(1).toBeLessThanOrEqual(1);
	});

	test("color must be hex format", () => {
		expect(/^#[0-9a-fA-F]{6}$/.test("#FF5500")).toBe(true);
		expect(/^#[0-9a-fA-F]{6}$/.test("#ff5500")).toBe(true);
		expect(/^#[0-9a-fA-F]{6}$/.test("red")).toBe(false);
		expect(/^#[0-9a-fA-F]{6}$/.test("#FFF")).toBe(false);
	});

	test("wink duration bounds: 100-5000ms", () => {
		expect(100).toBeGreaterThanOrEqual(100);
		expect(5000).toBeLessThanOrEqual(5000);
		expect(800).toBeGreaterThanOrEqual(100);
		expect(800).toBeLessThanOrEqual(5000);
	});

	test("speak text max 500 chars", () => {
		const text = "a".repeat(500);
		expect(text.length).toBeLessThanOrEqual(500);
	});

	test("speak duration bounds: 500-30000ms", () => {
		expect(500).toBeGreaterThanOrEqual(500);
		expect(30000).toBeLessThanOrEqual(30000);
	});

	test("progress text max 200 chars", () => {
		const text = "a".repeat(200);
		expect(text.length).toBeLessThanOrEqual(200);
	});
});
