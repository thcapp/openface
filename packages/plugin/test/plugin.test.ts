import { describe, test, expect, beforeEach, mock } from "bun:test";

// ── Mock @openface/filter before plugin import ──
mock.module("@openface/filter", () => ({
	cleanForDisplay: (text: string) => text.trim(),
	detectFromText: () => [{ emotion: "neutral", intensity: 0.5, source: "pattern" }],
	blendEmotions: (signals: any[]) => ({
		emotion: signals[0]?.emotion || "neutral",
		intensity: signals[0]?.intensity || 1,
	}),
	summarizeToolCall: (call: any) => `Using ${call.name}`,
}));

// ── Helpers: mock fetch + mock API ──

let fetchCalls: { url: string; method: string; body: any; headers: any }[] = [];

function mockFetch() {
	fetchCalls = [];
	const fn = mock(async (url: string | URL | Request, init?: RequestInit) => {
		const u = typeof url === "string" ? url : url instanceof URL ? url.toString() : url.url;
		fetchCalls.push({
			url: u,
			method: init?.method || "GET",
			body: init?.body ? JSON.parse(init.body as string) : undefined,
			headers: init?.headers || {},
		});
		return new Response(JSON.stringify({ ok: true }), { status: 200 });
	});
	globalThis.fetch = fn as typeof globalThis.fetch;
	return fn;
}

function createMockApi(config: Record<string, unknown> = {}) {
	const handlers: Record<string, Function[]> = {};
	return {
		config: { plugins: { entries: { openface: { config } } } },
		on(event: string, handler: Function) {
			if (!handlers[event]) handlers[event] = [];
			handlers[event].push(handler);
		},
		async emit(event: string, data?: unknown) {
			for (const h of handlers[event] || []) await h(data);
		},
	};
}

// Import plugin after mocks are set up
const { default: plugin } = await import("../src/index.js");

describe("plugin registration", () => {
	beforeEach(() => {
		mockFetch();
	});

	test("exports plugin with id, name, description", () => {
		expect(plugin.id).toBe("openface");
		expect(plugin.name).toBe("Open Face");
		expect(typeof plugin.description).toBe("string");
		expect(typeof plugin.register).toBe("function");
	});

	test("pushes idle state on register", async () => {
		const api = createMockApi();
		plugin.register(api);
		await Bun.sleep(10);
		const initCall = fetchCalls.find(c => c.body?.state === "idle");
		expect(initCall).toBeTruthy();
		expect(initCall!.body.emotion).toBe("neutral");
	});

	test("uses custom face_url from config", async () => {
		const api = createMockApi({ face_url: "http://custom:8080" });
		plugin.register(api);
		await Bun.sleep(10);
		const initCall = fetchCalls.find(c => c.url.includes("custom:8080"));
		expect(initCall).toBeTruthy();
	});

	test("includes auth header when api key configured", async () => {
		const api = createMockApi({ face_api_key: "test-key" });
		plugin.register(api);
		await Bun.sleep(10);
		const call = fetchCalls[0];
		expect(call.headers.Authorization).toBe("Bearer test-key");
	});
});

