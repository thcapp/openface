function escapeHtml(s: string): string {
	return s
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#039;");
}

export function renderViewerHtml(username: string, facePack: string, host: string): string {
	const safeUsername = escapeHtml(username);
	const safeFacePack = escapeHtml(facePack);
	const safeHost = escapeHtml(host);
	return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${safeUsername} — Open Face</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { height: 100%; overflow: hidden; background: #0a0a0f; }
  open-face { width: 100%; height: 100%; display: block; }
</style>
</head>
<body>
<open-face
  id="face"
  server="wss://${safeHost}/${safeUsername}/ws/viewer"
  face="${safeFacePack}"
  state="idle"
  emotion="neutral"
  audio-enabled
></open-face>
<script type="module" src="/open-face.js"></script>
<script>
  (function () {
    const params = new URLSearchParams(location.search);
    const face = document.getElementById("face");
    if (!face) return;
    const ttsParam = params.get("tts");
    const enabled = ttsParam !== null && !["0", "false", "off", "no"].includes(String(ttsParam).toLowerCase());
    if (!enabled) return;
    face.setAttribute("tts", "");
    const voice = params.get("tts-voice");
    const rate = params.get("tts-rate");
    const pitch = params.get("tts-pitch");
    if (voice) face.setAttribute("tts-voice", voice);
    if (rate) face.setAttribute("tts-rate", rate);
    if (pitch) face.setAttribute("tts-pitch", pitch);
  })();
</script>
</body>
</html>`;
}

export function renderUnclaimedHtml(username: string): string {
	const safeUsername = escapeHtml(username);
	return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${safeUsername} — Available on Open Face</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: system-ui, sans-serif; background: #0a0a0f; color: #e8e8f0; display: flex; align-items: center; justify-content: center; min-height: 100vh; }
  .card { text-align: center; max-width: 400px; padding: 2rem; }
  h1 { font-size: 1.5rem; margin-bottom: 0.5rem; }
  h1 span { color: #4FC3F7; }
  p { color: #9999b0; margin-bottom: 1.5rem; font-size: 0.95rem; }
  .face-preview { width: 160px; height: 160px; margin: 0 auto 1.5rem; border-radius: 16px; overflow: hidden; border: 1px solid #2a2a3f; }
  .face-preview open-face { width: 100%; height: 100%; }
  .btn { display: inline-block; background: #4FC3F7; color: #0a0a0f; font-weight: 700; padding: 0.6rem 1.5rem; border-radius: 6px; text-decoration: none; font-size: 0.9rem; }
  .btn:hover { opacity: 0.85; }
  .url { font-family: 'SF Mono', monospace; color: #4FC3F7; font-size: 0.85rem; margin-top: 1rem; }
</style>
</head>
<body>
<div class="card">
  <div class="face-preview">
    <open-face state="waiting" emotion="neutral" face="default"></open-face>
  </div>
  <h1><span>${safeUsername}</span> is available</h1>
  <p>This face hasn't been claimed yet. Make it yours.</p>
  <a class="btn" href="https://openface.live/docs/integration">Claim this face</a>
  <div class="url">oface.io/${safeUsername}</div>
</div>
<script type="module" src="/open-face.js"></script>
</body>
</html>`;
}
