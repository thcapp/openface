# open-face

openface.live — Animated faces for AI agents.

## Architecture

Bun monorepo with workspaces. Port **9999**. GitHub: thcapp/openface.

| Package | Path | Description |
|---------|------|-------------|
| `@openface/renderer` | `packages/renderer/` | Canvas2D engine + procedural face generator (zero deps) |
| `@openface/element` | `packages/element/` | `<open-face>` web component |
| `@openface/server` | `packages/server/` | Bun WebSocket relay |
| `@openface/client` | `packages/client/` | Agent client library |
| `@openface/mcp` | `packages/mcp/` | MCP server (8 tools) |
| `@openface/server-edge` | `packages/server-edge/` | Cloudflare Workers + Durable Objects |
| `@openface/filter` | `packages/filter/` | Output filtering + normalization |
| `@openface/plugin` | `packages/plugin/` | OpenClaw lifecycle plugin |
| Protocol | `protocol/v1/` | JSON Schemas + spec |
| Face packs | `faces/` | 1 official + 15 community .face.json definitions |
| Site | `site/` | openface.live (landing page) |
| Research | `docs/` | 24 research/design reports |

## Expression System

- **11 states**: idle, thinking, speaking, listening, reacting, puzzled, alert, working, sleeping, waiting, loading
- **13 emotions**: neutral, happy, sad, confused, excited, concerned, surprised, playful, frustrated, skeptical, determined, embarrassed, proud
- **12 eye styles**: oval, round, rectangle, dot, almond, crescent, star, heart, cat, cross, diamond, semicircle
- **10 pupil shapes**: circle, slit, star, heart, diamond, cross, ring, flower, spiral, none
- **8 specular shapes**: circle, star, crescent, dual, line, cross, ring, none
- **10 mouth shapes**: curve, cat, slit, zigzag, pixel, circle, fang, smirk, wave, none
- **12 head shapes**: fullscreen, circle, rounded, oval, squircle, hexagon, diamond, egg, pill, shield, cloud, octagon
- **8 brow styles**: line, flat, block, none, arch, angled, thick, dot
- **7 eyelash styles**: none, simple, thick, wing, bottom, full, spider
- **6 nose styles**: none, dot, line, triangle, L, button
- **10 face decorations**: freckles, tears, sweat, scar, stripes, sparkles, bandaid, hearts, stars, lines
- **Per-eye overrides**: heterochromia (different style, pupil, color per eye)
- **Dual-color system**: per-feature fill and stroke colors
- **Protocol fields**: intensity (0-1), progress (0-1), emotionSecondary + emotionBlend
- **Visual params**: squint, mouthWidth, mouthAsymmetry
- **Personality**: energy, expressiveness, warmth, stability, playfulness → modulate animation speed, range, bias, micro-frequency, sway

## Renderer Design

Single-path bezier rendering — no threshold branches, no render pops:
- Eyes: 12 styles (oval, round, rectangle, dot, almond, crescent, star, heart, cat, cross, diamond, semicircle) — all single closed bezier paths
- Pupils: 10 shapes (circle, slit, star, heart, diamond, cross, ring, flower, spiral, none)
- Speculars: 8 shapes (circle, star, crescent, dual, line, cross, ring, none)
- Mouth: 10 shapes (curve, cat, slit, zigzag, pixel, circle, fang, smirk, wave, none) — fill or line renderer per state/emotion
- Brows: 8 styles (line, flat, block, none, arch, angled, thick, dot)
- Eyelashes: 7 styles (none, simple, thick, wing, bottom, full, spider)
- Noses: 6 styles (none, dot, line, triangle, L, button)
- Decorations: 10 types (freckles, tears, sweat, scar, stripes, sparkles, bandaid, hearts, stars, lines)
- Head: 12 shapes (fullscreen, circle, rounded, oval, squircle, hexagon, diamond, egg, pill, shield, cloud, octagon)
- Per-eye overrides: heterochromia support (independent style, pupil, color per eye)
- Dual-color system: per-feature fill and stroke colors
- Highlights: bounded displacement (25% of eye dims), hardware clip, per-style shapes
- Colors: procedural emotion shifts on theme's own state color — no foreign color injection

## Face Generator

`face-generator.ts` (1600+ lines) — procedural face pack generation:
- HSL color utilities + palette generator (seed hue → 24 colors)
- Proportional system (25 genes → 150 params)
- Personality → geometry mapping
- 7 archetype templates (friendly, serious, cute, edgy, minimal, retro, organic)
- Energy function (quality validator for generated packs)
- Pack interpolation (blend two packs by parameter)
- Entry points: `generateFromArchetype()`, `generateFromPersonality()`, `generateFromDescription()`

