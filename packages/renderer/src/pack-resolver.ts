/**
 * Shared appearance resolution.
 *
 * A face's appearance was stored as a bare string and treated everywhere as the name
 * of a bundled pack. That left published gallery designs and custom definitions with
 * nowhere to live: the hosted viewer read `record.face`, failed to match a builtin,
 * and silently rendered Default — presenting the wrong character as success.
 *
 * A reference can mean three different things, so it says which:
 *   builtin  - a pack in the shipped manifest, e.g. "default"
 *   gallery  - a published community entry, resolved through the gallery API
 *   snapshot - a definition pinned inline, so later edits elsewhere cannot change
 *              a live face underneath its owner
 *
 * Resolution never substitutes a different character on failure. A visible error is
 * recoverable; the wrong face presented as the right one is not.
 */

import type { FaceDefinition } from "./types.js";

export type PackRef =
	| { kind: "builtin"; id: string }
	| { kind: "gallery"; id: string }
	| { kind: "snapshot"; pack: FaceDefinition };

export type ResolveResult =
	| { ok: true; pack: FaceDefinition; ref: PackRef }
	| { ok: false; error: string; ref: PackRef | null };

/** Fetchers are injected so this module stays portable across browser and Workers. */
export interface PackSource {
	builtin(id: string): Promise<unknown>;
	gallery(id: string): Promise<unknown>;
}

const GALLERY_PREFIX = "gallery:";
/** Matches the username/id policy: lowercase alphanumeric and hyphens. */
const ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;

function isRecord(v: unknown): v is Record<string, unknown> {
	return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Structural validation. Pure — it never mutates or normalizes its input, so a
 * candidate can be checked before it is allowed to replace a draft, a stored
 * publication, or a live face.
 */
export function validatePack(input: unknown): { ok: true; pack: FaceDefinition } | { ok: false; errors: string[] } {
	const errors: string[] = [];

	if (!isRecord(input)) {
		return { ok: false, errors: ["pack must be an object"] };
	}

	const meta = input.meta;
	if (!isRecord(meta)) errors.push("meta is required");
	else if (typeof meta.name !== "string" || !meta.name.trim()) errors.push("meta.name must be a non-empty string");

	const palette = input.palette;
	if (!isRecord(palette)) errors.push("palette is required");

	const geometry = input.geometry;
	if (!isRecord(geometry)) {
		errors.push("geometry is required");
	} else {
		const eyes = geometry.eyes;
		if (!isRecord(eyes)) {
			errors.push("geometry.eyes is required");
		} else {
			if (typeof eyes.style !== "string") errors.push("geometry.eyes.style must be a string");
			for (const k of ["baseWidth", "baseHeight", "spacing"]) {
				const v = eyes[k];
				if (typeof v !== "number" || !Number.isFinite(v)) {
					errors.push(`geometry.eyes.${k} must be a finite number`);
				}
			}
		}
	}

	if (errors.length) return { ok: false, errors };
	return { ok: true, pack: input as unknown as FaceDefinition };
}

/**
 * Interpret a stored appearance value. Accepts the bare strings already in the
 * registry, so existing faces keep working, plus explicit refs and inline packs.
 */
export function parsePackRef(value: unknown): PackRef | null {
	if (typeof value === "string") {
		const trimmed = value.trim();
		if (!trimmed) return null;
		if (trimmed.startsWith(GALLERY_PREFIX)) {
			const id = trimmed.slice(GALLERY_PREFIX.length);
			return ID_PATTERN.test(id) ? { kind: "gallery", id } : null;
		}
		return ID_PATTERN.test(trimmed) ? { kind: "builtin", id: trimmed } : null;
	}

	if (!isRecord(value)) return null;

	if (value.kind === "builtin" || value.kind === "gallery") {
		const id = value.id;
		if (typeof id !== "string" || !ID_PATTERN.test(id)) return null;
		return { kind: value.kind, id };
	}

	if (value.kind === "snapshot") {
		const checked = validatePack(value.pack);
		return checked.ok ? { kind: "snapshot", pack: checked.pack } : null;
	}

	// A bare definition object, as exported by the builder.
	const asPack = validatePack(value);
	return asPack.ok ? { kind: "snapshot", pack: asPack.pack } : null;
}

/** Serialize a reference for storage. Snapshots are stored whole. */
export function serializePackRef(ref: PackRef): string | Record<string, unknown> {
	if (ref.kind === "builtin") return ref.id;
	if (ref.kind === "gallery") return `${GALLERY_PREFIX}${ref.id}`;
	return { kind: "snapshot", pack: ref.pack as unknown as Record<string, unknown> };
}

/** Resolve a reference to a definition, or explain why it could not be resolved. */
export async function resolvePack(ref: PackRef | null, source: PackSource): Promise<ResolveResult> {
	if (!ref) return { ok: false, error: "No appearance reference", ref: null };

	if (ref.kind === "snapshot") return { ok: true, pack: ref.pack, ref };

	let raw: unknown;
	try {
		raw = ref.kind === "gallery" ? await source.gallery(ref.id) : await source.builtin(ref.id);
	} catch (err) {
		return { ok: false, error: `Could not load ${ref.kind} pack "${ref.id}": ${(err as Error)?.message ?? "fetch failed"}`, ref };
	}

	if (raw === null || raw === undefined) {
		return { ok: false, error: `${ref.kind} pack "${ref.id}" not found`, ref };
	}

	// The gallery API returns the record with the definition under `pack`.
	const candidate = isRecord(raw) && isRecord(raw.pack) ? raw.pack : raw;

	const checked = validatePack(candidate);
	if (!checked.ok) {
		return { ok: false, error: `${ref.kind} pack "${ref.id}" is not a valid face: ${checked.errors.join("; ")}`, ref };
	}

	return { ok: true, pack: checked.pack, ref };
}
