/**
 * @openface/filter — Filtering/normalization pipeline for raw AI agent output.
 * Transforms raw provider messages into clean StateUpdate messages.
 */

import { extractClaude, extractOpenAI, extractGemini, extractOllama, extractAuto } from "./extract.js";
import { classify } from "./classify.js";
import { detectFromText, detectFromTools, faceStateFromTools, blendEmotions } from "./emotion.js";
import { summarizeToolCall, summarizeToolCalls } from "./summarize.js";
import { cleanForDisplay, cleanForDetail } from "./clean.js";
import type {
	Provider, FilterConfig, FilterResult, StateUpdate,
	NormalizedMessage, ContentCategory, FaceState,
} from "./types.js";

// Re-export types and utilities
export { extractClaude, extractOpenAI, extractGemini, extractOllama, extractAuto } from "./extract.js";
export { classify, isNoise } from "./classify.js";
export { detectFromText, detectFromTools, detectFromState, faceStateFromTools, blendEmotions } from "./emotion.js";
export { summarizeToolCall, summarizeToolCalls } from "./summarize.js";
export {
	stripMarkdown, stripDiscord, processCodeBlocks,
	truncateSentence, truncateWord, truncateUrl, truncatePath,
	cleanForDisplay, cleanForDetail,
	chunkBySentence, prepareForTTS,
} from "./clean.js";
export type {
	Provider, FilterConfig, FilterResult, StateUpdate,
	NormalizedMessage, ToolCallInfo, ContentCategory,
	FaceState, FaceEmotion, EmotionSignal, BlendedEmotion,
	ClassifiedMessage,
} from "./types.js";

const DEFAULT_CONFIG: Required<FilterConfig> = {
	provider: "claude",
	showThinking: false,
	maxBubbleLength: 200,
	maxDetailLength: 500,
	maxStatusLength: 80,
};

/** Resolve extractor function for a provider. */
function getExtractor(provider: Provider) {
	switch (provider) {
		case "claude": return extractClaude;
		case "openai": return extractOpenAI;
		case "gemini": return extractGemini;
		case "ollama": return extractOllama;
		default: return extractAuto;
	}
}

/** The main filtering pipeline. Processes raw agent output into a StateUpdate + metadata. */
export class FilterPipeline {
	private config: Required<FilterConfig>;
	private extract: (raw: unknown) => NormalizedMessage;

	constructor(config: Partial<FilterConfig> = {}) {
		this.config = { ...DEFAULT_CONFIG, ...config };
		this.extract = getExtractor(this.config.provider);
	}

	/** Process a raw provider message through the full pipeline. */
	process(raw: unknown): FilterResult {
		// 1. Extract normalized message
		const msg = this.extract(raw);

		// 2. Classify content
		const classified = classify(msg);

		// 3. Detect emotion
		const emotionSignals = [];
		if (msg.text) {
			emotionSignals.push(...detectFromText(msg.text));
		}
		const toolEmotion = detectFromTools(msg.toolCalls);
		if (toolEmotion) {
			emotionSignals.push(toolEmotion);
		}
		const blended = blendEmotions(emotionSignals);

		// 4. Determine face state
		let faceState: FaceState = classified.faceState;
		const toolState = faceStateFromTools(msg.toolCalls);
		if (toolState && classified.category === "summarizable") {
			faceState = toolState;
		}

		// 5. Build display text (full content, no truncation)
		let displayText: string | null = null;
		if (classified.displayText) {
			displayText = cleanForDisplay(classified.displayText);
		} else if (this.config.showThinking && msg.thinking) {
			displayText = cleanForDisplay(msg.thinking);
		}

		// 6. Build status / detail text
		let statusText: string | null = classified.statusText;
		if (classified.category === "summarizable" && msg.toolCalls.length > 0) {
			statusText = summarizeToolCalls(msg.toolCalls, this.config.maxStatusLength);
		}

		// 7. Build detail (full content preserved)
		let detail: string | null = null;
		if (msg.text) {
			detail = cleanForDetail(msg.text);
		}

		// 8. Assemble StateUpdate
		const stateUpdate: StateUpdate = {
			state: faceState,
			emotion: blended.emotion,
			intensity: blended.intensity,
			type: "state",
		};

		if (blended.emotionSecondary) {
			stateUpdate.emotionSecondary = blended.emotionSecondary;
			stateUpdate.emotionBlend = blended.emotionBlend;
		}

		if (displayText) {
			stateUpdate.text = displayText;
		} else if (statusText) {
			stateUpdate.text = statusText;
		}

		if (detail) {
			stateUpdate.detail = detail;
		}

		return {
			stateUpdate,
			displayText: displayText ?? statusText,
			category: classified.category,
		};
	}

	/** Update configuration (e.g., switch provider mid-stream). */
	setConfig(config: Partial<FilterConfig>): void {
		Object.assign(this.config, config);
		if (config.provider) {
			this.extract = getExtractor(this.config.provider);
		}
	}
}

/** Convenience: create a new FilterPipeline. */
export function createFilter(config: Partial<FilterConfig> = {}): FilterPipeline {
	return new FilterPipeline(config);
}
