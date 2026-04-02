import { FaceRenderer, STATES, EMOTIONS } from "@openface/renderer";
import type { FaceDefinition, FaceState, StateUpdate, StyleVariant } from "@openface/renderer";
import { BUILTIN_FACES } from "./builtin-faces.js";

/**
 * Build the shadow DOM template programmatically (no innerHTML).
 * This is static, known-safe content — no user input involved.
 */
function createShadowContent(): DocumentFragment {
	const frag = document.createDocumentFragment();
	const style = document.createElement("style");
	style.textContent = [
		":host { display: block; width: 100%; height: 100%; overflow: hidden; position: relative; }",
		"canvas { display: block; width: 100%; height: 100%; touch-action: none; }",
		".text-overlay {" +
			"position: absolute; bottom: 8%; left: 50%; transform: translateX(-50%);" +
			"max-width: 88%; padding: 6px 14px; border-radius: 10px;" +
			"background: rgba(0,0,0,0.55); color: #fff;" +
			"font: 500 clamp(12px, 2.5vw, 18px)/1.35 system-ui, sans-serif;" +
			"text-align: center; pointer-events: none;" +
			"opacity: 0; transition: opacity 0.25s ease;" +
			"word-break: break-word; z-index: 1;" +
		"}",
		".text-overlay.visible { opacity: 1; }",
	].join("\n");
	const canvas = document.createElement("canvas");
	const textOverlay = document.createElement("div");
	textOverlay.className = "text-overlay";
	textOverlay.setAttribute("aria-hidden", "true");
	frag.appendChild(style);
	frag.appendChild(canvas);
	frag.appendChild(textOverlay);
	return frag;
}

export class OpenFaceElement extends HTMLElement {
	static get observedAttributes() {
		return ["state", "emotion", "amplitude", "look-x", "look-y", "color", "face", "server", "style-variant", "audio-enabled", "volume", "debug-overlay", "tts", "tts-voice", "tts-rate", "tts-pitch"];
	}

	private renderer: FaceRenderer | null = null;
	private canvas: HTMLCanvasElement | null = null;
	private resizeObserver: ResizeObserver | null = null;
	private serverUrl: string | null = null;
	private ws: WebSocket | null = null;
	private wsRetryDelay = 1000;
	private wsRetryTimer: ReturnType<typeof setTimeout> | null = null;
	private wsPingTimer: ReturnType<typeof setInterval> | null = null;
	private reducedMotionMql: MediaQueryList | null = null;
	private faceLoadRequestId = 0;
	private faceDefCache = new Map<string, FaceDefinition>();
	private static sharedFaceCache = new Map<string, FaceDefinition>();
	private static manifestFileById = new Map<string, string>();
	private static preloadPromise: Promise<void> | null = null;

	// Text overlay
	private textOverlay: HTMLDivElement | null = null;
	private textHideTimer: ReturnType<typeof setTimeout> | null = null;

	// Built-in TTS (browser SpeechSynthesis)
	private ttsEnabled = false;
	private ttsActivated = false;
	private ttsSpeaking = false;
	private ttsLastText = "";
	private ttsPendingText = "";
	private audioAuthoritative = false;

	// Audio playback system
	private audioEnabled = false;
	private audioCtx: AudioContext | null = null;
	private gainNode: GainNode | null = null;
	private analyserNode: AnalyserNode | null = null;
	private audioQueue: AudioBuffer[] = [];
	private audioPlaying = false;
	private audioSeq = 0;
	private audioStreamEnded = false;
	private audioRafId: number | null = null;
	private volumeValue = 0.8;
	private readonly maxAudioQueue = 120;

	constructor() {
		super();
		this.attachShadow({ mode: "open" });
		const content = createShadowContent();
		this.canvas = content.querySelector("canvas");
		this.textOverlay = content.querySelector(".text-overlay");
		this.shadowRoot!.appendChild(content);
	}

	// --- Lifecycle ---

