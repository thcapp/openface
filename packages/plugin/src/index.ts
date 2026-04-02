// @openface/plugin — OpenClaw plugin for Open Face
//
// Drives the face from agent lifecycle events. Single authority model:
// - This plugin owns state transitions (thinking, working, speaking, idle)
// - TTS server owns audio delivery (chunks via /api/audio)
// - Viewer owns amplitude (extracted from audio waveform client-side)
//
// Install: cp -r packages/plugin ~/.openclaw/plugins/openface

import { cleanForDisplay, detectFromText, blendEmotions, summarizeToolCall } from "@openface/filter";

const DEFAULT_FACE_URL = "http://localhost:9999";
const DEFAULT_TTS_URL = "http://localhost:9200";
const PUSH_TIMEOUT_MS = 2500;
const PUSH_RETRIES = 1;
const STATE_PUSH_DEBOUNCE_MS = 5;

interface SpeakResponse {
	ok?: boolean;
	seq?: number;
}

async function postJson(
	url: string,
	headers: Record<string, string>,
	body: Record<string, unknown>,
	retries = PUSH_RETRIES,
): Promise<Record<string, unknown> | null> {
	let attempt = 0;
	while (attempt <= retries) {
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), PUSH_TIMEOUT_MS);
		try {
			const res = await fetch(url, {
				method: "POST",
				headers,
				body: JSON.stringify(body),
				signal: controller.signal,
			});
			if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
			return await res.json() as Record<string, unknown>;
		} catch {
			if (attempt >= retries) return null;
			await new Promise((resolve) => setTimeout(resolve, 150 * (attempt + 1)));
		} finally {
			clearTimeout(timer);
		}
		attempt++;
	}
	return null;
}

// Non-blocking push adapter with bounded retry/timeout.
function createPusher(faceUrl: string, apiKey: string) {
	const headers: Record<string, string> = { "Content-Type": "application/json" };
	if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

	return {
		state(data: Record<string, unknown>) {
			void postJson(`${faceUrl}/api/state`, headers, data);
		},
		async speak(data: Record<string, unknown>): Promise<SpeakResponse | null> {
			const result = await postJson(`${faceUrl}/api/speak`, headers, data);
			return result as SpeakResponse | null;
		},
	};
}

