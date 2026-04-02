/** Valid face states. */
export const VALID_STATES = new Set([
	"idle", "thinking", "speaking", "listening",
	"reacting", "puzzled", "alert", "working", "sleeping",
	"waiting", "loading",
]);

/** Valid emotions. */
export const VALID_EMOTIONS = new Set([
	"neutral", "happy", "sad", "confused",
	"excited", "concerned", "surprised", "playful",
	"frustrated", "skeptical", "determined", "embarrassed", "proud",
]);

const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;

export interface FaceStateData {
	state: string;
	amplitude: number;
	emotion: string;
	emotionSecondary: string;
	emotionBlend: number;
	intensity: number;
	progress: number | null;
	lookAt: { x: number; y: number };
	color: string | null;
	text: string | null;
	textDuration: number;
	detail: string | null;
	winkLeft: number;
	winkRight: number;
	_ts: number;
}

export function createDefaultState(): FaceStateData {
	return {
		state: "idle",
		amplitude: 0.0,
		emotion: "neutral",
		emotionSecondary: "neutral",
		emotionBlend: 0,
		intensity: 1,
		progress: null,
		lookAt: { x: 0, y: 0 },
		color: null,
		text: null,
		textDuration: 3000,
		detail: null,
		winkLeft: 0,
		winkRight: 0,
		_ts: Date.now(),
	};
}

/** Merge a partial update into current state with validation. */
export function mergeState(current: FaceStateData, partial: Record<string, unknown>): void {
	if (partial.type === "reset") {
		Object.assign(current, createDefaultState());
		return;
	}

	if (partial.state !== undefined && VALID_STATES.has(partial.state as string)) {
		current.state = partial.state as string;
	}
	if (partial.amplitude !== undefined) {
		current.amplitude = Math.max(0, Math.min(1, Number(partial.amplitude)));
	}
	if (partial.emotion !== undefined && VALID_EMOTIONS.has(partial.emotion as string)) {
		current.emotion = partial.emotion as string;
	}
	if (partial.emotionSecondary !== undefined && VALID_EMOTIONS.has(partial.emotionSecondary as string)) {
		current.emotionSecondary = partial.emotionSecondary as string;
	}
	if (partial.emotionBlend !== undefined) {
		current.emotionBlend = Math.max(0, Math.min(1, Number(partial.emotionBlend)));
	}
	if (partial.intensity !== undefined) {
		current.intensity = Math.max(0, Math.min(1, Number(partial.intensity)));
	}
	if (partial.progress !== undefined) {
		current.progress = partial.progress === null
			? null
			: Math.max(0, Math.min(1, Number(partial.progress)));
	}
	if (partial.lookAt !== undefined && typeof partial.lookAt === "object" && partial.lookAt !== null) {
		const la = partial.lookAt as { x?: unknown; y?: unknown };
		const x = Number(la.x);
		const y = Number(la.y);
		if (!isNaN(x)) current.lookAt.x = Math.max(-1, Math.min(1, x));
		if (!isNaN(y)) current.lookAt.y = Math.max(-1, Math.min(1, y));
	}
	if (partial.color !== undefined) {
		current.color = (partial.color === null || HEX_COLOR_RE.test(partial.color as string))
			? (partial.color as string | null)
			: current.color;
	}
	if (partial.text !== undefined) {
		current.text = typeof partial.text === "string" ? partial.text : null;
	}
	if (partial.detail !== undefined) {
		current.detail = typeof partial.detail === "string" ? partial.detail : null;
	}
	if (partial.textDuration !== undefined) {
		current.textDuration = Math.max(500, Math.min(30000, Number(partial.textDuration) || 3000));
	}
	if (partial.winkLeft !== undefined) {
		current.winkLeft = Math.max(0, Math.min(1, Number(partial.winkLeft)));
	}
	if (partial.winkRight !== undefined) {
		current.winkRight = Math.max(0, Math.min(1, Number(partial.winkRight)));
	}

	current._ts = Date.now();
}

/** Return state without internal fields. */
export function publicState(current: FaceStateData): Omit<FaceStateData, "_ts"> {
	const { _ts, ...rest } = current;
	return rest;
}
