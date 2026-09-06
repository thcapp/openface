import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

// Build current sources into scratch space; never audit a stale deployed bundle.
const root = fileURLToPath(new URL("../", import.meta.url));
const output = await mkdtemp(join(tmpdir(), "openface-character-qa-"));
const entry = join(output, "entry.ts");
await Bun.write(entry, `export * from ${JSON.stringify(join(root, "packages/renderer/src/index.ts"))};
export { computeSceneFrame } from ${JSON.stringify(join(root, "packages/renderer/src/draw.ts"))};`);
const build = await Bun.build({ entrypoints: [entry], outdir: output, target: "browser" });
assert.ok(build.success, build.logs.map(String).join("\n"));

const manifest = JSON.parse(await readFile(join(root, "faces/index.json"), "utf8"));
const packs = [];
for (const item of [...manifest.official, ...manifest.community]) {
	const path = resolve(root, "faces", item.file);
	assert.ok(path.startsWith(resolve(root, "faces") + "/"));
	packs.push({ id: item.id, name: item.name, definition: JSON.parse(await readFile(path, "utf8")) });
}

const server = Bun.serve({
	hostname: "127.0.0.1", port: 0,
	fetch(request) {
		if (new URL(request.url).pathname === "/renderer.js") return new Response(Bun.file(build.outputs[0].path));
		return new Response("<!doctype html><html lang='en'><title>Open Face Character QA</title><body></body></html>", {
			headers: { "Content-Type": "text/html" },
		});
	},
});

