# Open Face Protocol v1

## Overview

The Open Face Protocol defines how AI agents express visual state through animated faces. It consists of two schemas:

1. **State Messages** — JSON objects that describe the current visual state of a face
2. **Face Definitions** — `.face.json` files that define a face's visual identity

## State Message

All fields are optional. Partial updates merge into current state.

```json
{
  "state": "speaking",
  "emotion": "happy",
  "emotionSecondary": "surprised",
  "emotionBlend": 0.3,
  "intensity": 0.8,
  "amplitude": 0.6,
  "lookAt": { "x": 0.3, "y": -0.1 },
  "color": "#FF1493",
  "winkLeft": 0.0,
  "winkRight": 0.0,
  "progress": null,
  "text": "Hello!",
  "textDuration": 3000
}
```

### Fields

| Field | Type | Range | Default | Description |
|-------|------|-------|---------|-------------|
| `state` | string | enum | — | Current face state (activity) |
| `emotion` | string | enum | — | Primary emotion overlay (mood) |
| `emotionSecondary` | string | enum | `"neutral"` | Secondary emotion for compound expressions |
| `emotionBlend` | number | 0.0–1.0 | 0.0 | Blend between primary (0) and secondary (1) emotion |
| `intensity` | number | 0.0–1.0 | 1.0 | Emotion intensity multiplier (scales all emotion deltas) |
| `amplitude` | number | 0.0–1.0 | — | Mouth openness (for speaking/lip-sync) |
| `lookAt` | object | x,y: -1.0–1.0 | — | Eye gaze target |
| `color` | string/null | hex or null | — | Override face color (`null` = auto from state/emotion) |
| `winkLeft` | number | 0.0–1.0 | — | Left eye closure (0=open, 1=closed) |
| `winkRight` | number | 0.0–1.0 | — | Right eye closure (0=open, 1=closed) |
| `progress` | number/null | 0.0–1.0 | — | Task progress for working/loading states (`null` = indeterminate) |
| `text` | string/null | free-form | — | Speech bubble overlay text |
| `textDuration` | number | 500–30000 ms | 3000 | Auto-clear text timeout |
| `detail` | string/null | free-form | — | Extended text content |

### States (11)

| Value | Default Color | Visual Description |
|-------|---------------|-------------------|
| `idle` | `#4FC3F7` | Neutral mouth, relaxed brows, subtle head sway |
| `thinking` | `#CE93D8` | Eyes drift up-right, one brow raised |
| `speaking` | `#4FC3F7` | Mouth opens/closes driven by `amplitude` |
| `listening` | `#81C784` | Wide eyes, raised attentive brows, head tilted |
| `reacting` | `#FFB74D` | Big eyes, open mouth, raised brows |
| `puzzled` | `#FF8A65` | Asymmetric brows + eye sizes, wavy mouth |
| `alert` | `#E57373` | Huge eyes, high brows, frown mouth, shake |
| `working` | `#90CAF9` | Focused smaller eyes, furrowed brows |
| `sleeping` | `#7986CB` | Closed eyes, relaxed brows, Zzz |
| `waiting` | `#B0BEC5` | Still (no head sway), eyes open, occasional glance, subtle pulse |
| `loading` | `#78909C` | Eyes gradually opening, sequential dot animation, breathing normalizing |

### Emotions (13)

| Value | Default Color | Effect |
|-------|---------------|--------|
| `neutral` | (none) | Use state color, no modification |
| `happy` | `#FFD54F` | Smile, brows up, cheek blush |
| `sad` | `#7986CB` | Frown, brows droop |
| `confused` | `#FF8A65` | Asymmetric brows |
| `excited` | `#FF7043` | Big smile, brows raised high, blush |
| `concerned` | `#B0BEC5` | Slight frown, brows dropped |
| `surprised` | `#FFF176` | Wide eyes, high brows, O-mouth |
| `playful` | `#F48FB1` | Asymmetric brows, head tilt, smile, blush |
| `frustrated` | `#EF5350` | Furrowed brows, narrowed eyes, tight compressed mouth |
| `skeptical` | `#BCAAA4` | Strong asymmetric brow (one up, one down), flat mouth |
| `determined` | `#66BB6A` | Slightly narrowed eyes, level lowered brows, tight mouth |
| `embarrassed` | `#F48FB1` | Heavy blush, averted gaze, asymmetric smile, tilted head |
| `proud` | `#FFB300` | Satisfied smile, slightly narrowed confident eyes, chin-up tilt |

### Compound Emotions

Use `emotionSecondary` and `emotionBlend` to create compound expressions. The renderer interpolates between the primary and secondary emotion deltas:

```json
{ "emotion": "happy", "emotionSecondary": "surprised", "emotionBlend": 0.4 }
```

