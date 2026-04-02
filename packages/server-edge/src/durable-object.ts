/**
 * FaceRoom Durable Object — holds state for a single face instance.
 * Uses WebSocket Hibernation API so idle faces cost nothing.
 */

import { createDefaultState, mergeState, publicState } from "@openface/server/state";
import type { FaceStateData } from "@openface/server/state";

interface FaceRoomEnv {
	OPENCLAW_GATEWAY_URL?: string;
	OPENCLAW_GATEWAY_TOKEN?: string;
	OPENCLAW_SESSION_KEY?: string;
}

type WsTag = "viewer" | "agent";

export class FaceRoom implements DurableObject {
	private ctx: DurableObjectState;
	private env: FaceRoomEnv;
	private current: FaceStateData = createDefaultState();
	private idleTimer: ReturnType<typeof setTimeout> | null = null;
	private sleepTimer: ReturnType<typeof setTimeout> | null = null;
	private audioSeq = 0;

	constructor(ctx: DurableObjectState, env: FaceRoomEnv) {
		this.ctx = ctx;
		this.env = env;
	}

	private getViewers(): WebSocket[] {
		return this.ctx.getWebSockets("viewer");
	}

	private getAgents(): WebSocket[] {
		return this.ctx.getWebSockets("agent");
	}

	async fetch(request: Request): Promise<Response> {
		const url = new URL(request.url);

		if (request.method === "OPTIONS") {
			return new Response(null, { status: 204, headers: corsHeaders() });
		}

		// WebSocket upgrade — Hibernation API
		if (request.headers.get("upgrade") === "websocket") {
			const role: WsTag = url.pathname.includes("/agent") ? "agent" : "viewer";

			if (role === "viewer" && this.getViewers().length >= 50) {
				return new Response("Too many viewers", { status: 503 });
			}
			if (role === "agent" && this.getAgents().length >= 5) {
				return new Response("Too many agents", { status: 503 });
			}

			const pair = new WebSocketPair();
			const [client, server] = Object.values(pair);

			// Hibernation: acceptWebSocket with tag
			this.ctx.acceptWebSocket(server, [role]);

			if (role === "viewer") {
				server.send(JSON.stringify({ type: "state", ...this.current }));
			} else {
				// Agent connected — wake up if sleeping
				if (this.current.state === "sleeping" && this.getAgents().length === 0) {
					this.current.state = "idle";
					this.current._ts = Date.now();
					this.broadcast();
				}
			}

			return new Response(null, { status: 101, webSocket: client });
		}

		// POST /api/state
		if (url.pathname.endsWith("/api/state") && request.method === "POST") {
			try {
				const data = await request.json() as Record<string, unknown>;
				mergeState(this.current, data);
				this.resetIdleTimer();
				this.broadcast();
				return Response.json({ ok: true, state: publicState(this.current) }, { headers: corsHeaders() });
			} catch {
				return Response.json({ error: "Invalid JSON" }, { status: 400, headers: corsHeaders() });
			}
		}

		// POST /api/audio
		if (url.pathname.endsWith("/api/audio") && request.method === "POST") {
			try {
				const contentType = request.headers.get("content-type") || "";
				let b64: string;
				let seq = this.audioSeq;

				if (contentType.includes("audio/") || contentType.includes("octet-stream")) {
					const raw = new Uint8Array(await request.arrayBuffer());
					b64 = btoa(String.fromCharCode(...raw));
				} else {
					const body = await request.json() as { data?: string; seq?: number };
					if (!body.data) return Response.json({ error: "data field required" }, { status: 400, headers: corsHeaders() });
					b64 = body.data;
					if (body.seq !== undefined) seq = body.seq;
				}

				const msg = JSON.stringify({ type: "audio", data: b64, format: "wav", seq });
				this.broadcastToViewers(msg);
				return Response.json({ ok: true, seq }, { headers: corsHeaders() });
			} catch {
				return Response.json({ error: "Invalid request" }, { status: 400, headers: corsHeaders() });
			}
		}

		// POST /api/audio-done
		if (url.pathname.endsWith("/api/audio-done") && request.method === "POST") {
			const msg = JSON.stringify({ type: "audio-done", seq: this.audioSeq });
			this.broadcastToViewers(msg);
			return Response.json({ ok: true, seq: this.audioSeq }, { headers: corsHeaders() });
		}

		// POST /api/speak
		if (url.pathname.endsWith("/api/speak") && request.method === "POST") {
			try {
				const data = await request.json() as Record<string, unknown>;
				this.audioSeq++;
				data.state = data.state || "speaking";
				mergeState(this.current, data);
				this.resetIdleTimer();
				this.broadcast();
				const seqMsg = JSON.stringify({ type: "audio-seq", seq: this.audioSeq });
				this.broadcastToViewers(seqMsg);
				return Response.json({ ok: true, seq: this.audioSeq, state: publicState(this.current) }, { headers: corsHeaders() });
			} catch {
				return Response.json({ error: "Invalid request" }, { status: 400, headers: corsHeaders() });
			}
		}

		// POST /api/chat
		if (url.pathname.endsWith("/api/chat") && request.method === "POST") {
			const gatewayUrl = this.env.OPENCLAW_GATEWAY_URL;
			if (!gatewayUrl) {
				return Response.json({ error: "No gateway configured" }, { status: 503, headers: corsHeaders() });
			}
			try {
				const { message } = await request.json() as { message?: string };
				if (!message || typeof message !== "string") {
					return Response.json({ error: "message required" }, { status: 400, headers: corsHeaders() });
				}
				const headers: Record<string, string> = { "Content-Type": "application/json" };
				if (this.env.OPENCLAW_GATEWAY_TOKEN) headers.Authorization = `Bearer ${this.env.OPENCLAW_GATEWAY_TOKEN}`;

				const sessionKey = this.env.OPENCLAW_SESSION_KEY || "agent:main";
				const res = await fetch(`${gatewayUrl}/api/message`, {
					method: "POST",
					headers,
					body: JSON.stringify({ message, sessionKey }),
				});
				const result = await res.json();
				return Response.json(result, { headers: corsHeaders() });
			} catch {
				return Response.json({ error: "Gateway unavailable" }, { status: 502, headers: corsHeaders() });
			}
		}

		// GET /api/state
		if (url.pathname.endsWith("/api/state") && request.method === "GET") {
			return Response.json(publicState(this.current), { headers: corsHeaders() });
		}

		// GET /health
		if (url.pathname.endsWith("/health")) {
			return Response.json({
				ok: true,
				viewers: this.getViewers().length,
				agents: this.getAgents().length,
				state: this.current.state,
			}, { headers: corsHeaders() });
		}

		return new Response("Not found", { status: 404 });
	}