## Visual Iteration Pipeline

Playwright-based render → evaluate → fix → re-render loop for tuning face packs. Screenshots rendered packs, evaluates against design specs, identifies issues, applies fixes, and re-renders. Lessons captured in `docs/lessons-learned.md` (27 rules from real mistakes).

## Animation System

Proportional feature system — features react to each other:
- Brows respond to eye scale, slope responds to squint + brow direction
- Blush tracks happiness, confusion drives brow asymmetry
- Gaze parallax (eyes compress sideways), per-eye gaze asymmetry
- Squint reduces lid opening for visual coherence
- Unified transition speed (1.5x boost for 300ms after state/emotion change)
- Soft limiting via tanh (no hard clips)
- Personality params modulate speeds, ranges, idle behavior

Pipeline: state targets → emotion deltas → idle variations → proportional coupling → soft limits → micro-expressions → anticipation → unified lerp → blink → draw

## Product Routes

The server serves the deployable product:
```
http://localhost:9999/           → face viewer (full-screen, auto-connects WS)
http://localhost:9999/dashboard  → 4-panel dashboard (header, left, right, footer)
http://localhost:9999/api/state  → HTTP API (push/read state)
http://localhost:9999/api/chat   → proxy to OpenClaw gateway
http://localhost:9999/api/audio  → relay audio chunks to viewers
http://localhost:9999/api/speak  → atomic: set speaking + increment audio seq
http://localhost:9999/health     → health check
ws://localhost:9999/ws/viewer    → WebSocket for face displays
ws://localhost:9999/ws/agent     → WebSocket for agents
```

### oface.io Routes (Edge Product)

```
https://oface.io/api/claim         → claim a username, get API key (GitHub login required when OAuth configured)
https://oface.io/api/check/:user   → check username availability
https://oface.io/api/gallery       → POST submit / GET list community gallery packs
https://oface.io/api/gallery/:id   → GET single gallery pack
https://oface.io/auth/login        → GitHub OAuth redirect
https://oface.io/auth/callback     → OAuth code exchange, creates session (7-day TTL)
https://oface.io/auth/me           → session check: { authenticated, user, avatar }
https://oface.io/auth/logout       → clear session (POST)
https://oface.io/api/admin/gallery → admin: list/delete/update gallery submissions
https://oface.io/api/admin/claims  → admin: list/delete claimed faces
https://oface.io/:user             → per-face viewer (full-screen)
https://oface.io/:user/dashboard   → per-face dashboard (redirects with server param)
https://oface.io/:user/api/state   → push/read state (auth required for POST)
https://oface.io/:user/api/config  → get/put persistent face config (pack, head, body)
https://oface.io/:user/api/speak   → start speaking sequence
https://oface.io/:user/api/audio   → push audio chunks
https://oface.io/:user/api/audio-done → end audio sequence
wss://oface.io/:user/ws/viewer     → public viewing WebSocket
wss://oface.io/:user/ws/agent      → agent WebSocket (auth required)
```

**Authentication**: GitHub OAuth (optional — backward compatible when `GITHUB_CLIENT_ID` is empty). Sessions stored in KV with 7-day TTL. Cross-origin cookies (`SameSite=None`, `Secure`). Admin users: `thcllc`.

**Username validation**: 2-32 chars, lowercase alphanumeric + hyphens. 70+ reserved names blocked (system paths, AI assistants, platforms, brands). 12 profanity substrings blocked. No leading/trailing hyphens, no double hyphens.

`site/` is the marketing site for openface.live — separate from the product.

### Site Pages (openface.live)
```
/                    → Landing page (hero, devices, features)
/gallery             → Community gallery (featured + user submissions)
/builder             → Face Pack Builder (visual editor, live preview, publish to gallery)
/use-cases           → What you can build
/dashboard           → Demo dashboard (simulated activity)
/docs/               → Documentation hub (sidebar nav)
/docs/protocol       → Protocol reference (states, emotions, messages)
/docs/api            → API reference (endpoints, WS, auth, MCP, oface.io)
/docs/integration    → Integration guide (6 paths including oface.io)
/docs/face-pack-guide → Face pack authoring + shorthand format
/test                → Test matrix (all packs × states × emotions)
```

### Shorthand Face Pack Format
```
{eyeStyle}:{idleColor}:{thinkingColor}:{speakingColor}:{name}
oval:#FF6B6B:#C084FC:#4FC3F7:MyBot
```
Expands to a full FaceDefinition with defaults. Copy-pasteable in 35 chars.

