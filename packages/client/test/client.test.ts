import { describe, test, expect, beforeEach, mock, afterEach } from "bun:test";
import { OpenFaceClient } from "../src/index.js";
import type { StateUpdate, ClientOptions } from "../src/index.js";

// ── Mock fetch ──

let fetchMock: ReturnType<typeof mock>;
let lastFetchUrl: string;
let lastFetchInit: RequestInit;

function setupFetch(responseBody: unknown = { ok: true }, status = 200) {
	fetchMock = mock(async (url: string | URL | Request, init?: RequestInit) => {
		lastFetchUrl = typeof url === "string" ? url : url instanceof URL ? url.toString() : url.url;
		lastFetchInit = init || {};
		return new Response(JSON.stringify(responseBody), {
			status,
			headers: { "Content-Type": "application/json" },
		});
	});
	globalThis.fetch = fetchMock as typeof globalThis.fetch;
}

describe("constructor", () => {
	test("strips trailing slashes from baseUrl", () => {
		setupFetch();
		const client = new OpenFaceClient("http://localhost:9999///");
		expect((client as any).baseUrl).toBe("http://localhost:9999");
	});

	test("sets default timeout", () => {
		setupFetch();
		const client = new OpenFaceClient("http://localhost:9999");
		expect((client as any).timeout).toBe(5000);
	});

	test("accepts custom timeout", () => {
		setupFetch();
		const client = new OpenFaceClient("http://localhost:9999", { timeout: 10000 });
		expect((client as any).timeout).toBe(10000);
	});

	test("stores api key", () => {
		setupFetch();
		const client = new OpenFaceClient("http://localhost:9999", { apiKey: "secret" });
		expect((client as any).apiKey).toBe("secret");
	});

	test("api key defaults to null", () => {
		setupFetch();
		const client = new OpenFaceClient("http://localhost:9999");
		expect((client as any).apiKey).toBeNull();
	});
});

describe("setState", () => {
	let client: OpenFaceClient;

	beforeEach(() => {
		setupFetch({ ok: true });
		client = new OpenFaceClient("http://localhost:9999");
	});

	test("posts to /api/state", async () => {
		await client.setState({ state: "thinking" });
		expect(lastFetchUrl).toBe("http://localhost:9999/api/state");
		expect(lastFetchInit.method).toBe("POST");
	});

	test("sends state update as JSON body", async () => {
		await client.setState({ state: "speaking", emotion: "happy", amplitude: 0.8 });
		const body = JSON.parse(lastFetchInit.body as string);
		expect(body.state).toBe("speaking");
		expect(body.emotion).toBe("happy");
		expect(body.amplitude).toBe(0.8);
	});

	test("sets Content-Type header", async () => {
		await client.setState({ state: "idle" });
		const headers = lastFetchInit.headers as Record<string, string>;
		expect(headers["Content-Type"]).toBe("application/json");
	});

	test("includes Authorization header when apiKey set", async () => {
		const authClient = new OpenFaceClient("http://localhost:9999", { apiKey: "my-key" });
		await authClient.setState({ state: "idle" });
		const headers = lastFetchInit.headers as Record<string, string>;
		expect(headers.Authorization).toBe("Bearer my-key");
	});

	test("omits Authorization header when no apiKey", async () => {
		await client.setState({ state: "idle" });
		const headers = lastFetchInit.headers as Record<string, string>;
		expect(headers.Authorization).toBeUndefined();
	});

	test("returns response body", async () => {
		const result = await client.setState({ state: "idle" });
		expect(result).toEqual({ ok: true });
	});

	test("throws on non-ok response", async () => {
		setupFetch({ error: "bad" }, 400);
		client = new OpenFaceClient("http://localhost:9999");
		expect(client.setState({ state: "invalid" as any })).rejects.toThrow("Open Face API error: 400");
	});
});

describe("reset", () => {
	test("sends type: reset via setState", async () => {
		setupFetch({ ok: true });
		const client = new OpenFaceClient("http://localhost:9999");
		await client.reset();
		const body = JSON.parse(lastFetchInit.body as string);
		expect(body.type).toBe("reset");
	});
});

describe("getState", () => {
	test("fetches from /api/state", async () => {
		const stateData = { state: "idle", emotion: "neutral", amplitude: 0 };
		setupFetch(stateData);
		const client = new OpenFaceClient("http://localhost:9999");
		const result = await client.getState();
		expect(lastFetchUrl).toBe("http://localhost:9999/api/state");
		expect(lastFetchInit.method).toBeUndefined(); // GET has no method set
		expect(result).toEqual(stateData);
	});

	test("throws on non-ok response", async () => {
		setupFetch({}, 500);
		const client = new OpenFaceClient("http://localhost:9999");
		expect(client.getState()).rejects.toThrow("Open Face API error: 500");
	});
});

describe("health", () => {
	test("fetches from /health", async () => {
		const healthData = { status: "ok", uptime: 1234 };
		setupFetch(healthData);
		const client = new OpenFaceClient("http://localhost:9999");
		const result = await client.health();
		expect(lastFetchUrl).toBe("http://localhost:9999/health");
		expect(result).toEqual(healthData);
	});
});

describe("convenience methods", () => {
	let client: OpenFaceClient;

	beforeEach(() => {
		setupFetch({ ok: true });
		client = new OpenFaceClient("http://localhost:9999");
	});

	test("thinking() sets state to thinking", async () => {
		await client.thinking();
		const body = JSON.parse(lastFetchInit.body as string);
		expect(body.state).toBe("thinking");
	});

	test("thinking() accepts optional emotion", async () => {
		await client.thinking("confused");
		const body = JSON.parse(lastFetchInit.body as string);
		expect(body.state).toBe("thinking");
		expect(body.emotion).toBe("confused");
	});

	test("speaking() sets state, amplitude, and text", async () => {
		await client.speaking("Hello world", 0.9);
		const body = JSON.parse(lastFetchInit.body as string);
		expect(body.state).toBe("speaking");
		expect(body.amplitude).toBe(0.9);
		expect(body.text).toBe("Hello world");
	});

	test("speaking() uses default amplitude of 0.6", async () => {
		await client.speaking("Hi");
		const body = JSON.parse(lastFetchInit.body as string);
		expect(body.amplitude).toBe(0.6);
	});

	test("idle() sets state to idle with zero amplitude", async () => {
		await client.idle();
		const body = JSON.parse(lastFetchInit.body as string);
		expect(body.state).toBe("idle");
		expect(body.amplitude).toBe(0);
	});

	test("listening() sets state to listening", async () => {
		await client.listening();
		const body = JSON.parse(lastFetchInit.body as string);
		expect(body.state).toBe("listening");
	});
});

describe("abort timeout", () => {
	test("uses AbortController with configured timeout", async () => {
		// Verify the client sets up an abort signal
		setupFetch({ ok: true });
		const client = new OpenFaceClient("http://localhost:9999", { timeout: 100 });
		const result = await client.setState({ state: "idle" });
		expect(result).toEqual({ ok: true });
		// Confirm signal was passed
		expect(lastFetchInit.signal).toBeInstanceOf(AbortSignal);
	});
});