The effective delta for each parameter is: `primary * (1 - blend) + secondary * blend`, then scaled by `intensity`.

### Intensity

The `intensity` field (default 1.0) scales all emotion deltas, enabling a continuous expression space:

| Intensity | Example with `happy` |
|-----------|---------------------|
| 0.2 | Content — slight smile |
| 0.5 | Pleased — moderate smile |
| 1.0 | Happy — full expression |

### Progress

The `progress` field (0.0–1.0) provides visual momentum for long-running `working` and `loading` states. When `null` or omitted, the animation is indeterminate (looping). When set, it drives deterministic animation (e.g., gear dots speeding up, boot sequence advancing).

### Visual Parameters

The renderer maintains these interpolated parameters in `CurrentState`:

| Parameter | Range | Description |
|-----------|-------|-------------|
| `squint` | 0.0–1.0 | Bottom eye bezier compressed — Duchenne eye smile (^_^) |
| `mouthWidth` | -1.0–1.0 | Mouth horizontal stretch (-1=compressed, 0=normal, 1=wide) |
| `mouthAsymmetry` | -1.0–1.0 | One mouth corner up, other down (-1=left up, 1=right up) |

These are driven by emotion deltas in face definitions, not set directly via the protocol.

### Eye Styles

Face packs define `geometry.eyes.style` to control eye shape:

| Style | Shape | Specular Containment |
|-------|-------|----------------------|
| `oval` | Bezier ellipse | Elliptical (asymmetric Y for squint) |
| `round` | Circular with squint | Elliptical |
| `rectangle` | Rounded-corner rectangle | Rectangular box |
| `dot` | Perfect circle | Circular |

The specular reflection (lighting cue) is contained within the rendered eye shape in real-time. Each style uses its own containment geometry — elliptical for ovals, rectangular for rectangles, circular for dots. Pupil motion and specular motion are configured independently per face pack.

Eye style aliases are not supported in v1 strict mode. Use only `oval`, `round`, `rectangle`, or `dot`.

### Rendering Principles

1. **Single-path rendering**: Every visual element is one bezier path, one fill call. No threshold branching between render modes. No alpha crossfade between overlapping shapes.
2. **Stable specular positioning**: Specular reflections use a fixed unit reference for placement, then clamp inside the live eye contour to prevent drift during scale transitions.
3. **Mouth renderer modes**: Mouth can be `fill` or `line`, with per-state/per-emotion overrides from the face pack.
4. **Strict schema contract**: Deprecated keys like `geometry.eyes.highlight`, `palette.highlight`, and `geometry.mouth.speakingFill` are rejected.

### Personality

Face packs define personality traits in `personality` that modulate animation behavior:

| Trait | Effect |
|-------|--------|
| `energy` (0-1) | Animation speed (0.6x slow → 1.4x snappy) |
| `expressiveness` (0-1) | Parameter range (0.4x subtle → 1.6x dramatic) |
| `warmth` (0-1) | Happiness baseline offset (-0.15 → +0.15) |
| `stability` (0-1) | Micro-expression frequency (high = calmer) |
| `playfulness` (0-1) | Asymmetry and sway amplitude |

### Color Blending

Emotion colors blend with (not replace) state colors. Controlled by `palette.emotionColorBlend` (0-1):

```
finalColor = lerp(stateColor, emotionColor, emotionColorBlend * intensity)
```

### lookAt Coordinate System

```
(-1, -1) ─────── (1, -1)
    │    top-left     │
    │                 │
    │    (0, 0)       │
    │    center       │
    │                 │
(-1, 1) ──────── (1, 1)
         bottom-right
```

## Transport

### HTTP API

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `POST` | `/api/state` | Yes | Push state update (JSON body) |
| `GET` | `/api/state` | No | Get current state |
| `POST` | `/api/audio` | Yes | Relay audio chunk to viewers (binary WAV or JSON base64) |
| `POST` | `/api/audio-done` | Yes | Signal end of audio stream |
| `POST` | `/api/speak` | Yes | Atomic: set speaking state + increment audio seq |
| `POST` | `/api/chat` | Yes | Proxy message to OpenClaw gateway |
| `GET` | `/api/history` | No | Read recent state history ring buffer |
| `GET` | `/health` | No | Health check |

Auth: `Authorization: Bearer <key>` header when `FACE_API_KEY` is set.

#### Audio Endpoints

**POST /api/audio** accepts two formats:
- **Raw binary WAV** — `Content-Type: audio/wav` (or `audio/*`, `application/octet-stream`). Server base64-encodes and broadcasts.
- **JSON base64** — `Content-Type: application/json` with body `{"data": "<base64>", "seq": <int>}`. The `seq` field is optional (defaults to current server sequence).