	connectedCallback() {
		if (!this.canvas) return;

		// Screen reader support
		this.setAttribute("role", "img");
		this.setAttribute("aria-live", "polite");
		this.updateAriaLabel();

		// Reactive reduced-motion: listen for changes instead of checking once
		this.reducedMotionMql = window.matchMedia("(prefers-reduced-motion: reduce)");
		const reducedMotion = this.reducedMotionMql.matches;
		this.reducedMotionMql.addEventListener("change", this.onReducedMotionChange);

		const style = (this.getAttribute("style-variant") || "classic") as StyleVariant;

		this.renderer = new FaceRenderer({
			canvas: this.canvas,
			style,
			reducedMotion,
			debugOverlay: this.hasAttribute("debug-overlay"),
		});

		this.renderer.onStateChanged((state, prev) => {
			this.updateAriaLabel();
			this.dispatchEvent(new CustomEvent("face-state-change", {
				bubbles: true, composed: true,
				detail: { state, previousState: prev },
			}));
		});

		this.resize();
		this.resizeObserver = new ResizeObserver(() => this.resize());
		this.resizeObserver.observe(this);

		this.renderer.start();

		window.addEventListener("message", this.onMessage);
		document.addEventListener("visibilitychange", this.onVisibilityChange);

		if (this.serverUrl) this.wsConnect();
		void OpenFaceElement.preloadFacePacks();

		// Apply initial attributes that were set before renderer existed
		const initState = this.getAttribute("state");
		const initEmotion = this.getAttribute("emotion");
		const initAmplitude = this.getAttribute("amplitude");
		if (initState || initEmotion || initAmplitude) {
			const update: Record<string, unknown> = {};
			if (initState) update.state = initState;
			if (initEmotion) update.emotion = initEmotion;
			if (initAmplitude) update.amplitude = parseFloat(initAmplitude);
			this.renderer.setState(update as any);
		}

		const faceName = this.getAttribute("face");
		if (faceName) this.loadFace(faceName);
	}

	disconnectedCallback() {
		this.renderer?.stop();
		this.renderer = null;

		this.resizeObserver?.disconnect();
		this.resizeObserver = null;

		this.reducedMotionMql?.removeEventListener("change", this.onReducedMotionChange);
		this.reducedMotionMql = null;

		if (this.textHideTimer) clearTimeout(this.textHideTimer);
		this.textHideTimer = null;
		this.stopTts();
		document.removeEventListener("click", this.ttsActivate);
		document.removeEventListener("touchstart", this.ttsActivate);
		document.removeEventListener("keydown", this.ttsActivate);

		window.removeEventListener("message", this.onMessage);
		document.removeEventListener("visibilitychange", this.onVisibilityChange);

		this.stopAmplitudeLoop();
		this.audioQueue = [];
		this.audioAuthoritative = false;
		this.audioCtx?.close().catch(() => {});
		this.audioCtx = null;

		this.wsDisconnect();
	}

	attributeChangedCallback(name: string, _oldVal: string | null, newVal: string | null) {
		switch (name) {
			case "state":
				if (newVal && STATES.includes(newVal as FaceState)) {
					this.renderer?.setState({ state: newVal as FaceState });
				}
				break;
			case "emotion":
				if (newVal && EMOTIONS.includes(newVal as FaceState)) {
					this.renderer?.setState({ emotion: newVal as StateUpdate["emotion"] });
					this.updateAriaLabel();
				}
				break;
			case "amplitude":
				this.renderer?.setState({ amplitude: parseFloat(newVal || "0") });
				break;
			case "look-x":
				this.renderer?.setState({ lookAt: { x: parseFloat(newVal || "0"), y: this.renderer?.getState().lookY ?? 0 } });
				break;
			case "look-y":
				this.renderer?.setState({ lookAt: { x: this.renderer?.getState().lookX ?? 0, y: parseFloat(newVal || "0") } });
				break;
			case "color":
				this.renderer?.setState({ color: newVal || null });
				break;
			case "face":
				if (newVal && this.isConnected) this.loadFace(newVal);
				break;
			case "server":
				this.serverUrl = newVal || null;
				if (this.isConnected) {
					this.wsDisconnect();
					if (this.serverUrl) this.wsConnect();
				}
				break;
			case "style-variant":
				this.renderer?.setStyle((newVal || "classic") as StyleVariant);
				break;
			case "audio-enabled":
				this.audioEnabled = newVal !== null && newVal !== "false";
				break;
			case "volume":
				this.volumeValue = Math.max(0, Math.min(1, parseFloat(newVal || "0.8")));
				if (this.gainNode) this.gainNode.gain.value = this.volumeValue;
				break;
			case "debug-overlay":
				this.renderer?.setDebugOverlay(newVal !== null && newVal !== "false");
				break;
			case "tts":
				this.ttsEnabled = newVal !== null && newVal !== "false";
				break;
			case "tts-voice":
			case "tts-rate":
			case "tts-pitch":
				// Read on demand when speaking
				break;
		}
	}

