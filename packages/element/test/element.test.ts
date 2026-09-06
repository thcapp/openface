import { beforeEach, describe, expect, test } from "bun:test";

// element.ts declares `class OpenFaceElement extends HTMLElement`, so the base class
// must exist before the module is evaluated. Nothing else in it runs at import time
// (customElements.define lives in index.ts), so the real methods can be probed here.
(globalThis as unknown as { HTMLElement: unknown }).HTMLElement = class {};

const { OpenFaceElement } = await import("../src/element.js");
// biome-ignore lint/suspicious/noExplicitAny: probing real prototype methods against stubs
const P = (OpenFaceElement as any).prototype;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("wsScheduleRetry lifecycle guard", () => {
	// `isConnected` is DOM attachment, not socket state. The guard was inverted, so
	// attached (visible) elements never reconnected and detached ones did.
	function countScheduled(opts: { serverUrl?: string; isConnected: boolean }): number {
		let scheduled = 0;
		const realSetTimeout = globalThis.setTimeout;
		// biome-ignore lint/suspicious/noExplicitAny: deliberate timer stub
		(globalThis as any).setTimeout = () => {
			scheduled++;
			return 1;
		};
		try {
			P.wsScheduleRetry.call({
				// `in` rather than `??` so an explicit undefined means "no server configured"
				serverUrl: "serverUrl" in opts ? opts.serverUrl : "wss://example.test/ws/viewer",
				isConnected: opts.isConnected,
				wsRetryTimer: null,
				wsRetryDelay: 1000,
			});
		} finally {
			globalThis.setTimeout = realSetTimeout;
		}
		return scheduled;
	}

	test("an attached element schedules a reconnect", () => {
		expect(countScheduled({ isConnected: true })).toBe(1);
	});

	test("a detached element does not schedule a reconnect", () => {
		expect(countScheduled({ isConnected: false })).toBe(0);
	});

	test("no configured server means no reconnect even when attached", () => {
		expect(countScheduled({ serverUrl: undefined, isConnected: true })).toBe(0);
	});
});

