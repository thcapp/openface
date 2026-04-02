/**
 * @openface/client — Control an Open Face from any agent.
 *
 * Works with both self-hosted Bun server and Cloudflare edge server.
 *
 * Usage:
 * ```ts
 * import { OpenFaceClient } from "@openface/client";
 * const face = new OpenFaceClient("https://face.example.com", { apiKey: "secret" });
 * await face.setState({ state: "thinking", emotion: "happy" });
 * await face.setState({ state: "speaking", amplitude: 0.7, text: "Hello!" });
 * await face.reset();
 * ```
 */

export interface StateUpdate {
	state?: string;
	emotion?: string;
	amplitude?: number;
	lookAt?: { x: number; y: number };
	color?: string | null;
	winkLeft?: number;
	winkRight?: number;
	text?: string | null;
	textDuration?: number;
	detail?: string | null;
	type?: "state" | "reset";
}

export interface ClientOptions {
	/** API key for authenticated endpoints. */
	apiKey?: string;
	/** Request timeout in ms (default 5000). */
	timeout?: number;
}

export class OpenFaceClient {
	private baseUrl: string;
	private apiKey: string | null;
	private timeout: number;

	constructor(baseUrl: string, options: ClientOptions = {}) {
		// Normalize: strip trailing slash
		this.baseUrl = baseUrl.replace(/\/+$/, "");
		this.apiKey = options.apiKey ?? null;
		this.timeout = options.timeout ?? 5000;
	}

	/** Push a partial state update. Fire-and-forget friendly. */
	async setState(update: StateUpdate): Promise<{ ok: boolean }> {
		const res = await this.post("/api/state", update);
		return res as { ok: boolean };
	}

	/** Reset face to defaults. */
	async reset(): Promise<{ ok: boolean }> {
		return this.setState({ type: "reset" });
	}

	/** Get current face state. */
	async getState(): Promise<Record<string, unknown>> {
		return this.get("/api/state");
	}

	/** Get server health. */
	async health(): Promise<Record<string, unknown>> {
		return this.get("/health");
	}

	// --- Convenience methods ---

	/** Set face to thinking state. */
	async thinking(emotion?: string): Promise<{ ok: boolean }> {
		return this.setState({ state: "thinking", emotion: emotion ?? undefined });
	}

	/** Set face to speaking with optional text. */
	async speaking(text?: string, amplitude = 0.6): Promise<{ ok: boolean }> {
		return this.setState({ state: "speaking", amplitude, text: text ?? undefined });
	}

	/** Set face to idle. */
	async idle(): Promise<{ ok: boolean }> {
		return this.setState({ state: "idle", amplitude: 0 });
	}

	/** Set face to listening. */
	async listening(): Promise<{ ok: boolean }> {
		return this.setState({ state: "listening" });
	}

	// --- HTTP helpers ---

	private async post(path: string, body: unknown): Promise<unknown> {
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), this.timeout);
		try {
			const res = await fetch(`${this.baseUrl}${path}`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {}),
				},
				body: JSON.stringify(body),
				signal: controller.signal,
			});
			if (!res.ok) {
				throw new Error(`Open Face API error: ${res.status} ${res.statusText}`);
			}
			return await res.json();
		} finally {
			clearTimeout(timer);
		}
	}

	private async get(path: string): Promise<Record<string, unknown>> {
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), this.timeout);
		try {
			const res = await fetch(`${this.baseUrl}${path}`, {
				signal: controller.signal,
			});
			if (!res.ok) {
				throw new Error(`Open Face API error: ${res.status} ${res.statusText}`);
			}
			return await res.json() as Record<string, unknown>;
		} finally {
			clearTimeout(timer);
		}
	}
}
