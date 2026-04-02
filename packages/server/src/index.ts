/**
 * Open Face — WebSocket Relay Server (Bun)
 *
 * Pure state relay. No audio, no image generation.
 * Receives state from agents, broadcasts to viewers.
 *
 * Usage: FACE_PORT=9999 bun packages/server/src/index.ts
 */

import { RateLimiter } from "./rate-limit.js";
import { checkAuth, getClientIp } from "./auth.js";
import { createDefaultState, mergeState, publicState } from "./state.js";
import type { FaceStateData } from "./state.js";

const PORT = parseInt(process.env.FACE_PORT || "9999");
const API_KEY = process.env.FACE_API_KEY || "";
const IDLE_TIMEOUT_MS = parseInt(process.env.FACE_IDLE_TIMEOUT || "30000");
const GATEWAY_URL = process.env.OPENCLAW_GATEWAY_URL || "";
const GATEWAY_TOKEN = process.env.OPENCLAW_GATEWAY_TOKEN || "";
const GATEWAY_SESSION = process.env.OPENCLAW_SESSION_KEY || "agent:main";
const MAX_VIEWERS = parseInt(process.env.FACE_MAX_VIEWERS || "50");
const MAX_AGENTS = parseInt(process.env.FACE_MAX_AGENTS || "5");
const MAX_MSG_BYTES = 4096;
const RATE_LIMIT_PER_SEC = parseInt(process.env.FACE_RATE_LIMIT || "60");
const MAX_CHAT_CHARS = parseInt(process.env.FACE_CHAT_MAX_CHARS || "4000");
const MAX_AUDIO_BYTES = parseInt(process.env.FACE_AUDIO_MAX_BYTES || String(1024 * 1024));
const MAX_AUDIO_B64_CHARS = parseInt(process.env.FACE_AUDIO_MAX_B64_CHARS || String(2 * 1024 * 1024));

// --- State ---

const viewers = new Set<WebSocket>();
const agents = new Set<WebSocket>();
const currentState: FaceStateData = createDefaultState();
let audioSeq = 0; // monotonic sequence for audio streams

// State history — ring buffer for late-joining viewers
const MAX_HISTORY = 200;
interface HistoryEntry { type: string; ts: number; data: Record<string, unknown>; }
const stateHistory: HistoryEntry[] = [];

function recordHistory(type: string, data: Record<string, unknown>) {
	stateHistory.push({ type, ts: Date.now(), data });
	if (stateHistory.length > MAX_HISTORY) stateHistory.shift();
}

// Monitoring
let errorCount = 0;
const msgTimestamps: number[] = [];

function log(event: string, detail = "") {
	console.log(`[${new Date().toISOString()}] [${event}] ${detail}`);
}

// --- Idle / Sleep ---

let idleTimer: ReturnType<typeof setTimeout> | null = null;
function resetIdleTimer() {
	if (idleTimer) clearTimeout(idleTimer);
	if (currentState.state === "sleeping") return;
	idleTimer = setTimeout(() => {
		currentState.state = "idle";
		currentState.emotion = "neutral";
		currentState.amplitude = 0;
		currentState.text = null;
		currentState._ts = Date.now();
		broadcastState();
		log("IDLE_TIMEOUT", "Auto-returned to idle");
	}, IDLE_TIMEOUT_MS);
}

let sleepTimer: ReturnType<typeof setTimeout> | null = null;
function checkAgentPresence() {
	if (sleepTimer) clearTimeout(sleepTimer);
	if (agents.size === 0) {
		sleepTimer = setTimeout(() => {
			if (agents.size === 0 && currentState.state !== "sleeping") {
				currentState.state = "sleeping";
				currentState.emotion = "neutral";
				currentState.amplitude = 0;
				currentState._ts = Date.now();
				broadcastState();
				log("AUTO_SLEEP", "No agents connected");
			}
		}, 5000);
	}
}

// --- Broadcast ---

function broadcastState() {
	const msg = JSON.stringify({ type: "state", ...currentState });
	for (const ws of viewers) ws.send(msg);
}