describe("audio playback lifecycle", () => {
	let spoken: string[];
	let stub: Record<string, unknown>;

	beforeEach(() => {
		spoken = [];
		const synth = {
			speak: (u: { text: string }) => spoken.push(u.text),
			cancel: () => {},
			getVoices: () => [{ name: "v", lang: "en-US", default: true }],
			addEventListener: () => {},
			speaking: false,
			pending: false,
		};
		// biome-ignore lint/suspicious/noExplicitAny: browser speech API stubs
		(globalThis as any).speechSynthesis = synth;
		// biome-ignore lint/suspicious/noExplicitAny: browser speech API stubs
		(globalThis as any).window = { speechSynthesis: synth };
		// biome-ignore lint/suspicious/noExplicitAny: browser speech API stubs
		(globalThis as any).SpeechSynthesisUtterance = class {
			text: string;
			constructor(t: string) {
				this.text = t;
			}
		};

		stub = {
			ttsEnabled: true,
			ttsActivated: true,
			ttsSpeaking: false,
			ttsLastText: "",
			ttsPendingText: "",
			audioEnabled: true,
			audioAuthoritative: false,
			audioPlaying: false,
			audioQueue: [],
			audioSeq: 0,
			audioStreamEnded: false,
			audioPhase: "idle",
			audioPendingTimer: null,
			audioPendingTimeoutMs: 10,
			audioDeferredText: null,
			chunks: [] as string[],
			getAttribute: () => null,
			ttsEnsureActivation() {},
			ttsPickVoice: () => null,
			handleAudioChunk(d: string) {
				(this as unknown as { chunks: string[] }).chunks.push(d);
			},
			// real implementations under test
			handleAudioMessage: P.handleAudioMessage,
			audioEnterPending: P.audioEnterPending,
			audioEnterActive: P.audioEnterActive,
			audioPendingExpired: P.audioPendingExpired,
			audioReleaseAuthority: P.audioReleaseAuthority,
			audioClearPendingTimer: P.audioClearPendingTimer,
			stopTts: P.stopTts,
			ttsSpeak: P.ttsSpeak,
		};
	});

	const call = (fn: string, ...args: unknown[]) => (stub[fn] as (...a: unknown[]) => void).call(stub, ...args);

	test("speaks normally when no audio sequence is announced", () => {
		call("ttsSpeak", "hello");
		expect(spoken).toEqual(["hello"]);
	});

	// The regression: a sequence announcement used to take authority permanently,
	// so a provider that never delivered a chunk left TTS silent forever.
	test("a sequence that never delivers audio falls back to TTS", async () => {
		call("handleAudioMessage", { type: "audio-seq", seq: 1 });
		expect(stub.audioPhase).toBe("pending");

		call("ttsSpeak", "fallback text");
		expect(spoken).toEqual([]); // held, not dropped

		await sleep(30);
		expect(stub.audioPhase).toBe("failed");
		expect(stub.audioAuthoritative).toBe(false);
		expect(spoken).toEqual(["fallback text"]);
	});

	test("later utterances still speak after a dead sequence", async () => {
		call("handleAudioMessage", { type: "audio-seq", seq: 1 });
		await sleep(30);
		call("ttsSpeak", "second");
		call("ttsSpeak", "third");
		expect(spoken).toContain("second");
		expect(spoken).toContain("third");
	});

	test("real audio takes authority and suppresses TTS", async () => {
		call("handleAudioMessage", { type: "audio-seq", seq: 1 });
		call("ttsSpeak", "should not be spoken");
		call("handleAudioMessage", { type: "audio", seq: 1, data: "chunk" });

		expect(stub.audioPhase).toBe("active");
		expect(stub.chunks).toEqual(["chunk"]);

		await sleep(30); // the pending timeout must not fire after audio arrived
		expect(spoken).toEqual([]);
		expect(stub.audioPhase).toBe("active");
	});

	test("audio-done releases authority", () => {
		call("handleAudioMessage", { type: "audio-seq", seq: 1 });
		call("handleAudioMessage", { type: "audio", seq: 1, data: "chunk" });
		call("handleAudioMessage", { type: "audio-done", seq: 1 });

		expect(stub.audioPhase).toBe("idle");
		expect(stub.audioAuthoritative).toBe(false);

		call("ttsSpeak", "after audio");
		expect(spoken).toEqual(["after audio"]);
	});

	// The plugin announces a sequence on every agent turn, even with TTS disabled.
	// Without the flag that meant a dead 1.5s wait before fallback, every turn.
	test("a sender that expects no audio does not hold back TTS at all", () => {
		call("handleAudioMessage", { type: "audio-seq", seq: 1, expectAudio: false });
		expect(stub.audioPhase).toBe("idle");
		expect(stub.audioAuthoritative).toBe(false);

		call("ttsSpeak", "immediate");
		expect(spoken).toEqual(["immediate"]); // no bounded wait
	});

	test("a sequence bump still invalidates stale audio when no audio is expected", () => {
		stub.audioQueue = ["stale"];
		call("handleAudioMessage", { type: "audio-seq", seq: 4, expectAudio: false });
		expect(stub.audioQueue).toEqual([]);
		expect(stub.audioSeq).toBe(4);
	});

	// Both servers broadcast the state message (with the text) before the sequence,
	// so speech has already started when audio-seq lands. Cancelling it is right only
	// if real audio follows; otherwise the utterance was cut off mid-word and lost.
	test("an utterance cut off by a sequence is resumed when no audio arrives", async () => {
		call("ttsSpeak", "the agent reply");
		stub.ttsSpeaking = true;
		expect(spoken).toEqual(["the agent reply"]);

		call("handleAudioMessage", { type: "audio-seq", seq: 1 });
		await sleep(30);

		expect(spoken).toEqual(["the agent reply", "the agent reply"]);
	});

	test("an utterance cut off by a sequence is not resumed when audio does arrive", async () => {
		call("ttsSpeak", "the agent reply");
		stub.ttsSpeaking = true;
		call("handleAudioMessage", { type: "audio-seq", seq: 1 });
		call("handleAudioMessage", { type: "audio", seq: 1, data: "chunk" });
		await sleep(30);

		expect(spoken).toEqual(["the agent reply"]); // external audio supersedes it
	});

	// audio and audio-done are gated on audioEnabled, so without it no chunk can ever
	// arrive to release authority — a second way the flag used to latch on forever.
	test("a viewer that cannot play audio never waits on a sequence", () => {
		stub.audioEnabled = false;
		call("handleAudioMessage", { type: "audio-seq", seq: 3 });
		expect(stub.audioPhase).toBe("idle");

		call("ttsSpeak", "immediate");
		expect(spoken).toEqual(["immediate"]);
	});

	test("stale chunks from an older sequence are ignored", () => {
		call("handleAudioMessage", { type: "audio-seq", seq: 5 });
		call("handleAudioMessage", { type: "audio", seq: 2, data: "stale" });
		expect(stub.chunks).toEqual([]);
	});
});
