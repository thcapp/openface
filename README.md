# Open Face

Animated faces for AI agents. [openface.live](https://openface.live) | [oface.io](https://oface.io)

One protocol. Any agent. Any surface.

## Quick Start

```bash
bun install
bun run dev          # Start face server on :9999
open http://localhost:9999
```

Push state from anywhere:
```bash
curl -X POST http://127.0.0.1:9999/api/state \
  -H "Content-Type: application/json" \
  -d '{"state":"speaking","emotion":"happy","text":"Hello!"}'
```

## Hosted Faces (oface.io)

Claim a permanent URL for your agent's face — no server needed:

```bash
# Sign in with GitHub at oface.io/auth/login, then:
curl -X POST https://oface.io/api/claim \
  -H "Content-Type: application/json" \
  -d '{"username":"mybot","face":"default"}'

# Push state with the returned API key
curl -X POST https://oface.io/mybot/api/state \
  -H "Authorization: Bearer oface_ak_..." \
  -d '{"state":"speaking","emotion":"happy"}'

# Anyone can view at https://oface.io/mybot
```

## Web Component

```html
<script type="module" src="https://openface.live/open-face.js"></script>
<open-face state="idle" emotion="neutral"></open-face>
```

Connect to a live server:
```html
<open-face server="ws://localhost:9999/ws/viewer"></open-face>
```

## Builder

Visual face pack editor at [openface.live/builder](https://openface.live/builder). Create, customize, and publish face packs to the [community gallery](https://openface.live/gallery).

## Architecture

Bun monorepo. Port 9999.

```
open-face/
├── packages/
│   ├── renderer/       Canvas2D engine + face generator (zero deps)
│   ├── element/        <open-face> web component
│   ├── server/         Bun WebSocket relay + HTTP API
│   ├── client/         TypeScript client library
│   ├── mcp/            MCP server (8 tools for Claude)
│   ├── server-edge/    Cloudflare Workers + Durable Objects (powers oface.io)
│   ├── filter/         Output filtering + emotion detection
│   └── plugin/         OpenClaw lifecycle plugin
├── protocol/v1/        JSON Schemas + spec
├── faces/              Default face pack + community/ directory
├── site/               openface.live
└── docs/               Design docs + research
```

## Expression System

**11 states**: idle, thinking, speaking, listening, reacting, puzzled, alert, working, sleeping, waiting, loading

**13 emotions**: neutral, happy, sad, confused, excited, concerned, surprised, playful, frustrated, skeptical, determined, embarrassed, proud

Blend two emotions: `{ "emotion": "happy", "emotionSecondary": "surprised", "emotionBlend": 0.4, "intensity": 0.8 }`

## Renderer

Zero-dependency Canvas2D engine with proportional feature system — every element reacts to every other in real time.

- 12 eye styles, 10 pupil shapes, 8 specular shapes
- 10 mouth shapes, 12 head shapes, 8 brow styles
- 7 eyelash styles, 6 nose styles, 10 face decorations
- Per-eye overrides (heterochromia), dual-color system
- Soft limiting (tanh), unified transitions, saccade-aware gaze
- Optional body module, accessory system (antenna physics, glasses)

## Face Packs

Default is the only built-in pack. Community packs live in `faces/community/` and are loaded on-demand from the gallery.

Each pack is a `.face.json` defining geometry, colors, animation, personality, and optional body/accessories. Create your own in the [builder](https://openface.live/builder).

### Personality

| Trait | Effect |
|-------|--------|
| `energy` (0-1) | Animation speed |
| `expressiveness` (0-1) | Parameter range |
| `warmth` (0-1) | Happiness baseline |
| `stability` (0-1) | Micro-expression frequency |
| `playfulness` (0-1) | Asymmetry and sway |

## Server

State relay with WebSocket broadcast, audio passthrough, and chat proxy.

```
POST /api/state          Push state update
POST /api/speak          Start speaking (atomic seq increment)
POST /api/audio          Relay audio chunks to viewers
POST /api/audio-done     End audio stream
POST /api/chat           Proxy to OpenClaw gateway
GET  /api/state          Read current state
GET  /api/history        Recent state timeline
GET  /health             Health check
WS   /ws/viewer          Receive state + audio
WS   /ws/agent           Push state
```

### Audio Pipeline

Single authority model — no race conditions:
- **Plugin** owns state transitions
- **TTS server** owns audio delivery (WAV chunks to `/api/audio`)
- **Viewer** owns amplitude (Web Audio API extracts RMS from waveform)

## Integrations

**OpenClaw Plugin**: `cp -r packages/plugin ~/.openclaw/plugins/openface` — auto-maps agent lifecycle to face states.

**MCP Tools**: `FACE_URL=http://127.0.0.1:9999 bun packages/mcp/src/index.ts` — 8 tools for Claude (set_face_state, face_speak, set_face_look, face_wink, set_face_progress, face_emote, get_face_state, face_reset).

**Client Library**:
```js
import { OpenFaceClient } from "@openface/client";
const face = new OpenFaceClient("http://127.0.0.1:9999");
await face.setState({ state: "thinking", emotion: "determined" });
await face.speaking("Hello!");
```

**Filter**: Normalizes raw AI output → clean state updates. Provider extractors for Claude, OpenAI, Gemini, Ollama. Emotion detection, text cleaning, tool summarization.

## Development

```bash
bun install
bun run dev              # Build + start server on :9999
bun run test             # 362 tests
bun run build            # Build all targets
bun run deploy           # Deploy to Cloudflare
```

## Deploy

| Target | Domain | Command |
|--------|--------|---------|
| Marketing site | openface.live | `bun run deploy:site` |
| Edge product | oface.io | `wr deploy` from packages/server-edge/ |
| Self-hosted | localhost:9999 | `bun run dev` |

## Protocol

JSON state messages over HTTP or WebSocket. Full spec: [protocol/v1/spec.md](protocol/v1/spec.md)

Schemas: [state.schema.json](protocol/v1/state.schema.json) | [face.schema.json](protocol/v1/face.schema.json)

## License

MIT