describe("lifecycle events", () => {
	let api: ReturnType<typeof createMockApi>;

	beforeEach(() => {
		mockFetch();
		api = createMockApi();
		plugin.register(api);
		fetchCalls = [];
	});

	test("message_received pushes listening state", async () => {
		await api.emit("message_received", { text: "Hello there" });
		await Bun.sleep(10);
		const call = fetchCalls.find(c => c.body?.state === "listening");
		expect(call).toBeTruthy();
		expect(call!.url).toContain("/api/state");
	});

	test("message_received extracts text from content array", async () => {
		await api.emit("message_received", {
			content: [{ type: "text", text: "Array content" }],
		});
		await Bun.sleep(10);
		const call = fetchCalls.find(c => c.body?.state === "listening");
		expect(call).toBeTruthy();
		expect(call!.body.detail).toContain("Array content");
	});

	test("before_agent_start pushes thinking state", async () => {
		await api.emit("before_agent_start", {});
		await Bun.sleep(10);
		const call = fetchCalls.find(c => c.body?.state === "thinking");
		expect(call).toBeTruthy();
	});

	test("before_tool_call pushes working state for normal tools", async () => {
		await api.emit("before_agent_start", {});
		fetchCalls = [];
		await api.emit("before_tool_call", { name: "web_search", input: { query: "test" } });
		await Bun.sleep(10);
		const call = fetchCalls.find(c => c.body?.state === "working");
		expect(call).toBeTruthy();
	});

	test("before_tool_call suppresses internal tools", async () => {
		await api.emit("before_agent_start", {});
		fetchCalls = [];
		await api.emit("before_tool_call", { name: "memory_get", input: {} });
		await Bun.sleep(10);
		const workingCall = fetchCalls.find(c => c.body?.state === "working");
		expect(workingCall).toBeUndefined();
	});

	test("after_tool_call pushes thinking for normal tools", async () => {
		await api.emit("before_tool_call", { name: "web_search", input: {} });
		fetchCalls = [];
		await api.emit("after_tool_call", { name: "web_search" });
		await Bun.sleep(10);
		const call = fetchCalls.find(c => c.body?.state === "thinking");
		expect(call).toBeTruthy();
	});

	test("after_tool_call does not push state for suppressed tools", async () => {
		await api.emit("before_tool_call", { name: "memory_set", input: {} });
		fetchCalls = [];
		await api.emit("after_tool_call", { name: "memory_set" });
		await Bun.sleep(10);
		const call = fetchCalls.find(c => c.body?.state === "thinking");
		expect(call).toBeUndefined();
	});

	test("session_start pushes idle/happy", async () => {
		// Change state away from idle first (register sets idle)
		await api.emit("before_agent_start", {});
		fetchCalls = [];
		await api.emit("session_start", {});
		await Bun.sleep(10);
		const call = fetchCalls.find(c => c.body?.state === "idle" && c.body?.emotion === "happy");
		expect(call).toBeTruthy();
	});

	test("session_end pushes sleeping", async () => {
		await api.emit("session_end", {});
		await Bun.sleep(10);
		const call = fetchCalls.find(c => c.body?.state === "sleeping");
		expect(call).toBeTruthy();
	});
});

