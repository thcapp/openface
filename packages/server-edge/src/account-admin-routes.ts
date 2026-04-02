export interface AccountAdminEnv {
	FACE_REGISTRY?: KVNamespace;
}

async function removeGalleryFromIndex(id: string, env: AccountAdminEnv): Promise<void> {
	if (!env.FACE_REGISTRY) return;
	const index = await env.FACE_REGISTRY.get("gallery:__index__", "json") as Record<string, unknown>[] | null;
	if (!index) return;
	const filtered = index.filter((p: Record<string, unknown>) => p.id !== id);
	await env.FACE_REGISTRY.put("gallery:__index__", JSON.stringify(filtered));
}

export async function handleAccountClaims(githubUser: string, env: AccountAdminEnv, cors: Record<string, string>): Promise<Response> {
	if (!env.FACE_REGISTRY) return Response.json([], { headers: cors });
	try {
		const list = await env.FACE_REGISTRY.list({ prefix: "face:" });
		const claims = [];
		for (const key of list.keys) {
			const data = await env.FACE_REGISTRY.get(key.name, "json") as Record<string, unknown> | null;
			if (data && data.githubUser === githubUser) {
				claims.push({
					username: data.username,
					face: data.face,
					apiKey: data.apiKey,
					createdAt: data.createdAt,
					config: data.config || null,
				});
			}
		}
		return Response.json(claims, { headers: cors });
	} catch {
		return Response.json([], { headers: cors });
	}
}

export async function handleAccountGallery(githubUser: string, env: AccountAdminEnv, cors: Record<string, string>): Promise<Response> {
	if (!env.FACE_REGISTRY) return Response.json([], { headers: cors });
	try {
		const index = await env.FACE_REGISTRY.get("gallery:__index__", "json") as Record<string, unknown>[] | null;
		const mine = (index || []).filter((p) => p.author === githubUser && p.authorType === "github");
		return Response.json(mine, { headers: cors });
	} catch {
		return Response.json([], { headers: cors });
	}
}

export async function handleAccountClaimDelete(githubUser: string, username: string, env: AccountAdminEnv, cors: Record<string, string>): Promise<Response> {
	if (!env.FACE_REGISTRY) return Response.json({ error: "No registry" }, { status: 503, headers: cors });
	try {
		const data = await env.FACE_REGISTRY.get(`face:${username}`, "json") as Record<string, unknown> | null;
		if (!data) return Response.json({ error: "Not found" }, { status: 404, headers: cors });
		if (data.githubUser !== githubUser) return Response.json({ error: "Not yours" }, { status: 403, headers: cors });
		await env.FACE_REGISTRY.delete(`face:${username}`);
		return Response.json({ ok: true, deleted: username }, { headers: cors });
	} catch {
		return Response.json({ error: "Failed" }, { status: 500, headers: cors });
	}
}

export async function handleAccountGalleryDelete(githubUser: string, id: string, env: AccountAdminEnv, cors: Record<string, string>): Promise<Response> {
	if (!env.FACE_REGISTRY) return Response.json({ error: "No registry" }, { status: 503, headers: cors });
	try {
		const record = await env.FACE_REGISTRY.get(`gallery:${id}`, "json") as Record<string, unknown> | null;
		if (!record) return Response.json({ error: "Not found" }, { status: 404, headers: cors });
		if (record.author !== githubUser || record.authorType !== "github") {
			return Response.json({ error: "Not yours" }, { status: 403, headers: cors });
		}
		await env.FACE_REGISTRY.delete(`gallery:${id}`);
		await removeGalleryFromIndex(id, env);
		return Response.json({ ok: true, deleted: id }, { headers: cors });
	} catch {
		return Response.json({ error: "Failed" }, { status: 500, headers: cors });
	}
}

export async function handleAccountRegenerateKey(githubUser: string, username: string, env: AccountAdminEnv, cors: Record<string, string>): Promise<Response> {
	if (!env.FACE_REGISTRY) return Response.json({ error: "No registry" }, { status: 503, headers: cors });
	try {
		const data = await env.FACE_REGISTRY.get(`face:${username}`, "json") as Record<string, unknown> | null;
		if (!data) return Response.json({ error: "Not found" }, { status: 404, headers: cors });
		if (data.githubUser !== githubUser) return Response.json({ error: "Not yours" }, { status: 403, headers: cors });
		const bytes = new Uint8Array(24);
		crypto.getRandomValues(bytes);
		const newKey = "oface_ak_" + Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
		data.apiKey = newKey;
		await env.FACE_REGISTRY.put(`face:${username}`, JSON.stringify(data));
		return Response.json({ ok: true, username, apiKey: newKey }, { headers: cors });
	} catch {
		return Response.json({ error: "Failed" }, { status: 500, headers: cors });
	}
}

