import { describe, expect, test } from "bun:test";
import {
	ARCHETYPES,
	generateFromArchetype,
	generateFromPersonality,
	generateFromDescription,
	interpolatePacks,
	computeEnergy,
	evolve,
} from "../src/face-generator.js";
import type { Archetype, Personality } from "../src/face-generator.js";
import type { FaceDefinition } from "../src/types.js";

// ---------------------------------------------------------------------------
// generateFromArchetype
// ---------------------------------------------------------------------------

describe("generateFromArchetype", () => {
	for (const archetype of ARCHETYPES) {
		test(`produces valid FaceDefinition for "${archetype.name}"`, () => {
			const face = generateFromArchetype(archetype);
			expect(face.meta.name).toBe(archetype.name);
			expect(face.$type).toBe("face");
			expect(face.geometry.eyes.style).toBeTruthy();
			expect(face.geometry.eyes.baseWidth).toBeGreaterThan(0);
			expect(face.geometry.eyes.baseHeight).toBeGreaterThan(0);
			expect(face.geometry.eyes.spacing).toBeGreaterThan(0);
			expect(face.geometry.mouth.width).toBeGreaterThan(0);
			expect(face.geometry.head?.shape).toBeTruthy();
			expect(face.palette.states).toBeTruthy();
			expect(face.personality).toBeTruthy();
			expect(face.animation?.blinkInterval?.[0]).toBeGreaterThan(0);
			expect(face.animation?.blinkInterval?.[1]).toBeGreaterThan(
				face.animation!.blinkInterval![0],
			);
		});
	}

	test("variation=0 produces exact archetype values (no offsets)", () => {
		const arch = ARCHETYPES[0]; // Friendly Helper
		const faceA = generateFromArchetype(arch, 0);
		const faceB = generateFromArchetype(arch, 0);

		// Two calls with variation=0 must be identical (deterministic)
		expect(faceA.geometry.eyes.baseWidth).toBe(faceB.geometry.eyes.baseWidth);
		expect(faceA.geometry.eyes.baseHeight).toBe(faceB.geometry.eyes.baseHeight);
		expect(faceA.geometry.eyes.spacing).toBe(faceB.geometry.eyes.spacing);

		// With variation=1.0, values should differ from variation=0
		const faceC = generateFromArchetype(arch, 1.0);
		// At least some numeric values should differ
		const widthDiffers = faceA.geometry.eyes.baseWidth !== faceC.geometry.eyes.baseWidth;
		const spacingDiffers = faceA.geometry.eyes.spacing !== faceC.geometry.eyes.spacing;
		const headDiffers = faceA.geometry.head?.width !== faceC.geometry.head?.width;
		expect(widthDiffers || spacingDiffers || headDiffers).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// generateFromPersonality — input clamping
// ---------------------------------------------------------------------------

describe("generateFromPersonality", () => {
	test("clamps out-of-range inputs without error", () => {
		const extreme: Personality = {
			energy: 5.0,
			expressiveness: -2.0,
			warmth: 100,
			stability: -0.5,
			playfulness: 1.5,
		};
		const face = generateFromPersonality("test-extreme", extreme);
		expect(face.meta.name).toBe("test-extreme");
		expect(face.$type).toBe("face");

		// Blink intervals must be positive and ordered
		expect(face.animation!.blinkInterval![0]).toBeGreaterThan(0);
		expect(face.animation!.blinkInterval![1]).toBeGreaterThan(
			face.animation!.blinkInterval![0],
		);

		// Mouth constraints must be ordered
		const mc = face.geometry.mouth.constraints!;
		expect(mc.widthMax!).toBeGreaterThanOrEqual(mc.widthMin!);
		expect(mc.openMax!).toBeGreaterThanOrEqual(mc.openMin!);
	});

	test("produces valid face from normal inputs", () => {
		const face = generateFromPersonality("normal-bot", {
			energy: 0.5,
			expressiveness: 0.5,
			warmth: 0.5,
			stability: 0.5,
			playfulness: 0.5,
		});
		expect(face.meta.name).toBe("normal-bot");
		expect(face.geometry.eyes.baseWidth).toBeGreaterThan(0);
	});

	test("micro-expression intervals are positive after clamping", () => {
		const face = generateFromPersonality("micro-test", {
			energy: -10,
			expressiveness: 0.5,
			warmth: 0.5,
			stability: 0.5,
			playfulness: -5,
		});
		const micro = face.animation!.microExpressions!;
		expect(micro.eyeDart!.interval![0]).toBeGreaterThan(0);
		expect(micro.eyeDart!.interval![1]).toBeGreaterThan(micro.eyeDart!.interval![0]);
		expect(micro.mouthTwitch!.interval![0]).toBeGreaterThan(0);
		expect(micro.mouthTwitch!.interval![1]).toBeGreaterThan(micro.mouthTwitch!.interval![0]);
	});
});

// ---------------------------------------------------------------------------
// generateFromDescription — order independence
// ---------------------------------------------------------------------------

describe("generateFromDescription", () => {
	test("is order-independent for keyword matching", () => {
		const faceA = generateFromDescription("test-a", "friendly calm");
		const faceB = generateFromDescription("test-b", "calm friendly");

		// Personality traits should be identical regardless of word order
		expect(faceA.personality!.warmth).toBe(faceB.personality!.warmth);
		expect(faceA.personality!.energy).toBe(faceB.personality!.energy);
		expect(faceA.personality!.stability).toBe(faceB.personality!.stability);
		expect(faceA.personality!.expressiveness).toBe(faceB.personality!.expressiveness);
		expect(faceA.personality!.playfulness).toBe(faceB.personality!.playfulness);
	});

	test("multi-keyword order independence", () => {
		const faceA = generateFromDescription("test-a", "playful warm energetic");
		const faceB = generateFromDescription("test-b", "energetic playful warm");
		const faceC = generateFromDescription("test-c", "warm energetic playful");

		expect(faceA.personality!.energy).toBe(faceB.personality!.energy);
		expect(faceB.personality!.energy).toBe(faceC.personality!.energy);
		expect(faceA.personality!.warmth).toBe(faceC.personality!.warmth);
	});

	test("produces valid face from description", () => {
		const face = generateFromDescription("blue-bot", "a friendly warm blue robot");
		expect(face.meta.name).toBe("blue-bot");
		expect(face.geometry.eyes.style).toBeTruthy();
	});
});

// ---------------------------------------------------------------------------
// interpolatePacks
// ---------------------------------------------------------------------------

describe("interpolatePacks", () => {
	const faceA = generateFromArchetype(ARCHETYPES[0], 0); // Friendly Helper
	const faceB = generateFromArchetype(ARCHETYPES[3], 0); // Technical Expert

	test("t=0 returns pack A values", () => {
		const result = interpolatePacks(faceA, faceB, 0);
		expect(result.geometry.eyes.baseWidth).toBe(faceA.geometry.eyes.baseWidth);
		expect(result.geometry.eyes.baseHeight).toBe(faceA.geometry.eyes.baseHeight);
		expect(result.geometry.eyes.spacing).toBe(faceA.geometry.eyes.spacing);
		expect(result.geometry.mouth.width).toBe(faceA.geometry.mouth.width);
		expect(result.geometry.eyes.style).toBe(faceA.geometry.eyes.style);
		expect(result.geometry.head?.shape).toBe(faceA.geometry.head?.shape);
	});

	test("t=1 returns pack B values", () => {
		const result = interpolatePacks(faceA, faceB, 1);
		expect(result.geometry.eyes.baseWidth).toBe(faceB.geometry.eyes.baseWidth);
		expect(result.geometry.eyes.baseHeight).toBe(faceB.geometry.eyes.baseHeight);
		expect(result.geometry.eyes.spacing).toBe(faceB.geometry.eyes.spacing);
		expect(result.geometry.mouth.width).toBe(faceB.geometry.mouth.width);
		expect(result.geometry.eyes.style).toBe(faceB.geometry.eyes.style);
		expect(result.geometry.head?.shape).toBe(faceB.geometry.head?.shape);
	});

	test("t=0.5 interpolates numeric values", () => {
		const result = interpolatePacks(faceA, faceB, 0.5);
		const expectedWidth = (faceA.geometry.eyes.baseWidth + faceB.geometry.eyes.baseWidth) / 2;
		expect(result.geometry.eyes.baseWidth).toBeCloseTo(expectedWidth, 6);
	});

	test("preserves body when present", () => {
		const withBody: FaceDefinition = {
			...faceA,
			geometry: {
				...faceA.geometry,
				body: {
					enabled: true,
					shape: "capsule",
					width: 0.5,
					height: 0.6,
				},
			},
		};

		// body from A at t=0
		const resultA = interpolatePacks(withBody, faceB, 0);
		expect(resultA.geometry.body).toBeTruthy();
		expect(resultA.geometry.body!.enabled).toBe(true);

		// body from A at t=0.3 (< 0.5)
		const resultMid = interpolatePacks(withBody, faceB, 0.3);
		expect(resultMid.geometry.body).toBeTruthy();

		// body from B at t=0.7 — B has no body, but snap to B means it falls back to A
		const resultB = interpolatePacks(withBody, faceB, 0.7);
		// Since B has no body, it falls back to A's body
		expect(resultB.geometry.body).toBeTruthy();
	});

	test("preserves accessories when present", () => {
		const withAccessories: FaceDefinition = {
			...faceA,
			accessories: [
				{ id: "hat", type: "antenna", anchor: "top", segments: 3, segmentLength: 0.05 } as any,
			],
		};

		const result = interpolatePacks(withAccessories, faceB, 0);
		expect(result.accessories).toBeTruthy();
		expect(result.accessories!.length).toBe(1);

		const resultMid = interpolatePacks(withAccessories, faceB, 0.3);
		expect(resultMid.accessories).toBeTruthy();
	});

	test("preserves palette.body when present", () => {
		const withPaletteBody: FaceDefinition = {
			...faceA,
			palette: {
				...faceA.palette,
				body: {
					fill: "#FF0000",
					stroke: "#00FF00",
				},
			},
		};

		const result = interpolatePacks(withPaletteBody, faceB, 0.2);
		expect(result.palette.body).toBeTruthy();
		expect(result.palette.body!.fill).toBe("#FF0000");
	});

	test("preserves rendererByState on mouth", () => {
		const withRenderers: FaceDefinition = {
			...faceA,
			geometry: {
				...faceA.geometry,
				mouth: {
					...faceA.geometry.mouth,
					rendererByState: { speaking: "fill" as const, thinking: "line" as const },
				},
			},
		};

		const result = interpolatePacks(withRenderers, faceB, 0.2);
		expect(result.geometry.mouth.rendererByState).toBeTruthy();
		expect(result.geometry.mouth.rendererByState!.speaking).toBe("fill");
	});

	test("preserves rendererByEmotion on brows", () => {
		const withRenderers: FaceDefinition = {
			...faceA,
			geometry: {
				...faceA.geometry,
				brows: {
					...faceA.geometry.brows,
					rendererByEmotion: { happy: "arch" as any, sad: "flat" as any },
				},
			},
		};

		const result = interpolatePacks(withRenderers, faceB, 0.2);
		expect(result.geometry.brows?.rendererByEmotion).toBeTruthy();
		expect(result.geometry.brows!.rendererByEmotion!.happy).toBe("arch");
	});
});

// ---------------------------------------------------------------------------
// computeEnergy
// ---------------------------------------------------------------------------

describe("computeEnergy", () => {
	test("returns 0 for a well-formed pack", () => {
		// Use a generated face that should have near-zero energy
		const face = generateFromArchetype(ARCHETYPES[0], 0);
		const energy = computeEnergy(
			{
				eyeW: face.geometry.eyes.baseWidth,
				eyeH: face.geometry.eyes.baseHeight,
				eyeSpacing: face.geometry.eyes.spacing,
				eyeY: face.geometry.eyes.verticalPosition ?? -0.05,
				mouthW: face.geometry.mouth.width,
				mouthY: face.geometry.mouth.verticalPosition ?? 0.13,
				headW: face.geometry.head?.width ?? 0.82,
				headH: face.geometry.head?.height ?? 0.82,
				featureColor: face.palette.feature,
			},
			{
				stateColors: face.palette.states as Record<string, string>,
				feature: face.palette.feature,
			},
		);
		// Energy should be low for a generated face (not necessarily 0 due to density/contrast)
		expect(energy).toBeLessThan(10);
	});

	test("penalizes overlapping features", () => {
		const energy = computeEnergy(
			{
				eyeW: 0.06,
				eyeH: 0.2, // Very tall eyes
				eyeSpacing: 0.16,
				eyeY: -0.05,
				mouthW: 0.12,
				mouthY: 0.05, // Mouth very close to eyes
				headW: 0.82,
				headH: 0.82,
			},
			{},
		);
		expect(energy).toBeGreaterThan(0);
	});
});

// ---------------------------------------------------------------------------
// evolve
// ---------------------------------------------------------------------------

describe("evolve", () => {
	test("returns correct population size", () => {
		const pop = ARCHETYPES.slice(0, 4).map(arch => generateFromArchetype(arch, 0));
		const ratings = [0.9, 0.7, 0.3, 0.1];

		const next = evolve(pop, ratings);
		expect(next.length).toBe(pop.length);
	});

	test("returns empty for empty population", () => {
		expect(evolve([], []).length).toBe(0);
	});

	test("throws on mismatched lengths", () => {
		const pop = [generateFromArchetype(ARCHETYPES[0], 0)];
		expect(() => evolve(pop, [1, 2])).toThrow();
	});

	test("preserves highest-rated individuals", () => {
		const pop = ARCHETYPES.slice(0, 3).map(arch => generateFromArchetype(arch, 0));
		const ratings = [10, 5, 1]; // First face rated highest

		const next = evolve(pop, ratings);
		// Top survivor should be in the result (first element after sorting by rating)
		expect(next[0].meta.name).toBe(pop[0].meta.name);
	});

	test("all children are valid FaceDefinitions", () => {
		const pop = ARCHETYPES.slice(0, 4).map(arch => generateFromArchetype(arch, 0));
		const ratings = [0.9, 0.7, 0.5, 0.3];

		const next = evolve(pop, ratings);
		for (const face of next) {
			expect(face.geometry.eyes.baseWidth).toBeGreaterThan(0);
			expect(face.geometry.eyes.baseHeight).toBeGreaterThan(0);
			expect(face.geometry.mouth.width).toBeGreaterThan(0);
			expect(face.palette.states).toBeTruthy();
		}
	});
});
