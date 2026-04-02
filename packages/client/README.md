# @openface/client

Client library for controlling Open Face from any AI agent.

## Usage

```ts
import { OpenFaceClient } from "@openface/client";

const face = new OpenFaceClient("http://localhost:9999", {
  apiKey: "optional-secret",
});

// Push state
await face.setState({
  state: "speaking",
  emotion: "happy",
  intensity: 0.8,
  text: "Hello!",
});

// Convenience methods
await face.thinking("confused");
await face.speaking("Let me explain...", 0.6);
await face.listening();
await face.idle();
await face.reset();

// Read state
const state = await face.getState();
const health = await face.health();
```

## API

| Method | Description |
|--------|-------------|
| `setState(update)` | Push partial state update |
| `reset()` | Reset to defaults |
| `getState()` | Read current state |
| `health()` | Server health check |
| `thinking(emotion?)` | Set thinking state |
| `speaking(text?, amplitude?)` | Set speaking with text |
| `listening()` | Set listening state |
| `idle()` | Set idle state |