Returns `{"ok": true, "seq": <int>}`.

**POST /api/audio-done** signals end of the current audio stream. Takes no body. Returns `{"ok": true, "seq": <int>}`.

**POST /api/speak** is an atomic operation that:
1. Increments the server's audio sequence number
2. Sets state to `"speaking"` (or the `state` value in the body)
3. Merges any additional state fields from the JSON body
4. Broadcasts an `audio-seq` message so viewers flush stale audio

Returns `{"ok": true, "seq": <int>, "state": {...}}`.

**POST /api/chat** proxies a user message to the OpenClaw gateway. Body: `{"message": "<string>"}`. Requires `OPENCLAW_GATEWAY_URL` env var. Returns the gateway response.

### WebSocket

| Path | Role | Direction |
|------|------|-----------|
| `/ws/viewer` | Face display | Server → Client (state broadcasts) |
| `/ws/agent` | Agent | Client → Server (state pushes) |

Agent auth: `?token=<key>` query parameter.

#### WebSocket Message Types

**Server → Viewer:**

| Type | Fields | Description |
|------|--------|-------------|
| `state` | (all state fields) | Full state broadcast |
| `audio` | `data` (base64), `format` ("wav"), `seq` (int) | Audio chunk for playback |
| `audio-done` | `seq` (int) | End of audio stream — viewer should play remaining buffer then stop |
| `audio-seq` | `seq` (int) | New speech started — viewer should flush old audio queue |
| `pong` | — | Keepalive response |
| `error` | `message` (string) | Error notification (e.g., rate limited) |

```json
{"type": "state", "state": "thinking", "emotion": "neutral", ...}
{"type": "audio", "data": "UklGR...", "format": "wav", "seq": 3}
{"type": "audio-done", "seq": 3}
{"type": "audio-seq", "seq": 4}
{"type": "pong"}
{"type": "error", "message": "Rate limited"}
```

**Agent → Server:**

| Type | Fields | Description |
|------|--------|-------------|
| (none) | (state fields) | State update — `type` field is optional |
| `ping` | — | Keepalive request |
| `reset` | — | Reset to default state |

```json
{"state": "speaking", "amplitude": 0.5}
{"type": "ping"}
{"type": "reset"}
```

## Audio Pipeline — Single Authority Model

Audio delivery follows a strict ownership model to prevent race conditions:

| Authority | Owns | Mechanism |
|-----------|------|-----------|
| **Plugin / Agent** | State transitions (thinking → working → speaking → idle) | `POST /api/speak`, `POST /api/state`, or WebSocket state messages |
| **TTS Server** | Audio delivery (raw WAV chunks) | `POST /api/audio` → server base64-encodes → broadcasts to viewers |
| **Viewer** | Amplitude (mouth movement) | Extracts amplitude from waveform via Web Audio API, drives `amplitude` locally |

### Sequence

```
Agent                    Server                   Viewer
  │                        │                        │
  ├─ POST /api/speak ─────►│                        │
  │  {state:"speaking"}    │── audio-seq {seq:N} ──►│ flush old queue
  │                        │── state {speaking} ───►│
  │                        │                        │
TTS ─ POST /api/audio ───►│                        │
  │  (raw WAV chunk)       │── audio {b64,seq:N} ──►│ decode + play
TTS ─ POST /api/audio ───►│                        │
  │  (raw WAV chunk)       │── audio {b64,seq:N} ──►│ decode + play
  │                        │                        │
TTS ─ POST /api/audio-done►│                       │
  │                        │── audio-done {seq:N} ─►│ play remaining buffer
  │                        │                        │
Agent ─ {state:"idle"} ──►│                        │
  │                        │── state {idle} ───────►│
```

The `seq` field allows viewers to discard audio from a previous utterance when a new one starts. When the viewer receives `audio-seq` with a new sequence number, it flushes any buffered audio from the old sequence.

### Built-in TTS Fallback

The `<open-face>` element supports browser-native text-to-speech via the `tts` attribute. When enabled and no audio chunks are being received, the element uses `window.speechSynthesis` to speak any `text` field from state messages.

- External audio pipeline always takes priority over built-in TTS
- Face auto-transitions to `speaking` on utterance start, `idle` on end
- Amplitude is simulated from word boundary events
- Optional tuning: `tts-voice`, `tts-rate`, `tts-pitch` attributes

This provides a zero-config speech path for agents that don't have a TTS server.

## Server Behaviors

### Idle Timeout
If no state update for 30s, auto-transitions to `idle` + `neutral`. The `sleeping` and `waiting` states are exempt.

### Auto-Sleep
When last agent disconnects → `sleeping` after 5s. When first agent connects → `idle`.

