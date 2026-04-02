import { getSession, getSessionToken, oauthEnabled } from "./auth-session.js";
import { GALLERY_TAGS, checkGalleryRateLimit, randomSuffix, slugify } from "./gallery-utils.js";

export interface GalleryRoutesEnv {
	FACE_REGISTRY?: KVNamespace;
	GITHUB_CLIENT_ID: string;
	GITHUB_CLIENT_SECRET: string;
}

interface GalleryRecord {
	id: string;
	name: string;
	author: string;
	authorType: "github" | "anonymous";
	description: string;
	tags: string[];
	pack: Record<string, unknown>;
	createdAt: string;
	downloads: number;
}

interface GalleryIndexEntry {
	id: string;
	name: string;
	author: string;
	authorType: "github" | "anonymous";
	description: string;
	tags: string[];
	createdAt: string;
	downloads: number;
}

/** POST /api/gallery — submit a pack to the community gallery */
export async function handleGallerySubmit(
	request: Request,
	env: GalleryRoutesEnv,
	cors: Record<string, string>,
): Promise<Response> {
	if (!env.FACE_REGISTRY) {
		return Response.json({ error: "Registry not configured" }, { status: 503, headers: cors });
	}

	const allowed = await checkGalleryRateLimit(request, env);
	if (!allowed) {
		return Response.json({ error: "Rate limit exceeded. Max 10 submissions per hour." }, { status: 429, headers: cors });
	}

	let authenticatedUser: string | null = null;
	if (oauthEnabled(env)) {
		const token = getSessionToken(request);
		if (token) {
			const session = await getSession(token, env);
			if (session) authenticatedUser = session.githubUser;
		}
	}

	let body: { name?: string; author?: string; description?: string; tags?: string[]; pack?: Record<string, unknown> };
	try {
		body = await request.json() as typeof body;
	} catch {
		return Response.json({ error: "Invalid JSON" }, { status: 400, headers: cors });
	}

	const name = (body.name || "").trim();
	if (name.length < 2 || name.length > 50) {
		return Response.json({ error: "Name must be 2-50 characters" }, { status: 400, headers: cors });
	}

	let author: string;
	let authorType: "github" | "anonymous";
	if (authenticatedUser) {
		author = authenticatedUser;
		authorType = "github";
	} else {
		author = (body.author || "").trim();
		if (author.length < 2 || author.length > 50) {
			return Response.json({ error: "Author must be 2-50 characters" }, { status: 400, headers: cors });
		}
		authorType = "anonymous";
	}

	const tags = Array.isArray(body.tags) ? body.tags.filter((tag) => typeof tag === "string" && GALLERY_TAGS.has(tag)) : [];
	if (tags.length === 0) {
		return Response.json({ error: "At least one valid tag is required" }, { status: 400, headers: cors });
	}

	const pack = body.pack;
	if (!pack || typeof pack !== "object" || !pack.meta || !pack.geometry || !pack.palette) {
		return Response.json({ error: "Pack must include meta, geometry, and palette" }, { status: 400, headers: cors });
	}

	const description = (body.description || "").trim().slice(0, 300);
	const slug = slugify(name);
	const id = slug ? `${slug}-${randomSuffix()}` : randomSuffix(10);

	const record: GalleryRecord = {
		id,
		name,
		author,
		authorType,
		description,
		tags,
		pack,
		createdAt: new Date().toISOString(),
		downloads: 0,
	};
	await env.FACE_REGISTRY.put(`gallery:${id}`, JSON.stringify(record));

	const indexEntry: GalleryIndexEntry = {
		id,
		name,
		author,
		authorType,
		description,
		tags,
		createdAt: record.createdAt,
		downloads: 0,
	};

	try {
		const rawIndex = await env.FACE_REGISTRY.get("gallery:__index__", "json") as unknown;
		const index = Array.isArray(rawIndex) ? rawIndex as GalleryIndexEntry[] : [];
		index.push(indexEntry);
		await env.FACE_REGISTRY.put("gallery:__index__", JSON.stringify(index));
	} catch {
		await env.FACE_REGISTRY.put("gallery:__index__", JSON.stringify([indexEntry]));
	}

	return Response.json({
		ok: true,
		id,
		url: `https://openface.live/packs#${id}`,
	}, { status: 201, headers: cors });
}

/** GET /api/gallery — list all gallery packs (metadata only, no full pack JSON) */
export async function handleGalleryList(env: GalleryRoutesEnv, cors: Record<string, string>): Promise<Response> {
	if (!env.FACE_REGISTRY) {
		return Response.json([], { headers: cors });
	}
	try {
		const rawIndex = await env.FACE_REGISTRY.get("gallery:__index__", "json") as unknown;
		return Response.json(Array.isArray(rawIndex) ? rawIndex : [], { headers: cors });
	} catch {
		return Response.json([], { headers: cors });
	}
}

/** GET /api/gallery/:id — get a single gallery pack (full pack JSON) */
export async function handleGalleryGet(id: string, env: GalleryRoutesEnv, cors: Record<string, string>): Promise<Response> {
	if (!id || id.length > 60) {
		return Response.json({ error: "Invalid gallery ID" }, { status: 400, headers: cors });
	}
	if (!env.FACE_REGISTRY) {
		return Response.json({ error: "Registry not configured" }, { status: 503, headers: cors });
	}

	try {
		const raw = await env.FACE_REGISTRY.get(`gallery:${id}`, "json") as GalleryRecord | null;
		if (!raw) {
			return Response.json({ error: "Not found" }, { status: 404, headers: cors });
		}

		const downloads = (typeof raw.downloads === "number" ? raw.downloads : 0) + 1;
		raw.downloads = downloads;
		env.FACE_REGISTRY.put(`gallery:${id}`, JSON.stringify(raw)).catch(() => {});

		return Response.json(raw, { headers: cors });
	} catch {
		return Response.json({ error: "Registry unavailable" }, { status: 503, headers: cors });
	}
}
