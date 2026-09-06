import { expect, test } from "bun:test";
import { handleGallerySubmit } from "../src/gallery-routes.js";

test("publication links open the submitted face in the gallery's namespaced detail view", async () => {
	const values = new Map<string, string>();
	const registry = {
		async get(key: string, type?: string) {
			const value = values.get(key) ?? null;
			return type === "json" && value !== null ? JSON.parse(value) : value;
		},
		async put(key: string, value: string) { values.set(key, value); },
	} as unknown as KVNamespace;
	const response = await handleGallerySubmit(new Request("http://127.0.0.1/api/gallery", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			name: "Paper Lantern", author: "Test Artist", tags: ["organic"],
			pack: { meta: { name: "Paper Lantern" }, geometry: {}, palette: { states: { idle: "#E87C42" } } },
		}),
	}), { FACE_REGISTRY: registry, GITHUB_CLIENT_ID: "", GITHUB_CLIENT_SECRET: "" }, {});
	expect(response.status).toBe(201);
	const result = await response.json() as { id: string; url: string };
	const url = new URL(result.url);
	expect(url.origin).toBe("https://openface.live");
	expect(url.pathname).toBe("/gallery");
	expect(new URLSearchParams(url.hash.slice(1)).get("pack")).toBe(`gallery:${result.id}`);
	expect(values.has(`gallery:${result.id}`)).toBe(true);
});
