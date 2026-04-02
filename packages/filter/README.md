# @openface/filter

Output filtering and normalization pipeline. Takes raw AI agent output from any provider and produces clean StateUpdate messages for Open Face.

## Usage

```ts
import { createFilter } from "@openface/filter";

const filter = createFilter({ provider: "claude" });

const result = filter.process(rawMessage);
// result.stateUpdate  → { state, emotion, intensity, text, ... }
// result.displayText  → cleaned text for speech bubble
// result.category     → "display" | "status" | "summarizable" | "internal" | "error"
```

## Pipeline

```
Raw agent output → Extract → Classify → Detect Emotion → Summarize → Clean → StateUpdate
```

### Providers

| Provider | Extractor | Notes |
|----------|-----------|-------|
| Claude | `extractClaude()` | Content blocks, tool_use, thinking |
| OpenAI | `extractOpenAI()` | Chat + Responses API, tool_calls |
| Gemini | `extractGemini()` | Parts-based, functionCall |
| Ollama | `extractOllama()` | NDJSON streaming |
| Auto | `extractAuto()` | Detects provider from message shape |

### Emotion Detection

Hybrid pipeline:
1. **Pattern matching** (primary): 20+ regex rules mapping agent vocabulary to 13 emotions with calibrated intensity
2. **State inference**: tool name → face state + default emotion (e.g., Bash → working/determined)
3. **Blending**: multiple signals combined into primary + secondary emotion

### Text Cleaning

- Markdown stripping (headers, bold, lists → plain text)
- Discord noise removal (snowflake IDs, mentions, embeds)
- Sentence-boundary chunking for TTS (`chunkBySentence()`, `prepareForTTS()`)
- No hard truncation — full text preserved, display layers handle overflow

### Tool Summarization

Raw JSON → human-readable:
- `Bash` → "Running: git status"
- `Read` → "Reading: src/index.ts"
- `Edit` → "Editing: package.json"
- `Grep` → "Searching: handleAuth"
- `WebSearch` → "Searching web: cloudflare workers pricing"