	// ── Hibernation WebSocket handlers ──

	async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): void {
		const tags = this.ctx.getTags(ws);
		const role = tags.includes("agent") ? "agent" : "viewer";
		const msg = typeof message === "string" ? message : new TextDecoder().decode(message);

		try {
			const data = JSON.parse(msg);
			if (data.type === "ping") {
				ws.send(JSON.stringify({ type: "pong" }));
				return;
			}
			if (role === "viewer") return; // viewers can only ping

			// Agent message — merge state
			mergeState(this.current, data);
			this.resetIdleTimer();
			this.broadcast();
		} catch { /* ignore malformed */ }
	}

	async webSocketClose(ws: WebSocket, code: number, reason: string, wasClean: boolean): void {
		const tags = this.ctx.getTags(ws);
		if (tags.includes("agent")) {
			this.checkAgentPresence();
		}
	}

	async webSocketError(ws: WebSocket, error: unknown): void {
		// Clean up on error — same as close
		const tags = this.ctx.getTags(ws);
		if (tags.includes("agent")) {
			this.checkAgentPresence();
		}
	}

	// ── Internal helpers ──

	private broadcast(): void {
		const msg = JSON.stringify({ type: "state", ...this.current });
		this.broadcastToViewers(msg);
	}

	private broadcastToViewers(msg: string): void {
		for (const ws of this.getViewers()) {
			try { ws.send(msg); } catch { /* hibernated or closed */ }
		}
	}

	private resetIdleTimer(): void {
		if (this.idleTimer) clearTimeout(this.idleTimer);
		if (this.current.state === "sleeping") return;
		this.idleTimer = setTimeout(() => {
			this.current.state = "idle";
			this.current.emotion = "neutral";
			this.current.amplitude = 0;
			this.current.text = null;
			this.current._ts = Date.now();
			this.broadcast();
		}, 30000);
	}

	private checkAgentPresence(): void {
		if (this.sleepTimer) clearTimeout(this.sleepTimer);
		if (this.getAgents().length === 0) {
			this.sleepTimer = setTimeout(() => {
				if (this.getAgents().length === 0 && this.current.state !== "sleeping") {
					this.current.state = "sleeping";
					this.current.emotion = "neutral";
					this.current.amplitude = 0;
					this.current._ts = Date.now();
					this.broadcast();
				}
			}, 5000);
		}
	}
}

function corsHeaders() {
	return {
		"Access-Control-Allow-Origin": "*",
		"Access-Control-Allow-Methods": "GET, POST, OPTIONS",
		"Access-Control-Allow-Headers": "Content-Type, Authorization",
	};
}