	// --- Public JS API ---

	get state(): string { return this.renderer?.getState().state ?? "idle"; }
	set state(v: string) {
		if (STATES.includes(v as FaceState)) {
			this.renderer?.setState({ state: v as FaceState });
			this.setAttribute("state", v);
		}
	}

	get emotion(): string { return this.renderer?.getState().emotion ?? "neutral"; }
	set emotion(v: string) {
		if (EMOTIONS.includes(v as FaceState)) {
			this.renderer?.setState({ emotion: v as StateUpdate["emotion"] });
			this.setAttribute("emotion", v);
		}
	}

	get amplitude(): number { return this.renderer?.getState().amplitude ?? 0; }
	set amplitude(v: number) {
		this.renderer?.setState({ amplitude: v });
	}

	get lookAt(): { x: number; y: number } {
		const s = this.renderer?.getState();
		return { x: s?.lookX ?? 0, y: s?.lookY ?? 0 };
	}
	set lookAt(v: { x: number; y: number }) {
		this.renderer?.setState({ lookAt: v });
	}

	/** Show text overlay. Pass null to hide. */
	setText(text: string | null, duration?: number): void {
		this.showText(text, duration);
	}

	get connected(): boolean {
		return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
	}

	/** Load a face definition object directly. */
	loadFaceDefinition(def: FaceDefinition): void {
		this.renderer?.loadFace(def);
	}

	// --- Face Loading ---

	private async loadFace(name: string): Promise<void> {
		const requestId = ++this.faceLoadRequestId;
		const embedded = BUILTIN_FACES[name];
		if (embedded) {
			if (requestId !== this.faceLoadRequestId) return;
			this.faceDefCache.set(name, embedded);
			OpenFaceElement.sharedFaceCache.set(name, embedded);
			this.renderer?.loadFace(embedded);
			this.setAttribute("loaded-face", name);
			return;
		}
		const cached = this.faceDefCache.get(name);
		if (cached) {
			if (requestId !== this.faceLoadRequestId) return;
			this.renderer?.loadFace(cached);
			this.setAttribute("loaded-face", name);
			return;
		}
		const sharedCached = OpenFaceElement.sharedFaceCache.get(name);
		if (sharedCached) {
			if (requestId !== this.faceLoadRequestId) return;
			this.faceDefCache.set(name, sharedCached);
			this.renderer?.loadFace(sharedCached);
			this.setAttribute("loaded-face", name);
			return;
		}

		await OpenFaceElement.preloadFacePacks();

		const urls: string[] = [];
		const mappedFile = OpenFaceElement.manifestFileById.get(name);
		if (mappedFile) {
			urls.push(`faces/${mappedFile}`);
			try {
				const base = new URL(".", import.meta.url).href;
				urls.push(`${base}faces/${mappedFile}`);
			} catch { /* ignore */ }
		} else {
			urls.push(`faces/${name}.face.json`);
			urls.push(`faces/community/${name}.face.json`);
			try {
				const base = new URL(".", import.meta.url).href;
				urls.push(`${base}faces/${name}.face.json`);
				urls.push(`${base}faces/community/${name}.face.json`);
			} catch { /* ignore */ }
		}

		for (const url of urls) {
			try {
				const res = await fetch(url, { cache: "no-store" });
				if (!res.ok) continue;
				const def = await res.json() as FaceDefinition;
				// Ignore stale async responses from older face selections.
				if (requestId !== this.faceLoadRequestId) return;
				this.faceDefCache.set(name, def);
				OpenFaceElement.sharedFaceCache.set(name, def);
				this.renderer?.loadFace(def);
				this.setAttribute("loaded-face", name);
				return;
			} catch { /* ignore */ }
		}

		// Never leave stale previous-pack geometry active after a failed fetch.
		if (name !== "default") {
			await this.loadFace("default");
			return;
		}
		console.warn(`[open-face] Failed to load face "${name}" from URLs: ${urls.join(", ")}`);
		this.renderer?.resetFace();
		this.setAttribute("loaded-face", "default");
	}

