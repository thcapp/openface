import { describe, expect, test } from "bun:test";
import { getSessionToken, isAdmin, oauthEnabled } from "../src/auth-session.js";

function makeRequest(cookie: string): Request {
	return new Request("https://oface.io/auth/me", {
		headers: { Cookie: cookie },
	});
}

describe("oauthEnabled", () => {
	test("is true only when both credentials are present", () => {
		expect(oauthEnabled({ GITHUB_CLIENT_ID: "id", GITHUB_CLIENT_SECRET: "secret" })).toBe(true);
		expect(oauthEnabled({ GITHUB_CLIENT_ID: "", GITHUB_CLIENT_SECRET: "secret" })).toBe(false);
		expect(oauthEnabled({ GITHUB_CLIENT_ID: "id", GITHUB_CLIENT_SECRET: "" })).toBe(false);
	});
});

describe("getSessionToken", () => {
	test("extracts token from cookie header", () => {
		const token = "a".repeat(64);
		expect(getSessionToken(makeRequest(`foo=bar; oface_session=${token}; theme=dark`))).toBe(token);
	});

	test("returns null for missing or malformed tokens", () => {
		expect(getSessionToken(makeRequest("foo=bar"))).toBeNull();
		expect(getSessionToken(makeRequest("oface_session=short"))).toBeNull();
	});
});

describe("isAdmin", () => {
	test("recognizes the configured admin user", () => {
		expect(isAdmin({
			githubUser: "thcllc",
			githubAvatar: "",
			createdAt: new Date().toISOString(),
		})).toBe(true);
		expect(isAdmin({
			githubUser: "someone-else",
			githubAvatar: "",
			createdAt: new Date().toISOString(),
		})).toBe(false);
		expect(isAdmin(null)).toBe(false);
	});
});
