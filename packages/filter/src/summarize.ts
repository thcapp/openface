import type { ToolCallInfo } from "./types.js";

/** Summarize tool calls into human-readable status text. */

type SummaryFn = (input: Record<string, unknown>) => string;

const TOOL_SUMMARIES: Record<string, SummaryFn> = {
	// Claude Code tools
	Bash: (input) => `Running: ${truncate(String(input.command ?? ""), 60)}`,
	Read: (input) => `Reading: ${basename(String(input.file_path ?? ""))}`,
	Edit: (input) => `Editing: ${basename(String(input.file_path ?? ""))}`,
	Write: (input) => `Writing: ${basename(String(input.file_path ?? ""))}`,
	Glob: (input) => `Finding: ${String(input.pattern ?? "")}`,
	Grep: (input) => `Searching: ${String(input.pattern ?? "")}`,
	WebFetch: (input) => `Fetching: ${hostname(String(input.url ?? ""))}`,
	WebSearch: (input) => `Searching: ${truncate(String(input.query ?? ""), 50)}`,
	Agent: (input) => `Spawning: ${String(input.agent_name || input.subagent_type || "subagent")}`,

	// OpenAI Responses API built-in tools
	web_search: () => "Searching the web...",
	web_search_call: () => "Searching the web...",
	file_search: () => "Searching files...",
	file_search_call: () => "Searching files...",
	code_interpreter: () => "Running code...",
	code_interpreter_call: () => "Running code...",
	image_generation: () => "Generating image...",
	image_generation_call: () => "Generating image...",
	mcp_call: (input) => `Calling: ${String(input.name ?? "tool")}`,

	// Gemini
	executableCode: () => "Running code...",
};

/** Summarize a single tool call. */
export function summarizeToolCall(call: ToolCallInfo): string {
	const fn = TOOL_SUMMARIES[call.name];
	if (fn) return fn(call.input);
	return `Calling: ${call.name}`;
}

/** Summarize multiple tool calls into a single status string. */
export function summarizeToolCalls(calls: ToolCallInfo[], maxLen = 80): string {
	if (calls.length === 0) return "";
	if (calls.length === 1) return truncate(summarizeToolCall(calls[0]), maxLen);

	const first = summarizeToolCall(calls[0]);
	return truncate(`${first} (+${calls.length - 1} more)`, maxLen);
}

/** Truncate a string to a max length with ellipsis. */
export function truncate(text: string, maxLen: number): string {
	if (text.length <= maxLen) return text;
	return text.slice(0, maxLen - 3) + "...";
}

/** Extract basename from a file path. */
function basename(filePath: string): string {
	const parts = filePath.split("/");
	return parts[parts.length - 1] || filePath;
}

/** Extract hostname from a URL. */
function hostname(url: string): string {
	try {
		return new URL(url).hostname;
	} catch {
		return truncate(url, 40);
	}
}