	private static async preloadFacePacks(): Promise<void> {
		if (OpenFaceElement.preloadPromise) return OpenFaceElement.preloadPromise;
		OpenFaceElement.preloadPromise = (async () => {
			for (const [id, def] of Object.entries(BUILTIN_FACES)) {
				if (!OpenFaceElement.sharedFaceCache.has(id)) {
					OpenFaceElement.sharedFaceCache.set(id, def);
				}
			}
			const manifestUrls = ["faces/index.json"];
			try {
				const base = new URL(".", import.meta.url).href;
				manifestUrls.push(`${base}faces/index.json`);
			} catch { /* ignore */ }

			type ManifestFace = { id?: string; file?: string };
			type ManifestShape = {
				official?: ManifestFace[];
				community?: ManifestFace[];
			};
			let manifestFaces: ManifestFace[] = [];
			for (const url of manifestUrls) {
				try {
					const res = await fetch(url, { cache: "no-store" });
					if (!res.ok) continue;
					const manifest = await res.json() as ManifestShape;
					const official = Array.isArray(manifest.official) ? manifest.official : [];
					const community = Array.isArray(manifest.community) ? manifest.community : [];
					const merged = [...official, ...community];
					if (merged.length > 0) {
						manifestFaces = merged;
						break;
					}
				} catch { /* ignore */ }
			}
			if (manifestFaces.length === 0) return;

			for (const entry of manifestFaces) {
				const id = typeof entry.id === "string" ? entry.id : "";
				const file = typeof entry.file === "string" ? entry.file : "";
				if (!id || !file) continue;
				if (!OpenFaceElement.manifestFileById.has(id)) {
					OpenFaceElement.manifestFileById.set(id, file);
				}
			}
		})();
		return OpenFaceElement.preloadPromise;
	}

	// --- Resize ---

	private resize(): void {
		const rect = this.getBoundingClientRect();
		this.renderer?.resize(rect.width, rect.height);
		// Flag small sizes so face packs can simplify rendering
		if (rect.width < 128 || rect.height < 128) {
			this.setAttribute("data-small", "");
		} else {
			this.removeAttribute("data-small");
		}
	}

	// --- Accessibility ---

	private updateAriaLabel(): void {
		const state = this.renderer?.activeState ?? this.getAttribute("state") ?? "idle";
		const emotion = this.renderer?.getState().emotion ?? this.getAttribute("emotion") ?? "neutral";
		this.setAttribute("aria-label", `Face: ${state}, feeling ${emotion}`);
	}

	private onReducedMotionChange = (e: MediaQueryListEvent): void => {
		this.renderer?.setReducedMotion(e.matches);
	};

	// --- postMessage support ---

	private onMessage = (e: MessageEvent): void => {
		try {
			const data = typeof e.data === "string" ? JSON.parse(e.data) : e.data;
			if (!data || data.type !== "face-state") return;
			this.renderer?.setState(data as StateUpdate);
			if (data.state || data.emotion) this.updateAriaLabel();
			if ("text" in data) {
				this.showText(data.text, data.textDuration);
				if (data.text) this.ttsSpeak(data.text);
			}
		} catch { /* ignore */ }
	};

	// --- WebSocket ---

