# @openface/renderer

Canvas2D face rendering engine. Zero dependencies.

## Usage

```ts
import { FaceRenderer } from "@openface/renderer";

const renderer = new FaceRenderer({ canvas: myCanvas });
renderer.start();
renderer.setState({ state: "thinking", emotion: "happy" });
renderer.loadFace(faceDefinition); // from .face.json
```

## Architecture

```
FaceRenderer
  ├── interpolation.ts  — state interpolation engine (the "feel")
  │     └── emotion blending, intensity scaling, state transitions
  ├── draw.ts           — Canvas2D rendering
  │     ├── drawEyeShape()       — per-style eye geometry
  │     ├── computeSpecularCenter() — bounded specular placement
  │     └── drawFace()           — main render (background, eyes, mouth, brows, effects)
  ├── blink.ts          — blink system + micro-expressions + anticipation
  │     ├── updateBlink()         — per-state intervals, asymmetric speeds
  │     ├── updateMicro()         — two-tier saccades (jitter + glance)
  │     ├── triggerAnticipation() — pre-movement on state transitions
  │     └── updateAnticipation()  — decay anticipation offsets per frame
  ├── face-loader.ts    — .face.json parsing
  │     ├── applyFaceDefinition() — geometry, colors, animation params
  │     └── personality wiring    — energy→speed, warmth→bias, etc.
  ├── math.ts           — dlerp, saccadeLerp, color conversion
  ├── face-generator.ts — procedural pack generation (archetypes, palettes, interpolation)
  └── types.ts          — all shared types and enums
```

## Rendering Design

### Single-Path Philosophy

Every visual element is **one path, one fill call**. No threshold branching between render modes. No alpha crossfade between overlapping shapes.

**Eyes**: One continuous bezier per eye. Top half curves normally, bottom half compressed by squint. 12 eye styles via `drawEyeShape()` — always a single closed path. Supports per-eye overrides for heterochromia (independent style, pupil shape, color per eye).

**Mouth**: 10 mouth shapes, each with fill or line renderer controlled by `geometry.mouth.renderer`:
- `"fill"` (default): Filled bezier shape. "Closed" = near-zero height fill. Smile, waviness, asymmetry all modulate the same control points.
- `"line"` (Classic pack): Stroked bezier curve. Openness increases curve deflection + line width. The OG MVP look.

**Additional features**: Eyelash rendering (7 styles), nose rendering (6 styles), face decorations (10 types), and a dual-color system (per-feature fill and stroke colors).

**Why**: Threshold-based rendering (if open > 0.12 → fill, else → stroke) causes visual pops during transitions when the lerp crosses the threshold. Two overlapping shapes with crossfading alpha cause ghost artifacts. One path eliminates both classes of bugs.

### Eye Styles (12)

Each face pack defines `geometry.eyes.style`:

| Style | Shape | Used by |
|-------|-------|---------|
| `oval` | Bezier ellipse | Default, Corporate, Lobster, Colorblind |
| `round` | Circular with squint | Kawaii, Warm |
| `rectangle` | Rounded-corner rectangle | Robot, Cyberpunk |
| `dot` | Perfect circle | Zen, Halloween |
| `almond` | Tapered almond shape | — |
| `crescent` | Crescent/moon curve | — |
| `star` | Star-shaped eye | — |
| `heart` | Heart-shaped eye | — |
| `cat` | Vertically-slit cat eye | — |
| `cross` | Cross/plus shape | — |
| `diamond` | Diamond/rhombus | — |
| `semicircle` | Half-circle | — |

Face definition eye styles are strict: unsupported values throw at load time.

### Pupil Shapes (10)

Set via `geometry.eyes.pupil.shape`: circle, slit, star, heart, diamond, cross, ring, flower, spiral, none.

### Specular Shapes (8)

Set via `geometry.eyes.specular.shape`: circle, star, crescent, dual, line, cross, ring, none.

### Mouth Shapes (10)

Set via `geometry.mouth.shape`: curve, cat, slit, zigzag, pixel, circle, fang, smirk, wave, none.

### Head Shapes (12)

Set via `geometry.head.shape`: fullscreen, circle, rounded, oval, squircle, hexagon, diamond, egg, pill, shield, cloud, octagon.

### Brow Styles (8)

Set via `geometry.brows.style`: line, flat, block, none, arch, angled, thick, dot.

### Eyelash Styles (7)

Set via `geometry.eyes.eyelash.style`: none, simple, thick, wing, bottom, full, spider.

### Nose Styles (6)

Set via `geometry.nose.style`: none, dot, line, triangle, L, button.

### Face Decorations (10)

Set via `geometry.decorations[]`: freckles, tears, sweat, scar, stripes, sparkles, bandaid, hearts, stars, lines.

### Per-Eye Overrides

Heterochromia support via `geometry.eyes.left` and `geometry.eyes.right` — each can override style, pupil shape, and color independently.

### Dual-Color System

Per-feature fill and stroke colors via `palette.eyes.fill`/`palette.eyes.stroke`, `palette.mouth.fill`/`palette.mouth.stroke`, etc.

### Pupil + Specular Separation

Pupil and specular reflections are independent systems:
- pupil: anatomical, usually darker, higher gaze follow (`eyes.pupil.lookFollow`)
- specular: lighting cue, usually bright, lower gaze follow (`eyes.specular.lookFollow`)

Specular position is driven by pack-configured base shift plus bounded gaze displacement:
- base: `specular.shiftX/shiftY` (normalized 0-1 within eye bounds)
- gaze offset: `lookX/lookY` scaled by `specular.lookFollow`
- final center is clamped to eye bounds