export async function handleAdminGalleryList(env: AccountAdminEnv, cors: Record<string, string>): Promise<Response> {
	if (!env.FACE_REGISTRY) return Response.json([], { headers: cors });
	try {
		const index = await env.FACE_REGISTRY.get("gallery:__index__", "json") as unknown[] | null;
		return Response.json(index || [], { headers: cors });
	} catch {
		return Response.json([], { headers: cors });
	}
}

export async function handleAdminGalleryDelete(id: string, env: AccountAdminEnv, cors: Record<string, string>): Promise<Response> {
	if (!env.FACE_REGISTRY) return Response.json({ error: "No registry" }, { status: 503, headers: cors });
	try {
		await env.FACE_REGISTRY.delete(`gallery:${id}`);
		await removeGalleryFromIndex(id, env);
		return Response.json({ ok: true, deleted: id }, { headers: cors });
	} catch {
		return Response.json({ error: "Failed" }, { status: 500, headers: cors });
	}
}

export async function handleAdminGalleryUpdate(request: Request, id: string, env: AccountAdminEnv, cors: Record<string, string>): Promise<Response> {
	if (!env.FACE_REGISTRY) return Response.json({ error: "No registry" }, { status: 503, headers: cors });
	try {
		const updates = await request.json() as Record<string, unknown>;
		const raw = await env.FACE_REGISTRY.get(`gallery:${id}`, "json") as Record<string, unknown> | null;
		if (!raw) return Response.json({ error: "Not found" }, { status: 404, headers: cors });
		if (typeof updates.featured === "boolean") raw.featured = updates.featured;
		if (typeof updates.name === "string") raw.name = updates.name;
		if (typeof updates.description === "string") raw.description = updates.description;
		if (Array.isArray(updates.tags)) raw.tags = updates.tags;
		await env.FACE_REGISTRY.put(`gallery:${id}`, JSON.stringify(raw));
		const index = await env.FACE_REGISTRY.get("gallery:__index__", "json") as Record<string, unknown>[] | null;
		if (index) {
			const entry = index.find((p: Record<string, unknown>) => p.id === id);
			if (entry) {
				if (typeof updates.featured === "boolean") entry.featured = updates.featured;
				if (typeof updates.name === "string") entry.name = updates.name;
				if (typeof updates.description === "string") entry.description = updates.description;
				if (Array.isArray(updates.tags)) entry.tags = updates.tags;
				await env.FACE_REGISTRY.put("gallery:__index__", JSON.stringify(index));
			}
		}
		return Response.json({ ok: true, id }, { headers: cors });
	} catch {
		return Response.json({ error: "Failed" }, { status: 500, headers: cors });
	}
}

export async function handleAdminClaimsList(env: AccountAdminEnv, cors: Record<string, string>): Promise<Response> {
	if (!env.FACE_REGISTRY) return Response.json([], { headers: cors });
	try {
		const list = await env.FACE_REGISTRY.list({ prefix: "face:" });
		const claims = [];
		for (const key of list.keys) {
			const data = await env.FACE_REGISTRY.get(key.name, "json") as Record<string, unknown> | null;
			if (data) {
				claims.push({
					username: data.username,
					face: data.face,
					githubUser: data.githubUser || null,
					createdAt: data.createdAt,
				});
			}
		}
		return Response.json(claims, { headers: cors });
	} catch {
		return Response.json([], { headers: cors });
	}
}

export async function handleAdminClaimDelete(username: string, env: AccountAdminEnv, cors: Record<string, string>): Promise<Response> {
	if (!env.FACE_REGISTRY) return Response.json({ error: "No registry" }, { status: 503, headers: cors });
	try {
		await env.FACE_REGISTRY.delete(`face:${username}`);
		return Response.json({ ok: true, deleted: username }, { headers: cors });
	} catch {
		return Response.json({ error: "Failed" }, { status: 500, headers: cors });
	}
}