	private wsConnect(): void {
		if (!this.serverUrl) return;
		if (this.ws && (this.ws.readyState === WebSocket.CONNECTING || this.ws.readyState === WebSocket.OPEN)) return;

		try {
			this.ws = new WebSocket(this.serverUrl);
		} catch {
			this.wsScheduleRetry();
			return;
		}

		this.ws.onopen = () => {
			this.wsRetryDelay = 1000;
			this.renderer?.setDisconnected(false);
			if (this.wsPingTimer) clearInterval(this.wsPingTimer);
			this.wsPingTimer = setInterval(() => {
				if (this.ws?.readyState === WebSocket.OPEN) {
					this.ws.send(JSON.stringify({ type: "ping" }));
				}
			}, 30000);
			this.dispatchEvent(new CustomEvent("face-connected", { bubbles: true, composed: true }));
		};

		this.ws.onmessage = (event) => {
			try {
				const data = JSON.parse(event.data as string);
				if (data.type === "pong") return;
				if (data.type === "state") {
					this.renderer?.setState(data as StateUpdate);
					if (data.state || data.emotion) this.updateAriaLabel();
					if ("text" in data) {
						this.showText(data.text, data.textDuration);
						if (data.text) this.ttsSpeak(data.text);
					}
					this.dispatchEvent(new CustomEvent("face-state-data", {
						bubbles: true,
						composed: true,
						detail: data,
					}));
				}
				// Audio messages
					if (data.type === "audio-seq") {
						// New speech — flush old queue if seq is higher
						if (data.seq > this.audioSeq) {
							this.audioSeq = data.seq;
							this.audioQueue = [];
							this.audioStreamEnded = false;
							this.audioAuthoritative = true;
							this.stopTts();
						}
					}
					if (data.type === "audio" && this.audioEnabled && data.data) {
						if (typeof data.seq === "number") {
							if (data.seq < this.audioSeq) return;
							if (data.seq > this.audioSeq) {
								this.audioSeq = data.seq;
								this.audioQueue = [];
								this.audioStreamEnded = false;
							}
						}
						this.audioAuthoritative = true;
						this.stopTts();
						this.handleAudioChunk(data.data);
					}
					if (data.type === "audio-done" && this.audioEnabled) {
						if (typeof data.seq !== "number" || data.seq === this.audioSeq) {
							this.audioStreamEnded = true;
							if (!this.audioPlaying && this.audioQueue.length === 0) {
								this.audioAuthoritative = false;
							}
						}
					}
			} catch { /* ignore */ }
		};

		this.ws.onclose = () => {
			this.renderer?.setState({ state: "sleeping", emotion: "neutral" });
			this.renderer?.setDisconnected(true);
			if (this.wsPingTimer) clearInterval(this.wsPingTimer);
			this.dispatchEvent(new CustomEvent("face-disconnected", { bubbles: true, composed: true }));
			this.wsScheduleRetry();
		};

		this.ws.onerror = () => {};
	}

	private wsScheduleRetry(): void {
		if (!this.serverUrl || this.isConnected) return;
		if (this.wsRetryTimer) clearTimeout(this.wsRetryTimer);
		this.wsRetryTimer = setTimeout(
			() => this.wsConnect(),
			this.wsRetryDelay + this.wsRetryDelay * 0.3 * Math.random(),
		);
		this.wsRetryDelay = Math.min(this.wsRetryDelay * 1.5, 60000);
	}

	private wsDisconnect(): void {
		if (this.wsRetryTimer) clearTimeout(this.wsRetryTimer);
		if (this.wsPingTimer) clearInterval(this.wsPingTimer);
		if (this.ws) {
			this.ws.onclose = null;
			this.ws.onerror = null;
			this.ws.onmessage = null;
			this.ws.onopen = null;
			if (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING) {
				this.ws.close();
			}
			this.ws = null;
		}
		this.audioAuthoritative = false;
	}

	private onVisibilityChange = (): void => {
		if (!document.hidden && this.serverUrl && (!this.ws || this.ws.readyState !== WebSocket.OPEN)) {
			this.wsConnect();
		}
	};

	// --- Audio Playback ---

	private ensureAudioCtx(): void {
		if (this.audioCtx) return;
		this.audioCtx = new AudioContext();
		this.gainNode = this.audioCtx.createGain();
		this.gainNode.gain.value = this.volumeValue;
		this.analyserNode = this.audioCtx.createAnalyser();
		this.analyserNode.fftSize = 256;
		this.gainNode.connect(this.analyserNode);
		this.analyserNode.connect(this.audioCtx.destination);
	}

