import type { NormalizedMessage, ToolCallInfo } from "./types.js";

/** Extract normalized message from a Claude (Anthropic Messages API) response. */
export function extractClaude(raw: unknown): NormalizedMessage {
	const msg = raw as Record<string, unknown>;
	const content = Array.isArray(msg.content) ? msg.content : [];

	let text: string | null = null;
	let thinking: string | null = null;
	const toolCalls: ToolCallInfo[] = [];
	let error: string | null = null;

	for (const block of content) {
		if (!block || typeof block !== "object") continue;
		const b = block as Record<string, unknown>;

		switch (b.type) {
			case "text":
				text = concatText(text, b.text as string);
				break;
			case "thinking":
				thinking = concatText(thinking, b.thinking as string);
				break;
			case "tool_use":
				toolCalls.push({
					name: b.name as string,
					input: (b.input as Record<string, unknown>) ?? {},
					id: b.id as string | undefined,
				});
				break;
			case "server_tool_use":
				toolCalls.push({
					name: b.name as string,
					input: (b.input as Record<string, unknown>) ?? {},
					id: b.id as string | undefined,
				});
				break;
			// redacted_thinking, web_search_tool_result, signature — skip
		}
	}

	// Check for error in the top-level response
	if (msg.type === "error") {
		const errObj = msg.error as Record<string, unknown> | undefined;
		error = errObj?.message as string ?? "Unknown error";
	}

	const stopReason = (msg.stop_reason as string) ?? null;

	return { text, thinking, toolCalls, stopReason, error, raw };
}

/** Extract normalized message from an OpenAI Chat Completions response. */
export function extractOpenAI(raw: unknown): NormalizedMessage {
	const msg = raw as Record<string, unknown>;

	// Support both Chat Completions and Responses API
	const choices = msg.choices as Array<Record<string, unknown>> | undefined;
	const output = msg.output as Array<Record<string, unknown>> | undefined;

	let text: string | null = null;
	let thinking: string | null = null;
	const toolCalls: ToolCallInfo[] = [];
	let error: string | null = null;
	let stopReason: string | null = null;

	if (choices?.length) {
		// Chat Completions format
		const choice = choices[0];
		const message = choice.message as Record<string, unknown> | undefined;

		if (message) {
			text = (message.content as string) ?? null;

			const calls = message.tool_calls as Array<Record<string, unknown>> | undefined;
			if (calls) {
				for (const call of calls) {
					const fn = call.function as Record<string, unknown>;
					let args: Record<string, unknown> = {};
					try {
						args = JSON.parse(fn.arguments as string);
					} catch { /* malformed args */ }
					toolCalls.push({
						name: fn.name as string,
						input: args,
						id: call.id as string | undefined,
					});
				}
			}
		}

		stopReason = (choice.finish_reason as string) ?? null;
	} else if (output?.length) {
		// Responses API format
		for (const item of output) {
			switch (item.type) {
				case "message": {
					const parts = item.content as Array<Record<string, unknown>> | undefined;
					if (parts) {
						for (const p of parts) {
							if (p.type === "output_text") {
								text = concatText(text, p.text as string);
							}
						}
					}
					break;
				}
				case "function_call":
					toolCalls.push({
						name: item.name as string,
						input: parseArgs(item.arguments),
						id: item.call_id as string | undefined,
					});
					break;
				case "reasoning":
					thinking = concatText(thinking, (item as Record<string, unknown>).summary as string);
					break;
				case "web_search_call":
				case "file_search_call":
				case "code_interpreter_call":
				case "image_generation_call":
				case "mcp_call":
					toolCalls.push({
						name: item.type as string,
						input: {},
						id: item.id as string | undefined,
					});
					break;
			}
		}
		stopReason = (msg.status as string) ?? null;
	}

	if (msg.error) {
		const errObj = msg.error as Record<string, unknown>;
		error = (errObj.message as string) ?? "Unknown error";
	}

	return { text, thinking, toolCalls, stopReason, error, raw };
}

