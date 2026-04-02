import type { FaceEmotion, FaceState, EmotionSignal, EmotionSource, BlendedEmotion, ToolCallInfo } from "./types.js";

/** Pattern-based emotion rules — ordered by specificity. */
const EMOTION_PATTERNS: Array<{ pattern: RegExp; emotion: FaceEmotion; intensity: number }> = [
	// Frustrated / Error
	{ pattern: /\b(error|failed|failure|refused|denied|timeout|exception|crash|panic|fatal)\b/i, emotion: "frustrated", intensity: 0.7 },
	{ pattern: /\b(bug|broken|invalid|corrupt|malformed|unexpected)\b/i, emotion: "frustrated", intensity: 0.5 },
	{ pattern: /\b(deprecated|unsupported|incompatible)\b/i, emotion: "skeptical", intensity: 0.4 },

	// Concerned / Warning
	{ pattern: /\b(warning|warn|caution|careful|risky|dangerous)\b/i, emotion: "concerned", intensity: 0.6 },
	{ pattern: /\b(slow|degraded|partial|incomplete|missing)\b/i, emotion: "concerned", intensity: 0.4 },
	{ pattern: /\b(retry|retrying|attempt|fallback)\b/i, emotion: "concerned", intensity: 0.3 },

	// Confused / Puzzled
	{ pattern: /\b(unclear|ambiguous|unexpected|strange|weird|odd|confus)/i, emotion: "confused", intensity: 0.5 },
	{ pattern: /\?\s*$/, emotion: "confused", intensity: 0.3 },
	{ pattern: /\b(not sure|uncertain|unsure|don't know|can't tell)\b/i, emotion: "confused", intensity: 0.5 },

	// Happy / Success
	{ pattern: /\b(success|succeeded|passed|complete[d]?|done|ready|fixed|resolved|merged)\b/i, emotion: "happy", intensity: 0.6 },
	{ pattern: /\b(works?|working|running|live|deployed|published)\b/i, emotion: "happy", intensity: 0.4 },
	{ pattern: /\b(great|excellent|perfect|awesome|nice)\b/i, emotion: "happy", intensity: 0.7 },

	// Excited
	{ pattern: /!{2,}/, emotion: "excited", intensity: 0.6 },
	{ pattern: /\b(new|breakthrough|milestone|launch|release|ship)\b/i, emotion: "excited", intensity: 0.5 },

	// Determined / Working
	{ pattern: /\b(searching|scanning|processing|analyzing|building|compiling|installing|downloading)\b/i, emotion: "determined", intensity: 0.5 },
	{ pattern: /\b(found|located|identified|detected|discovered)\b/i, emotion: "determined", intensity: 0.4 },
	{ pattern: /\b(implementing|creating|generating|writing|updating)\b/i, emotion: "determined", intensity: 0.5 },

	// Surprised
	{ pattern: /\b(unexpected|surprisingly|interesting|notable|unusual)\b/i, emotion: "surprised", intensity: 0.5 },

	// Skeptical
	{ pattern: /\b(however|although|but|yet|despite|questionable|doubt)\b/i, emotion: "skeptical", intensity: 0.3 },

	// Proud
	{ pattern: /\b(optimized|improved|enhanced|refactored|simplified|clean)\b/i, emotion: "proud", intensity: 0.4 },

	// Playful (rare in agent output)
	{ pattern: /[:;]-?[)D]/, emotion: "playful", intensity: 0.5 },
];

