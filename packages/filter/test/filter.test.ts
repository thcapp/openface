import { describe, test, expect } from "bun:test";
import {
	createFilter, FilterPipeline,
	extractClaude, extractOpenAI, extractGemini, extractOllama, extractAuto,
	classify, isNoise,
	detectFromText, detectFromTools, blendEmotions, faceStateFromTools,
	summarizeToolCall, summarizeToolCalls,
	stripMarkdown, stripDiscord, processCodeBlocks,
	truncateSentence, truncateWord, truncateUrl, truncatePath,
	cleanForDisplay, cleanForDetail,
	chunkBySentence, prepareForTTS,
} from "../src/index.js";
import type { NormalizedMessage, ToolCallInfo, EmotionSignal } from "../src/index.js";

// ─── Extraction Tests ───────────────────────────────────────────────

describe("extractClaude", () => {
	test("extracts text blocks", () => {
		const msg = extractClaude({
			type: "message",
			role: "assistant",
			content: [{ type: "text", text: "Hello! How can I help?" }],
			stop_reason: "end_turn",
		});
		expect(msg.text).toBe("Hello! How can I help?");
		expect(msg.thinking).toBeNull();
		expect(msg.toolCalls).toHaveLength(0);
		expect(msg.stopReason).toBe("end_turn");
	});

	test("extracts thinking blocks", () => {
		const msg = extractClaude({
			type: "message",
			content: [
				{ type: "thinking", thinking: "Let me analyze..." },
				{ type: "text", text: "The answer is 42." },
			],
			stop_reason: "end_turn",
		});
		expect(msg.thinking).toBe("Let me analyze...");
		expect(msg.text).toBe("The answer is 42.");
	});

	test("extracts tool_use blocks", () => {
		const msg = extractClaude({
			type: "message",
			content: [
				{ type: "tool_use", id: "toolu_01D", name: "get_weather", input: { city: "Paris" } },
			],
			stop_reason: "tool_use",
		});
		expect(msg.toolCalls).toHaveLength(1);
		expect(msg.toolCalls[0].name).toBe("get_weather");
		expect(msg.toolCalls[0].input).toEqual({ city: "Paris" });
		expect(msg.stopReason).toBe("tool_use");
	});

	test("extracts server_tool_use blocks", () => {
		const msg = extractClaude({
			type: "message",
			content: [
				{ type: "server_tool_use", id: "srvtoolu_01", name: "web_search", input: { query: "test" } },
			],
		});
		expect(msg.toolCalls).toHaveLength(1);
		expect(msg.toolCalls[0].name).toBe("web_search");
	});

	test("handles error responses", () => {
		const msg = extractClaude({
			type: "error",
			error: { type: "rate_limit", message: "Too many requests" },
		});
		expect(msg.error).toBe("Too many requests");
	});

	test("skips redacted_thinking and signature blocks", () => {
		const msg = extractClaude({
			type: "message",
			content: [
				{ type: "redacted_thinking", data: "base64stuff" },
				{ type: "text", text: "Hello" },
			],
		});
		expect(msg.text).toBe("Hello");
		expect(msg.thinking).toBeNull();
	});

	test("concatenates multiple text blocks", () => {
		const msg = extractClaude({
			type: "message",
			content: [
				{ type: "text", text: "Part 1. " },
				{ type: "text", text: "Part 2." },
			],
		});
		expect(msg.text).toBe("Part 1. Part 2.");
	});
});

