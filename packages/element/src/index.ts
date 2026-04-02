export { OpenFaceElement } from "./element.js";

// Re-export useful types from renderer
export type { FaceDefinition, FaceState, FaceEmotion, StateUpdate, StyleVariant } from "@openface/renderer";
export const OPEN_FACE_BUILD = "2026-04-01-research-backed-packs";

// Register the custom element
import { OpenFaceElement } from "./element.js";
if (!customElements.get("open-face")) {
	customElements.define("open-face", OpenFaceElement);
}

try {
	const w = window as Window & { __OPEN_FACE_BUILD__?: string };
	w.__OPEN_FACE_BUILD__ = OPEN_FACE_BUILD;
	console.info(`[open-face] build=${OPEN_FACE_BUILD}`);
} catch {
	// Non-browser context.
}