/** Extract normalized message from a Google Gemini GenerateContent response. */
export function extractGemini(raw: unknown): NormalizedMessage {
	const msg = raw as Record<string, unknown>;
	const candidates = msg.candidates as Array<Record<string, unknown>> | undefined;

	let text: string | null = null;
	let thinking: string | null = null;
	const toolCalls: ToolCallInfo[] = [];
	let error: string | null = null;
	let stopReason: string | null = null;

	if (candidates?.length) {
		const candidate = candidates[0];
		const content = candidate.content as Record<string, unknown> | undefined;
		const parts = content?.parts as Array<Record<string, unknown>> | undefined;

		if (parts) {
			for (const part of parts) {
				if (part.thought && part.text) {
					thinking = concatText(thinking, part.text as string);
				} else if (part.text) {
					text = concatText(text, part.text as string);
				} else if (part.functionCall) {
					const fc = part.functionCall as Record<string, unknown>;
					toolCalls.push({
						name: fc.name as string,
						input: (fc.args as Record<string, unknown>) ?? {},
						id: fc.id as string | undefined,
					});
				} else if (part.executableCode) {
					toolCalls.push({
						name: "executableCode",
						input: part.executableCode as Record<string, unknown>,
					});
				}
			}
		}

		stopReason = (candidate.finishReason as string) ?? null;

		// Check blocked by safety
		const ratings = candidate.safetyRatings as Array<Record<string, unknown>> | undefined;
		if (ratings?.some(r => r.blocked)) {
			error = "Content blocked by safety filter";
		}
	}

	if (msg.error) {
		const errObj = msg.error as Record<string, unknown>;
		error = (errObj.message as string) ?? "Unknown error";
	}

	return { text, thinking, toolCalls, stopReason, error, raw };
}

/** Extract normalized message from an Ollama generate/chat response. */
export function extractOllama(raw: unknown): NormalizedMessage {
	const msg = raw as Record<string, unknown>;

	let text: string | null = null;
	const toolCalls: ToolCallInfo[] = [];
	let error: string | null = null;

	// Chat API format
	const message = msg.message as Record<string, unknown> | undefined;
	if (message) {
		text = (message.content as string) ?? null;

		const calls = message.tool_calls as Array<Record<string, unknown>> | undefined;
		if (calls) {
			for (const call of calls) {
				const fn = (call.function as Record<string, unknown>) ?? call;
				toolCalls.push({
					name: fn.name as string,
					input: (fn.arguments as Record<string, unknown>) ?? {},
				});
			}
		}
	} else if (typeof msg.response === "string") {
		// Generate API format
		text = msg.response;
	}

	if (msg.error) {
		error = typeof msg.error === "string" ? msg.error : "Unknown error";
	}

	const stopReason = (msg.done_reason as string) ?? (msg.done === true ? "stop" : null);

	return { text, thinking: null, toolCalls, stopReason, error, raw };
}

/** Auto-detect provider and extract. */
export function extractAuto(raw: unknown): NormalizedMessage {
	const msg = raw as Record<string, unknown>;

	// Claude: has content array with typed blocks, or type: "message"
	if (msg.type === "message" || (Array.isArray(msg.content) && msg.content[0]?.type)) {
		return extractClaude(raw);
	}

	// OpenAI Chat Completions: has choices array
	if (Array.isArray(msg.choices)) {
		return extractOpenAI(raw);
	}

	// OpenAI Responses API: has output array
	if (Array.isArray(msg.output)) {
		return extractOpenAI(raw);
	}

	// Gemini: has candidates array
	if (Array.isArray(msg.candidates)) {
		return extractGemini(raw);
	}

	// Ollama: has response string or message.content with done field
	if (typeof msg.response === "string" || (msg.message && "done" in msg)) {
		return extractOllama(raw);
	}

	// Fallback: try to pull out any text
	return {
		text: typeof msg.content === "string" ? msg.content : typeof msg.text === "string" ? msg.text : null,
		thinking: null,
		toolCalls: [],
		stopReason: null,
		error: null,
		raw,
	};
}

// --- Helpers ---

function concatText(existing: string | null, addition: string): string {
	if (!existing) return addition;
	return existing + addition;
}

function parseArgs(args: unknown): Record<string, unknown> {
	if (typeof args === "string") {
		try { return JSON.parse(args); } catch { return {}; }
	}
	if (args && typeof args === "object") return args as Record<string, unknown>;
	return {};
}