describe("agent_end", () => {
	let api: ReturnType<typeof createMockApi>;

	beforeEach(() => {
		mockFetch();
		api = createMockApi();
		plugin.register(api);
		fetchCalls = [];
	});

	test("pushes speaking with text for normal messages", async () => {
		await api.emit("agent_end", {
			messages: [{ role: "assistant", content: "Here is a detailed response with enough text." }],
		});
		await Bun.sleep(10);
		const call = fetchCalls.find(c => c.url.includes("/api/speak"));
		expect(call).toBeTruthy();
		expect(call!.body.text).toContain("Here is a detailed response");
	});

	test("replaces code blocks with [code] in display text", async () => {
		await api.emit("agent_end", {
			messages: [{ role: "assistant", content: "Check this:\n```js\nconsole.log('hi')\n```\nDone!" }],
		});
		await Bun.sleep(10);
		const call = fetchCalls.find(c => c.url.includes("/api/speak"));
		expect(call).toBeTruthy();
		expect(call!.body.text).toContain("[code]");
		expect(call!.body.text).not.toContain("console.log");
	});

	test("pushes idle for system messages", async () => {
		// Change state away from idle first so pushState doesn't dedup
		await api.emit("before_agent_start", {});
		fetchCalls = [];
		await api.emit("agent_end", {
			messages: [{ role: "assistant", content: "ok" }],
		});
		await Bun.sleep(10);
		const idleCall = fetchCalls.find(c => c.body?.state === "idle");
		expect(idleCall).toBeTruthy();
		const speakCall = fetchCalls.find(c => c.url?.includes("/api/speak"));
		expect(speakCall).toBeUndefined();
	});

	test("extracts last assistant message from array content", async () => {
		await api.emit("agent_end", {
			messages: [
				{ role: "user", content: "What is 2+2?" },
				{ role: "assistant", content: [{ type: "text", text: "The answer is four, of course!" }] },
			],
		});
		await Bun.sleep(10);
		const call = fetchCalls.find(c => c.url.includes("/api/speak"));
		expect(call).toBeTruthy();
		expect(call!.body.text).toContain("answer is four");
	});

	test("skips tool_use JSON assistant messages", async () => {
		await api.emit("agent_end", {
			messages: [
				{ role: "assistant", content: '{ "name": "web_search", "input": {} }' },
				{ role: "assistant", content: "Here is the real response with enough text." },
			],
		});
		await Bun.sleep(10);
		const call = fetchCalls.find(c => c.url.includes("/api/speak"));
		expect(call).toBeTruthy();
		expect(call!.body.text).toContain("real response");
	});

	test("falls back to event.response when messages empty", async () => {
		await api.emit("agent_end", {
			messages: [],
			response: "Fallback response text with enough content here.",
		});
		await Bun.sleep(10);
		const call = fetchCalls.find(c => c.url.includes("/api/speak"));
		expect(call).toBeTruthy();
		expect(call!.body.text).toContain("Fallback response");
	});
});

describe("isSystemMessage detection", () => {
	let api: ReturnType<typeof createMockApi>;

	beforeEach(() => {
		mockFetch();
		api = createMockApi();
		plugin.register(api);
		fetchCalls = [];
	});

	const systemMessages = [
		"ok", "done.", "success", "completed", "saved",
		"token synced", "cron ran", "no errors found", "ran cleanly",
	];

	for (const msg of systemMessages) {
		test(`detects "${msg}" as system message`, async () => {
			await api.emit("agent_end", {
				messages: [{ role: "assistant", content: msg }],
			});
			await Bun.sleep(10);
			const speakCall = fetchCalls.find(c => c.url?.includes("/api/speak"));
			expect(speakCall).toBeUndefined();
		});
	}
});

describe("internal tool detection", () => {
	let api: ReturnType<typeof createMockApi>;

	beforeEach(async () => {
		mockFetch();
		api = createMockApi();
		plugin.register(api);
		await api.emit("before_agent_start", {});
		fetchCalls = [];
	});

	const internalTools = [
		"cron", "scheduled_task", "memory_get", "memory_set",
		"message_list", "message_read", "channel_list",
		"http_request", "fetch", "sleep",
	];

	for (const tool of internalTools) {
		test(`suppresses "${tool}" tool`, async () => {
			await api.emit("before_tool_call", { name: tool, input: {} });
			await Bun.sleep(10);
			const workingCall = fetchCalls.find(c => c.body?.state === "working");
			expect(workingCall).toBeUndefined();
		});
	}

	test("suppresses tools with pattern-matched input", async () => {
		await api.emit("before_tool_call", {
			name: "custom_tool",
			input: { action: "sync-token-refresh" },
		});
		await Bun.sleep(10);
		const workingCall = fetchCalls.find(c => c.body?.state === "working");
		expect(workingCall).toBeUndefined();
	});

	test("allows non-internal tools", async () => {
		await api.emit("before_tool_call", { name: "web_search", input: { query: "bun runtime" } });
		await Bun.sleep(10);
		const workingCall = fetchCalls.find(c => c.body?.state === "working");
		expect(workingCall).toBeTruthy();
	});
});

