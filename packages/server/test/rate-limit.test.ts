import { describe, expect, test } from "bun:test";
import { RateLimiter } from "../src/rate-limit.js";

describe("RateLimiter", () => {
	test("allows requests within limit", () => {
		const limiter = new RateLimiter(10);
		for (let i = 0; i < 10; i++) {
			expect(limiter.checkIp("1.2.3.4")).toBe(true);
		}
	});

	test("blocks requests over limit", () => {
		const limiter = new RateLimiter(5);
		for (let i = 0; i < 5; i++) limiter.checkIp("1.2.3.4");
		expect(limiter.checkIp("1.2.3.4")).toBe(false);
	});

	test("tracks IPs independently", () => {
		const limiter = new RateLimiter(2);
		limiter.checkIp("1.1.1.1");
		limiter.checkIp("1.1.1.1");
		expect(limiter.checkIp("1.1.1.1")).toBe(false);
		expect(limiter.checkIp("2.2.2.2")).toBe(true);
	});

	test("tracks WebSocket connections independently", () => {
		const limiter = new RateLimiter(2);
		const ws1 = {};
		const ws2 = {};
		limiter.checkWs(ws1);
		limiter.checkWs(ws1);
		expect(limiter.checkWs(ws1)).toBe(false);
		expect(limiter.checkWs(ws2)).toBe(true);
	});
});
