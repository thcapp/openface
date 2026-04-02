# @openface/plugin

OpenClaw plugin that drives an Open Face server from agent lifecycle events.

## Install

```bash
cp -r packages/plugin ~/.openclaw/plugins/openface
```

## Configure

In `~/.openclaw/openclaw.json`:

```json
{
  "plugins": {
    "entries": {
      "openface": {
        "enabled": true,
        "config": {
          "face_url": "http://localhost:9999",
          "face_api_key": "",
          "tts_enabled": false,
          "tts_url": "http://localhost:9200"
        }
      }
    }
  }
}
```

## How It Works

| Agent Event | Face State |
|-------------|-----------|
| `message_received` | listening |
| `before_agent_start` | thinking |
| `before_tool_call` | working (with tool description) |
| `after_tool_call` | thinking |
| `agent_end` | speaking + text + emotion |
| `session_start` | idle + happy |
| `session_end` | sleeping |

### Single Authority Model

- **This plugin** owns state transitions — it's the only thing that pushes `speaking`
- **TTS server** owns audio delivery — just streams WAV chunks
- **Viewer** owns amplitude — extracts RMS from the waveform client-side

The `message_sending` hook is intentionally not used — it caused duplicate speaking pushes. `agent_end` is the single authority for the speaking transition.

### Delivery Guarantees

- State/speak pushes use bounded timeout + retry (`2.5s`, `1` retry)
- Dedup is payload-based (full JSON payload), so emotion/detail changes are preserved
- `agent_end` awaits `/api/speak` and uses returned `seq`
- When TTS is enabled, plugin forwards `{text, seq, faceUrl, faceApiKey?}` to `/tts/speak`
- If `/api/speak` fails, plugin falls back to `idle` to avoid stuck speaking state

### What Gets Filtered

- System messages (cron outputs, health checks, token syncs)
- Internal tools (memory ops, Discord sync, message polling)
- Raw JSON tool outputs
- Messages under 5 characters

## Troubleshooting

- Face never speaks: confirm `face_url` is reachable and `/api/speak` auth matches `face_api_key`.
- TTS audio plays but lip sync desyncs: ensure TTS echoes plugin-provided `seq` to `/api/audio` and `/api/audio-done`.
- Frequent idle fallbacks: indicates `/api/speak` failures/timeouts; check server logs and network path.