function handleStateUpdate(partial: Record<string, unknown>) {
	const prevState = currentState.state;
	mergeState(currentState, partial);
	resetIdleTimer();

	// Record to history
	if (partial.state && partial.state !== prevState) {
		recordHistory("state", { state: partial.state, prev: prevState, emotion: currentState.emotion });
	}
	if (partial.text) {
		recordHistory("text", { text: partial.text, state: currentState.state, emotion: currentState.emotion });
	}
	if (partial.detail) {
		recordHistory("detail", { detail: partial.detail });
	}

	const now = Date.now();
	msgTimestamps.push(now);
	// Keep only last 60 seconds
	while (msgTimestamps.length > 0 && msgTimestamps[0]! < now - 60000) {
		msgTimestamps.shift();
	}

	broadcastState();

	// Clear ephemeral fields after broadcast so they don't re-send on next state change
	if (currentState.text) currentState.text = null;
	if ((currentState as any).detail) (currentState as any).detail = null;
}

// --- Rate Limiting ---

const rateLimiter = new RateLimiter(RATE_LIMIT_PER_SEC);

// --- CORS ---

const CORS_HEADERS = {
	"Access-Control-Allow-Origin": "*",
	"Access-Control-Allow-Methods": "GET, POST, OPTIONS",
	"Access-Control-Allow-Headers": "Content-Type, Authorization",
};

// --- Server ---

interface WsData { role: "viewer" | "agent" }