describe("state dedup", () => {
	let api: ReturnType<typeof createMockApi>;

	beforeEach(() => {
		mockFetch();
		api = createMockApi();
		plugin.register(api);
		fetchCalls = [];
	});

	test("dedups repeated identical payloads", async () => {
		await api.emit("gateway_start", {});
		await api.emit("gateway_start", {});
		await Bun.sleep(10);
		const idleCalls = fetchCalls.filter(c => c.body?.state === "idle");
		expect(idleCalls.length).toBe(1);
	});

	test("does not dedup same state when emotion changes", async () => {
		await api.emit("before_agent_start", {});
		fetchCalls = [];
		await api.emit("session_start", {}); // idle + happy
		await Bun.sleep(10);
		const call = fetchCalls.find(c => c.body?.state === "idle" && c.body?.emotion === "happy");
		expect(call).toBeTruthy();
	});

	test("coalesces rapid state updates to the latest payload", async () => {
		fetchCalls = [];
		await api.emit("before_agent_start", {});
		await api.emit("before_tool_call", { name: "web_search", input: {} });
		await api.emit("after_tool_call", { name: "web_search" });
		await Bun.sleep(20);
		const stateCalls = fetchCalls.filter(c => c.url.includes("/api/state"));
		expect(stateCalls.length).toBeLessThanOrEqual(2);
		const last = stateCalls[stateCalls.length - 1];
		expect(last?.body?.state).toBe("thinking");
	});
});

describe("tts sequencing", () => {
	test("forwards speak seq to tts when enabled", async () => {
		fetchCalls = [];
		globalThis.fetch = mock(async (url: string | URL | Request, init?: RequestInit) => {
			const u = typeof url === "string" ? url : url instanceof URL ? url.toString() : url.url;
			fetchCalls.push({
				url: u,
				method: init?.method || "GET",
				body: init?.body ? JSON.parse(init.body as string) : undefined,
				headers: init?.headers || {},
			});
			if (u.includes("/api/speak")) {
				return new Response(JSON.stringify({ ok: true, seq: 42 }), { status: 200 });
			}
			return new Response(JSON.stringify({ ok: true }), { status: 200 });
		}) as typeof globalThis.fetch;

		const api = createMockApi({
			tts_enabled: true,
			tts_url: "http://localhost:9200",
			face_url: "http://localhost:9999",
			face_api_key: "face-key",
		});
		plugin.register(api);
		fetchCalls = [];

		await api.emit("agent_end", {
			messages: [{ role: "assistant", content: "This should be spoken through TTS." }],
		});
		await Bun.sleep(20);

		const ttsCall = fetchCalls.find(c => c.url.includes("/tts/speak"));
		expect(ttsCall).toBeTruthy();
		expect(ttsCall!.body.seq).toBe(42);
		expect(ttsCall!.body.faceUrl).toBe("http://localhost:9999");
		expect(ttsCall!.body.faceApiKey).toBe("face-key");
	});
});

describe("speak failure fallback", () => {
	test("returns to idle when /api/speak fails", async () => {
		fetchCalls = [];
		globalThis.fetch = mock(async (url: string | URL | Request, init?: RequestInit) => {
			const u = typeof url === "string" ? url : url instanceof URL ? url.toString() : url.url;
			fetchCalls.push({
				url: u,
				method: init?.method || "GET",
				body: init?.body ? JSON.parse(init.body as string) : undefined,
				headers: init?.headers || {},
			});
			if (u.includes("/api/speak")) {
				return new Response(JSON.stringify({ ok: false }), { status: 500 });
			}
			return new Response(JSON.stringify({ ok: true }), { status: 200 });
		}) as typeof globalThis.fetch;

		const api = createMockApi();
		plugin.register(api);
		fetchCalls = [];

		await api.emit("agent_end", {
			messages: [{ role: "assistant", content: "This response should trigger fallback." }],
		});
		await Bun.sleep(20);

		const fallbackCall = fetchCalls.find(c => c.url.includes("/api/state") && c.body?.state === "idle");
		expect(fallbackCall).toBeTruthy();
	});
});