describe("extractOpenAI", () => {
	test("extracts Chat Completions format", () => {
		const msg = extractOpenAI({
			choices: [{
				index: 0,
				message: { role: "assistant", content: "Hello!" },
				finish_reason: "stop",
			}],
		});
		expect(msg.text).toBe("Hello!");
		expect(msg.stopReason).toBe("stop");
	});

	test("extracts tool calls with JSON string arguments", () => {
		const msg = extractOpenAI({
			choices: [{
				message: {
					role: "assistant",
					content: null,
					tool_calls: [{
						id: "call_abc",
						type: "function",
						function: { name: "get_weather", arguments: '{"city":"Paris"}' },
					}],
				},
				finish_reason: "tool_calls",
			}],
		});
		expect(msg.toolCalls).toHaveLength(1);
		expect(msg.toolCalls[0].name).toBe("get_weather");
		expect(msg.toolCalls[0].input).toEqual({ city: "Paris" });
		expect(msg.stopReason).toBe("tool_calls");
	});

	test("handles malformed tool call arguments", () => {
		const msg = extractOpenAI({
			choices: [{
				message: {
					tool_calls: [{
						id: "call_x",
						type: "function",
						function: { name: "test", arguments: "not json" },
					}],
				},
				finish_reason: "tool_calls",
			}],
		});
		expect(msg.toolCalls).toHaveLength(1);
		expect(msg.toolCalls[0].input).toEqual({});
	});

	test("extracts Responses API format", () => {
		const msg = extractOpenAI({
			output: [
				{
					type: "message",
					content: [{ type: "output_text", text: "Hello from Responses API!" }],
				},
			],
			status: "completed",
		});
		expect(msg.text).toBe("Hello from Responses API!");
	});

	test("extracts Responses API function calls", () => {
		const msg = extractOpenAI({
			output: [
				{ type: "function_call", name: "get_weather", arguments: '{"city":"London"}', call_id: "fc_1" },
			],
		});
		expect(msg.toolCalls).toHaveLength(1);
		expect(msg.toolCalls[0].name).toBe("get_weather");
		expect(msg.toolCalls[0].input).toEqual({ city: "London" });
	});

	test("extracts Responses API built-in tools", () => {
		const msg = extractOpenAI({
			output: [
				{ type: "web_search_call", id: "ws_1" },
				{ type: "code_interpreter_call", id: "ci_1" },
			],
		});
		expect(msg.toolCalls).toHaveLength(2);
		expect(msg.toolCalls[0].name).toBe("web_search_call");
		expect(msg.toolCalls[1].name).toBe("code_interpreter_call");
	});
});

describe("extractGemini", () => {
	test("extracts text parts", () => {
		const msg = extractGemini({
			candidates: [{
				content: { parts: [{ text: "Hello from Gemini!" }], role: "model" },
				finishReason: "STOP",
			}],
		});
		expect(msg.text).toBe("Hello from Gemini!");
		expect(msg.stopReason).toBe("STOP");
	});

	test("extracts thinking parts", () => {
		const msg = extractGemini({
			candidates: [{
				content: {
					parts: [
						{ thought: true, text: "Let me think..." },
						{ text: "The answer is 42." },
					],
				},
				finishReason: "STOP",
			}],
		});
		expect(msg.thinking).toBe("Let me think...");
		expect(msg.text).toBe("The answer is 42.");
	});

	test("extracts functionCall parts", () => {
		const msg = extractGemini({
			candidates: [{
				content: {
					parts: [
						{ functionCall: { name: "get_weather", args: { city: "Tokyo" } } },
					],
				},
			}],
		});
		expect(msg.toolCalls).toHaveLength(1);
		expect(msg.toolCalls[0].name).toBe("get_weather");
		expect(msg.toolCalls[0].input).toEqual({ city: "Tokyo" });
	});

	test("extracts executableCode parts", () => {
		const msg = extractGemini({
			candidates: [{
				content: {
					parts: [
						{ executableCode: { code: "print('hi')", language: "PYTHON" } },
					],
				},
			}],
		});
		expect(msg.toolCalls).toHaveLength(1);
		expect(msg.toolCalls[0].name).toBe("executableCode");
	});

	test("detects safety-blocked content", () => {
		const msg = extractGemini({
			candidates: [{
				content: { parts: [{ text: "Some text" }] },
				safetyRatings: [{ category: "HARM", probability: "HIGH", blocked: true }],
			}],
		});
		expect(msg.error).toBe("Content blocked by safety filter");
	});
});

