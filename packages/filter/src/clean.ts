/** Text cleaning and preparation for speech bubble / TTS display. */

const CODE_BLOCK_RE = /```[\s\S]*?```/g;
const INLINE_CODE_RE = /`([^`]+)`/g;
const LINK_RE = /\[([^\]]+)\]\([^)]+\)/g;
const HEADER_RE = /^#{1,6}\s+/gm;
const BOLD_ITALIC_RE = /[*_]{1,3}([^*_]+)[*_]{1,3}/g;
const LIST_MARKER_RE = /^[\s]*[-*+]\s+/gm;
const BLOCKQUOTE_RE = /^>\s+/gm;
const IMAGE_RE = /!\[([^\]]*)\]\([^)]+\)/g;
const MULTI_NEWLINE_RE = /\n{2,}/g;
const MULTI_SPACE_RE = /\s+/g;

// Discord-specific noise
const DISCORD_USER_RE = /<@!?\d{17,20}>/g;
const DISCORD_CHANNEL_RE = /<#\d{17,20}>/g;
const DISCORD_ROLE_RE = /<@&\d{17,20}>/g;
const DISCORD_EMOJI_RE = /<a?:\w+:\d{17,20}>/g;

/** Strip markdown formatting, producing plain text suitable for TTS / speech bubble. */
export function stripMarkdown(text: string): string {
	return text
		.replace(CODE_BLOCK_RE, "")
		.replace(INLINE_CODE_RE, "$1")
		.replace(IMAGE_RE, "")
		.replace(LINK_RE, "$1")
		.replace(HEADER_RE, "")
		.replace(BOLD_ITALIC_RE, "$1")
		.replace(LIST_MARKER_RE, "")
		.replace(BLOCKQUOTE_RE, "")
		.replace(MULTI_NEWLINE_RE, " ")
		.replace(MULTI_SPACE_RE, " ")
		.trim();
}

/** Strip Discord-specific formatting noise. */
export function stripDiscord(text: string): string {
	return text
		.replace(DISCORD_USER_RE, "")
		.replace(DISCORD_CHANNEL_RE, "")
		.replace(DISCORD_ROLE_RE, "")
		.replace(DISCORD_EMOJI_RE, "")
		.replace(MULTI_SPACE_RE, " ")
		.trim();
}

/** Process code blocks: produce speech-safe and detail versions. */
export function processCodeBlocks(text: string): {
	speech: string;
	detail: string;
	hasCode: boolean;
	codeLanguage: string | null;
} {
	const hasCode = CODE_BLOCK_RE.test(text);
	// Reset lastIndex since we tested with a global regex
	CODE_BLOCK_RE.lastIndex = 0;
	const langMatch = text.match(/```(\w+)/);

	return {
		speech: text
			.replace(CODE_BLOCK_RE, " [code] ")
			.replace(MULTI_SPACE_RE, " ")
			.trim(),
		detail: truncateWord(text, 500),
		hasCode,
		codeLanguage: langMatch?.[1] ?? null,
	};
}

/** Truncate at sentence boundary. */
export function truncateSentence(text: string, maxLen: number): string {
	if (text.length <= maxLen) return text;

	const sub = text.slice(0, maxLen - 3);
	const lastPeriod = Math.max(
		sub.lastIndexOf(". "),
		sub.lastIndexOf("! "),
		sub.lastIndexOf("? "),
	);

	if (lastPeriod > maxLen * 0.5) {
		return text.slice(0, lastPeriod + 1);
	}

	// Fall back to word boundary
	const lastSpace = sub.lastIndexOf(" ");
	return text.slice(0, lastSpace > 0 ? lastSpace : maxLen - 3) + "...";
}

/** Truncate at word boundary. */
export function truncateWord(text: string, maxLen: number): string {
	if (text.length <= maxLen) return text;
	const sub = text.slice(0, maxLen - 3);
	const lastSpace = sub.lastIndexOf(" ");
	return text.slice(0, lastSpace > 0 ? lastSpace : maxLen - 3) + "...";
}

/** Truncate a URL for display. */
export function truncateUrl(url: string, maxLen = 40): string {
	try {
		const u = new URL(url);
		const path = u.pathname.length > 1 ? u.pathname.split("/").pop() || "" : "";
		return u.hostname + (path ? "/" + path : "");
	} catch {
		return url.slice(0, maxLen) + (url.length > maxLen ? "..." : "");
	}
}

/** Truncate a file path for display. */
export function truncatePath(filePath: string, maxLen = 40): string {
	if (filePath.length <= maxLen) return filePath;
	const parts = filePath.split("/");
	const filename = parts.pop() ?? "";
	return ".../" + (parts.length > 0 ? parts.pop() + "/" : "") + filename;
}

/** Full text cleaning pipeline: markdown strip + discord strip. No truncation. */
export function cleanForDisplay(text: string): string {
	let cleaned = stripMarkdown(text);
	cleaned = stripDiscord(cleaned);
	return cleaned;
}

/** Clean text for the detail field. No truncation. */
export function cleanForDetail(text: string): string {
	return text;
}

// --- Sentence-boundary chunking (for TTS and display overflow) ---

const SENTENCE_END_RE = /(?<=[.!?])\s+/g;

/**
 * Split text into chunks at sentence boundaries.
 * Each chunk is ≤ maxLen chars. If a single sentence exceeds maxLen,
 * it's split at word boundaries as a fallback.
 *
 * Use this for TTS (each chunk becomes one audio request) and for
 * paginated speech bubble display.
 */
export function chunkBySentence(text: string, maxLen = 200): string[] {
	if (text.length <= maxLen) return [text];

	const sentences = text.split(SENTENCE_END_RE).filter(s => s.length > 0);
	const chunks: string[] = [];
	let current = "";

	for (const sentence of sentences) {
		// Single sentence exceeds limit — split at word boundary
		if (sentence.length > maxLen) {
			if (current) { chunks.push(current.trim()); current = ""; }
			const words = sentence.split(/\s+/);
			let wordChunk = "";
			for (const word of words) {
				if (wordChunk && (wordChunk + " " + word).length > maxLen) {
					chunks.push(wordChunk.trim());
					wordChunk = word;
				} else {
					wordChunk = wordChunk ? wordChunk + " " + word : word;
				}
			}
			if (wordChunk) current = wordChunk;
			continue;
		}

		if (current && (current + " " + sentence).length > maxLen) {
			chunks.push(current.trim());
			current = sentence;
		} else {
			current = current ? current + " " + sentence : sentence;
		}
	}

	if (current.trim()) chunks.push(current.trim());
	return chunks;
}

/**
 * Prepare text for TTS: clean, then chunk at sentence boundaries.
 * Returns an array of clean text chunks ready for sequential TTS synthesis.
 */
export function prepareForTTS(text: string, chunkSize = 200): string[] {
	const cleaned = cleanForDisplay(text);
	return chunkBySentence(cleaned, chunkSize);
}
