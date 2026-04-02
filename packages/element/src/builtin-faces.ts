import defaultFace from "../../../faces/default.face.json";
import type { FaceDefinition } from "@openface/renderer";

export const BUILTIN_FACES: Record<string, FaceDefinition> = {
	default: defaultFace as FaceDefinition,
};
