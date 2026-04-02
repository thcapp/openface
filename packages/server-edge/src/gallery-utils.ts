export const GALLERY_TAGS = new Set([
	"minimal", "dark", "cute", "mechanical", "warm", "spooky", "retro",
	"accessible", "bold", "organic", "cosmic", "expressive",
]);

/** Slugify a name for use as gallery ID */
export function slugify(name: string): string {
	return name
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-|-$/g, "")
		.slice(0, 40);
}

/** Generate a short random suffix */
export function randomSuffix(len = 6): string {
	const bytes = new Uint8Array(len);
	crypto.getRandomValues(bytes);
	return Array.from(bytes).map((b) => b.toString(36).slice(-1)).join("");
}

/** Simple IP-based rate limit check: max 10 submissions per IP per hour */
export async function checkGalleryRateLimit(request: Request, env: { FACE_REGISTRY?: KVNamespace }): Promise<boolean> {
	if (!env.FACE_REGISTRY) return true; // no KV = no rate limit
	const ip = request.headers.get("CF-Connecting-IP") || request.headers.get("x-forwarded-for") || "unknown";
	const key = `ratelimit:gallery:${ip}`;
	try {
		const raw = await env.FACE_REGISTRY.get(key);
		const count = raw ? parseInt(raw, 10) : 0;
		if (count >= 10) return false;
		await env.FACE_REGISTRY.put(key, String(count + 1), { expirationTtl: 3600 });
		return true;
	} catch {
		return true; // fail open
	}
}