/** Tool name → [faceState, emotion, intensity]. */
const STATE_EMOTION_MAP: Record<string, [FaceState, FaceEmotion, number]> = {
	Bash: ["working", "determined", 0.5],
	Edit: ["working", "determined", 0.6],
	Write: ["working", "determined", 0.6],
	Read: ["thinking", "neutral", 0.2],
	Glob: ["working", "determined", 0.4],
	Grep: ["working", "determined", 0.4],
	WebFetch: ["working", "determined", 0.3],
	WebSearch: ["thinking", "confused", 0.3],
	Agent: ["working", "determined", 0.5],
	// OpenAI Responses API tools
	web_search_call: ["working", "determined", 0.3],
	file_search_call: ["working", "determined", 0.4],
	code_interpreter_call: ["working", "determined", 0.5],
	image_generation_call: ["working", "determined", 0.5],
	mcp_call: ["working", "determined", 0.4],
	// Gemini
	executableCode: ["working", "determined", 0.5],
	// Special states
	_error: ["puzzled", "frustrated", 0.6],
	_timeout: ["waiting", "concerned", 0.5],
	_rate_limit: ["waiting", "neutral", 0.2],
	_start: ["loading", "neutral", 0.0],
	_stop: ["idle", "neutral", 0.0],
	_thinking: ["thinking", "determined", 0.4],
	_speaking: ["speaking", "neutral", 0.3],
};

/** Calibration multipliers per source type. */
const CALIBRATION: Record<EmotionSource, number> = {
	pattern: 1.0,
	state: 0.8,
	transformer: 0.6,
};

/** Detect emotions from text using pattern matching. */
export function detectFromText(text: string): EmotionSignal[] {
	const signals: EmotionSignal[] = [];
	const seen = new Set<FaceEmotion>();

	for (const rule of EMOTION_PATTERNS) {
		if (rule.pattern.test(text) && !seen.has(rule.emotion)) {
			seen.add(rule.emotion);
			signals.push({
				emotion: rule.emotion,
				intensity: calibrate(rule.intensity, "pattern"),
				source: "pattern",
				confidence: 0.8,
			});
		}
	}

	return signals;
}

/** Infer emotion from tool calls (state-based). */
export function detectFromTools(toolCalls: ToolCallInfo[]): EmotionSignal | null {
	if (toolCalls.length === 0) return null;

	// Use the first tool call for state inference
	const toolName = toolCalls[0].name;
	const mapping = STATE_EMOTION_MAP[toolName];

	if (mapping) {
		return {
			emotion: mapping[1],
			intensity: calibrate(mapping[2], "state"),
			source: "state",
			confidence: 0.9,
		};
	}

	// Default for unknown tools
	return {
		emotion: "determined",
		intensity: calibrate(0.4, "state"),
		source: "state",
		confidence: 0.5,
	};
}

/** Infer face state from tool calls. */
export function faceStateFromTools(toolCalls: ToolCallInfo[]): FaceState | null {
	if (toolCalls.length === 0) return null;
	const toolName = toolCalls[0].name;
	const mapping = STATE_EMOTION_MAP[toolName];
	return mapping ? mapping[0] : "working";
}

/** Infer emotion from a special state key. */
export function detectFromState(stateKey: string): EmotionSignal | null {
	const mapping = STATE_EMOTION_MAP[stateKey];
	if (!mapping) return null;

	return {
		emotion: mapping[1],
		intensity: calibrate(mapping[2], "state"),
		source: "state",
		confidence: 0.9,
	};
}

/** Blend multiple emotion signals into primary + optional secondary. */
export function blendEmotions(signals: EmotionSignal[]): BlendedEmotion {
	if (signals.length === 0) return { emotion: "neutral", intensity: 0 };
	if (signals.length === 1) return { emotion: signals[0].emotion, intensity: signals[0].intensity };

	// Sort by confidence * intensity descending
	const sorted = [...signals].sort(
		(a, b) => (b.confidence * b.intensity) - (a.confidence * a.intensity),
	);

	const primary = sorted[0];
	const secondary = sorted[1];

	const result: BlendedEmotion = {
		emotion: primary.emotion,
		intensity: primary.intensity,
	};

	if (secondary && secondary.emotion !== primary.emotion) {
		result.emotionSecondary = secondary.emotion;
		result.emotionBlend = secondary.intensity / (primary.intensity + secondary.intensity);
	}

	return result;
}

/** Apply calibration multiplier by source type. */
function calibrate(rawIntensity: number, source: EmotionSource): number {
	return Math.min(1.0, rawIntensity * (CALIBRATION[source] ?? 0.7));
}
