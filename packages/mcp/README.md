# @openface/mcp

MCP server for controlling Open Face from Claude and other AI clients.

## Usage

```bash
FACE_URL=http://localhost:9999 bun packages/mcp/src/index.ts
```

## Tools

| Tool | Description |
|------|-------------|
| `set_face_state` | Set state, emotion, intensity, compound blend, color |
| `set_face_look` | Control eye gaze direction (x, y) |
| `face_wink` | Wink one eye with auto-reset timer |
| `face_speak` | Display text in speech bubble |
| `set_face_progress` | Set progress for working/loading states |
| `face_emote` | Quick emotion + intensity shortcut |
| `get_face_state` | Read current state |
| `face_reset` | Reset to defaults |

## Environment

```
FACE_URL=http://127.0.0.1:9999   # Face server URL
FACE_API_KEY=                      # Optional auth token
```