### Rate Limiting
60 messages/second per agent (token bucket), per IP for HTTP.

## Face Definition Format

Face definitions (`.face.json`) describe the visual identity of a face pack. See `face.schema.json` for the full schema.

Required sections:
- **meta** — name, author, license, description
- **geometry** — eye style/size/spacing, mouth style/width, brows, blush
- **palette** — colors for states, emotions, and feature modules

Optional sections:
- **animation** — breathing, blink intervals, lerp speeds, micro-expressions
- **personality** — energy, expressiveness, warmth, stability, playfulness
- **states** — per-state visual parameters (mouth shape, brow position, lid openness)
- **emotionDeltas** — additive overlays for each emotion
- **accessories** — layered props (for example `antenna` and `glasses`)

### Head Layer

Face packs may define an explicit head shape via `geometry.head`:
- `geometry.head.shape` (`fullscreen | circle | rounded`) — default `fullscreen` (no visible head)
- `geometry.head.width`, `geometry.head.height` — head dimensions as fraction of canvas
- `geometry.head.verticalOffset` — vertical shift
- `palette.head.fill`, `palette.head.stroke` — head colors

Legacy alias: `geometry.shape` maps to `geometry.head.shape` for backward compatibility.

### Body Module (v1)

Face packs may include an optional body layer via `geometry.body` and `palette.body`.

Body v1 is intentionally simple (no rigging): torso/neck/shoulders/arms rendered as 2D primitives behind the face with subtle derived motion from existing signals (`breathe`, `tilt`, `lookAt`, `amplitude`).

Core body fields:
- `geometry.body.shape` (`capsule | trapezoid | roundedRect | blob`)
- `geometry.body.neck`, `geometry.body.shoulders`, `geometry.body.arms`
- `geometry.body.motion` (breath/tilt/weight-shift/sway/speaking-bob multipliers)
- `geometry.body.constraints` (tilt/shift caps)
- `palette.body` (`fill`, `stroke`, `neck`, `arms`, `shadow`, `shadowAlpha`)

### Accessories

Face packs may define an `accessories` array of layered props. Each accessory has:
- `id` — unique identifier
- `type` (`antenna | glasses | custom`)
- `layer` (`back | mid | front | overlay`) — draw order relative to face features
- `mirrorX` — if true, loader auto-generates a mirrored copy

Antenna-specific physics fields:
- `segments`, `segmentLength` — chain length
- `restAngle`, `restCurve`, `tipCurl` — rest-shape controls (tipCurl ramps in late, t > 0.55)
- `physics.stiffness`, `physics.damping`, `physics.gravity`, `physics.headInfluence`
- `stateOverrides` — per-state physics parameter overrides

Physics runs at a fixed 120Hz timestep with substep cap and long-frame reset for deterministic simulation.

### Eye Submodules

- `geometry.eyes.pupil` — `color`, `size`, `gazeStrength` (pupil follows gaze)
- `geometry.eyes.eyelid` — `cover`, `color` (lid overlay)
- `geometry.eyes.style` — `oval | round | rectangle | dot` (strict, no aliases)

### Brow Configuration

- `geometry.brows.renderer` — brow draw style override
- `geometry.brows.configs` — per-brow configuration objects

### Mouth Renderers

- `geometry.mouth.renderer` — base mouth mode (`fill | line`)
- `geometry.mouth.rendererByState` — per-state overrides (e.g., `{ speaking: "fill" }`)
- `geometry.mouth.rendererByEmotion` — per-emotion overrides (e.g., `{ excited: "fill" }`)

Resolution order: base → state override → emotion override (fill wins over line).

### Feature Locks and Constraints

- `geometry.locks` — pin specific animation parameters to fixed values (e.g., Robot locks brow height to 0)
- `geometry.constraints` — bound parameter ranges (e.g., limit eye scale range)

Locks prevent the interpolation engine from animating the locked parameter. Constraints clamp values to defined min/max.

### Emotion Color Blending

- `emotionColorBlend` (0-1) — controls how much emotion colors override state colors. 0 = state only, 1 = full emotion override. Preserves pack theme identity.

### Strict Contract

- Use only `geometry.eyes.style` values: `oval`, `round`, `rectangle`, `dot`
- Deprecated keys are **rejected** at load time: `geometry.eyes.highlight`, `palette.highlight`, `geometry.mouth.speakingFill`
- Legacy eye style aliases (`narrow`, `square`, `pixel`) are no longer accepted

## Versioning

- This is protocol **v1**
- Additive changes (new optional fields, new states/emotions) = minor version
- Breaking changes = major version
- State messages should ignore unknown fields for forward compatibility where safe.
- Face definitions should follow `face.schema.json` strictly.