	private async handleAudioChunk(base64: string): Promise<void> {
		try {
			this.ensureAudioCtx();
			if (this.audioCtx!.state === "suspended") await this.audioCtx!.resume();

			const binary = atob(base64);
			const bytes = new Uint8Array(binary.length);
			for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

			const audioBuffer = await this.audioCtx!.decodeAudioData(bytes.buffer);
			this.audioQueue.push(audioBuffer);
			// Bound queue growth under long streams.
			if (this.audioQueue.length > this.maxAudioQueue) {
				this.audioQueue.splice(0, this.audioQueue.length - this.maxAudioQueue);
			}

			if (!this.audioPlaying) this.playNextChunk();
		} catch {
			// Decode failed — skip chunk
		}
	}

	private playNextChunk(): void {
		if (this.audioQueue.length === 0) {
			this.audioPlaying = false;
			if (this.audioStreamEnded) {
				// All audio finished — return to idle
				this.renderer?.setState({ amplitude: 0 });
				this.stopAmplitudeLoop();
				this.audioAuthoritative = false;
				this.dispatchEvent(new CustomEvent("face-audio-ended", { bubbles: true, composed: true }));
			}
			return;
		}

		this.audioPlaying = true;
		const buffer = this.audioQueue.shift()!;
		const source = this.audioCtx!.createBufferSource();
		source.buffer = buffer;
		source.connect(this.gainNode!);
		source.onended = () => this.playNextChunk();
		source.start();

		if (!this.audioRafId) this.startAmplitudeLoop();
	}

	private startAmplitudeLoop(): void {
		if (!this.analyserNode) return;
		const data = new Uint8Array(this.analyserNode.fftSize);

		const tick = () => {
			if (!this.audioPlaying && this.audioQueue.length === 0) {
				this.audioRafId = null;
				return;
			}
			this.analyserNode!.getByteTimeDomainData(data);
			// Compute RMS amplitude (0-1)
			let sum = 0;
			for (let i = 0; i < data.length; i++) {
				const v = (data[i] - 128) / 128;
				sum += v * v;
			}
			const rms = Math.sqrt(sum / data.length);
			const amplitude = Math.min(1, rms * 3); // scale up for visual impact
			this.renderer?.setState({ amplitude });

			this.audioRafId = requestAnimationFrame(tick);
		};
		this.audioRafId = requestAnimationFrame(tick);
	}

	// --- Built-in TTS ---