describe("extractOllama", () => {
	test("extracts chat API format", () => {
		const msg = extractOllama({
			message: { role: "assistant", content: "Hello from Ollama!" },
			done: true,
			done_reason: "stop",
		});
		expect(msg.text).toBe("Hello from Ollama!");
		expect(msg.stopReason).toBe("stop");
	});

	test("extracts generate API format", () => {
		const msg = extractOllama({
			response: "Generated text here",
			done: true,
			done_reason: "stop",
		});
		expect(msg.text).toBe("Generated text here");
	});

	test("extracts tool calls", () => {
		const msg = extractOllama({
			message: {
				role: "assistant",
				content: "",
				tool_calls: [{
					type: "function",
					function: { name: "calculate", arguments: { x: 1, y: 2 } },
				}],
			},
			done: false,
		});
		expect(msg.toolCalls).toHaveLength(1);
		expect(msg.toolCalls[0].name).toBe("calculate");
		expect(msg.toolCalls[0].input).toEqual({ x: 1, y: 2 });
	});

	test("handles error string", () => {
		const msg = extractOllama({ error: "model not found" });
		expect(msg.error).toBe("model not found");
	});

	test("infers stop from done:true without done_reason", () => {
		const msg = extractOllama({ response: "done", done: true });
		expect(msg.stopReason).toBe("stop");
	});
});

describe("extractAuto", () => {
	test("detects Claude format", () => {
		const msg = extractAuto({
			type: "message",
			content: [{ type: "text", text: "Claude here" }],
		});
		expect(msg.text).toBe("Claude here");
	});

	test("detects OpenAI Chat Completions", () => {
		const msg = extractAuto({
			choices: [{ message: { content: "OpenAI here" }, finish_reason: "stop" }],
		});
		expect(msg.text).toBe("OpenAI here");
	});

	test("detects Gemini format", () => {
		const msg = extractAuto({
			candidates: [{ content: { parts: [{ text: "Gemini here" }] } }],
		});
		expect(msg.text).toBe("Gemini here");
	});

	test("detects Ollama format", () => {
		const msg = extractAuto({ response: "Ollama here", done: true });
		expect(msg.text).toBe("Ollama here");
	});

	test("fallback extracts text from content string", () => {
		const msg = extractAuto({ content: "Plain text" });
		expect(msg.text).toBe("Plain text");
	});
});

// ─── Classification Tests ────────────────────────────────────────────

describe("classify", () => {
	test("classifies error messages", () => {
		const result = classify({
			text: null, thinking: null, toolCalls: [], stopReason: null,
			error: "Authentication failed", raw: {},
		});
		expect(result.category).toBe("error");
		expect(result.faceState).toBe("alert");
	});

	test("classifies rate limit error as waiting", () => {
		const result = classify({
			text: null, thinking: null, toolCalls: [], stopReason: null,
			error: "Rate limit exceeded", raw: {},
		});
		expect(result.category).toBe("error");
		expect(result.faceState).toBe("waiting");
	});

	test("classifies tool-only messages as summarizable", () => {
		const result = classify({
			text: null, thinking: null,
			toolCalls: [{ name: "Read", input: { file_path: "/test.ts" } }],
			stopReason: "tool_use", error: null, raw: {},
		});
		expect(result.category).toBe("summarizable");
		expect(result.faceState).toBe("working");
	});

	test("classifies text responses as display", () => {
		const result = classify({
			text: "Here is your answer.", thinking: null, toolCalls: [],
			stopReason: "end_turn", error: null, raw: {},
		});
		expect(result.category).toBe("display");
		expect(result.faceState).toBe("speaking");
		expect(result.displayText).toBe("Here is your answer.");
	});

	test("classifies thinking-only as status", () => {
		const result = classify({
			text: null, thinking: "Let me think about this...", toolCalls: [],
			stopReason: null, error: null, raw: {},
		});
		expect(result.category).toBe("status");
		expect(result.faceState).toBe("thinking");
	});

	test("classifies empty messages as internal", () => {
		const result = classify({
			text: null, thinking: null, toolCalls: [],
			stopReason: "end_turn", error: null, raw: {},
		});
		expect(result.category).toBe("internal");
	});

	test("classifies pure JSON as internal", () => {
		const result = classify({
			text: '{"tokens": 500, "model": "gpt-4"}', thinking: null, toolCalls: [],
			stopReason: null, error: null, raw: {},
		});
		expect(result.category).toBe("internal");
	});
});

