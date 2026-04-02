# @openface/server-edge

Open Face edge server — Cloudflare Workers + Durable Objects. Powers [oface.io](https://oface.io).

Same protocol as the Bun server, but runs on Cloudflare's edge network. Each claimed username gets its own isolated Durable Object with persistent state, WebSocket Hibernation, and per-face API key auth.

## Deploy

```bash
cd packages/server-edge
wr deploy
```

## Architecture

- **Worker** (`worker.ts`): username routing, claim API, availability check, static assets, auth gate
- **FaceRoom** (`durable-object.ts`): per-face state, WS fanout (Hibernation API), audio relay, chat proxy
- **KV Registry** (`FACE_REGISTRY`): username → face config + API key stored in Workers KV

### Username Routing

Every request with a username in the path routes to that face's Durable Object:

```
oface.io/alice           → FaceRoom("alice"), serve viewer
oface.io/alice/dashboard → redirect to dashboard with server param
oface.io/alice/api/state → FaceRoom("alice"), state endpoint
oface.io/alice/ws/viewer → FaceRoom("alice"), WebSocket
```

Paths without a username are system-level:
- `/api/claim`, `/api/check/:username` — registration
- `/health` — health check
- `/open-face.js`, `/faces/*` — static assets

### WebSocket Hibernation

Durable Objects use Cloudflare's Hibernation API. When no messages are being exchanged, the DO sleeps — WebSocket connections stay open but billing stops. Idle faces cost effectively nothing.

### KV Registry

Username registry stored in Workers KV (`FACE_REGISTRY` binding):

```json
{
  "username": "alice",
  "face": "zen",
  "apiKey": "oface_ak_a1b2c3d4e5f6",
  "createdAt": "2026-03-31T12:00:00Z",
  "config": { "head": { "enabled": true } }
}
```

### Username Validation

**Reserved names**: 70+ blocked names including system paths (`api`, `health`, `dashboard`, `auth`, `gallery`...), AI assistants (`claude`, `gpt`, `gemini`, `copilot`, `siri`, `alexa`...), platforms (`openai`, `anthropic`, `google`, `github`, `discord`...), and other squattable names.

**Profanity filtering**: 12 substring patterns checked against the full username.

**Format rules**: 2-32 chars, lowercase alphanumeric + hyphens. No leading/trailing hyphens, no double hyphens (`--`).

## Routes

### System Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `POST` | `/api/claim` | Session (when OAuth enabled) | Claim a username, get API key |
| `GET` | `/api/check/:username` | None | Check username availability |
| `GET` | `/health` | None | Health check |

### GitHub OAuth

GitHub OAuth is optional — when `GITHUB_CLIENT_ID` is not set, auth is skipped and claim works without login (backward compatible).

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/auth/login` | None | Redirect to GitHub OAuth authorize URL |
| `GET` | `/auth/callback` | None | Exchange code for token, create session in KV (7-day TTL) |
| `GET` | `/auth/me` | Session cookie | Returns `{ authenticated, user, avatar }` |
| `POST` | `/auth/logout` | Session cookie | Clear session, delete cookie |

Sessions are stored in KV with 7-day TTL. Cross-origin cookies use `SameSite=None; Secure` for openface.live integration.

### Gallery API

Community gallery for user-submitted face packs. Submissions are rate-limited to 10 per IP per hour.

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `POST` | `/api/gallery` | Optional session | Submit a pack (authenticated users get verified GitHub username) |
| `GET` | `/api/gallery` | None | List all gallery packs (metadata only) |
| `GET` | `/api/gallery/:id` | None | Get a single gallery pack (full JSON) |

### Admin API

Admin endpoints require a valid session with a GitHub username in the `ADMIN_USERS` set (currently: `thcllc`).

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/api/admin/gallery` | Admin session | List all gallery submissions |
| `DELETE` | `/api/admin/gallery/:id` | Admin session | Remove a gallery submission |
| `PUT` | `/api/admin/gallery/:id` | Admin session | Update submission (featured, name, description, tags) |
| `GET` | `/api/admin/claims` | Admin session | List all claimed faces |
| `DELETE` | `/api/admin/claims/:username` | Admin session | Release a claimed face |

### Per-Face Endpoints

All per-face endpoints are namespaced under `/{username}/`:

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/{username}` | None | Face viewer (full-screen) |
| `GET` | `/{username}/dashboard` | None | Dashboard redirect |
| `GET` | `/{username}/api/state` | None | Read current state |
| `POST` | `/{username}/api/state` | API key | Push state update |
| `GET` | `/{username}/api/config` | None | Read face config |
| `PUT` | `/{username}/api/config` | API key | Update face config |
| `POST` | `/{username}/api/speak` | API key | Start speaking sequence |
| `POST` | `/{username}/api/audio` | API key | Push audio chunks |
| `POST` | `/{username}/api/audio-done` | API key | End audio sequence |
| `GET` | `/{username}/ws/viewer` | None | WebSocket (public viewing) |
| `GET` | `/{username}/ws/agent` | API key | WebSocket (agent push) |

### Unclaimed Usernames

Visiting `oface.io/unclaimed-name` serves an "available" landing page instead of a face viewer.

### Dashboard Redirect

`oface.io/alice/dashboard` redirects to the dashboard HTML with a `server` query param pointing at the face's WebSocket, so the dashboard connects to the correct Durable Object.

## Per-Face Auth

Per-face API keys are generated at claim time (`oface_ak_` prefix). Auth is required for write endpoints:

```
Authorization: Bearer oface_ak_xxxxxxxxxxxx
# or query param
?token=oface_ak_xxxxxxxxxxxx
```

Public endpoints (viewer, `GET /api/state`, `GET /api/config`, `/ws/viewer`) require no auth.

## Legacy Room Routes

Named rooms from the pre-oface.io era are still supported:

- `/room/:id/ws/viewer`
- `/room/:id/ws/agent`
- `/room/:id/api/state`
- `/room/:id/api/speak`
- `/room/:id/api/audio`
- `/room/:id/api/audio-done`
- `/room/:id/health`