	// Ranked voice name patterns by quality (from readium/speech voice database)
	// veryHigh: Edge Natural voices > high: Google/Android/Apple > normal: everything else
	private static readonly TTS_VOICE_RANK: Array<[RegExp, number]> = [
		[/Natural\)/, 4],           // Edge Neural/Natural voices (veryHigh)
		[/Google.*English/, 3],     // Chrome desktop Google voices (high)
		[/\ben-/, 2],               // Any English-tagged voice (normal)
	];

	private ttsPickVoice(): SpeechSynthesisVoice | null {
		const voices = speechSynthesis.getVoices();
		if (!voices.length) return null;

		const lang = this.getAttribute("tts-voice") || navigator.language || "en";
		const langPrefix = lang.slice(0, 2).toLowerCase();

		let best: SpeechSynthesisVoice | null = null;
		let bestScore = -1;

		for (const v of voices) {
			const vLang = v.lang.toLowerCase();
			if (!vLang.startsWith(langPrefix)) continue;

			let score = 0;
			if (v.localService) score += 1; // prefer local (no network latency)
			for (const [pattern, bonus] of OpenFaceElement.TTS_VOICE_RANK) {
				if (pattern.test(v.name)) { score += bonus; break; }
			}
			if (score > bestScore) { bestScore = score; best = v; }
		}

		return best;
	}

	private ttsActivate = (): void => {
		// Warm up speechSynthesis with a silent utterance during user gesture
		const silent = new SpeechSynthesisUtterance("");
		speechSynthesis.speak(silent);
		this.ttsActivated = true;
		document.removeEventListener("click", this.ttsActivate);
		document.removeEventListener("touchstart", this.ttsActivate);
		document.removeEventListener("keydown", this.ttsActivate);
		// Speak any pending text
		if (this.ttsPendingText) {
			const text = this.ttsPendingText;
			this.ttsPendingText = "";
			setTimeout(() => this.ttsSpeak(text), 100);
		}
	};

	private ttsEnsureActivation(): void {
		if (this.ttsActivated) return;
		document.addEventListener("click", this.ttsActivate, { once: false });
		document.addEventListener("touchstart", this.ttsActivate, { once: false });
		document.addEventListener("keydown", this.ttsActivate, { once: false });
	}

	private stopTts(): void {
		if (!window.speechSynthesis) return;
		if (window.speechSynthesis.speaking || window.speechSynthesis.pending || this.ttsSpeaking) {
			window.speechSynthesis.cancel();
		}
		this.ttsSpeaking = false;
		this.ttsPendingText = "";
	}

	private ttsSpeak(text: string): void {
		if (!this.ttsEnabled || !text || !window.speechSynthesis) return;
		if (this.audioAuthoritative || this.audioPlaying || this.audioQueue.length > 0) return;
		if (text === this.ttsLastText && this.ttsSpeaking) return;

		// Chrome requires user activation for speechSynthesis
		if (!this.ttsActivated) {
			this.ttsPendingText = text;
			this.ttsEnsureActivation();
			return;
		}

		// Ensure voices are loaded (Chrome loads them async)
		if (!speechSynthesis.getVoices().length) {
			speechSynthesis.addEventListener("voiceschanged", () => this.ttsSpeak(text), { once: true });
			return;
		}

		this.ttsLastText = text;
		window.speechSynthesis.cancel();

		const utterance = new SpeechSynthesisUtterance(text);

		const rate = this.getAttribute("tts-rate");
		const pitch = this.getAttribute("tts-pitch");
		if (rate) utterance.rate = Math.max(0.1, Math.min(10, parseFloat(rate)));
		if (pitch) utterance.pitch = Math.max(0, Math.min(2, parseFloat(pitch)));

		// Smart voice selection: explicit tts-voice overrides auto-pick
		const voiceAttr = this.getAttribute("tts-voice");
		const explicit = voiceAttr ? speechSynthesis.getVoices().find(v => v.name === voiceAttr) : null;
		utterance.voice = explicit || this.ttsPickVoice() || null;

		let boundaryToggle = false;
		utterance.onstart = () => {
			this.ttsSpeaking = true;
			this.renderer?.setState({ state: "speaking" as any, amplitude: 0.5 });
		};
		utterance.onboundary = () => {
			boundaryToggle = !boundaryToggle;
			this.renderer?.setState({ amplitude: boundaryToggle ? 0.7 : 0.3 });
		};
		utterance.onend = () => {
			this.ttsSpeaking = false;
			this.renderer?.setState({ state: "idle" as any, amplitude: 0 });
		};
		utterance.onerror = () => {
			this.ttsSpeaking = false;
			this.renderer?.setState({ amplitude: 0 });
		};

		window.speechSynthesis.speak(utterance);
	}


	// --- Text Overlay ---

	private showText(text: string | null | undefined, duration?: number): void {
		if (!this.textOverlay) return;

		if (this.textHideTimer) {
			clearTimeout(this.textHideTimer);
			this.textHideTimer = null;
		}

		if (!text) {
			this.textOverlay.classList.remove("visible");
			return;
		}

		this.textOverlay.textContent = text;
		this.textOverlay.classList.add("visible");

		const ms = duration && duration > 0 ? duration : 4000;
		this.textHideTimer = setTimeout(() => {
			this.textOverlay?.classList.remove("visible");
			this.textHideTimer = null;
		}, ms);
	}

	private stopAmplitudeLoop(): void {
		if (this.audioRafId) {
			cancelAnimationFrame(this.audioRafId);
			this.audioRafId = null;
		}
	}
}