describe("isNoise", () => {
	test("detects token counts", () => {
		expect(isNoise("Used 500 tokens")).toBe(true);
	});

	test("detects internal IDs", () => {
		expect(isNoise("msg_01XFDUDYJgAACzvnptvVoYEL")).toBe(true);
		expect(isNoise("chatcmpl-abc123")).toBe(true);
	});

	test("detects base64 blobs", () => {
		expect(isNoise("EqQBCkYKMGF1dGhvcml6YXRpb24gY29kZSBmb3IgdGhlIG1vZGVs")).toBe(true);
	});

	test("detects health check output", () => {
		expect(isNoise("Health check passed")).toBe(true);
	});

	test("detects empty/whitespace", () => {
		expect(isNoise("")).toBe(true);
		expect(isNoise("   ")).toBe(true);
	});

	test("passes through normal text", () => {
		expect(isNoise("Hello! How can I help you today?")).toBe(false);
	});
});

// ─── Emotion Detection Tests ─────────────────────────────────────────

describe("detectFromText", () => {
	test("detects frustrated from error words", () => {
		const signals = detectFromText("Error: Build failed with 3 errors");
		const frustrated = signals.find(s => s.emotion === "frustrated");
		expect(frustrated).toBeDefined();
		expect(frustrated!.intensity).toBeGreaterThan(0);
	});

	test("detects happy from success words", () => {
		const signals = detectFromText("All tests passed successfully!");
		const happy = signals.find(s => s.emotion === "happy");
		expect(happy).toBeDefined();
	});

	test("detects concerned from warnings", () => {
		const signals = detectFromText("Warning: deprecated API in use");
		const concerned = signals.find(s => s.emotion === "concerned");
		expect(concerned).toBeDefined();
	});

	test("detects confused from uncertainty", () => {
		const signals = detectFromText("I'm not sure what this function does?");
		const confused = signals.find(s => s.emotion === "confused");
		expect(confused).toBeDefined();
	});

	test("detects determined from working verbs", () => {
		const signals = detectFromText("Searching for matching files...");
		const determined = signals.find(s => s.emotion === "determined");
		expect(determined).toBeDefined();
	});

	test("detects excited from emphasis", () => {
		const signals = detectFromText("New release shipped!!");
		const excited = signals.find(s => s.emotion === "excited");
		expect(excited).toBeDefined();
	});

	test("detects proud from improvement words", () => {
		const signals = detectFromText("Refactored and optimized the pipeline");
		const proud = signals.find(s => s.emotion === "proud");
		expect(proud).toBeDefined();
	});

	test("detects skeptical from hedge words", () => {
		const signals = detectFromText("However, this approach is questionable");
		const skeptical = signals.find(s => s.emotion === "skeptical");
		expect(skeptical).toBeDefined();
	});

	test("returns empty for neutral text", () => {
		const signals = detectFromText("The value is 42");
		expect(signals).toHaveLength(0);
	});

	test("detects multiple emotions without duplicates", () => {
		const signals = detectFromText("Error failed but found a fix, works now");
		const emotions = signals.map(s => s.emotion);
		const unique = [...new Set(emotions)];
		expect(emotions.length).toBe(unique.length);
	});
});

describe("detectFromTools", () => {
	test("infers determined from Bash tool", () => {
		const signal = detectFromTools([{ name: "Bash", input: { command: "npm test" } }]);
		expect(signal).toBeDefined();
		expect(signal!.emotion).toBe("determined");
	});

	test("infers neutral from Read tool", () => {
		const signal = detectFromTools([{ name: "Read", input: { file_path: "/test.ts" } }]);
		expect(signal).toBeDefined();
		expect(signal!.emotion).toBe("neutral");
	});

	test("infers confused from WebSearch", () => {
		const signal = detectFromTools([{ name: "WebSearch", input: { query: "how to" } }]);
		expect(signal).toBeDefined();
		expect(signal!.emotion).toBe("confused");
	});

	test("returns default for unknown tools", () => {
		const signal = detectFromTools([{ name: "CustomTool", input: {} }]);
		expect(signal).toBeDefined();
		expect(signal!.emotion).toBe("determined");
		expect(signal!.confidence).toBe(0.5);
	});

	test("returns null for empty tool list", () => {
		expect(detectFromTools([])).toBeNull();
	});
});