`ctx.clip()` on the eye path is kept as a hardware safety net. Specular shapes match eye style (rounded-rect for rectangles, ellipse for curved styles).

Deprecated keys are rejected at load time:
- `geometry.eyes.highlight` → use `geometry.eyes.specular`
- `palette.highlight` → use `palette.specular`
- `geometry.mouth.speakingFill` → use `geometry.mouth.rendererByState.speaking = "fill"`

### Animation Pipeline

Each frame:

```
1. triggerAnticipation()  — queue pre-movement if state just changed
2. updateAnticipation()   — decay anticipation offsets
3. interpolate()          — proportional feature system
   ├── state targets      — base mouth, brows, eyes per state
   │   └── eye base scales come from `geometry.eyes.stateScales`
   ├── emotion deltas     — additive, scaled by intensity, blended if compound
   ├── idle variations    — emotion-specific oscillations (tremble, bounce, droop)
   ├── proportional coupling:
   │   ├── brows respond to eye scale
   │   ├── slope responds to squint + brow direction
   │   ├── blush tracks happiness
   │   ├── confusion drives brow asymmetry
   │   ├── gaze parallax (eyes compress sideways)
   │   ├── per-eye gaze asymmetry
   │   └── squint reduces lid
   ├── soft limiting (tanh compression, no hard clips)
   ├── micro-expressions  — jitter + glance offsets
   └── blink              — per-state intervals, asymmetric close/open
4. drawFace()             — render everything from interpolated values
```

### Unified Transitions

When state or emotion changes, all lerp speeds get a 1.5x boost for 300ms. This makes the entire expression morph together — no more brows arriving before eyes, or mouth settling before tilt. After 300ms, speeds return to normal for smooth idle behavior.

### Soft Limiting

Parameters use `softLimit()` (tanh-based) instead of hard `Math.max/min` clamps. Values compress smoothly near boundaries — a parameter approaching its limit decelerates naturally instead of hitting a wall. This prevents visual "popping" when effects stack.

### Personality Parameters

Face packs define personality traits that modulate the animation:

| Trait | Maps to | Range |
|-------|---------|-------|
| `energy` | `animSpeed` — animation speed multiplier | 0.6x – 1.4x |
| `expressiveness` | `animRange` — parameter range multiplier | 0.4x – 1.6x |
| `warmth` | `warmthBias` — happiness baseline offset | -0.15 – +0.15 |
| `stability` | `microFreqMult` — micro-expression frequency | 0.5x – 2.0x |
| `playfulness` | `playMult` — asymmetry and sway amplitude | 0.5x – 1.5x |

### Color Blending

Emotion colors blend with state colors (not override):

```
finalColor = lerp(stateColor, emotionColor, emotionColorBlend * intensity)
```

Per-pack `emotionColorBlend`:
- 0.3: strong identity packs (Cyberpunk, Robot) — state colors dominate
- 0.5: balanced (Default, Classic, Zen)
- 0.7: expressive (Kawaii, Warm) — emotions show through

## Key Features

- 12 eye styles, 10 pupil shapes, 8 specular shapes with per-style containment math
- Single-path bezier mouth (zero ghost artifacts)
- Saccade-aware gaze (large jumps snap, small adjustments drift)
- Anticipation (50-120ms pre-movement before state transitions)
- Two-tier micro-saccades (barely-visible jitter + deliberate glances)
- Per-state blink intervals with asymmetric close/open speeds
- Compound emotion blending with intensity scaling
- Personality-driven animation behavior
- Frame-rate independent (dlerp adjusted for delta time)
- 11 states, 13 emotions, continuous expression space

## Face Generator

`face-generator.ts` — procedural face pack generation from high-level inputs. Produces complete `.face.json` packs without manual authoring.

### Entry Points

| Function | Input | Output |
|----------|-------|--------|
| `generateFromArchetype(archetype, variation?)` | One of 7 archetype templates + optional variation (0-1) | Full `FaceDefinition` |
| `generateFromPersonality(personality, name?)` | 5 personality traits (energy, expressiveness, warmth, stability, playfulness) | Full `FaceDefinition` |
| `generateFromDescription(name, description)` | Natural language name + description string | Full `FaceDefinition` |
| `interpolatePacks(a, b, t)` | Two `FaceDefinition` packs + blend factor (0-1) | Blended `FaceDefinition` |

### Palette Generation

`generateFullPalette(seedHue)` produces 24 colors (11 state colors + 13 emotion colors) from a single hue. State colors use complementary/analogous relationships; emotion colors follow psychological associations (warm hues for happy/excited, cool for sad/concerned).

### Archetypes

7 built-in templates via the `ARCHETYPES` constant:

| Archetype | Style | Character |
|-----------|-------|-----------|
| Friendly | Round eyes, warm palette | Approachable, expressive |
| Serious | Oval eyes, muted tones | Professional, composed |
| Cute | Round eyes, pastels | High expressiveness, playful |
| Edgy | Rectangle eyes, high contrast | Fast, intense |
| Minimal | Dot eyes, monochrome | Calm, subtle |
| Retro | Oval eyes, CRT palette | Nostalgic, terminal |
| Organic | Oval eyes, earth tones | Natural, grounded |

### Quality Validation

`computeEnergy(pack)` scores a generated pack (0-1) by checking proportional relationships, contrast ratios, and parameter coherence. Higher energy = higher quality. Useful for filtering or ranking generated packs.

### Proportional System

25 "genes" (normalized 0-1 values) expand into 150+ parameters through the proportional system. Personality traits map to geometry: high energy → larger eyes, wider mouth; high warmth → rounder shapes, warmer hue shifts; high stability → tighter state scales.
