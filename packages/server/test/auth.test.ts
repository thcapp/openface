import { describe, expect, test } from "bun:test";
import { checkAuth, getClientIp } from "../src/auth.js";

function req(url: string, headers: Record<string, string> = {}): Request {
	return new Request(url, { headers });
}

describe("checkAuth", () => {
	test("allows all requests when API key is disabled", () => {
		expect(checkAuth("", req("http://localhost/api/chat"))).toBe(true);
	});

	test("accepts Bearer token", () => {
		expect(checkAuth("secret", req("http://localhost/api/chat", {
			authorization: "Bearer secret",
		}))).toBe(true);
	});

	test("accepts token query parameter", () => {
		expect(checkAuth("secret", req("http://localhost/api/chat?token=secret"))).toBe(true);
	});

	test("rejects missing/invalid credentials", () => {
		expect(checkAuth("secret", req("http://localhost/api/chat"))).toBe(false);
		expect(checkAuth("secret", req("http://localhost/api/chat", {
			authorization: "Bearer wrong",
		}))).toBe(false);
	});
});

describe("getClientIp", () => {
	test("prefers x-forwarded-for", () => {
		const ip = getClientIp(req("http://localhost/api/state", {
			"x-forwarded-for": "10.0.0.1",
			"cf-connecting-ip": "10.0.0.2",
		}));
		expect(ip).toBe("10.0.0.1");
	});

	test("falls back to cf-connecting-ip and unknown", () => {
		expect(getClientIp(req("http://localhost/api/state", {
			"cf-connecting-ip": "10.0.0.2",
		}))).toBe("10.0.0.2");
		expect(getClientIp(req("http://localhost/api/state"))).toBe("unknown");
	});
});