describe("faceStateFromTools", () => {
	test("returns working for Bash", () => {
		expect(faceStateFromTools([{ name: "Bash", input: {} }])).toBe("working");
	});

	test("returns thinking for Read", () => {
		expect(faceStateFromTools([{ name: "Read", input: {} }])).toBe("thinking");
	});

	test("returns working for unknown tools", () => {
		expect(faceStateFromTools([{ name: "Unknown", input: {} }])).toBe("working");
	});

	test("returns null for empty list", () => {
		expect(faceStateFromTools([])).toBeNull();
	});
});

describe("blendEmotions", () => {
	test("returns neutral for empty signals", () => {
		const result = blendEmotions([]);
		expect(result.emotion).toBe("neutral");
		expect(result.intensity).toBe(0);
	});

	test("returns single emotion unblended", () => {
		const result = blendEmotions([
			{ emotion: "happy", intensity: 0.6, source: "pattern", confidence: 0.8 },
		]);
		expect(result.emotion).toBe("happy");
		expect(result.intensity).toBe(0.6);
		expect(result.emotionSecondary).toBeUndefined();
	});

	test("blends two different emotions", () => {
		const result = blendEmotions([
			{ emotion: "happy", intensity: 0.6, source: "pattern", confidence: 0.8 },
			{ emotion: "excited", intensity: 0.4, source: "pattern", confidence: 0.7 },
		]);
		expect(result.emotion).toBe("happy");
		expect(result.emotionSecondary).toBe("excited");
		expect(result.emotionBlend).toBeGreaterThan(0);
		expect(result.emotionBlend!).toBeLessThan(1);
	});

	test("does not set secondary if both signals have same emotion", () => {
		const result = blendEmotions([
			{ emotion: "happy", intensity: 0.8, source: "pattern", confidence: 0.9 },
			{ emotion: "happy", intensity: 0.4, source: "state", confidence: 0.7 },
		]);
		expect(result.emotionSecondary).toBeUndefined();
	});
});

// ─── Summarization Tests ─────────────────────────────────────────────

describe("summarizeToolCall", () => {
	test("summarizes Bash commands", () => {
		expect(summarizeToolCall({ name: "Bash", input: { command: "npm test" } }))
			.toBe("Running: npm test");
	});

	test("summarizes Read tool", () => {
		expect(summarizeToolCall({ name: "Read", input: { file_path: "/src/utils/helper.ts" } }))
			.toBe("Reading: helper.ts");
	});

	test("summarizes Edit tool", () => {
		expect(summarizeToolCall({ name: "Edit", input: { file_path: "/src/main.ts" } }))
			.toBe("Editing: main.ts");
	});

	test("summarizes Write tool", () => {
		expect(summarizeToolCall({ name: "Write", input: { file_path: "/new-file.ts" } }))
			.toBe("Writing: new-file.ts");
	});

	test("summarizes Glob tool", () => {
		expect(summarizeToolCall({ name: "Glob", input: { pattern: "**/*.ts" } }))
			.toBe("Finding: **/*.ts");
	});

	test("summarizes Grep tool", () => {
		expect(summarizeToolCall({ name: "Grep", input: { pattern: "handleAuth" } }))
			.toBe("Searching: handleAuth");
	});

	test("summarizes WebSearch", () => {
		expect(summarizeToolCall({ name: "WebSearch", input: { query: "React hooks best practices" } }))
			.toBe("Searching: React hooks best practices");
	});

	test("summarizes WebFetch with hostname", () => {
		expect(summarizeToolCall({ name: "WebFetch", input: { url: "https://docs.example.com/api" } }))
			.toBe("Fetching: docs.example.com");
	});

	test("summarizes Agent tool", () => {
		expect(summarizeToolCall({ name: "Agent", input: { subagent_type: "code-reviewer" } }))
			.toBe("Spawning: code-reviewer");
	});

	test("summarizes OpenAI built-in tools", () => {
		expect(summarizeToolCall({ name: "web_search", input: {} }))
			.toBe("Searching the web...");
		expect(summarizeToolCall({ name: "code_interpreter", input: {} }))
			.toBe("Running code...");
	});

	test("summarizes unknown tools generically", () => {
		expect(summarizeToolCall({ name: "custom_tool", input: {} }))
			.toBe("Calling: custom_tool");
	});

	test("truncates long bash commands", () => {
		const long = "a".repeat(100);
		const result = summarizeToolCall({ name: "Bash", input: { command: long } });
		expect(result.length).toBeLessThanOrEqual(69); // "Running: " (9) + 60
	});
});