// Skip system/cron/operational messages
function isSystemMessage(text: string): boolean {
	if (!text || text.length < 5) return true;
	const t = text.toLowerCase();
	if (/token synced|token refreshed|cron|heartbeat|health check/i.test(t)) return true;
	if (/^\s*ok\s*$/i.test(t)) return true;
	if (/^\s*\{\s*"(name|type|tool_use_id)"\s*:/.test(text)) return true;
	if (/\.sync-state|discord\/\.|memory_get|message_list/i.test(t)) return true;
	if (/no errors|ran cleanly|executed successfully|exit code/i.test(t)) return true;
	if (/^\s*(done|success|completed|finished|saved|updated|synced|sent|deleted|created)\.?\s*$/i.test(t)) return true;
	return false;
}

// Always-suppress tools — internal ops that shouldn't show on face
const SUPPRESS_TOOLS = new Set([
	"cron", "scheduled_task",
	"memory_get", "memory_set", "memory_delete", "memory_list",
	"message", "messages", "message_list", "message_read",
	"channel_list", "channel_info", "guild_list", "guild_info",
	"reaction_add", "reaction_remove", "typing_indicator",
	"http_request", "fetch", "sleep", "wait", "delay",
]);
const SUPPRESS_PATTERNS = /sync.*token|cron|heartbeat|health.check|scheduled|\.sync-state|discord\/\./i;

function isInternalTool(name: string, input: unknown): boolean {
	if (SUPPRESS_TOOLS.has(name)) return true;
	const str = typeof input === "string" ? input : JSON.stringify(input || "");
	return SUPPRESS_PATTERNS.test(str);
}

// ── Plugin registration ──

const plugin = {
	id: "openface",
	name: "Open Face",
	description: "Drives Open Face from agent lifecycle events",

	register(api: any) {
		let faceUrl = DEFAULT_FACE_URL;
		let apiKey = "";
		let ttsUrl = DEFAULT_TTS_URL;
		let ttsEnabled = false;
		try {
			const cfg = api.config?.plugins?.entries?.openface?.config || {};
			faceUrl = cfg.face_url || DEFAULT_FACE_URL;
			apiKey = cfg.face_api_key || "";
			ttsUrl = cfg.tts_url || DEFAULT_TTS_URL;
			ttsEnabled = !!cfg.tts_enabled;
		} catch {}

		const push = createPusher(faceUrl, apiKey);
		let suppressedToolActive = false;
		let lastPushKey = "";
		let pendingStatePayload: Record<string, unknown> | null = null;
		let pendingStateTimer: ReturnType<typeof setTimeout> | null = null;

		function flushStatePush() {
			if (!pendingStatePayload) return;
			const payload = pendingStatePayload;
			pendingStatePayload = null;
			const key = JSON.stringify(payload);
			if (key === lastPushKey) return;
			lastPushKey = key;
			push.state(payload);
		}

		function pushState(state: string, data: Record<string, unknown> = {}, immediate = false) {
			const payload = { state, ...data };
			if (immediate) {
				const pendingKey = pendingStatePayload ? JSON.stringify(pendingStatePayload) : "";
				const nextKey = JSON.stringify(payload);
				if (pendingKey && pendingKey !== nextKey) lastPushKey = "";
				if (pendingStateTimer) clearTimeout(pendingStateTimer);
				pendingStateTimer = null;
				pendingStatePayload = payload;
				flushStatePush();
				return;
			}
			pendingStatePayload = payload;
			if (pendingStateTimer) return;
			pendingStateTimer = setTimeout(() => {
				pendingStateTimer = null;
				flushStatePush();
			}, STATE_PUSH_DEBOUNCE_MS);
		}

		pushState("idle", { emotion: "neutral" }, true);

		// ── User sends message → listening ──
		api.on("message_received", async (event: any) => {
			let userText = "";
			try {
				const content = event?.content || event?.message?.content || event?.text || "";
				userText = typeof content === "string"
					? content
					: Array.isArray(content)
						? content.filter((c: any) => c.type === "text").map((c: any) => c.text).join("\n")
						: "";
				userText = cleanForDisplay(userText);
			} catch {}
			pushState("listening", { detail: userText ? `User: ${userText.slice(0, 200)}` : "Listening..." });
		});

		// ── Agent starts processing → thinking ──
		api.on("before_agent_start", async () => {
			pushState("thinking", { detail: "Processing request..." });
		});

		// ── Tool execution → working (skip internal tools) ──
		api.on("before_tool_call", async (event: any) => {
			const name = event?.name || event?.tool?.name || event?.toolName || "";
			const input = event?.input || event?.arguments || event?.params || "";
			if (isInternalTool(name, input)) {
				suppressedToolActive = true;
				return { block: false };
			}
			suppressedToolActive = false;
			const toolInput = typeof input === "object" && input ? input as Record<string, unknown> : {};
			pushState("working", { detail: summarizeToolCall({ name, input: toolInput }) });
			return { block: false };
		});

		// ── Tool complete → back to thinking ──
		api.on("after_tool_call", async (event: any) => {
			const name = event?.name || event?.tool?.name || event?.toolName || "";
			if (suppressedToolActive || isInternalTool(name, null)) {
				suppressedToolActive = false;
				return;
			}
			pushState("thinking");
		});

		// ── Agent done — single authority for speaking transition ──
		api.on("agent_end", async (event: any) => {
			let rawContent = "";
			try {
				const messages = event?.messages || [];
				for (let i = messages.length - 1; i >= 0; i--) {
					const msg = messages[i];
					if (msg.role !== "assistant") continue;
					let text = "";
					if (typeof msg.content === "string") text = msg.content;
					else if (Array.isArray(msg.content)) {
						text = msg.content.filter((c: any) => c.type === "text").map((c: any) => c.text).join("\n");
					}
					if (!text || /^\s*\{\s*"name"\s*:/.test(text.trim())) continue;
					rawContent = text;
					break;
				}
			} catch {}

			if (!rawContent) rawContent = event?.response || event?.content || event?.output || "";
			const content = cleanForDisplay(typeof rawContent === "string" ? rawContent : "");
			const signals = detectFromText(content);
			const blended = blendEmotions(signals);

			if (isSystemMessage(content)) {
				lastPushKey = "";
				pushState("idle", { emotion: "neutral" }, true);
				return;
			}

			if (content.length <= 3) return;

			const displayText = content.replace(/```[\s\S]*?```/g, "[code]");
			const speakRes = await push.speak({
				text: displayText,
				emotion: blended.emotion,
				intensity: blended.intensity,
				...(blended.emotionSecondary && { emotionSecondary: blended.emotionSecondary, emotionBlend: blended.emotionBlend }),
			});

			if (!speakRes?.ok) {
				lastPushKey = "";
				pushState("idle", { emotion: "neutral" }, true);
				return;
			}

			// Fire TTS if enabled (audio chunks should preserve the same seq)
			if (ttsEnabled) {
				const speakable = content
					.replace(/```[\s\S]*?```/g, "")
					.replace(/\n/g, " ")
					.replace(/\s+/g, " ")
					.trim()
					.slice(0, 500);
				if (speakable.length >= 3) {
					const ttsPayload: Record<string, unknown> = {
						text: speakable,
						seq: speakRes.seq ?? null,
						faceUrl,
					};
					if (apiKey) ttsPayload.faceApiKey = apiKey;
					void postJson(`${ttsUrl}/tts/speak`, { "Content-Type": "application/json" }, ttsPayload, 0);
				}
				// Do NOT push idle — viewer transitions after audio completion.
			} else {
				setTimeout(() => pushState("idle", { emotion: blended.emotion }), 5000);
			}
		});

		// ── Session lifecycle ──
		api.on("session_start", async () => { pushState("idle", { emotion: "happy" }); });
		api.on("session_end", async () => {
			if (pendingStateTimer) clearTimeout(pendingStateTimer);
			pendingStateTimer = null;
			pendingStatePayload = null;
			pushState("sleeping", { emotion: "neutral" }, true);
			lastPushKey = "";
		});
		api.on("gateway_start", async () => { pushState("idle"); });
	},
};

export default plugin;