let browser;
const browserErrors = [];
const runs = [];
try {
	browser = await chromium.launch({ headless: true });
	for (const dpr of [1, 2]) {
		const page = await browser.newPage({ viewport: { width: 1280, height: 1080 }, deviceScaleFactor: dpr });
		page.on("pageerror", (error) => browserErrors.push(error.message));
		await page.goto(`http://127.0.0.1:${server.port}`);
		const result = await page.evaluate(async ({ packs, dpr }) => {
			const { FaceRenderer, STATES, EMOTIONS, computeSceneFrame } = await import("/renderer.js");
			let seed = 17;
			Math.random = () => {
				seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
				return seed / 4294967296;
			};
			let now = performance.now();
			let nextId = 0;
			const callbacks = new Map();
			window.requestAnimationFrame = (callback) => { callbacks.set(++nextId, callback); return nextId; };
			window.cancelAnimationFrame = (id) => callbacks.delete(id);
			const advance = (frames, rate = 120) => {
				for (let frame = 0; frame < frames; frame++) {
					now += 1000 / rate;
					const pending = [...callbacks.values()];
					callbacks.clear();
					for (const callback of pending) callback(now);
				}
			};
			const failures = [];
			const check = (condition, message) => { if (!condition && failures.length < 100) failures.push(message); };
			const near = (a, b) => Math.abs(a - b) < 1e-6;
			let combinations = 0;
			let attachmentChecks = 0;
			let alphaChecks = 0;
			const diagnostics = [];
			const canvas = document.createElement("canvas");
			document.body.append(canvas);
			const renderer = new FaceRenderer({ canvas });
			renderer.resize(320, 240);
			renderer.start();
			for (const pack of packs) {
				renderer.loadFace(structuredClone(pack.definition));
				// These runtime fields are observed only by QA; this is not an authoring API.
				const g = renderer.geom;
				diagnostics.push({
					id: pack.id,
					pupilEnabled: g.pupilEnabled,
					pupilMatchesEyeFill: g.pupilEnabled && g.pupilColor.toLowerCase() === (g.eyeFillColor || g.featureColor).toLowerCase(),
					specularEnabled: g.specularEnabled,
				});
				for (const state of STATES) {
					for (const emotion of EMOTIONS) {
						renderer.setState({ state, emotion, amplitude: state === "speaking" ? 0.85 : 0, lookAt: { x: 0.8, y: -0.6 } });
						advance(12);
						combinations++;
						check(Object.values(renderer.current).every(Number.isFinite), `${pack.id}/${state}/${emotion}: non-finite pose`);
						check(renderer.getState().lookX === 0.8 && renderer.getState().lookY === -0.6, `${pack.id}: gaze command was mutated`);
					}
				}
				for (const [width, height] of [[96, 96], [320, 180], [180, 320], [512, 512]]) {
					renderer.resize(width, height);
					renderer.setState({ type: "reset" });
					advance(120);
					const scene = computeSceneFrame(width, height, g);
					for (const accessory of g.accessories) {
						const physics = renderer.accessoryPhysics.get(accessory.id);
						if (!physics) continue;
						attachmentChecks++;
						check(near(physics.points[0].x, scene.cx + scene.unit * accessory.anchor.x), `${pack.id}: detached antenna X at ${width}x${height}`);
						check(near(physics.points[0].y, scene.cy + scene.unit * (accessory.anchor.y + renderer.current.breathe * g.breathY)), `${pack.id}: detached antenna Y at ${width}x${height}`);
					}
					for (const style of ["minimal", "classic", "minimal"]) {
						renderer.setStyle(style);
						advance(2);
						alphaChecks++;
						const alpha = canvas.getContext("2d").getImageData(0, 0, 1, 1).data[3];
						check(alpha === (style === "minimal" ? 0 : 255), `${pack.id}: ${style} corner alpha=${alpha} at ${width}x${height}`);
					}
				}
			}
			renderer.stop();
			canvas.remove();
			document.body.innerHTML = `<style>
			*{box-sizing:border-box}body{margin:0;padding:24px;background:#eee9e0;color:#24231f;font-family:monospace}
			h1{font-size:22px;margin:0 0 18px}.grid{display:grid;grid-template-columns:repeat(4,1fr);gap:12px}
			.card{border:1px solid #c5c1b8;background:#fff}.card div{padding:9px}
			canvas{display:block;width:100%;height:204px;background:repeating-conic-gradient(#d8d5cf 0% 25%,#eeeae3 0% 50%) 50%/18px 18px}
			</style><h1>Open Face / idle / current sources</h1><main class="grid"></main>`;
			const portraits = [];
			for (const pack of packs) {
				const card = document.createElement("section"); card.className = "card";
				const label = document.createElement("div"); label.textContent = pack.name;
				const canvas = document.createElement("canvas"); card.append(label, canvas);
				document.querySelector("main").append(card);
				const r = new FaceRenderer({ canvas, reducedMotion: true });
				r.resize(canvas.clientWidth, 204);
				r.loadFace(structuredClone(pack.definition));
				r.blink.nextBlink = Number.POSITIVE_INFINITY;
				r.start(); portraits.push(r);
			}
			advance(240);
			window.showPose = (speaking, transparent) => {
				document.querySelector("h1").textContent = `Open Face / ${speaking ? "speaking" : "idle"} / ${transparent ? "transparent" : "solid"}`;
				for (const r of portraits) {
					r.setStyle(transparent ? "minimal" : "classic");
					r.setState({ state: speaking ? "speaking" : "idle", emotion: speaking ? "happy" : "neutral", amplitude: speaking ? 0.65 : 0 });
				}
				advance(240);
			};
			return { dpr, packs: packs.length, combinations, attachmentChecks, alphaChecks, diagnostics, failures };
		}, { packs, dpr });
		runs.push(result);
		await page.screenshot({ path: join(output, `idle-dpr${dpr}.png`), fullPage: true });
		await page.evaluate(() => window.showPose(false, true));
		await page.screenshot({ path: join(output, `transparent-dpr${dpr}.png`), fullPage: true });
		await page.evaluate(() => window.showPose(true, false));
		await page.screenshot({ path: join(output, `speaking-dpr${dpr}.png`), fullPage: true });
		await page.close();
	}
} finally {
	await browser?.close();
	server.stop(true);
}

await Bun.write(join(output, "results.json"), JSON.stringify({ runs, browserErrors }, null, 2));
console.log(JSON.stringify({
	output,
	combinations: runs.reduce((n, run) => n + run.combinations, 0),
	attachmentChecks: runs.reduce((n, run) => n + run.attachmentChecks, 0),
	alphaChecks: runs.reduce((n, run) => n + run.alphaChecks, 0),
	failures: runs.flatMap((run) => run.failures), browserErrors,
}, null, 2));
assert.deepEqual(browserErrors, []);
assert.deepEqual(runs.flatMap((run) => run.failures), []);