describe("summarizeToolCalls", () => {
	test("summarizes single tool call", () => {
		const result = summarizeToolCalls([{ name: "Read", input: { file_path: "/test.ts" } }]);
		expect(result).toBe("Reading: test.ts");
	});

	test("summarizes multiple tool calls", () => {
		const result = summarizeToolCalls([
			{ name: "Read", input: { file_path: "/a.ts" } },
			{ name: "Read", input: { file_path: "/b.ts" } },
		]);
		expect(result).toContain("Reading: a.ts");
		expect(result).toContain("+1 more");
	});

	test("returns empty for no calls", () => {
		expect(summarizeToolCalls([])).toBe("");
	});
});

// ─── Text Cleaning Tests ─────────────────────────────────────────────

describe("stripMarkdown", () => {
	test("strips headers", () => {
		expect(stripMarkdown("## Hello World")).toBe("Hello World");
	});

	test("strips bold and italic", () => {
		expect(stripMarkdown("This is **bold** and *italic*")).toBe("This is bold and italic");
	});

	test("strips links, keeps text", () => {
		expect(stripMarkdown("Click [here](https://example.com)")).toBe("Click here");
	});

	test("strips code blocks", () => {
		expect(stripMarkdown("Before\n```js\ncode\n```\nAfter")).toBe("Before After");
	});

	test("strips inline code, keeps content", () => {
		expect(stripMarkdown("Use `npm install`")).toBe("Use npm install");
	});

	test("strips list markers", () => {
		expect(stripMarkdown("- Item one\n- Item two")).toBe("Item one Item two");
	});

	test("strips blockquotes", () => {
		expect(stripMarkdown("> A quote")).toBe("A quote");
	});

	test("strips images", () => {
		expect(stripMarkdown("![alt](image.png)")).toBe("");
	});

	test("collapses whitespace", () => {
		expect(stripMarkdown("Hello\n\n\nWorld")).toBe("Hello World");
	});
});

describe("stripDiscord", () => {
	test("strips user mentions", () => {
		expect(stripDiscord("Hey <@123456789012345678> check this")).toBe("Hey check this");
	});

	test("strips channel mentions", () => {
		expect(stripDiscord("Posted in <#123456789012345678>")).toBe("Posted in");
	});

	test("strips role mentions", () => {
		expect(stripDiscord("Ping <@&123456789012345678>")).toBe("Ping");
	});

	test("strips custom emoji", () => {
		expect(stripDiscord("Nice <:thumbsup:123456789012345678>")).toBe("Nice");
	});
});

describe("processCodeBlocks", () => {
	test("detects code blocks", () => {
		const result = processCodeBlocks("Here:\n```js\nconst x = 1;\n```");
		expect(result.hasCode).toBe(true);
		expect(result.codeLanguage).toBe("js");
		expect(result.speech).toContain("[code]");
		expect(result.speech).not.toContain("```");
	});

	test("handles no code blocks", () => {
		const result = processCodeBlocks("Just plain text");
		expect(result.hasCode).toBe(false);
		expect(result.codeLanguage).toBeNull();
		expect(result.speech).toBe("Just plain text");
	});
});

describe("truncateSentence", () => {
	test("returns short text unchanged", () => {
		expect(truncateSentence("Hello.", 200)).toBe("Hello.");
	});

	test("truncates at sentence boundary", () => {
		const text = "First sentence. Second sentence. Third sentence is very long and keeps going.";
		const result = truncateSentence(text, 40);
		expect(result).toBe("First sentence. Second sentence.");
	});

	test("falls back to word boundary", () => {
		const text = "One very long sentence without any period breaks that goes on and on";
		const result = truncateSentence(text, 30);
		expect(result.endsWith("...")).toBe(true);
		expect(result.length).toBeLessThanOrEqual(30);
	});
});

