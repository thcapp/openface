import type { NormalizedMessage, ClassifiedMessage, ContentCategory, FaceState } from "./types.js";

/** Regex patterns that indicate system noise / internal metadata. */
const SYSTEM_NOISE_PATTERNS = [
	/\b\d+\s*tokens?\b/i,
	/usage:\s*\{/,
	/input_tokens|output_tokens|prompt_tokens|completion_tokens/,
	/^msg_[a-zA-Z0-9]+$/,
	/^chatcmpl-[a-zA-Z0-9]+$/,
	/^toolu_[a-zA-Z0-9]+$/,
	/^call_[a-zA-Z0-9]+$/,
	/health\s*check\s*(passed|ok|healthy)/i,
	/cron\s*(job|task)\s*(completed|finished|started)/i,
	/token\s*sync\s*(completed|started)/i,
	/x-ratelimit/i,
	/retry-after:\s*\d+/i,
	/HTTP\/\d\.\d\s+\d{3}/,
	/system_fingerprint/,
	/model_version/,
	/service_tier/,
	/^[A-Za-z0-9+/=]{40,}$/, // Base64 blobs
];

/** Map stop reasons to face states across providers. */
const STOP_REASON_MAP: Record<string, FaceState> = {
	// Claude
	end_turn: "idle",
	tool_use: "working",
	max_tokens: "speaking",
	stop_sequence: "idle",
	pause_turn: "working",
	refusal: "alert",
	// OpenAI
	stop: "idle",
	tool_calls: "working",
	length: "speaking",
	content_filter: "alert",
	// Gemini
	STOP: "idle",
	MAX_TOKENS: "speaking",
	SAFETY: "alert",
	RECITATION: "alert",
	MALFORMED_FUNCTION_CALL: "puzzled",
};

/** Classify a normalized message into a content category with face state. */
export function classify(msg: NormalizedMessage): ClassifiedMessage {
	// Error takes priority
	if (msg.error) {
		return {
			category: "error",
			faceState: classifyErrorState(msg.error),
			displayText: msg.error,
			statusText: null,
		};
	}

	// Tool calls → summarizable
	if (msg.toolCalls.length > 0 && !msg.text) {
		return {
			category: "summarizable",
			faceState: "working",
			displayText: null,
			statusText: null,
		};
	}

	// Text content
	if (msg.text) {
		// Check for noise
		if (isNoise(msg.text)) {
			return {
				category: "internal",
				faceState: faceStateFromStop(msg.stopReason),
				displayText: null,
				statusText: null,
			};
		}

		// Check for pure JSON (likely structured data, not human text)
		if (isPureJson(msg.text)) {
			return {
				category: "internal",
				faceState: "working",
				displayText: null,
				statusText: null,
			};
		}

		// Has both text and tool calls
		if (msg.toolCalls.length > 0) {
			return {
				category: "display",
				faceState: "speaking",
				displayText: msg.text,
				statusText: null,
			};
		}

		// Plain text response
		return {
			category: "display",
			faceState: "speaking",
			displayText: msg.text,
			statusText: null,
		};
	}

	// Thinking only (no text, no tools)
	if (msg.thinking) {
		return {
			category: "status",
			faceState: "thinking",
			displayText: null,
			statusText: "Thinking...",
		};
	}

	// Nothing useful
	return {
		category: "internal",
		faceState: faceStateFromStop(msg.stopReason),
		displayText: null,
		statusText: null,
	};
}

/** Check if text matches system noise patterns. */
export function isNoise(text: string): boolean {
	const trimmed = text.trim();
	if (!trimmed) return true;
	return SYSTEM_NOISE_PATTERNS.some(p => p.test(trimmed));
}

/** Check if text is pure JSON (not human language). */
function isPureJson(text: string): boolean {
	const trimmed = text.trim();
	if ((trimmed.startsWith("{") && trimmed.endsWith("}")) ||
		(trimmed.startsWith("[") && trimmed.endsWith("]"))) {
		try { JSON.parse(trimmed); return true; } catch { return false; }
	}
	return false;
}

/** Get face state from stop reason. */
function faceStateFromStop(stopReason: string | null): FaceState {
	if (!stopReason) return "idle";
	return STOP_REASON_MAP[stopReason] ?? "idle";
}

/** Classify error text into appropriate face state. */
function classifyErrorState(error: string): FaceState {
	const lower = error.toLowerCase();
	if (lower.includes("rate limit") || lower.includes("overloaded") || lower.includes("timeout")) {
		return "waiting";
	}
	if (lower.includes("auth") || lower.includes("denied") || lower.includes("refus") || lower.includes("safety")) {
		return "alert";
	}
	if (lower.includes("malformed") || lower.includes("invalid") || lower.includes("unexpected")) {
		return "puzzled";
	}
	return "puzzled";
}
