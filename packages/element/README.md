# @openface/element

`<open-face>` web component. Drop-in animated AI face.

## Usage

```html
<script src="https://openface.live/open-face.js"></script>
<open-face state="thinking" emotion="happy" face="cyberpunk"></open-face>
```

### Connected Mode (WebSocket)

```html
<open-face server="ws://localhost:9999/ws/viewer" face="default"></open-face>
```

### Standalone Mode (Attributes)

```html
<open-face id="face" state="idle" emotion="neutral"></open-face>
<script>
  const face = document.getElementById("face");
  face.state = "speaking";
  face.emotion = "excited";
  face.amplitude = 0.6;
  face.lookAt = { x: 0.3, y: -0.1 };
</script>
```

## Attributes

| Attribute | Description |
|-----------|-------------|
| `state` | Face state (idle, thinking, speaking, etc.) |
| `emotion` | Emotion (neutral, happy, sad, etc.) |
| `amplitude` | Mouth openness (0-1) |
| `look-x` / `look-y` | Gaze direction (-1 to 1) |
| `color` | Override face color (hex) |
| `face` | Face pack name (loads from `faces/{name}.face.json`) |
| `server` | WebSocket URL for live connection |
| `style-variant` | classic, gradient, or minimal |
| `audio-enabled` | Enable audio playback + lip sync from WS |
| `volume` | Audio volume (0-1, default 0.8) |
| `tts` | Enable built-in browser text-to-speech (fallback when no audio chunks) |
| `tts-voice` | TTS voice name or language code (e.g. "en-US") |
| `tts-rate` | TTS speech rate (0.1-10, default 1) |
| `tts-pitch` | TTS pitch (0-2, default 1) |
| `debug-overlay` | Enable renderer debug guides (eye bounds/reference lines) |

## Events

| Event | When |
|-------|------|
| `face-state-change` | State transitions |
| `face-state-data` | Raw `type:"state"` payload received from server |
| `face-connected` | WebSocket connected |
| `face-disconnected` | WebSocket disconnected |
| `face-audio-ended` | All audio chunks finished playing |

## Public Methods

- `loadFaceDefinition(def)` — load a face definition object directly
- `setText(text, duration?)` — show/hide text overlay imperatively

## Audio

When `audio-enabled` is set, the element handles audio natively:
- Decodes base64 WAV chunks from `type:"audio"` WebSocket messages
- Queues and plays sequentially through Web Audio API
- Extracts RMS amplitude from the waveform every frame → drives mouth
- Tracks `seq` to drop stale chunks and flush on newer speech streams
- Caps queue length to prevent unbounded growth during long streams
- Honors `audio-done.seq` so stream completion matches the active sequence
- Dispatches `face-audio-ended` when active stream chunks finish

## Built-in TTS

When the `tts` attribute is set, the element speaks text aloud using the browser's SpeechSynthesis API — no external TTS server needed:

```html
<open-face server="ws://localhost:9999/ws/viewer" tts></open-face>
```

- Text received via WebSocket or postMessage is spoken automatically
- Face transitions to `speaking` with simulated amplitude from word boundaries
- Returns to `idle` when speech ends
- **External audio takes priority** — if WAV chunks are flowing via the audio pipeline, TTS stays silent
- Customize with `tts-voice`, `tts-rate`, `tts-pitch` attributes

This is a zero-config fallback. For production quality, use the audio pipeline with your own TTS model.

## Accessibility

- `role="img"` with dynamic `aria-label`
- `aria-live="polite"` announces state changes
- Reactive `prefers-reduced-motion` support
- `data-small` attribute below 128px for style adaptation

## Troubleshooting

- No audio playback: ensure `audio-enabled` is set and browser autoplay policies allow resumed `AudioContext`.
- Missing chat/activity overlays: listen for `face-state-data` events (contains raw state payload including `text`/`detail`).
- Old audio leaking into new speech: verify upstream sends increasing `audio-seq` and matching `audio-done.seq`.