describe("truncateWord", () => {
	test("returns short text unchanged", () => {
		expect(truncateWord("Hello", 200)).toBe("Hello");
	});

	test("truncates at word boundary", () => {
		const result = truncateWord("The quick brown fox jumped over the lazy dog", 20);
		expect(result.endsWith("...")).toBe(true);
		expect(result.length).toBeLessThanOrEqual(20);
	});
});

describe("truncateUrl", () => {
	test("extracts hostname + last path segment", () => {
		expect(truncateUrl("https://docs.example.com/api/reference")).toBe("docs.example.com/reference");
	});

	test("handles URL with no path", () => {
		expect(truncateUrl("https://example.com")).toBe("example.com");
	});

	test("handles invalid URLs", () => {
		expect(truncateUrl("not-a-url")).toBe("not-a-url");
	});
});

describe("truncatePath", () => {
	test("returns short paths unchanged", () => {
		expect(truncatePath("/src/index.ts")).toBe("/src/index.ts");
	});

	test("truncates long paths", () => {
		const result = truncatePath("/very/long/deeply/nested/path/to/some/file.ts", 30);
		expect(result).toContain("file.ts");
		expect(result.startsWith(".../")).toBe(true);
	});
});

describe("cleanForDisplay", () => {
	test("strips markdown", () => {
		const result = cleanForDisplay("## Hello **World**!");
		expect(result).toBe("Hello World!");
	});

	test("strips discord and markdown together", () => {
		const result = cleanForDisplay("Hey <@123456789012345678> **check** this");
		expect(result).toBe("Hey check this");
	});

	test("preserves full text without truncation", () => {
		const longText = "This is a long sentence. ".repeat(20);
		const result = cleanForDisplay(longText);
		expect(result.length).toBeGreaterThan(200);
	});
});

describe("chunkBySentence", () => {
	test("returns single chunk for short text", () => {
		expect(chunkBySentence("Hello world.", 200)).toEqual(["Hello world."]);
	});

	test("splits at sentence boundaries", () => {
		const text = "First sentence. Second sentence. Third sentence is longer and adds more words.";
		const chunks = chunkBySentence(text, 40);
		expect(chunks.length).toBeGreaterThan(1);
		for (const chunk of chunks) {
			expect(chunk.length).toBeLessThanOrEqual(40);
		}
	});

	test("handles text with no sentence boundaries", () => {
		const text = "word ".repeat(100);
		const chunks = chunkBySentence(text, 50);
		expect(chunks.length).toBeGreaterThan(1);
		for (const chunk of chunks) {
			expect(chunk.length).toBeLessThanOrEqual(50);
		}
	});

	test("never drops content", () => {
		const text = "First sentence. Second sentence. Third sentence.";
		const chunks = chunkBySentence(text, 25);
		const rejoined = chunks.join(" ");
		expect(rejoined).toContain("First");
		expect(rejoined).toContain("Third");
	});
});

describe("prepareForTTS", () => {
	test("cleans markdown and chunks", () => {
		const text = "## Hello **World**! This is a test. Another sentence here.";
		const chunks = prepareForTTS(text, 30);
		expect(chunks.length).toBeGreaterThan(0);
		expect(chunks[0]).not.toContain("##");
		expect(chunks[0]).not.toContain("**");
	});
});

// ─── Full Pipeline Tests ─────────────────────────────────────────────