## Commands

```bash
bun run dev          # Build + start face server on :9999
bun run test         # Run 362+ tests
bun run build        # Build web component + server public + site
bun run deploy       # Build + deploy marketing site to Cloudflare Pages
```

## Deploy

Two deployment targets — marketing site and product:

| Target | Domain | Pages Project | Source Dir | Command |
|--------|--------|---------------|------------|---------|
| Marketing site | openface.live | `openface` | `site/` | `bun run deploy:site` |
| Product | oface.io | `oface-io` | `packages/server/public/` | `bun run deploy:product` |

```bash
bun run deploy          # Build + deploy both targets
bun run deploy:site     # Marketing site only → openface.live
bun run deploy:product  # Product only → oface.io
git push                # Push to github.com/thcapp/openface (via gh-wrap for auth)
```

Other deployment surfaces:
- **Self-hosted server**: `bun packages/server/src/index.ts` (port 9999)
- **oface.io (edge)**: `wr deploy` from `packages/server-edge/` — deploys to oface.io
  - Claim API (`POST /api/claim`), config API (`GET/PUT /{username}/api/config`)
  - Gallery API (`POST/GET /api/gallery`), admin API (`/api/admin/*`)
  - GitHub OAuth (`/auth/login`, `/auth/callback`, `/auth/me`, `/auth/logout`)
  - Username routing to Durable Objects, KV registry (`FACE_REGISTRY`), WebSocket Hibernation
- **MCP**: `FACE_URL=http://localhost:9999 bun packages/mcp/src/index.ts`
- **Plugin**: `cp -r packages/plugin ~/.openclaw/plugins/openface`

## Audio Pipeline

Single authority model — no race conditions:
- **Plugin** owns state transitions (thinking → working → speaking → idle)
- **TTS server** owns audio delivery (raw WAV chunks to `/api/audio`)
- **Viewer** owns amplitude (extracted from waveform via Web Audio API)

Server accepts both raw binary WAV (`audio/wav`) and JSON base64 (`application/json`) on `/api/audio`. Broadcasts base64 to all viewers via WebSocket.

## Chat Proxy

Dashboard chat → `POST /api/chat` → face server → OpenClaw gateway → agent processes → state + audio pipeline → viewer. Dashboard doesn't touch OpenClaw auth or sessions.

Env: `OPENCLAW_GATEWAY_URL`, `OPENCLAW_GATEWAY_TOKEN`, `OPENCLAW_SESSION_KEY`

## File Ownership (for multi-agent work)

Each source file has a single owner to avoid merge conflicts:
- `types.ts` — protocol/type definitions
- `draw.ts` — Canvas2D rendering, visual math
- `interpolation.ts` + `index.ts` — state logic, emotion blending, FaceRenderer class
- `blink.ts` + `math.ts` — blink timing, micro-saccades, anticipation, saccadeLerp
- `face-loader.ts` — face pack parsing, personality wiring
- `face-generator.ts` — procedural face pack generation (archetypes, palettes, interpolation)
- `plugin/src/index.ts` — OpenClaw lifecycle hooks
- `element.ts` — web component, accessibility, WebSocket
- `state.ts` + server `index.ts` — server state validation, HTTP/WS routes
- `mcp/index.ts` — MCP tools
- `filter/` — output filtering pipeline (extractors, classifier, emotion detection, text cleaning)
- `faces/*.json` + `faces/community/*.json` — face pack content

## Key Design Decisions

- **Server stores full text** — no truncation. Display layers handle overflow via chunking/scrolling.
- **Emotion colors blend with state colors** — `emotionColorBlend` per pack (0=state only, 1=override). Preserves theme identity.
- **Zero-dependency renderer** — no DOM, no framework. Portable to any canvas context.
- **Protocol is the product** — JSON state messages. Any language can push state. Renderer is replaceable.
- **Face packs are content, not code** — .face.json files with geometry, colors, animation, personality.

## Tests

362+ tests across renderer (math, face-loader, face-generator), server (state, rate-limit), filter (extraction, classification, emotion, cleaning, pipeline), and edge (E2E). All run via `bun test`. E2E test script: `scripts/e2e-test.sh` (12 checks).

## CLI Tools

Use credential-injecting wrappers (auto-detect profile from .base.yaml realm):
- `wr` instead of `wrangler` (injects Cloudflare token)
- `gh-wrap` instead of `gh` (switches GitHub account)
