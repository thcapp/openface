/** Supported AI provider identifiers. */
export type Provider = "claude" | "openai" | "gemini" | "ollama";

/** Content classification categories. */
export type ContentCategory = "display" | "status" | "summarizable" | "internal" | "error";

/** Emotion signal source for intensity calibration. */
export type EmotionSource = "pattern" | "state" | "transformer";

/** Face states (mirrored from @openface/renderer). */
export const STATES = [
	"idle", "thinking", "speaking", "listening",
	"reacting", "puzzled", "alert", "working", "sleeping",
	"waiting", "loading",
] as const;
export type FaceState = (typeof STATES)[number];

/** Face emotions (mirrored from @openface/renderer). */
export const EMOTIONS = [
	"neutral", "happy", "sad", "confused",
	"excited", "concerned", "surprised", "playful",
	"frustrated", "skeptical", "determined", "embarrassed", "proud",
] as const;
export type FaceEmotion = (typeof EMOTIONS)[number];

/** StateUpdate compatible with @openface/renderer. */
export interface StateUpdate {
	state?: FaceState;
	emotion?: FaceEmotion;
	emotionSecondary?: FaceEmotion;
	emotionBlend?: number;
	intensity?: number;
	amplitude?: number;
	lookAt?: { x: number; y: number };
	color?: string | null;
	winkLeft?: number;
	winkRight?: number;
	progress?: number | null;
	text?: string | null;
	textDuration?: number;
	detail?: string | null;
	type?: "state" | "reset" | "ping" | "pong";
}

/** Normalized message after provider extraction. */
export interface NormalizedMessage {
	text: string | null;
	thinking: string | null;
	toolCalls: ToolCallInfo[];
	stopReason: string | null;
	error: string | null;
	raw: unknown;
}

/** Extracted tool call information. */
export interface ToolCallInfo {
	name: string;
	input: Record<string, unknown>;
	id?: string;
}

/** Emotion detection result. */
export interface EmotionSignal {
	emotion: FaceEmotion;
	intensity: number;
	source: EmotionSource;
	confidence: number;
}

/** Blended emotion result. */
export interface BlendedEmotion {
	emotion: FaceEmotion;
	intensity: number;
	emotionSecondary?: FaceEmotion;
	emotionBlend?: number;
}

/** Classification result for a message. */
export interface ClassifiedMessage {
	category: ContentCategory;
	faceState: FaceState;
	displayText: string | null;
	statusText: string | null;
}

/** Full pipeline output. */
export interface FilterResult {
	stateUpdate: StateUpdate;
	displayText: string | null;
	category: ContentCategory;
}

/** Pipeline configuration. */
export interface FilterConfig {
	provider: Provider;
	/** Show thinking content (default false). */
	showThinking?: boolean;
	/** Max chars for speech bubble (default 200). */
	maxBubbleLength?: number;
	/** Max chars for detail field (default 500). */
	maxDetailLength?: number;
	/** Max chars for status text (default 80). */
	maxStatusLength?: number;
}