describe("FilterPipeline", () => {
	test("processes Claude text response", () => {
		const filter = createFilter({ provider: "claude" });
		const result = filter.process({
			type: "message",
			content: [{ type: "text", text: "Hello! All tests passed successfully." }],
			stop_reason: "end_turn",
		});

		expect(result.category).toBe("display");
		expect(result.displayText).toContain("tests passed");
		expect(result.stateUpdate.state).toBe("speaking");
		expect(result.stateUpdate.emotion).toBe("happy");
	});

	test("processes Claude tool call", () => {
		const filter = createFilter({ provider: "claude" });
		const result = filter.process({
			type: "message",
			content: [
				{ type: "tool_use", id: "toolu_01", name: "Read", input: { file_path: "/src/index.ts" } },
			],
			stop_reason: "tool_use",
		});

		expect(result.category).toBe("summarizable");
		expect(result.stateUpdate.state).toBe("thinking");
		expect(result.displayText).toContain("Reading: index.ts");
	});

	test("processes OpenAI response", () => {
		const filter = createFilter({ provider: "openai" });
		const result = filter.process({
			choices: [{
				message: { role: "assistant", content: "Here is the answer." },
				finish_reason: "stop",
			}],
		});

		expect(result.category).toBe("display");
		expect(result.stateUpdate.state).toBe("speaking");
	});

	test("processes Gemini response", () => {
		const filter = createFilter({ provider: "gemini" });
		const result = filter.process({
			candidates: [{
				content: { parts: [{ text: "Hello from Gemini!" }] },
				finishReason: "STOP",
			}],
		});

		expect(result.category).toBe("display");
		expect(result.stateUpdate.state).toBe("speaking");
	});

	test("processes Ollama response", () => {
		const filter = createFilter({ provider: "ollama" });
		const result = filter.process({
			message: { role: "assistant", content: "Hello from Ollama!" },
			done: true,
			done_reason: "stop",
		});

		expect(result.category).toBe("display");
		expect(result.stateUpdate.state).toBe("speaking");
	});

	test("processes error response", () => {
		const filter = createFilter({ provider: "claude" });
		const result = filter.process({
			type: "error",
			error: { type: "rate_limit", message: "Rate limit exceeded" },
		});

		expect(result.category).toBe("error");
		expect(result.stateUpdate.state).toBe("waiting");
	});

	test("filters noise messages", () => {
		const filter = createFilter({ provider: "claude" });
		const result = filter.process({
			type: "message",
			content: [{ type: "text", text: "msg_01XFDUDYJgAACzvnptvVoYEL" }],
		});

		expect(result.category).toBe("internal");
		expect(result.displayText).toBeNull();
	});

	test("includes thinking when showThinking is true", () => {
		const filter = createFilter({ provider: "claude", showThinking: true });
		const result = filter.process({
			type: "message",
			content: [{ type: "thinking", thinking: "Let me analyze this carefully." }],
		});

		expect(result.category).toBe("status");
		expect(result.displayText).toContain("analyze");
	});

	test("emotion blending with text + tools", () => {
		const filter = createFilter({ provider: "claude" });
		const result = filter.process({
			type: "message",
			content: [
				{ type: "text", text: "Great, found the fix!" },
				{ type: "tool_use", id: "t1", name: "Edit", input: { file_path: "/fix.ts" } },
			],
			stop_reason: "tool_use",
		});

		expect(result.stateUpdate.emotion).toBeDefined();
		expect(result.stateUpdate.intensity).toBeGreaterThan(0);
	});

	test("preserves full text without truncation", () => {
		const longText = "This is sentence one. This is sentence two. ".repeat(10);
		const filter = createFilter({ provider: "claude" });
		const result = filter.process({
			type: "message",
			content: [{ type: "text", text: longText }],
		});

		expect(result.stateUpdate.text).toBeDefined();
		expect(result.stateUpdate.detail).toBeDefined();
		// Full content preserved in detail
		expect(result.stateUpdate.detail!.length).toBeGreaterThan(200);
	});

	test("setConfig switches provider", () => {
		const filter = createFilter({ provider: "claude" });
		filter.setConfig({ provider: "openai" });

		const result = filter.process({
			choices: [{
				message: { content: "Now using OpenAI" },
				finish_reason: "stop",
			}],
		});

		expect(result.category).toBe("display");
		expect(result.displayText).toContain("OpenAI");
	});

	test("handles completely empty input", () => {
		const filter = createFilter({ provider: "claude" });
		const result = filter.process({});
		expect(result.category).toBe("internal");
	});
});

describe("createFilter", () => {
	test("creates a FilterPipeline with defaults", () => {
		const filter = createFilter();
		expect(filter).toBeInstanceOf(FilterPipeline);
	});

	test("creates a FilterPipeline with custom config", () => {
		const filter = createFilter({
			provider: "openai",
			showThinking: true,
			maxBubbleLength: 100,
		});
		expect(filter).toBeInstanceOf(FilterPipeline);
	});
});