export const server = Bun.serve<WsData>({
	port: PORT,

	async fetch(req, server) {
		const url = new URL(req.url);

		// CORS preflight
		if (req.method === "OPTIONS") {
			return new Response(null, { status: 204, headers: CORS_HEADERS });
		}

		// WebSocket: viewer
		if (url.pathname === "/ws/viewer") {
			if (viewers.size >= MAX_VIEWERS) return new Response("Too many viewers", { status: 503 });
			if (server.upgrade(req, { data: { role: "viewer" } })) return undefined;
			return new Response("Upgrade failed", { status: 400 });
		}

		// WebSocket: agent
		if (url.pathname === "/ws/agent") {
			if (!checkAuth(API_KEY, req)) return new Response("Unauthorized", { status: 401 });
			if (agents.size >= MAX_AGENTS) return new Response("Too many agents", { status: 503 });
			if (server.upgrade(req, { data: { role: "agent" } })) return undefined;
			return new Response("Upgrade failed", { status: 400 });
		}

		// POST /api/state — push state update
		if (url.pathname === "/api/state" && req.method === "POST") {
			if (!checkAuth(API_KEY, req)) {
				return Response.json({ error: "Unauthorized" }, { status: 401, headers: CORS_HEADERS });
			}
			const ip = req.headers.get("x-forwarded-for") || req.headers.get("cf-connecting-ip") || "unknown";
			if (!rateLimiter.checkIp(ip)) {
				errorCount++;
				return Response.json({ error: "Rate limited" }, { status: 429, headers: CORS_HEADERS });
			}
			try {
				const text = await req.text();
				if (text.length > MAX_MSG_BYTES) {
					errorCount++;
					return Response.json({ error: "Payload too large" }, { status: 413, headers: CORS_HEADERS });
				}
				const data = JSON.parse(text);
				handleStateUpdate(data);
				return Response.json({ ok: true, state: publicState(currentState) }, { headers: CORS_HEADERS });
			} catch {
				errorCount++;
				return Response.json({ error: "Invalid JSON" }, { status: 400, headers: CORS_HEADERS });
			}
		}

		// POST /api/audio — relay audio chunk to viewers
		// Accepts BOTH formats:
		//   - Raw binary WAV (Content-Type: audio/wav) — from Kokoro TTS
		//   - JSON {data: base64, seq?} (Content-Type: application/json) — from custom clients
		if (url.pathname === "/api/audio" && req.method === "POST") {
			if (!checkAuth(API_KEY, req)) return Response.json({ error: "Unauthorized" }, { status: 401, headers: CORS_HEADERS });
			const ip = getClientIp(req);
			if (!rateLimiter.checkIp(ip)) {
				errorCount++;
				return Response.json({ error: "Rate limited" }, { status: 429, headers: CORS_HEADERS });
			}
			try {
				const contentType = req.headers.get("content-type") || "";
				let b64: string;
				let seq = audioSeq;

				if (contentType.includes("audio/") || contentType.includes("octet-stream")) {
					// Raw binary — convert to base64 for WebSocket broadcast
					const raw = new Uint8Array(await req.arrayBuffer());
					if (raw.byteLength > MAX_AUDIO_BYTES) {
						return Response.json({ error: "Audio payload too large" }, { status: 413, headers: CORS_HEADERS });
					}
					b64 = Buffer.from(raw).toString("base64");
					log("AUDIO", `binary ${(raw.byteLength / 1024).toFixed(0)}KB seq=${seq} → ${viewers.size} viewers`);
				} else {
					// JSON with base64 data
					const body = await req.json() as { data?: string; seq?: number };
					if (!body.data) return Response.json({ error: "data field required" }, { status: 400, headers: CORS_HEADERS });
					b64 = body.data;
					if (b64.length > MAX_AUDIO_B64_CHARS) {
						return Response.json({ error: "Audio payload too large" }, { status: 413, headers: CORS_HEADERS });
					}
					if (body.seq !== undefined) seq = body.seq;
					log("AUDIO", `json ${(b64.length / 1024).toFixed(0)}KB seq=${seq} → ${viewers.size} viewers`);
				}

				const msg = JSON.stringify({ type: "audio", data: b64, format: "wav", seq });
				for (const ws of viewers) ws.send(msg);
				return Response.json({ ok: true, seq }, { headers: CORS_HEADERS });
			} catch {
				return Response.json({ error: "Invalid request" }, { status: 400, headers: CORS_HEADERS });
			}
		}

		// POST /api/audio-done — signal end of audio stream
		if (url.pathname === "/api/audio-done" && req.method === "POST") {
			if (!checkAuth(API_KEY, req)) return Response.json({ error: "Unauthorized" }, { status: 401, headers: CORS_HEADERS });
			const ip = getClientIp(req);
			if (!rateLimiter.checkIp(ip)) {
				errorCount++;
				return Response.json({ error: "Rate limited" }, { status: 429, headers: CORS_HEADERS });
			}
			let seq = audioSeq;
			try {
				const body = await req.json() as { seq?: number };
				if (typeof body.seq === "number" && Number.isFinite(body.seq)) seq = body.seq;
			} catch {
				// Body is optional; default to latest seq
			}
			const msg = JSON.stringify({ type: "audio-done", seq });
			for (const ws of viewers) ws.send(msg);
			log("AUDIO_DONE", `seq=${seq} → ${viewers.size} viewers`);
			return Response.json({ ok: true, seq }, { headers: CORS_HEADERS });
		}

		// POST /api/speak — atomic: set speaking state + increment audio seq
		if (url.pathname === "/api/speak" && req.method === "POST") {
			if (!checkAuth(API_KEY, req)) return Response.json({ error: "Unauthorized" }, { status: 401, headers: CORS_HEADERS });
			const ip = getClientIp(req);
			if (!rateLimiter.checkIp(ip)) {
				errorCount++;
				return Response.json({ error: "Rate limited" }, { status: 429, headers: CORS_HEADERS });
			}
			try {
				const data = await req.json() as Record<string, unknown>;
				audioSeq++;
				data.state = data.state || "speaking";
				handleStateUpdate(data);
				// Broadcast seq so viewers can flush old audio queue
				const seqMsg = JSON.stringify({ type: "audio-seq", seq: audioSeq });
				for (const ws of viewers) ws.send(seqMsg);
				log("SPEAK", `seq=${audioSeq} text="${String(data.text || "").slice(0, 50)}"`);
				return Response.json({ ok: true, seq: audioSeq, state: publicState(currentState) }, { headers: CORS_HEADERS });
			} catch {
				return Response.json({ error: "Invalid request" }, { status: 400, headers: CORS_HEADERS });
			}
		}

		// POST /api/chat — proxy user message to OpenClaw gateway
		if (url.pathname === "/api/chat" && req.method === "POST") {
			if (!checkAuth(API_KEY, req)) return Response.json({ error: "Unauthorized" }, { status: 401, headers: CORS_HEADERS });
			const ip = getClientIp(req);
			if (!rateLimiter.checkIp(ip)) {
				errorCount++;
				return Response.json({ error: "Rate limited" }, { status: 429, headers: CORS_HEADERS });
			}
			if (!GATEWAY_URL) {
				return Response.json({ error: "No gateway configured" }, { status: 503, headers: CORS_HEADERS });
			}
			try {
				const { message } = await req.json() as { message?: string };
				if (!message || typeof message !== "string") {
					return Response.json({ error: "message required" }, { status: 400, headers: CORS_HEADERS });
				}
				if (message.length > MAX_CHAT_CHARS) {
					return Response.json({ error: "message too long" }, { status: 413, headers: CORS_HEADERS });
				}
				const headers: Record<string, string> = { "Content-Type": "application/json" };
				if (GATEWAY_TOKEN) headers.Authorization = `Bearer ${GATEWAY_TOKEN}`;

				const res = await fetch(`${GATEWAY_URL}/api/message`, {
					method: "POST",
					headers,
					body: JSON.stringify({ message, sessionKey: GATEWAY_SESSION }),
				});
				const result = await res.json();
				log("CHAT", `"${message.slice(0, 50)}" → gateway ${res.status}`);
				return Response.json(result, { headers: CORS_HEADERS });
			} catch {
				return Response.json({ error: "Gateway unavailable" }, { status: 502, headers: CORS_HEADERS });
			}
		}

		// GET /api/state
		if (url.pathname === "/api/state" && req.method === "GET") {
			return Response.json(publicState(currentState), { headers: CORS_HEADERS });
		}

		// GET /api/history — recent state history for late-joining viewers
		if (url.pathname === "/api/history" && req.method === "GET") {
			return Response.json({ entries: stateHistory, count: stateHistory.length }, { headers: CORS_HEADERS });
		}

		// GET /health
		if (url.pathname === "/health") {
			return Response.json({
				ok: true,
				viewers: viewers.size,
				agents: agents.size,
				uptime: process.uptime(),
				state: currentState.state,
				lastStateChange: new Date(currentState._ts).toISOString(),
				messageRate: msgTimestamps.length,
				errorCount,
			}, { headers: CORS_HEADERS });
		}

		// Static files — serve the face viewer, dashboard, JS, face packs
		const PUBLIC_DIR = import.meta.dir + "/../public";
		const MIME: Record<string, string> = {
			".html": "text/html", ".js": "application/javascript",
			".json": "application/json", ".css": "text/css",
		};

		let filePath = url.pathname === "/" ? "/index.html" : url.pathname;
		// Try exact path, then with .html extension (so /dashboard works)
		let file = Bun.file(PUBLIC_DIR + filePath);
		if (!await file.exists() && !filePath.includes(".")) {
			file = Bun.file(PUBLIC_DIR + filePath + ".html");
			filePath = filePath + ".html";
		}
		if (await file.exists()) {
			const ext = filePath.substring(filePath.lastIndexOf("."));
			return new Response(file, {
				headers: { "Content-Type": MIME[ext] || "application/octet-stream", ...CORS_HEADERS },
			});
		}

		return new Response("Not found", { status: 404 });
	},

	websocket: {
		open(ws) {
			const { role } = ws.data;
			if (role === "viewer") {
				viewers.add(ws as unknown as WebSocket);
				// Send current state + history for late-joining viewers
				ws.send(JSON.stringify({ type: "state", ...currentState }));
				if (stateHistory.length > 0) {
					ws.send(JSON.stringify({ type: "history", entries: stateHistory }));
				}
				log("VIEWER_CONNECT", `total=${viewers.size} history=${stateHistory.length}`);
			} else if (role === "agent") {
				agents.add(ws as unknown as WebSocket);
				if (currentState.state === "sleeping" && agents.size === 1) {
					currentState.state = "idle";
					currentState._ts = Date.now();
					broadcastState();
				}
				log("AGENT_CONNECT", `total=${agents.size}`);
			}
		},

		message(ws, message) {
			const { role } = ws.data;

			if (role === "viewer") {
				try {
					const data = JSON.parse(message as string);
					if (data.type === "ping") ws.send(JSON.stringify({ type: "pong" }));
				} catch { /* ignore */ }
				return;
			}

			if (role === "agent") {
				if (typeof message === "string" && message.length > MAX_MSG_BYTES) return;
				if (!rateLimiter.checkWs(ws)) {
					errorCount++;
					ws.send(JSON.stringify({ type: "error", message: "Rate limited" }));
					return;
				}
				try {
					const data = JSON.parse(message as string);
					if (data.type === "ping") {
						ws.send(JSON.stringify({ type: "pong" }));
						return;
					}
					handleStateUpdate(data);
				} catch {
					errorCount++;
				}
			}
		},

		close(ws) {
			const { role } = ws.data;
			if (role === "viewer") {
				viewers.delete(ws as unknown as WebSocket);
				log("VIEWER_DISCONNECT", `total=${viewers.size}`);
			} else if (role === "agent") {
				agents.delete(ws as unknown as WebSocket);
				log("AGENT_DISCONNECT", `total=${agents.size}`);
				checkAgentPresence();
			}
		},
	},
});

log("START", `Open Face server listening on :${PORT}`);
log("START", `API:    http://127.0.0.1:${PORT}/api/state`);
log("START", `Health: http://127.0.0.1:${PORT}/health`);
log("START", `WS:     ws://127.0.0.1:${PORT}/ws/viewer`);
if (API_KEY) log("START", "API key auth enabled");
else log("START", "WARNING: No FACE_API_KEY set — API is open");
