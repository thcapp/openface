# @openface/server

Open Face server. Bun runtime. Port 9999.

Serves the face viewer, dashboard, state relay, audio relay, and chat proxy.

## Usage

```bash
bun run dev   # build + start on :9999
```

## Routes

| Method | Path | Description |
|--------|------|-------------|
| GET | `/` | Face viewer (auto-connects WS) |
| GET | `/dashboard` | 4-panel dashboard (chat, face, activity) |
| POST | `/api/state` | Push state update (auth + rate limited) |
| GET | `/api/state` | Read current state |
| POST | `/api/chat` | Proxy message to OpenClaw gateway (auth + rate limited) |
| POST | `/api/speak` | Set speaking state + start audio stream seq (auth + rate limited) |
| POST | `/api/audio` | Relay WAV chunk to viewers (binary or JSON; auth + rate limited) |
| POST | `/api/audio-done` | Signal end of audio stream (optional `{seq}`; auth + rate limited) |
| GET | `/api/history` | Read recent state history ring buffer |
| GET | `/health` | Server health |

### WebSocket

| Path | Role | Messages |
|------|------|----------|
| `/ws/viewer` | Face display | `state`, `audio`, `audio-seq`, `audio-done`, `pong` |
| `/ws/agent` | Agent | Accepts state JSON, `ping` |

## Behaviors

- **Idle timeout**: auto-returns to idle after 30s of no updates
- **Auto-sleep**: transitions to sleeping 5s after last agent disconnects
- **Rate limiting**: token bucket by client IP on write APIs (`/api/state`, `/api/speak`, `/api/audio`, `/api/audio-done`, `/api/chat`)
- **Auth**: `FACE_API_KEY` enables Bearer auth (and `?token=` fallback)
- **Audio seq**: monotonic counter for speech interruption handling
- **Audio safety**: `/api/audio` rejects oversized payloads (binary + base64 caps)
- **Chat safety**: `/api/chat` rejects oversized messages
- **Chat proxy**: forwards to OpenClaw gateway, response comes through state pipeline

## Environment

```
FACE_PORT=9999
FACE_API_KEY=
FACE_IDLE_TIMEOUT=30000
FACE_MAX_VIEWERS=50
FACE_MAX_AGENTS=5
FACE_RATE_LIMIT=60
FACE_CHAT_MAX_CHARS=4000
FACE_AUDIO_MAX_BYTES=1048576
FACE_AUDIO_MAX_B64_CHARS=2097152
OPENCLAW_GATEWAY_URL=         # e.g. http://localhost:18789
OPENCLAW_GATEWAY_TOKEN=       # gateway auth token
OPENCLAW_SESSION_KEY=agent:main
```

## Troubleshooting

- `401 Unauthorized` on write APIs: set matching Bearer token (or `?token=`) when `FACE_API_KEY` is configured.
- `429 Rate limited`: reduce burst volume or increase `FACE_RATE_LIMIT`.
- `413` on audio/chat: increase `FACE_AUDIO_MAX_BYTES`/`FACE_AUDIO_MAX_B64_CHARS`/`FACE_CHAT_MAX_CHARS` if intentionally sending larger payloads.
- Stuck speaking or clipped playback: verify plugin/TTS forward the same `seq` across `/api/speak`, `/api/audio`, and `/api/audio-done`.
