import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

type FaceManifest = {
	version: string;
	official: Array<{
		id: string;
		file: string;
		name?: string;
	}>;
	community: Array<{
		id: string;
		file: string;
		name?: string;
	}>;
};

const ROOT = resolve(import.meta.dir, "../../..");
const MANIFEST_PATH = resolve(ROOT, "faces/index.json");
const BUILTIN_PATH = resolve(ROOT, "packages/element/src/builtin-faces.ts");
const SITE_INDEX_PATH = resolve(ROOT, "site/index.html");
const SITE_DASHBOARD_PATH = resolve(ROOT, "site/dashboard.html");
const SITE_TEST_PATH = resolve(ROOT, "site/test.html");
const SITE_BUILDER_PATH = resolve(ROOT, "site/builder.html");

function sorted(values: string[]): string[] {
	return [...values].sort((a, b) => a.localeCompare(b));
}

function readManifest(): FaceManifest {
	return JSON.parse(readFileSync(MANIFEST_PATH, "utf8")) as FaceManifest;
}

function allFaces(manifest: FaceManifest): Array<{ id: string; file: string; name?: string }> {
	const official = Array.isArray(manifest.official) ? manifest.official : [];
	const community = Array.isArray(manifest.community) ? manifest.community : [];
	return [...official, ...community];
}

function parseStringArrayLiteral(source: string, constName: string): string[] {
	const re = new RegExp(`const\\s+${constName}\\s*=\\s*\\[(.*?)\\];`, "s");
	const match = source.match(re);
	if (!match) return [];
	return [...match[1].matchAll(/"([^"]+)"/g)].map(m => m[1]);
}

function parseBuiltinIds(source: string): string[] {
	const blockMatch = source.match(/BUILTIN_FACES[\s\S]*?=\s*{([\s\S]*?)};/);
	if (!blockMatch) return [];
	const ids: string[] = [];
	for (const rawLine of blockMatch[1].split("\n")) {
		const line = rawLine.trim();
		const match = line.match(/^(?:"([^"]+)"|([a-z][a-z0-9-]*))\s*:/i);
		if (!match) continue;
		const id = match[1] ?? match[2];
		if (id) ids.push(id);
	}
	return ids;
}

describe("face manifest integrity", () => {
	test("lists unique ids and references existing files", () => {
		const manifest = readManifest();
		const faces = allFaces(manifest);
		const ids = faces.map(face => face.id);
		expect(new Set(ids).size).toBe(ids.length);

		for (const face of faces) {
			expect(face.id).toMatch(/^[a-z0-9-]+$/);
			const filePath = resolve(ROOT, "faces", face.file);
			expect(existsSync(filePath)).toBe(true);
		}
	});

	test("stays in sync with built-in face map", () => {
		const manifest = readManifest();
		const builtinSource = readFileSync(BUILTIN_PATH, "utf8");
		const manifestIds = sorted((Array.isArray(manifest.official) ? manifest.official : []).map(face => face.id));
		const builtinIds = sorted(parseBuiltinIds(builtinSource));
		expect(builtinIds).toEqual(manifestIds);
	});

	test("stays in sync with site pack controls", () => {
		// Site files are in a separate private repo — skip if not present
		if (!existsSync(SITE_BUILDER_PATH)) return;

		const manifest = readManifest();
		const siteDashboardSource = readFileSync(SITE_DASHBOARD_PATH, "utf8");
		const siteTestSource = readFileSync(SITE_TEST_PATH, "utf8");
		const siteBuilderSource = readFileSync(SITE_BUILDER_PATH, "utf8");

		const officialManifestIds = sorted((Array.isArray(manifest.official) ? manifest.official : []).map(face => face.id));
		const dashboardIds = sorted(parseStringArrayLiteral(siteDashboardSource, "DEFAULT_PACKS"));
		const testPageDefaultIds = sorted(parseStringArrayLiteral(siteTestSource, "DEFAULT_PACKS"));
		const builderFallbackIds = sorted(parseStringArrayLiteral(siteBuilderSource, "FALLBACK_PACKS"));

		expect(dashboardIds).toEqual(officialManifestIds);
		expect(testPageDefaultIds).toEqual(officialManifestIds);
		expect(builderFallbackIds).toEqual(["default"]);
		expect(siteBuilderSource).toContain('fetch("faces/index.json")');
	});
});
