export type UsernameCheckReason = "invalid" | "reserved" | "blocked";

const RESERVED = new Set([
	// System paths
	"api", "health", "dashboard", "open-face.js", "faces", "_headers",
	"index.html", "favicon.ico", "robots.txt",
	// App routes
	"account", "admin", "app", "auth", "billing", "blog", "cdn", "claim", "config",
	"default", "demo", "dev", "docs", "face", "gallery", "help", "info", "login",
	"logout", "new", "null", "open", "openface", "ping", "public",
	"register", "root", "settings", "signup", "static", "status",
	"support", "system", "test", "undefined", "user", "users", "www", "ws",
	// Common names people would squat
	"agent", "ai", "assistant", "bot", "chat", "claude", "gpt", "gemini",
	"copilot", "siri", "alexa", "cortana", "jarvis", "hal", "samantha",
	"god", "jesus", "satan", "devil", "hitler", "nazi",
	"fuck", "shit", "ass", "dick", "porn", "sex", "xxx",
	"official", "verified", "staff", "mod", "moderator", "owner",
	"openai", "anthropic", "google", "microsoft", "apple", "meta", "facebook",
	"twitter", "x", "instagram", "tiktok", "youtube", "twitch", "discord",
	"github", "gitlab", "npm", "cloudflare",
]);

const BLOCKED_SUBSTRINGS = [
	"fuck", "shit", "cunt", "nigger", "nigga", "faggot", "retard", "porn", "hentai", "cock", "pussy", "bitch",
];

export function isReservedPathSegment(segment: string): boolean {
	return RESERVED.has(segment);
}

export function normalizeUsername(input: string | undefined | null): string {
	return (input || "").toLowerCase().replace(/[^a-z0-9-]/g, "");
}

export type UsernameValidation =
	| { ok: true; username: string }
	| { ok: false; status: 400 | 409; error: string; reason: UsernameCheckReason };

export function validateClaimUsername(raw: string | undefined | null): UsernameValidation {
	const username = normalizeUsername(raw);
	if (!username || username.length < 2 || username.length > 32) {
		return {
			ok: false,
			status: 400,
			error: "Username must be 2-32 chars, lowercase alphanumeric + hyphens",
			reason: "invalid",
		};
	}
	if (isReservedPathSegment(username)) {
		return { ok: false, status: 409, error: "Username is reserved", reason: "reserved" };
	}
	if (BLOCKED_SUBSTRINGS.some((w) => username.includes(w))) {
		return { ok: false, status: 400, error: "Username not allowed", reason: "blocked" };
	}
	if (username.startsWith("-") || username.endsWith("-") || username.includes("--")) {
		return {
			ok: false,
			status: 400,
			error: "Username cannot start/end with hyphens or contain double hyphens",
			reason: "invalid",
		};
	}
	return { ok: true, username };
}

