import { dlerp, hexToRGB, rgbToHex, softLimit } from "./math.js";
import {
	computeAntennaRestPoint,
	resolveAccessoryPatch,
	resolveAntennaPhysicsConfig,
	type AccessorySimulationFrame,
} from "./accessory-physics.js";
import type {
	AccessoryDefinition,
	AccessoryLayer,
	AccessoryPhysicsState,
	BrowRenderer,
	CurrentState,
	EyeStyle,
	FaceDecoration,
	FaceEmotion,
	FaceGeometry,
	FaceState,
	MouthStyle,
	PupilShape,
	SpecularShape,
	StyleVariant,
	TargetState,
} from "./types.js";

export interface ColorState {
	r: number;
	g: number;
	b: number;
}

export function createColorState(): ColorState {
	return { r: 79, g: 195, b: 247 }; // #4FC3F7 (idle blue)
}

function clamp(val: number, min: number, max: number): number {
	return Math.max(min, Math.min(max, val));
}

function shiftColorChannel(channel: number, delta: number): number {
	return clamp(channel + delta, 0, 255);
}

function shiftHexColor(r: number, g: number, b: number, delta: number): string {
	return rgbToHex(
		shiftColorChannel(r, delta),
		shiftColorChannel(g, delta),
		shiftColorChannel(b, delta),
	);
}

function pathRoundedRect(
	ctx: CanvasRenderingContext2D,
	x: number,
	y: number,
	w: number,
	h: number,
	r: number,
): void {
	const rr = Math.max(0, Math.min(r, w * 0.5, h * 0.5));
	ctx.moveTo(x + rr, y);
	ctx.lineTo(x + w - rr, y);
	ctx.arcTo(x + w, y, x + w, y + rr, rr);
	ctx.lineTo(x + w, y + h - rr);
	ctx.arcTo(x + w, y + h, x + w - rr, y + h, rr);
	ctx.lineTo(x + rr, y + h);
	ctx.arcTo(x, y + h, x, y + h - rr, rr);
	ctx.lineTo(x, y + rr);
	ctx.arcTo(x, y, x + rr, y, rr);
	ctx.closePath();
}

function drawBody(
	ctx: CanvasRenderingContext2D,
	unit: number,
	cx: number,
	cy: number,
	breathY: number,
	current: CurrentState,
	geom: FaceGeometry,
	activeState: FaceState,
	stateTime: number,
	reducedMotion: boolean,
): void {
	if (!geom.bodyEnabled) return;

	const motionMul = reducedMotion ? 0 : 1;
	const maxShiftX = Math.max(0, geom.bodyMaxShiftX) * unit;
	const maxShiftY = Math.max(0, geom.bodyMaxShiftY) * unit;
	const maxTilt = Math.max(0, geom.bodyMaxTilt);
	const idleSway = motionMul
		? Math.sin(stateTime * Math.max(0.1, geom.bodyMotionIdleSwayRate)) * unit * geom.bodyMotionIdleSway * 0.02
		: 0;
	const speakingBob = motionMul && activeState === "speaking"
		? current.amplitude * unit * geom.bodyMotionSpeakingBob * 0.03
		: 0;
	const shiftXRaw = current.lookX * unit * geom.bodyMotionWeightShift * 0.08 + idleSway;
	const shiftYRaw = breathY * geom.bodyMotionBreathFollow + speakingBob;
	const shiftX = maxShiftX > 0 ? softLimit(shiftXRaw, -maxShiftX, maxShiftX) : 0;
	const shiftY = maxShiftY > 0 ? softLimit(shiftYRaw, -maxShiftY, maxShiftY) : 0;
	const bodyTiltRaw = current.tilt * geom.bodyMotionTiltFollow;
	const bodyTilt = maxTilt > 0 ? softLimit(bodyTiltRaw, -maxTilt, maxTilt) : 0;
	const autoBodyOffsetY = computeAutoBodyOffsetY(geom);
	const bx = cx + unit * geom.bodyAnchorX + shiftX;
	const by = cy + unit * (geom.bodyAnchorY + autoBodyOffsetY) + shiftY;
	const bw = Math.max(1, unit * geom.bodyW);
	const bh = Math.max(1, unit * geom.bodyH);
	const rr = Math.max(0, Math.min(unit * geom.bodyRadius, bw * 0.5, bh * 0.5));

	ctx.save();
	ctx.translate(bx, by);
	ctx.rotate(bodyTilt);

	// Soft contact shadow to anchor the silhouette spatially.
	const shadowAlpha = clamp(geom.bodyShadowAlpha, 0, 1);
	if (shadowAlpha > 0.001) {
		ctx.save();
		ctx.globalAlpha = shadowAlpha;
		ctx.fillStyle = geom.bodyShadowColor;
		ctx.beginPath();
		ctx.ellipse(0, bh * 0.58, bw * 0.72, bh * 0.18, 0, 0, Math.PI * 2);
		ctx.fill();
		ctx.restore();
	}

	if (geom.bodyShouldersEnabled) {
		const sw = Math.max(1, unit * geom.bodyShouldersW);
		const ss = unit * geom.bodyShouldersSlope;
		const st = Math.max(1, unit * geom.bodyShouldersThick);
		const sy = -bh * 0.5 + st * 0.2;
		ctx.beginPath();
		ctx.moveTo(-sw * 0.5, sy + ss);
		ctx.lineTo(sw * 0.5, sy - ss);
		ctx.lineTo(sw * 0.5, sy - ss + st);
		ctx.lineTo(-sw * 0.5, sy + ss + st);
		ctx.closePath();
		ctx.fillStyle = geom.bodyStrokeColor;
		ctx.fill();
	}

	ctx.beginPath();
	switch (geom.bodyShape) {
		case "trapezoid": {
			const topW = bw * 0.68;
			ctx.moveTo(-topW * 0.5, -bh * 0.5);
			ctx.lineTo(topW * 0.5, -bh * 0.5);
			ctx.lineTo(bw * 0.5, bh * 0.5);
			ctx.lineTo(-bw * 0.5, bh * 0.5);
			ctx.closePath();
			break;
		}
		case "blob":
			ctx.moveTo(-bw * 0.42, -bh * 0.45);
			ctx.bezierCurveTo(-bw * 0.66, -bh * 0.18, -bw * 0.6, bh * 0.38, -bw * 0.2, bh * 0.5);
			ctx.bezierCurveTo(bw * 0.05, bh * 0.58, bw * 0.5, bh * 0.45, bw * 0.56, bh * 0.12);
			ctx.bezierCurveTo(bw * 0.62, -bh * 0.22, bw * 0.3, -bh * 0.56, -bw * 0.1, -bh * 0.52);
			ctx.closePath();
			break;
		case "roundedRect":
			pathRoundedRect(ctx, -bw * 0.5, -bh * 0.5, bw, bh, rr);
			break;
		case "capsule":
		default: {
			const capsuleRadius = Math.min(rr || bw * 0.5, bw * 0.5, bh * 0.5);
			pathRoundedRect(ctx, -bw * 0.5, -bh * 0.5, bw, bh, capsuleRadius);
			break;
		}
	}
	ctx.fillStyle = geom.bodyFillColor;
	ctx.fill();
	ctx.lineWidth = Math.max(1, unit * 0.006);
	ctx.strokeStyle = geom.bodyStrokeColor;
	ctx.stroke();

	if (geom.bodyNeckEnabled) {
		const nw = Math.max(1, unit * geom.bodyNeckW);
		const nh = Math.max(1, unit * geom.bodyNeckH);
		const ny = unit * geom.bodyNeckOffsetY;
		ctx.beginPath();
		pathRoundedRect(ctx, -nw * 0.5, ny - nh * 0.5, nw, nh, Math.min(nw, nh) * 0.45);
		ctx.fillStyle = geom.bodyNeckColor;
		ctx.fill();
	}

	if (geom.bodyArmsEnabled && geom.bodyArmsStyle !== "none") {
		const spread = unit * geom.bodyArmsSpread;
		const drop = unit * geom.bodyArmsDrop;
		const bend = unit * geom.bodyArmsBend;
		const baseX = bw * 0.42;
		const baseY = -bh * 0.24;
		ctx.strokeStyle = geom.bodyArmsColor;
		ctx.lineWidth = Math.max(1, unit * geom.bodyArmsThick);
		ctx.lineCap = "round";
		for (const side of [-1, 1] as const) {
			const sx = side * baseX;
			const ex = side * (baseX + spread);
			const ey = baseY + drop;
			ctx.beginPath();
			ctx.moveTo(sx, baseY);
			if (geom.bodyArmsStyle === "line") {
				ctx.lineTo(ex, ey);
			} else {
				ctx.quadraticCurveTo(side * (baseX + spread * 0.48 + bend), baseY + drop * 0.45, ex, ey);
			}
			ctx.stroke();
		}
	}

	ctx.restore();
}

function drawEyelash(
	ctx: CanvasRenderingContext2D,
	style: string,
	ex: number,
	eyeY: number,
	ew: number,
	eh: number,
	side: number,
	color: string,
	unit: number,
): void {
	if (style === "none") return;
	ctx.save();
	ctx.strokeStyle = color;
	ctx.lineCap = "round";

	switch (style) {
		case "simple": {
			// Short lines at outer corner
			ctx.lineWidth = unit * 0.004;
			const ox = ex + side * ew * 0.85;
			const oy = eyeY - eh * 0.5;
			ctx.beginPath();
			ctx.moveTo(ox, oy);
			ctx.lineTo(ox + side * ew * 0.2, oy - eh * 0.3);
			ctx.stroke();
			break;
		}
		case "thick": {
			// Bold line along top of eye
			ctx.lineWidth = unit * 0.008;
			ctx.beginPath();
			ctx.moveTo(ex - ew * 0.9, eyeY - eh * 0.45);
			ctx.quadraticCurveTo(ex, eyeY - eh * 0.7, ex + ew * 0.9, eyeY - eh * 0.45);
			ctx.stroke();
			break;
		}
		case "wing": {
			// Cat-eye wing at outer corner
			ctx.lineWidth = unit * 0.005;
			ctx.beginPath();
			ctx.moveTo(ex - ew * 0.8, eyeY - eh * 0.3);
			ctx.quadraticCurveTo(ex, eyeY - eh * 0.65, ex + ew * 0.9, eyeY - eh * 0.4);
			ctx.lineTo(ex + ew * 1.15, eyeY - eh * 0.7);
			ctx.stroke();
			break;
		}
		case "bottom": {
			// Subtle line under eye
			ctx.lineWidth = unit * 0.003;
			ctx.beginPath();
			ctx.moveTo(ex - ew * 0.6, eyeY + eh * 0.4);
			ctx.quadraticCurveTo(ex, eyeY + eh * 0.55, ex + ew * 0.6, eyeY + eh * 0.4);
			ctx.stroke();
			break;
		}
		case "full": {
			// Top thick + bottom subtle
			ctx.lineWidth = unit * 0.006;
			ctx.beginPath();
			ctx.moveTo(ex - ew * 0.9, eyeY - eh * 0.4);
			ctx.quadraticCurveTo(ex, eyeY - eh * 0.65, ex + ew * 0.9, eyeY - eh * 0.4);
			ctx.stroke();
			ctx.lineWidth = unit * 0.003;
			ctx.beginPath();
			ctx.moveTo(ex - ew * 0.6, eyeY + eh * 0.4);
			ctx.quadraticCurveTo(ex, eyeY + eh * 0.5, ex + ew * 0.6, eyeY + eh * 0.4);
			ctx.stroke();
			break;
		}
		case "spider": {
			// Long individual lash lines radiating from top
			ctx.lineWidth = unit * 0.003;
			const lashes = 5;
			for (let i = 0; i < lashes; i++) {
				const t = (i / (lashes - 1)) * 0.8 + 0.1;
				const lx = ex + (t - 0.5) * 2 * ew;
				const ly = eyeY - eh * 0.5;
				const angle = -Math.PI / 2 + (t - 0.5) * 0.8;
				ctx.beginPath();
				ctx.moveTo(lx, ly);
				ctx.lineTo(lx + Math.cos(angle) * eh * 0.5, ly + Math.sin(angle) * eh * 0.5);
				ctx.stroke();
			}
			break;
		}
	}
	ctx.restore();
}

function drawNose(
	ctx: CanvasRenderingContext2D,
	style: string,
	cx: number,
	ny: number,
	size: number,
	color: string,
	unit: number,
): void {
	if (style === "none") return;
	ctx.save();
	const s = size * unit;

	switch (style) {
		case "dot": {
			ctx.fillStyle = color;
			ctx.beginPath();
			ctx.arc(cx, ny, s * 0.06, 0, Math.PI * 2);
			ctx.fill();
			break;
		}
		case "line": {
			ctx.strokeStyle = color;
			ctx.lineWidth = unit * 0.004;
			ctx.lineCap = "round";
			ctx.beginPath();
			ctx.moveTo(cx, ny - s * 0.06);
			ctx.lineTo(cx, ny + s * 0.06);
			ctx.stroke();
			break;
		}
		case "triangle": {
			ctx.fillStyle = color;
			ctx.beginPath();
			ctx.moveTo(cx, ny - s * 0.05);
			ctx.lineTo(cx + s * 0.04, ny + s * 0.05);
			ctx.lineTo(cx - s * 0.04, ny + s * 0.05);
			ctx.closePath();
			ctx.fill();
			break;
		}
		case "L": {
			ctx.strokeStyle = color;
			ctx.lineWidth = unit * 0.004;
			ctx.lineCap = "round";
			ctx.beginPath();
			ctx.moveTo(cx, ny - s * 0.06);
			ctx.lineTo(cx, ny + s * 0.04);
			ctx.lineTo(cx + s * 0.035, ny + s * 0.04);
			ctx.stroke();
			break;
		}
		case "button": {
			ctx.fillStyle = color;
			ctx.globalAlpha = 0.5;
			ctx.beginPath();
			ctx.ellipse(cx, ny, s * 0.05, s * 0.035, 0, 0, Math.PI * 2);
			ctx.fill();
			break;
		}
	}
	ctx.restore();
}

function drawHeadLayer(
	ctx: CanvasRenderingContext2D,
	unit: number,
	cx: number,
	cy: number,
	breathY: number,
	geom: FaceGeometry,
	fillColor: string,
): void {
	if (geom.headShape === "fullscreen") return;
	const hw = Math.max(1, unit * geom.headW);
	const hh = Math.max(1, unit * geom.headH);
	const hy = cy + unit * geom.headY + breathY;

	ctx.beginPath();
	if (geom.headShape === "circle") {
		ctx.ellipse(cx, hy, hw * 0.5, hh * 0.5, 0, 0, Math.PI * 2);
	} else if (geom.headShape === "oval") {
		ctx.ellipse(cx, hy, hw * 0.5, hh * 0.5, 0, 0, Math.PI * 2);
	} else if (geom.headShape === "squircle") {
		const hx2 = cx;
		const hy2 = hy;
		const shw = hw * 0.5;
		const shh = hh * 0.5;
		const k = 0.85;
		ctx.moveTo(hx2, hy2 - shh);
		ctx.bezierCurveTo(hx2 + shw * k, hy2 - shh, hx2 + shw, hy2 - shh * k, hx2 + shw, hy2);
		ctx.bezierCurveTo(hx2 + shw, hy2 + shh * k, hx2 + shw * k, hy2 + shh, hx2, hy2 + shh);
		ctx.bezierCurveTo(hx2 - shw * k, hy2 + shh, hx2 - shw, hy2 + shh * k, hx2 - shw, hy2);
		ctx.bezierCurveTo(hx2 - shw, hy2 - shh * k, hx2 - shw * k, hy2 - shh, hx2, hy2 - shh);
		ctx.closePath();
	} else if (geom.headShape === "hexagon") {
		const shw = hw * 0.5;
		const shh = hh * 0.5;
		for (let i = 0; i < 6; i++) {
			const angle = (i * Math.PI) / 3 - Math.PI / 2;
			const px = cx + Math.cos(angle) * shw;
			const py = hy + Math.sin(angle) * shh;
			if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
		}
		ctx.closePath();
	} else if (geom.headShape === "diamond") {
		const shw = hw * 0.5;
		const shh = hh * 0.5;
		ctx.moveTo(cx, hy - shh);
		ctx.lineTo(cx + shw, hy);
		ctx.lineTo(cx, hy + shh);
		ctx.lineTo(cx - shw, hy);
		ctx.closePath();
	} else if (geom.headShape === "egg") {
		const shw = hw * 0.5;
		const shh = hh * 0.5;
		ctx.moveTo(cx, hy - shh);
		ctx.bezierCurveTo(cx + shw * 1.1, hy - shh, cx + shw * 1.1, hy, cx + shw * 0.75, hy + shh * 0.4);
		ctx.bezierCurveTo(cx + shw * 0.5, hy + shh, cx + shw * 0.1, hy + shh, cx, hy + shh);
		ctx.bezierCurveTo(cx - shw * 0.1, hy + shh, cx - shw * 0.5, hy + shh, cx - shw * 0.75, hy + shh * 0.4);
		ctx.bezierCurveTo(cx - shw * 1.1, hy, cx - shw * 1.1, hy - shh, cx, hy - shh);
		ctx.closePath();
	} else if (geom.headShape === "pill") {
		const shw = hw * 0.5;
		const shh = hh * 0.5;
		const pr = Math.min(shw, shh);
		ctx.moveTo(cx - shw + pr, hy - shh);
		ctx.lineTo(cx + shw - pr, hy - shh);
		ctx.arc(cx + shw - pr, hy, pr, -Math.PI / 2, Math.PI / 2);
		ctx.lineTo(cx - shw + pr, hy + shh);
		ctx.arc(cx - shw + pr, hy, pr, Math.PI / 2, -Math.PI / 2);
		ctx.closePath();
	} else if (geom.headShape === "shield") {
		const shw = hw * 0.5;
		const shh = hh * 0.5;
		ctx.moveTo(cx - shw, hy - shh * 0.3);
		ctx.quadraticCurveTo(cx - shw, hy - shh, cx, hy - shh);
		ctx.quadraticCurveTo(cx + shw, hy - shh, cx + shw, hy - shh * 0.3);
		ctx.lineTo(cx + shw, hy + shh * 0.2);
		ctx.quadraticCurveTo(cx + shw * 0.5, hy + shh, cx, hy + shh);
		ctx.quadraticCurveTo(cx - shw * 0.5, hy + shh, cx - shw, hy + shh * 0.2);
		ctx.closePath();
	} else if (geom.headShape === "cloud") {
		const shw = hw * 0.5;
		const shh = hh * 0.5;
		const bumps = 8;
		for (let i = 0; i <= bumps; i++) {
			const angle = (i / bumps) * Math.PI * 2 - Math.PI / 2;
			const bumpR = 1 + Math.sin(i * 2.5) * 0.08;
			const px = cx + Math.cos(angle) * shw * bumpR;
			const py = hy + Math.sin(angle) * shh * bumpR;
			if (i === 0) {
				ctx.moveTo(px, py);
			} else {
				const prevAngle = ((i - 1) / bumps) * Math.PI * 2 - Math.PI / 2;
				const cpx = cx + Math.cos((prevAngle + angle) / 2) * shw * 1.1;
				const cpy = hy + Math.sin((prevAngle + angle) / 2) * shh * 1.1;
				ctx.quadraticCurveTo(cpx, cpy, px, py);
			}
		}
		ctx.closePath();
	} else if (geom.headShape === "octagon") {
		const shw = hw * 0.5;
		const shh = hh * 0.5;
		for (let i = 0; i < 8; i++) {
			const angle = (i * Math.PI) / 4 - Math.PI / 8;
			const px = cx + Math.cos(angle) * shw;
			const py = hy + Math.sin(angle) * shh;
			if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
		}
		ctx.closePath();
	} else {
		const r = Math.max(0, Math.min(unit * geom.headRadius, hw * 0.5, hh * 0.5));
		pathRoundedRect(ctx, cx - hw * 0.5, hy - hh * 0.5, hw, hh, r);
	}
	ctx.fillStyle = fillColor;
	ctx.fill();

	if (geom.headStrokeW > 0 && geom.headStrokeColor) {
		ctx.lineWidth = Math.max(1, unit * geom.headStrokeW);
		ctx.strokeStyle = geom.headStrokeColor;
		ctx.stroke();
	}
}

interface SceneBounds {
	minX: number;
	maxX: number;
	minY: number;
	maxY: number;
}

export interface SceneFrame {
	unit: number;
	cx: number;
	cy: number;
	scale: number;
	bounds: SceneBounds;
}

function createSceneBounds(): SceneBounds {
	return { minX: Number.POSITIVE_INFINITY, maxX: Number.NEGATIVE_INFINITY, minY: Number.POSITIVE_INFINITY, maxY: Number.NEGATIVE_INFINITY };
}

function includeSceneBounds(bounds: SceneBounds, minX: number, maxX: number, minY: number, maxY: number): void {
	bounds.minX = Math.min(bounds.minX, minX);
	bounds.maxX = Math.max(bounds.maxX, maxX);
	bounds.minY = Math.min(bounds.minY, minY);
	bounds.maxY = Math.max(bounds.maxY, maxY);
}

function normalizeSceneBounds(bounds: SceneBounds): SceneBounds {
	if (!Number.isFinite(bounds.minX) || !Number.isFinite(bounds.maxX) || !Number.isFinite(bounds.minY) || !Number.isFinite(bounds.maxY)) {
		return { minX: -0.5, maxX: 0.5, minY: -0.5, maxY: 0.5 };
	}
	return bounds;
}

function computeAutoBodyOffsetY(geom: FaceGeometry): number {
	if (!geom.bodyEnabled || geom.headShape === "fullscreen") return 0;
	const headBottom = geom.headY + Math.max(0.05, geom.headH) * 0.5;
	const bodyTop = geom.bodyAnchorY - Math.max(0.05, geom.bodyH) * 0.5;
	const desiredOverlap = geom.bodyNeckEnabled ? 0.03 : 0.018;
	return Math.max(0, headBottom - desiredOverlap - bodyTop);
}

function estimateSceneBounds(geom: FaceGeometry): SceneBounds {
	const bounds = createSceneBounds();

	const eyeScale = clamp(geom.eyeScaleMax, 0.5, 2.2);
	const eyeHalfW = geom.eyeW * eyeScale;
	const eyeHalfH = geom.eyeH * eyeScale;
	const eyeOuterX = geom.eyeSpacing + eyeHalfW * 1.1;
	const browLift = eyeHalfH * geom.browVert + Math.max(0, geom.browMax) * geom.browRange + geom.eyeW * geom.browThick;
	const featureTop = geom.eyeY - browLift - eyeHalfH * 0.45;
	const mouthHalfW = geom.mouthW * (1 + Math.max(0, geom.mouthWidthMax) * 0.4) * 1.02;
	const featureBottom = Math.max(geom.eyeY + eyeHalfH * 1.45, geom.mouthY + 0.03 + Math.max(0, geom.mouthOpenMax) * 0.16);
	includeSceneBounds(bounds, -Math.max(eyeOuterX, mouthHalfW), Math.max(eyeOuterX, mouthHalfW), featureTop, featureBottom);

	if (geom.headShape !== "fullscreen") {
		const hw = Math.max(0.05, geom.headW) * 0.5;
		const hh = Math.max(0.05, geom.headH) * 0.5;
		const sw = Math.max(0, geom.headStrokeW) * 0.5;
		includeSceneBounds(bounds, -hw - sw, hw + sw, geom.headY - hh - sw, geom.headY + hh + sw);
	}

	if (geom.bodyEnabled) {
		const bodyOffsetY = computeAutoBodyOffsetY(geom);
		const bx = geom.bodyAnchorX;
		const by = geom.bodyAnchorY + bodyOffsetY;
		const bw = Math.max(0.05, geom.bodyW);
		const bh = Math.max(0.05, geom.bodyH);

		includeSceneBounds(bounds, bx - bw * 0.5, bx + bw * 0.5, by - bh * 0.5, by + bh * 0.5);

		if (geom.bodyShouldersEnabled) {
			const sw = Math.max(0, geom.bodyShouldersW);
			const st = Math.max(0, geom.bodyShouldersThick);
			const ss = Math.abs(geom.bodyShouldersSlope);
			const sy = by - bh * 0.5 + st * 0.2;
			includeSceneBounds(bounds, bx - sw * 0.5, bx + sw * 0.5, sy - ss, sy + ss + st);
		}
		if (geom.bodyNeckEnabled) {
			const nw = Math.max(0, geom.bodyNeckW);
			const nh = Math.max(0, geom.bodyNeckH);
			const ny = by + geom.bodyNeckOffsetY;
			includeSceneBounds(bounds, bx - nw * 0.5, bx + nw * 0.5, ny - nh * 0.5, ny + nh * 0.5);
		}
		if (geom.bodyArmsEnabled && geom.bodyArmsStyle !== "none") {
			const spread = Math.max(0, geom.bodyArmsSpread);
			const bend = Math.abs(geom.bodyArmsBend);
			const drop = geom.bodyArmsDrop;
			const tipX = bw * 0.42 + spread + bend * 0.25 + geom.bodyArmsThick;
			const tipY = -bh * 0.24 + drop + bend * 0.2 + geom.bodyArmsThick;
			includeSceneBounds(
				bounds,
				bx - tipX,
				bx + tipX,
				by + Math.min(-bh * 0.24, tipY) - geom.bodyArmsThick,
				by + Math.max(-bh * 0.24, tipY) + geom.bodyArmsThick,
			);
		}

		const motionPadX = Math.max(geom.bodyMaxShiftX, Math.abs(geom.bodyMotionWeightShift) * 0.08 + Math.abs(geom.bodyMotionIdleSway) * 0.02);
		const motionPadY = Math.max(
			geom.bodyMaxShiftY,
			Math.abs(geom.breathY) * Math.max(1, geom.bodyMotionBreathFollow) + Math.abs(geom.bodyMotionSpeakingBob) * 0.03 + Math.abs(geom.bodyMotionIdleSway) * 0.02,
		);
		includeSceneBounds(bounds, bounds.minX - motionPadX, bounds.maxX + motionPadX, bounds.minY - motionPadY, bounds.maxY + motionPadY);
	}

	for (const accessory of geom.accessories) {
		if (!accessory.enabled) continue;
		if (accessory.type === "antenna") {
			const len = Math.max(0.01, accessory.segments * accessory.segmentLength);
			const effectiveLen = Math.min(len, 0.42);
			const sx = accessory.anchor.x;
			const sy = accessory.anchor.y;
			const curve = Math.abs(accessory.restCurve ?? 0);
			const curl = Math.abs(accessory.tipCurl ?? 0);
			const tip = Math.max(0.004, accessory.tipSize ?? 0.012);
			const horizontal = effectiveLen * (0.42 + curve * 0.22 + curl * 0.16);
			const up = effectiveLen * (0.74 + curve * 0.12);
			const down = effectiveLen * (0.2 + curl * 0.14);
			const swayPad = accessory.physics?.enabled ? Math.min(0.08, effectiveLen * 0.1) : 0;
			includeSceneBounds(
				bounds,
				sx - horizontal - tip - swayPad,
				sx + horizontal + tip + swayPad,
				sy - up - tip - swayPad,
				sy + down + tip + swayPad,
			);
		} else if (accessory.type === "glasses") {
			const fw = Math.max(0.04, accessory.frameWidth ?? 0.11);
			const fh = Math.max(0.03, accessory.frameHeight ?? 0.08);
			const bridge = Math.max(0.01, accessory.bridgeWidth ?? 0.05);
			const follow = clamp(accessory.followEyes ?? 0.7, 0, 1);
			const lookPad = 0.03 * follow;
			const x = accessory.anchor.x;
			const y = accessory.anchor.y;
			const halfW = fw + bridge * 0.5 + 0.012;
			const halfH = fh * 0.62 + 0.01;
			includeSceneBounds(bounds, x - halfW - lookPad, x + halfW + lookPad, y - halfH, y + halfH);
		}
	}

	return normalizeSceneBounds(bounds);
}

export function computeSceneFrame(w: number, h: number, geom: FaceGeometry): SceneFrame {
	const baseUnit = Math.min(w, h);
	if (!baseUnit || !w || !h) {
		return {
			unit: baseUnit || 0,
			cx: w / 2,
			cy: h / 2,
			scale: 1,
			bounds: { minX: -0.5, maxX: 0.5, minY: -0.5, maxY: 0.5 },
		};
	}

	const needsFrame = geom.headShape !== "fullscreen" || geom.bodyEnabled || geom.accessories.length > 0;
	if (!needsFrame) {
		return {
			unit: baseUnit,
			cx: w / 2,
			cy: h / 2,
			scale: 1,
			bounds: { minX: -0.5, maxX: 0.5, minY: -0.5, maxY: 0.5 },
		};
	}

	const bounds = estimateSceneBounds(geom);
	const padPx = Math.max(12, baseUnit * 0.06);
	const availW = Math.max(1, w - padPx * 2);
	const availH = Math.max(1, h - padPx * 2);
	const guardScale = 1.18;
	const boundW = Math.max(1e-6, (bounds.maxX - bounds.minX) * baseUnit * guardScale);
	const boundH = Math.max(1e-6, (bounds.maxY - bounds.minY) * baseUnit * guardScale);
	const scale = Math.min(1, availW / boundW, availH / boundH);
	const unit = baseUnit * scale;
	const centerX = (bounds.minX + bounds.maxX) * 0.5;
	const centerY = (bounds.minY + bounds.maxY) * 0.5;
	return {
		unit,
		cx: w * 0.5 - centerX * unit,
		cy: h * 0.5 - centerY * unit,
		scale,
		bounds,
	};
}

interface EyeSpecularBounds {
	xRadius: number;
	topRadius: number;
	bottomRadius: number;
}

function getEyeSpecularBounds(style: EyeStyle, ew: number, openH: number, bottomH: number): EyeSpecularBounds {
	// Cubic bezier top/bottom arcs peak at 75% of control-point displacement.
	const bezierPeak = 0.55 * 0.75;
	switch (style) {
		case "rectangle":
			return { xRadius: ew, topRadius: openH, bottomRadius: bottomH };
		case "dot": {
			const r = Math.min(ew, (openH + bottomH) / 2);
			return { xRadius: r, topRadius: r, bottomRadius: r };
		}
		case "round": {
			const topArc = Math.max(ew, openH) * bezierPeak;
			return { xRadius: ew, topRadius: topArc, bottomRadius: bottomH * bezierPeak };
		}
		case "almond":
			// Tapered corners — similar to oval but narrower vertical reach
			return {
				xRadius: ew,
				topRadius: openH * bezierPeak,
				bottomRadius: bottomH * 0.7 * bezierPeak,
			};
		case "crescent":
			// Half-moon — very narrow vertical extent
			return {
				xRadius: ew,
				topRadius: openH * bezierPeak * 0.5,
				bottomRadius: openH * 0.2 * bezierPeak,
			};
		case "star":
			// 4-pointed star — inscribed circle bounds
			return {
				xRadius: ew * 0.45,
				topRadius: openH * 0.45,
				bottomRadius: bottomH * 0.45,
			};
		case "heart":
			// Heart — round bounds
			return {
				xRadius: ew * bezierPeak,
				topRadius: openH * bezierPeak,
				bottomRadius: bottomH * bezierPeak,
			};
		case "cat":
			// Vertical slit — narrow width
			return {
				xRadius: ew * 0.5 * bezierPeak,
				topRadius: openH * bezierPeak,
				bottomRadius: bottomH * bezierPeak,
			};
		case "cross":
			// Cross — rectangle-like bounds
			return { xRadius: ew, topRadius: openH, bottomRadius: bottomH };
		case "diamond":
			// Diamond — inscribed circle
			return {
				xRadius: ew * 0.5,
				topRadius: openH * 0.5,
				bottomRadius: bottomH * 0.5,
			};
		case "semicircle":
			// Flat bottom, round top — half the oval height
			return {
				xRadius: ew,
				topRadius: ew * bezierPeak,
				bottomRadius: 0,
			};
		case "oval":
		default:
			return {
				xRadius: ew,
				topRadius: openH * bezierPeak,
				bottomRadius: bottomH * bezierPeak,
			};
	}
}

export function computeSpecularCenter(
	style: EyeStyle,
	ex: number,
	eyeY: number,
	ew: number,
	openH: number,
	bottomH: number,
	lookX: number,
	lookY: number,
	specularShiftX: number,
	specularShiftY: number,
	specularLookFollow: number,
	rx = 0,
	ry = 0,
): { x: number; y: number } {
	const { xRadius, topRadius, bottomRadius } = getEyeSpecularBounds(style, ew, openH, bottomH);
	const sx = clamp(specularShiftX, 0, 1);
	const sy = clamp(specularShiftY, 0, 1);
	const follow = clamp(specularLookFollow, 0, 1);
	const top = eyeY - topRadius;
	const totalH = topRadius + bottomRadius;
	const baseX = ex - xRadius + sx * (xRadius * 2);
	const baseY = top + sy * totalH;
	// Reflection should appear mostly light-fixed; drift opposite gaze for a more
	// convincing specular cue instead of reading like a second pupil.
	const gazeX = -lookX * xRadius * 0.18 * follow;
	const gazeY = -lookY * Math.min(topRadius, bottomRadius) * 0.14 * follow;

	const rawX = baseX + gazeX;
	const rawY = baseY + gazeY;
	const minX = ex - xRadius + rx;
	const maxX = ex + xRadius - rx;
	const minY = top + ry;
	const maxY = eyeY + bottomRadius - ry;

	let x = minX <= maxX ? clamp(rawX, minX, maxX) : ex;
	let y = minY <= maxY ? clamp(rawY, minY, maxY) : eyeY;

	// For curved eye styles, keep specular center inside an inscribed ellipse rather
	// than a rectangular box so reflections don't clip at the corners/edges.
	if (style !== "rectangle") {
		const dy = y - eyeY;
		const axisX = Math.max(0.001, xRadius - rx);
		const axisY = dy < 0
			? Math.max(0.001, topRadius - ry)
			: Math.max(0.001, bottomRadius - ry);
		const normY = Math.min(0.999, Math.abs(dy) / axisY);
		const maxDx = axisX * Math.sqrt(Math.max(0, 1 - normY * normY));
		x = clamp(x, ex - maxDx, ex + maxDx);
	}

	return {
		x,
		y,
	};
}

/**
 * Draw an eye shape based on the face pack's style.
 * All styles produce a single closed path — no threshold branches.
 */
/**
 * Draw an eye shape with optional slope (tilts top edge).
 * slope > 0: inner corner rises (angry V). slope < 0: inner corner drops (sad droop).
 * slopeDir: 1 for left eye (inner = right side), -1 for right eye (inner = left side).
 */
function drawEyeShape(
	ctx: CanvasRenderingContext2D,
	style: EyeStyle,
	ex: number, eyeY: number,
	ew: number, openH: number, bottomH: number,
	slope = 0, slopeDir = 1,
): void {
	// Slope offsets for inner/outer top corners
	const slopeAmt = slope * openH * 0.4;
	const innerOff = -slopeAmt * slopeDir; // inner corner moves opposite
	const outerOff = slopeAmt * slopeDir;

	switch (style) {
		case "rectangle":
			{
				const r = Math.min(ew, openH) * 0.15;
				const topL = eyeY - openH + (slopeDir === 1 ? outerOff : innerOff);
				const topR = eyeY - openH + (slopeDir === 1 ? innerOff : outerOff);
				const bot = eyeY + bottomH;
				// Sloped rectangle — four corners with different Y
				ctx.moveTo(ex - ew, topL);
				ctx.lineTo(ex + ew, topR);
				ctx.lineTo(ex + ew, bot);
				ctx.lineTo(ex - ew, bot);
				ctx.closePath();
			}
			break;
		case "dot":
			{
				const radius = Math.min(ew, (openH + bottomH) / 2);
				ctx.arc(ex, eyeY, radius, 0, Math.PI * 2);
			}
			break;
		case "round":
			{
				const r = Math.max(ew, openH);
				ctx.moveTo(ex - ew, eyeY);
				ctx.bezierCurveTo(
					ex - ew, eyeY - r * 0.55 + outerOff,
					ex + ew, eyeY - r * 0.55 + innerOff,
					ex + ew, eyeY,
				);
				ctx.bezierCurveTo(ex + ew, eyeY + bottomH * 0.55, ex - ew, eyeY + bottomH * 0.55, ex - ew, eyeY);
				ctx.closePath();
			}
			break;
		case "almond":
			ctx.moveTo(ex - ew, eyeY);
			ctx.bezierCurveTo(ex - ew * 0.5, eyeY - openH + innerOff, ex + ew * 0.5, eyeY - openH + outerOff, ex + ew, eyeY);
			ctx.bezierCurveTo(ex + ew * 0.5, eyeY + bottomH * 0.7, ex - ew * 0.5, eyeY + bottomH * 0.7, ex - ew, eyeY);
			ctx.closePath();
			break;
		case "crescent":
			ctx.moveTo(ex - ew, eyeY + openH * 0.2);
			ctx.quadraticCurveTo(ex, eyeY - openH + (innerOff + outerOff) * 0.5, ex + ew, eyeY + openH * 0.2);
			ctx.quadraticCurveTo(ex, eyeY + openH * 0.1, ex - ew, eyeY + openH * 0.2);
			ctx.closePath();
			break;
		case "star":
			{
				const points = 4;
				for (let i = 0; i <= points * 2; i++) {
					const angle = (i * Math.PI) / points - Math.PI / 2;
					const r = i % 2 === 0 ? 1 : 0.45;
					const px = ex + Math.cos(angle) * ew * r;
					const py = eyeY + Math.sin(angle) * openH * r;
					if (i === 0) ctx.moveTo(px, py);
					else ctx.lineTo(px, py);
				}
				ctx.closePath();
			}
			break;
		case "heart":
			ctx.moveTo(ex, eyeY + openH * 0.7);
			ctx.bezierCurveTo(ex - ew * 0.1, eyeY + openH * 0.3, ex - ew, eyeY + openH * 0.1, ex - ew, eyeY - openH * 0.15);
			ctx.bezierCurveTo(ex - ew, eyeY - openH * 0.8, ex, eyeY - openH * 0.5, ex, eyeY - openH * 0.1);
			ctx.bezierCurveTo(ex, eyeY - openH * 0.5, ex + ew, eyeY - openH * 0.8, ex + ew, eyeY - openH * 0.15);
			ctx.bezierCurveTo(ex + ew, eyeY + openH * 0.1, ex + ew * 0.1, eyeY + openH * 0.3, ex, eyeY + openH * 0.7);
			ctx.closePath();
			break;
		case "cat":
			ctx.moveTo(ex, eyeY - openH);
			ctx.bezierCurveTo(ex + ew * 0.5, eyeY - openH * 0.5, ex + ew * 0.5, eyeY + bottomH * 0.5, ex, eyeY + bottomH);
			ctx.bezierCurveTo(ex - ew * 0.5, eyeY + bottomH * 0.5, ex - ew * 0.5, eyeY - openH * 0.5, ex, eyeY - openH);
			ctx.closePath();
			break;
		case "cross":
			{
				const cw = ew * 0.3;
				const ch = openH * 0.3;
				ctx.moveTo(ex - cw, eyeY - openH);
				ctx.lineTo(ex + cw, eyeY - openH);
				ctx.lineTo(ex + cw, eyeY - ch);
				ctx.lineTo(ex + ew, eyeY - ch);
				ctx.lineTo(ex + ew, eyeY + ch);
				ctx.lineTo(ex + cw, eyeY + ch);
				ctx.lineTo(ex + cw, eyeY + bottomH);
				ctx.lineTo(ex - cw, eyeY + bottomH);
				ctx.lineTo(ex - cw, eyeY + ch);
				ctx.lineTo(ex - ew, eyeY + ch);
				ctx.lineTo(ex - ew, eyeY - ch);
				ctx.lineTo(ex - cw, eyeY - ch);
				ctx.closePath();
			}
			break;
		case "diamond":
			ctx.moveTo(ex, eyeY - openH);
			ctx.lineTo(ex + ew, eyeY);
			ctx.lineTo(ex, eyeY + bottomH);
			ctx.lineTo(ex - ew, eyeY);
			ctx.closePath();
			break;
		case "semicircle":
			ctx.moveTo(ex - ew, eyeY);
			ctx.arc(ex, eyeY, ew, Math.PI, 0, false);
			ctx.lineTo(ex - ew, eyeY);
			ctx.closePath();
			break;
		case "oval":
		default:
			ctx.moveTo(ex - ew, eyeY);
			ctx.bezierCurveTo(
				ex - ew, eyeY - openH * 0.55 + outerOff,
				ex + ew, eyeY - openH * 0.55 + innerOff,
				ex + ew, eyeY,
			);
			ctx.bezierCurveTo(ex + ew, eyeY + bottomH * 0.55, ex - ew, eyeY + bottomH * 0.55, ex - ew, eyeY);
			ctx.closePath();
			break;
	}
}

/**
 * Draw the specular reflection shape matching the eye style and specular shape config.
 * The specularShape parameter controls the highlight shape; eyeStyle provides fallback
 * behavior for rectangles when specularShape is "circle" (default).
 */
function drawSpecularShape(
	ctx: CanvasRenderingContext2D,
	eyeStyle: EyeStyle,
	hx: number, hy: number, rx: number, ry: number,
	specularShape: SpecularShape = "circle",
): void {
	const hr = Math.max(rx, ry);
	switch (specularShape) {
		case "star": {
			// 4-pointed sparkle
			const pts = 4;
			for (let i = 0; i <= pts * 2; i++) {
				const angle = (i * Math.PI) / pts - Math.PI / 2;
				const r = i % 2 === 0 ? hr : hr * 0.3;
				const x = hx + Math.cos(angle) * r;
				const y = hy + Math.sin(angle) * r;
				if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
			}
			ctx.closePath();
			break;
		}
		case "crescent": {
			// Arc catch light
			ctx.arc(hx, hy, hr, -Math.PI * 0.8, -Math.PI * 0.2);
			ctx.arc(hx + hr * 0.2, hy - hr * 0.1, hr * 0.7, -Math.PI * 0.2, -Math.PI * 0.8, true);
			ctx.closePath();
			break;
		}
		case "dual": {
			// Two small dots — requires separate fill calls from caller;
			// draw both sub-paths here so a single fill works.
			ctx.arc(hx - hr * 0.4, hy - hr * 0.3, hr * 0.45, 0, Math.PI * 2);
			ctx.moveTo(hx + hr * 0.5 + hr * 0.25, hy + hr * 0.4);
			ctx.arc(hx + hr * 0.5, hy + hr * 0.4, hr * 0.25, 0, Math.PI * 2);
			break;
		}
		case "line": {
			// Horizontal dash
			const lw = hr * 2;
			const lh = hr * 0.3;
			const lr = hr * 0.15;
			pathRoundedRect(ctx, hx - hr, hy - lh / 2, lw, lh, lr);
			break;
		}
		case "cross": {
			// + sparkle
			const cw = hr * 0.2;
			ctx.rect(hx - cw, hy - hr, cw * 2, hr * 2);
			ctx.rect(hx - hr, hy - cw, hr * 2, cw * 2);
			break;
		}
		case "ring": {
			// Hollow circle
			ctx.arc(hx, hy, hr, 0, Math.PI * 2);
			ctx.arc(hx, hy, hr * 0.55, 0, Math.PI * 2, true);
			ctx.closePath();
			break;
		}
		case "none":
			// No specular — skip
			break;
		case "circle":
		default: {
			// Default behavior — shape follows eye style
			switch (eyeStyle) {
				case "rectangle":
				case "cross": {
					// Rounded-rect specular reflection
					const r = Math.min(rx, ry) * 0.3;
					ctx.moveTo(hx - rx + r, hy - ry);
					ctx.lineTo(hx + rx - r, hy - ry);
					ctx.arcTo(hx + rx, hy - ry, hx + rx, hy - ry + r, r);
					ctx.lineTo(hx + rx, hy + ry - r);
					ctx.arcTo(hx + rx, hy + ry, hx + rx - r, hy + ry, r);
					ctx.lineTo(hx - rx + r, hy + ry);
					ctx.arcTo(hx - rx, hy + ry, hx - rx, hy + ry - r, r);
					ctx.lineTo(hx - rx, hy - ry + r);
					ctx.arcTo(hx - rx, hy - ry, hx - rx + r, hy - ry, r);
					ctx.closePath();
					break;
				}
				default:
					// Ellipse for oval/round/dot/almond/crescent/star/heart/cat/diamond/semicircle.
					ctx.ellipse(hx, hy, rx, ry, 0, 0, Math.PI * 2);
					break;
			}
			break;
		}
	}
}

function drawPupilShape(ctx: CanvasRenderingContext2D, shape: PupilShape, px: number, py: number, pr: number): void {
	ctx.beginPath();
	switch (shape) {
		case "slit": {
			// Vertical narrow ellipse
			ctx.ellipse(px, py, pr * 0.3, pr, 0, 0, Math.PI * 2);
			break;
		}
		case "star": {
			const points = 4;
			for (let i = 0; i <= points * 2; i++) {
				const angle = (i * Math.PI) / points - Math.PI / 2;
				const r = i % 2 === 0 ? pr : pr * 0.4;
				const x = px + Math.cos(angle) * r;
				const y = py + Math.sin(angle) * r;
				if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
			}
			break;
		}
		case "heart": {
			const s = pr;
			ctx.moveTo(px, py + s * 0.6);
			ctx.bezierCurveTo(px - s * 0.05, py + s * 0.2, px - s, py + s * 0.05, px - s, py - s * 0.2);
			ctx.bezierCurveTo(px - s, py - s * 0.7, px, py - s * 0.5, px, py - s * 0.1);
			ctx.bezierCurveTo(px, py - s * 0.5, px + s, py - s * 0.7, px + s, py - s * 0.2);
			ctx.bezierCurveTo(px + s, py + s * 0.05, px + s * 0.05, py + s * 0.2, px, py + s * 0.6);
			break;
		}
		case "diamond": {
			ctx.moveTo(px, py - pr);
			ctx.lineTo(px + pr * 0.7, py);
			ctx.lineTo(px, py + pr);
			ctx.lineTo(px - pr * 0.7, py);
			break;
		}
		case "cross": {
			const w = pr * 0.3;
			ctx.moveTo(px - w, py - pr);
			ctx.lineTo(px + w, py - pr);
			ctx.lineTo(px + w, py - w);
			ctx.lineTo(px + pr, py - w);
			ctx.lineTo(px + pr, py + w);
			ctx.lineTo(px + w, py + w);
			ctx.lineTo(px + w, py + pr);
			ctx.lineTo(px - w, py + pr);
			ctx.lineTo(px - w, py + w);
			ctx.lineTo(px - pr, py + w);
			ctx.lineTo(px - pr, py - w);
			ctx.lineTo(px - w, py - w);
			break;
		}
		case "ring": {
			// Donut — outer circle then inner circle (counterclockwise for cutout)
			ctx.arc(px, py, pr, 0, Math.PI * 2);
			ctx.moveTo(px + pr * 0.5, py);
			ctx.arc(px, py, pr * 0.5, 0, Math.PI * 2, true);
			break;
		}
		case "flower": {
			// 4-petal clover
			const petalR = pr * 0.55;
			const dist = pr * 0.35;
			for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]] as const) {
				ctx.moveTo(px + dx * dist + petalR, py + dy * dist);
				ctx.arc(px + dx * dist, py + dy * dist, petalR, 0, Math.PI * 2);
			}
			break;
		}
		case "spiral": {
			// Simple spiral approximation — stroked, not filled
			const turns = 2.5;
			const steps = 60;
			for (let i = 0; i <= steps; i++) {
				const t = i / steps;
				const angle = t * turns * Math.PI * 2;
				const r = pr * t;
				const x = px + Math.cos(angle) * r;
				const y = py + Math.sin(angle) * r;
				if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
			}
			ctx.lineWidth = pr * 0.15;
			ctx.stroke();
			ctx.beginPath(); // reset so fill doesn't happen
			return; // exit early since we stroked instead of filling
		}
		case "none":
			return; // no pupil drawn
		case "circle":
		default: {
			ctx.arc(px, py, pr, 0, Math.PI * 2);
			break;
		}
	}
	ctx.closePath();
	ctx.fill();
}

function drawDebugOverlay(
	ctx: CanvasRenderingContext2D,
	ex: number,
	eyeY: number,
	ew: number,
	openH: number,
	bottomH: number,
	browY: number,
): void {
	ctx.save();
	ctx.strokeStyle = "rgba(255,255,255,0.25)";
	ctx.lineWidth = 1;
	ctx.beginPath();
	ctx.rect(ex - ew, eyeY - openH, ew * 2, openH + bottomH);
	ctx.stroke();
	ctx.beginPath();
	ctx.moveTo(ex - ew, browY);
	ctx.lineTo(ex + ew, browY);
	ctx.stroke();
	ctx.beginPath();
	ctx.arc(ex, eyeY, 1.8, 0, Math.PI * 2);
	ctx.fillStyle = "rgba(255,255,255,0.5)";
	ctx.fill();
	ctx.restore();
}

interface AccessoryDrawContext {
	ctx: CanvasRenderingContext2D;
	unit: number;
	cx: number;
	cy: number;
	breathY: number;
	eyeSpacing: number;
	eyeY: number;
	baseEyeW: number;
	baseEyeH: number;
	activeState: FaceState;
	target: TargetState;
	current: CurrentState;
	geom: FaceGeometry;
	stateTime: number;
	reducedMotion: boolean;
	accessoryPhysics: ReadonlyMap<string, AccessoryPhysicsState> | null;
}

function drawAntennaAccessory(accessory: Extract<AccessoryDefinition, { type: "antenna" }>, ac: AccessoryDrawContext): void {
	const { ctx, unit, cx, cy, breathY, activeState, target, current, stateTime, reducedMotion, geom } = ac;
	const patch = resolveAccessoryPatch(accessory, activeState, target);
	const color = patch.color || accessory.color || geom.featureColor;
	const tipColor = patch.tipColor || accessory.tipColor || color;
	const tipShape = accessory.tipShape || "circle";
	const thicknessBase = Math.max(0.001, unit * (accessory.thickness?.base ?? 0.012));
	const thicknessTip = Math.max(0.001, unit * (accessory.thickness?.tip ?? 0.006));
	const tipSize = Math.max(1, unit * (patch.tipSize ?? accessory.tipSize ?? 0.012));
	const physics = resolveAntennaPhysicsConfig(accessory, activeState, target);

	const segments = Math.max(2, accessory.segments);
	const anchorX = cx + unit * accessory.anchor.x;
	const anchorY = cy + unit * accessory.anchor.y + breathY;
	const side = accessory.anchor.x >= 0 ? 1 : -1;
	const motionMul = reducedMotion ? 0 : 1;
	const speechDrive = activeState === "speaking" ? current.amplitude : 0;
	const swayFreq = 1.6 + physics.stiffness * 2.4;
	const swayAmp = motionMul * unit * (0.004 + (1 - physics.damping) * 0.015 + speechDrive * 0.02);
	const sway = Math.sin(stateTime * swayFreq + side * 0.9) * swayAmp;
	const lookShift = current.lookX * unit * 0.01 * physics.headInfluence;
	const gravityOffset = unit * clamp(physics.gravity, -1, 1) * 0.03;
	const alertLift = activeState === "alert" ? -0.015 : 0;
	const sleepDroop = activeState === "sleeping" ? 0.04 : 0;

	let points: Array<{ x: number; y: number }>;
	const runtime = physics.enabled ? ac.accessoryPhysics?.get(accessory.id) : undefined;
	if (runtime && runtime.type === "antenna" && runtime.points.length >= 2) {
		points = runtime.points.map((p) => ({ x: p.x, y: p.y }));
	} else {
		const frame: AccessorySimulationFrame = {
			unit,
			cx,
			cy,
			breathY,
			stateTime,
			reducedMotion,
			activeState,
			target,
			current,
		};
		points = [{ x: anchorX, y: anchorY }];
		for (let i = 1; i <= segments; i++) {
			const t = i / segments;
			const rest = computeAntennaRestPoint(accessory, physics, frame, i);
			const curve = t * t;
			const x = rest.x + (sway + lookShift) * curve;
			const y = rest.y + gravityOffset * curve + unit * sleepDroop * curve + unit * alertLift * t;
			points.push({ x, y });
		}
	}

	ctx.save();
	ctx.strokeStyle = color;
	ctx.lineCap = "round";
	for (let i = 1; i < points.length; i++) {
		const a = points[i - 1];
		const b = points[i];
		const t = i / (points.length - 1);
		ctx.lineWidth = thicknessBase + (thicknessTip - thicknessBase) * t;
		ctx.beginPath();
		ctx.moveTo(a.x, a.y);
		ctx.lineTo(b.x, b.y);
		ctx.stroke();
	}
	const tip = points[points.length - 1]!;
	ctx.fillStyle = tipColor;
	ctx.beginPath();
	if (tipShape === "diamond") {
		ctx.moveTo(tip.x, tip.y - tipSize);
		ctx.lineTo(tip.x + tipSize, tip.y);
		ctx.lineTo(tip.x, tip.y + tipSize);
		ctx.lineTo(tip.x - tipSize, tip.y);
		ctx.closePath();
	} else {
		ctx.arc(tip.x, tip.y, tipSize, 0, Math.PI * 2);
	}
	ctx.fill();
	ctx.restore();
}

function drawGlassesAccessory(accessory: Extract<AccessoryDefinition, { type: "glasses" }>, ac: AccessoryDrawContext): void {
	const { ctx, unit, eyeSpacing, eyeY, baseEyeW, baseEyeH, current, target, activeState, geom } = ac;
	const patch = resolveAccessoryPatch(accessory, activeState, target);
	const color = patch.color || accessory.color || geom.featureColor;
	const follow = clamp(accessory.followEyes ?? 0.5, 0, 1);
	const lensAlpha = clamp(patch.lensAlpha ?? accessory.lensAlpha ?? 0, 0, 1);
	const frameW = unit * (accessory.frameWidth ?? geom.eyeW * 2.15);
	const frameH = unit * (accessory.frameHeight ?? geom.eyeH * 1.7);
	const bridgeW = unit * (accessory.bridgeWidth ?? 0.03);
	const lineW = Math.max(1, unit * (patch.lineWidth ?? accessory.lineWidth ?? 0.01));
	const eyeFollowX = current.lookX * baseEyeW * 0.2 * follow;
	const eyeFollowY = current.lookY * baseEyeH * 0.2 * follow;
	const leftX = (ac.cx - eyeSpacing) + eyeFollowX;
	const rightX = (ac.cx + eyeSpacing) + eyeFollowX;
	const y = eyeY + eyeFollowY + unit * accessory.anchor.y;

	ctx.save();
	ctx.strokeStyle = color;
	ctx.lineWidth = lineW;
	if (lensAlpha > 0) ctx.fillStyle = color;

	const drawFrame = (x: number) => {
		ctx.beginPath();
		if (accessory.shape === "rect") {
			const r = Math.min(frameW, frameH) * 0.18;
			ctx.moveTo(x - frameW + r, y - frameH);
			ctx.lineTo(x + frameW - r, y - frameH);
			ctx.arcTo(x + frameW, y - frameH, x + frameW, y - frameH + r, r);
			ctx.lineTo(x + frameW, y + frameH - r);
			ctx.arcTo(x + frameW, y + frameH, x + frameW - r, y + frameH, r);
			ctx.lineTo(x - frameW + r, y + frameH);
			ctx.arcTo(x - frameW, y + frameH, x - frameW, y + frameH - r, r);
			ctx.lineTo(x - frameW, y - frameH + r);
			ctx.arcTo(x - frameW, y - frameH, x - frameW + r, y - frameH, r);
			ctx.closePath();
		} else {
			ctx.ellipse(x, y, frameW, frameH, 0, 0, Math.PI * 2);
		}
		if (lensAlpha > 0) {
			ctx.globalAlpha = lensAlpha;
			ctx.fill();
			ctx.globalAlpha = 1;
		}
		ctx.stroke();
	};

	drawFrame(leftX);
	drawFrame(rightX);
	ctx.beginPath();
	ctx.moveTo(leftX + frameW, y);
	ctx.lineTo(rightX - frameW, y);
	ctx.moveTo(leftX - frameW, y);
	ctx.lineTo(leftX - frameW - bridgeW, y);
	ctx.moveTo(rightX + frameW, y);
	ctx.lineTo(rightX + frameW + bridgeW, y);
	ctx.stroke();
	ctx.restore();
}

function drawAccessoriesLayer(layer: AccessoryLayer, ac: AccessoryDrawContext): void {
	if (!ac.geom.accessories.length) return;
	for (const accessory of ac.geom.accessories) {
		if (accessory.enabled === false) continue;
		const accessoryLayer = accessory.layer ?? "front";
		if (accessoryLayer !== layer) continue;
		if (accessory.type === "antenna") drawAntennaAccessory(accessory, ac);
		else if (accessory.type === "glasses") drawGlassesAccessory(accessory, ac);
	}
}

/**
 * Draw the mouth path for a given style.
 * All styles produce a path at (mx, my) with half-width mw and openness open.
 * The path is NOT begun or closed by this function — the caller manages beginPath/closePath.
 */
function drawMouthShape(
	ctx: CanvasRenderingContext2D,
	style: MouthStyle,
	mx: number, my: number, mw: number, open: number,
): void {
	switch (style) {
		case "cat": {
			// W-shaped cat mouth (3 humps)
			ctx.moveTo(mx - mw, my);
			ctx.lineTo(mx - mw * 0.3, my + open * 0.5);
			ctx.lineTo(mx, my - open * 0.2);
			ctx.lineTo(mx + mw * 0.3, my + open * 0.5);
			ctx.lineTo(mx + mw, my);
			if (open > 0.02) {
				ctx.lineTo(mx + mw * 0.3, my + open * 0.8);
				ctx.lineTo(mx, my + open * 0.3);
				ctx.lineTo(mx - mw * 0.3, my + open * 0.8);
			}
			break;
		}
		case "slit": {
			// Thin horizontal line, minimal opening
			ctx.moveTo(mx - mw, my);
			ctx.lineTo(mx + mw, my);
			if (open > 0.02) {
				ctx.lineTo(mx + mw * 0.8, my + open * 0.4);
				ctx.lineTo(mx - mw * 0.8, my + open * 0.4);
			}
			break;
		}
		case "zigzag": {
			// Jagged line
			const segs = 6;
			ctx.moveTo(mx - mw, my);
			for (let i = 1; i <= segs; i++) {
				const x = mx - mw + (2 * mw * i) / segs;
				const y = my + (i % 2 === 0 ? -1 : 1) * open * 0.3 + (i % 2 === 0 ? -1 : 1) * mw * 0.05;
				ctx.lineTo(x, y);
			}
			break;
		}
		case "pixel": {
			// Stepped rectangles
			const step = mw * 0.3;
			const h = Math.max(open * 0.5, mw * 0.04);
			ctx.rect(mx - mw, my - h / 2, step, h);
			ctx.rect(mx - mw + step * 1.2, my - h / 2, step, h);
			ctx.rect(mx - mw + step * 2.4, my - h / 2, step, h);
			if (mw > step * 3.6) ctx.rect(mx - mw + step * 3.6, my - h / 2, step, h);
			break;
		}
		case "circle": {
			// Small "o" mouth
			const r = Math.max(mw * 0.25, open * 0.3);
			ctx.arc(mx, my + open * 0.2, r, 0, Math.PI * 2);
			break;
		}
		case "fang": {
			// Curve with small triangle fang
			ctx.moveTo(mx - mw, my);
			ctx.quadraticCurveTo(mx, my + open + mw * 0.1, mx + mw, my);
			if (open > 0.02) {
				ctx.quadraticCurveTo(mx, my + open * 0.6, mx - mw, my);
			}
			// Add fang triangle
			ctx.moveTo(mx + mw * 0.3, my + open * 0.1);
			ctx.lineTo(mx + mw * 0.35, my + open * 0.5 + mw * 0.08);
			ctx.lineTo(mx + mw * 0.4, my + open * 0.1);
			break;
		}
		case "smirk": {
			// Asymmetric curve — right side higher
			ctx.moveTo(mx - mw, my + mw * 0.02);
			ctx.quadraticCurveTo(mx - mw * 0.3, my + open * 0.5, mx, my);
			ctx.quadraticCurveTo(mx + mw * 0.5, my - mw * 0.06, mx + mw, my - mw * 0.04);
			if (open > 0.02) {
				ctx.quadraticCurveTo(mx + mw * 0.3, my + open * 0.4, mx, my + open * 0.3);
				ctx.quadraticCurveTo(mx - mw * 0.3, my + open * 0.7, mx - mw, my + mw * 0.02);
			}
			break;
		}
		case "wave": {
			// Wobbly multi-curve line
			ctx.moveTo(mx - mw, my);
			ctx.bezierCurveTo(mx - mw * 0.5, my - mw * 0.06, mx - mw * 0.2, my + mw * 0.06, mx, my);
			ctx.bezierCurveTo(mx + mw * 0.2, my - mw * 0.06, mx + mw * 0.5, my + mw * 0.06, mx + mw, my);
			if (open > 0.02) {
				ctx.bezierCurveTo(mx + mw * 0.5, my + open * 0.5, mx - mw * 0.5, my + open * 0.5, mx - mw, my);
			}
			break;
		}
		case "none":
			// Don't draw anything
			break;
		case "curve":
		default:
			// Sentinel — caller handles the default curve rendering inline
			break;
	}
}

export function resolveMouthRenderer(
	geom: FaceGeometry,
	state: FaceState,
	emotion: FaceEmotion,
	emotionSecondary: FaceEmotion,
	emotionBlend: number,
): "fill" | "line" {
	const stateRenderer = geom.mouthRendererByState[state];
	const primaryEmotionRenderer = geom.mouthRendererByEmotion[emotion];
	const secondaryEmotionRenderer = emotionBlend >= 0.5
		? geom.mouthRendererByEmotion[emotionSecondary]
		: undefined;

	// "fill" should always win over line when multiple sources apply.
	if (stateRenderer === "fill" || primaryEmotionRenderer === "fill" || secondaryEmotionRenderer === "fill") {
		return "fill";
	}
	if (stateRenderer === "line") return "line";
	if (primaryEmotionRenderer === "line") return "line";
	if (secondaryEmotionRenderer === "line") return "line";
	return geom.mouthRenderer;
}

export function resolveBrowRenderer(
	geom: FaceGeometry,
	state: FaceState,
	emotion: FaceEmotion,
	emotionSecondary: FaceEmotion,
	emotionBlend: number,
): BrowRenderer {
	const stateRenderer = geom.browRendererByState[state];
	const primaryEmotionRenderer = geom.browRendererByEmotion[emotion];
	const secondaryEmotionRenderer = emotionBlend >= 0.5
		? geom.browRendererByEmotion[emotionSecondary]
		: undefined;
	return stateRenderer || primaryEmotionRenderer || secondaryEmotionRenderer || geom.browRenderer;
}

function drawDecorations(
	ctx: CanvasRenderingContext2D,
	unit: number,
	cx: number,
	eyeY: number,
	eyeSpacing: number,
	mouthCY: number,
	decorations: readonly FaceDecoration[],
): void {
	if (!decorations || decorations.length === 0) return;

	for (const deco of decorations) {
		if (!deco.enabled) continue;
		ctx.save();
		ctx.globalAlpha = deco.alpha;
		ctx.fillStyle = deco.color;
		const s = deco.size * unit;

		switch (deco.type) {
			case "freckles": {
				const cheekY = (eyeY + mouthCY) / 2;
				const offsets: [number, number][] = [[-0.6, -0.3], [-0.3, -0.5], [-0.5, 0.1], [0.6, -0.3], [0.3, -0.5], [0.5, 0.1]];
				for (const [dx, dy] of offsets) {
					ctx.beginPath();
					ctx.arc(cx + dx * eyeSpacing * 0.7, cheekY + dy * s * 2, s * 0.12, 0, Math.PI * 2);
					ctx.fill();
				}
				break;
			}
			case "tears": {
				for (const side of [-1, 1]) {
					const tx = cx + side * eyeSpacing * 0.5;
					const ty = eyeY + s * 1.5;
					ctx.beginPath();
					ctx.moveTo(tx, ty - s * 0.3);
					ctx.quadraticCurveTo(tx + s * 0.25, ty + s * 0.2, tx, ty + s * 0.4);
					ctx.quadraticCurveTo(tx - s * 0.25, ty + s * 0.2, tx, ty - s * 0.3);
					ctx.fill();
				}
				break;
			}
			case "stripes": {
				ctx.strokeStyle = deco.color;
				ctx.lineWidth = s * 0.08;
				ctx.lineCap = "round";
				for (const side of [-1, 1]) {
					const sx = cx + side * eyeSpacing * 0.6;
					const sy = (eyeY + mouthCY) * 0.5;
					for (let i = -1; i <= 1; i++) {
						ctx.beginPath();
						ctx.moveTo(sx - s * 0.3, sy + i * s * 0.2);
						ctx.lineTo(sx + s * 0.3, sy + i * s * 0.2);
						ctx.stroke();
					}
				}
				break;
			}
			case "sparkles": {
				const positions: [number, number][] = [[-0.7, -0.8], [0.8, -0.6], [-0.5, 0.3], [0.6, 0.2]];
				for (const [dx, dy] of positions) {
					const sx = cx + dx * eyeSpacing * 0.6;
					const sy = eyeY + dy * s * 2;
					const sr = s * 0.15;
					ctx.beginPath();
					for (let i = 0; i <= 8; i++) {
						const angle = (i * Math.PI) / 4 - Math.PI / 2;
						const r = i % 2 === 0 ? sr : sr * 0.3;
						const px = sx + Math.cos(angle) * r;
						const py = sy + Math.sin(angle) * r;
						if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
					}
					ctx.closePath();
					ctx.fill();
				}
				break;
			}
			case "hearts": {
				for (const side of [-1, 1]) {
					const hx = cx + side * eyeSpacing * 0.65;
					const hy = (eyeY + mouthCY) * 0.5;
					const hr = s * 0.2;
					ctx.beginPath();
					ctx.moveTo(hx, hy + hr * 0.6);
					ctx.bezierCurveTo(hx - hr * 0.05, hy + hr * 0.2, hx - hr, hy, hx - hr, hy - hr * 0.2);
					ctx.bezierCurveTo(hx - hr, hy - hr * 0.7, hx, hy - hr * 0.5, hx, hy - hr * 0.1);
					ctx.bezierCurveTo(hx, hy - hr * 0.5, hx + hr, hy - hr * 0.7, hx + hr, hy - hr * 0.2);
					ctx.bezierCurveTo(hx + hr, hy, hx + hr * 0.05, hy + hr * 0.2, hx, hy + hr * 0.6);
					ctx.fill();
				}
				break;
			}
			case "stars": {
				for (const side of [-1, 1]) {
					const sx = cx + side * eyeSpacing * 0.65;
					const sy = (eyeY + mouthCY) * 0.5;
					const sr = s * 0.18;
					ctx.beginPath();
					for (let i = 0; i <= 10; i++) {
						const angle = (i * Math.PI) / 5 - Math.PI / 2;
						const r = i % 2 === 0 ? sr : sr * 0.4;
						const px = sx + Math.cos(angle) * r;
						const py = sy + Math.sin(angle) * r;
						if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
					}
					ctx.closePath();
					ctx.fill();
				}
				break;
			}
			case "lines": {
				ctx.strokeStyle = deco.color;
				ctx.lineWidth = s * 0.06;
				ctx.lineCap = "round";
				const ny = (eyeY + mouthCY) * 0.45;
				for (let i = -2; i <= 2; i++) {
					ctx.beginPath();
					ctx.moveTo(cx + i * s * 0.15 - s * 0.08, ny - s * 0.12);
					ctx.lineTo(cx + i * s * 0.15 + s * 0.08, ny + s * 0.12);
					ctx.stroke();
				}
				break;
			}
			case "scar": {
				ctx.strokeStyle = deco.color;
				ctx.lineWidth = s * 0.08;
				ctx.lineCap = "round";
				const scarX = cx - eyeSpacing * 0.5;
				ctx.beginPath();
				ctx.moveTo(scarX - s * 0.4, eyeY - s * 0.6);
				ctx.lineTo(scarX + s * 0.4, eyeY + s * 0.6);
				ctx.stroke();
				break;
			}
			case "sweat": {
				const sx = cx - eyeSpacing * 0.8;
				const sy = eyeY - s * 1.2;
				ctx.beginPath();
				ctx.moveTo(sx, sy - s * 0.4);
				ctx.quadraticCurveTo(sx + s * 0.2, sy + s * 0.1, sx, sy + s * 0.3);
				ctx.quadraticCurveTo(sx - s * 0.2, sy + s * 0.1, sx, sy - s * 0.4);
				ctx.fill();
				break;
			}
			case "bandaid": {
				ctx.strokeStyle = deco.color;
				ctx.lineWidth = s * 0.12;
				ctx.lineCap = "round";
				const bx = cx + eyeSpacing * 0.6;
				const by = (eyeY + mouthCY) * 0.5;
				ctx.beginPath();
				ctx.moveTo(bx - s * 0.2, by - s * 0.2);
				ctx.lineTo(bx + s * 0.2, by + s * 0.2);
				ctx.stroke();
				ctx.beginPath();
				ctx.moveTo(bx + s * 0.2, by - s * 0.2);
				ctx.lineTo(bx - s * 0.2, by + s * 0.2);
				ctx.stroke();
				break;
			}
		}
		ctx.restore();
	}
}

/**
 * Draw the face onto a Canvas2D context.
 *
 * @param ctx - Canvas rendering context
 * @param w - Canvas width in CSS pixels
 * @param h - Canvas height in CSS pixels
 * @param current - Interpolated face state
 * @param target - Target state (for color resolution)
 * @param geom - Face geometry parameters
 * @param colorState - Mutable color interpolation state
 * @param activeState - Current active state name
 * @param stateTime - Time in seconds since last state change
 * @param style - Rendering style variant
 * @param dt - Delta time in seconds
 * @param disconnected - Whether to show disconnected overlay
 */
export function drawFace(
	ctx: CanvasRenderingContext2D,
	w: number,
	h: number,
	current: CurrentState,
	target: TargetState,
	geom: FaceGeometry,
	colorState: ColorState,
	activeState: FaceState,
	stateTime: number,
	style: StyleVariant,
	dt: number,
	stateColors: Record<string, string>,
	emotionColors: Record<string, string | null>,
	disconnected = false,
	reducedMotion = false,
	emotionColorBlend = 0.5,
	debugOverlay = false,
	accessoryPhysics: ReadonlyMap<string, AccessoryPhysicsState> | null = null,
): void {
	if (!w || !h) return;

	const c = current;
	const G = geom;
	const scene = computeSceneFrame(w, h, G);
	const unit = scene.unit;
	const cx = scene.cx + (reducedMotion ? 0 : c.shake * Math.sin(stateTime * 40 * Math.PI * 2));
	const cy = scene.cy;

	// Interpolate face color
	const colorSpeed = activeState === "alert"
		? G.colorSpeedAlert
		: activeState === "sleeping"
			? G.colorSpeedSleeping
			: G.colorSpeedDefault;
	const targetColor = resolveFaceColor(target, stateColors, emotionColors, emotionColorBlend);
	const [tr, tg, tb] = hexToRGB(targetColor);
	colorState.r = dlerp(colorState.r, tr, colorSpeed, dt);
	colorState.g = dlerp(colorState.g, tg, colorSpeed, dt);
	colorState.b = dlerp(colorState.b, tb, colorSpeed, dt);

	const faceHex = rgbToHex(colorState.r, colorState.g, colorState.b);
	const floatingHead = G.headShape !== "fullscreen";
	const headFillHex = G.headFillColor ?? (floatingHead
		? shiftHexColor(colorState.r, colorState.g, colorState.b, 16)
		: faceHex);

	// Background
	if (style === "classic") {
		ctx.fillStyle = floatingHead
			? shiftHexColor(colorState.r, colorState.g, colorState.b, -28)
			: faceHex;
		ctx.fillRect(0, 0, w, h);
	} else if (style === "minimal") {
		ctx.clearRect(0, 0, w, h);
	} else {
		const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, unit * 0.85);
		const innerHex = floatingHead
			? shiftHexColor(colorState.r, colorState.g, colorState.b, -6)
			: shiftHexColor(colorState.r, colorState.g, colorState.b, 20);
		const outerHex = floatingHead
			? shiftHexColor(colorState.r, colorState.g, colorState.b, -34)
			: faceHex;
		grad.addColorStop(0, innerHex);
		grad.addColorStop(1, outerHex);
		ctx.fillStyle = grad;
		ctx.fillRect(0, 0, w, h);
	}

	// Disconnected overlay
	if (disconnected) {
		ctx.fillStyle = "rgba(128,128,128,0.3)";
		ctx.fillRect(0, 0, w, h);
	}

	const breathScale = 1 + c.breathe * G.breathAmt;
	const breathY = c.breathe * unit * G.breathY;
	drawBody(ctx, unit, cx, cy, breathY, c, G, activeState, stateTime, reducedMotion);

	// Head tilt + bounce
	ctx.save();
	ctx.translate(cx, cy);
	ctx.rotate(c.tilt);
	ctx.scale(c.bounce, c.bounce);
	ctx.translate(-cx, -cy);

	// Eyes
	const baseEyeW = unit * G.eyeW;
	const baseEyeH = unit * G.eyeH * breathScale;
	const eyeSpacing = unit * G.eyeSpacing;
	const eyeY = cy + unit * G.eyeY + breathY;
	const accessoryContext: AccessoryDrawContext = {
		ctx,
		unit,
		cx,
		cy,
		breathY,
		eyeSpacing,
		eyeY,
		baseEyeW,
		baseEyeH,
		activeState,
		target,
		current: c,
		geom: G,
		stateTime,
		reducedMotion,
		accessoryPhysics,
	};
	drawAccessoriesLayer("back", accessoryContext);
	drawHeadLayer(ctx, unit, cx, cy, breathY, G, headFillHex);

	// Specular positioning reference — uses base eye size but gets clamped to actual bounds

	for (let side = -1; side <= 1; side += 2) {
		const ex = cx + eyeSpacing * side;
		const brow = side === -1 ? c.browLeft : c.browRight;
		const eScale = side === -1 ? c.eyeScaleL : c.eyeScaleR;
		const rawEw = baseEyeW * eScale;
		const maxEw = eyeSpacing * 0.85; // allow large eyes (kawaii), prevent actual overlap
		const ew = Math.min(rawEw, maxEw);
		const eyeScaleClamp = rawEw > 0 ? ew / rawEw : 1;
		const eh = baseEyeH * eScale * eyeScaleClamp;
		const wink = side === -1 ? c.winkL : c.winkR;
		const effectiveLid = c.lidTop * (1 - wink);
		const openH = eh * Math.max(0.02, effectiveLid);

		// Per-eye overrides (heterochromia, mixed styles)
		const override = side === -1 ? G.eyeLeftOverride : G.eyeRightOverride;
		const eyeStyle = override.style || G.eyeStyle;
		const pupilShape = override.pupilShape || G.pupilShape;
		const pupilColor = override.pupilColor || G.pupilColor;
		const specShape = override.specularShape || G.specularShape;
		const specSize = override.specularSize !== undefined ? override.specularSize : G.specularSize;

		// Per-feature eye colors (fall back to shared featureColor)
		const eyeFill = G.eyeFillColor || G.featureColor;
		const eyeStroke = G.eyeStrokeColor || G.featureColor;

		// Squint amount: compress bottom of eye for Duchenne smile
		const squishFactor = 1 - c.squint * 0.7;
		const bottomH = openH * squishFactor;

		if (effectiveLid > 0.08) {
			// Open eye — draw shape then clip pupil/specular layers inside it
			ctx.save();
			ctx.beginPath();
			const slope = side === -1 ? c.eyeSlopeL : c.eyeSlopeR;
			drawEyeShape(ctx, eyeStyle, ex, eyeY, ew, openH, bottomH, slope, side);
			ctx.fillStyle = eyeFill;
			ctx.fill();
			// Hardware clip — pupil/specular pixels cannot render outside the eye path
			ctx.clip();

			if (effectiveLid > 0.25) {
				if (G.pupilEnabled) {
					const { xRadius, topRadius, bottomRadius } = getEyeSpecularBounds(eyeStyle, ew, openH, bottomH);
					const yRadius = Math.min(topRadius, bottomRadius);
					const prx = Math.min(ew * G.pupilSize, xRadius * 0.75);
					const pry = Math.min(openH * G.pupilSize, yRadius * 0.85, prx);
					const sx = clamp(G.pupilShiftX, 0, 1);
					const sy = clamp(G.pupilShiftY, 0, 1);
					const follow = clamp(G.pupilLookFollow, 0, 1);
					const px = ex - xRadius * 0.35 + sx * (xRadius * 0.7) + c.lookX * xRadius * 0.35 * follow;
					const py = eyeY - yRadius * 0.35 + sy * (yRadius * 0.7) + c.lookY * yRadius * 0.28 * follow;
					ctx.fillStyle = pupilColor;
					ctx.strokeStyle = pupilColor;
					const pr = Math.max(1, Math.min(prx, pry));
					drawPupilShape(ctx, pupilShape, px, py, pr);
				}
				if (G.specularEnabled && G.specularAlpha > 0) {
					const { xRadius, topRadius, bottomRadius } = getEyeSpecularBounds(eyeStyle, ew, openH, bottomH);
					const yRadius = Math.min(topRadius, bottomRadius);
					// Shape-aware specular size responds to true eye contour bounds.
					let srx = Math.min(baseEyeW * specSize, xRadius * 0.35);
					let sry = Math.min(baseEyeH * specSize, yRadius * 0.45, xRadius * 0.3);
					if (eyeStyle === "dot") {
						srx *= 0.85;
						sry *= 0.85;
					}
					const { x: sx, y: sy } = computeSpecularCenter(
						eyeStyle,
						ex,
						eyeY,
						ew,
						openH,
						bottomH,
						c.lookX,
						c.lookY,
						G.specularShiftX,
						G.specularShiftY,
						G.specularLookFollow,
						srx,
						sry,
					);
					ctx.save();
					ctx.globalAlpha = clamp(G.specularAlpha, 0, 1);
					ctx.beginPath();
					drawSpecularShape(ctx, eyeStyle, sx, sy, srx, sry, specShape);
					ctx.fillStyle = G.specularColor;
					ctx.fill();
					ctx.restore();
				}
			}
			if (G.eyelidRenderer === "cover") {
				const cover = clamp((1 - effectiveLid) * G.eyelidStrength, 0, 1);
				if (cover > 0.01) {
					const top = eyeY - openH;
					const height = (openH + bottomH) * cover;
					ctx.fillStyle = G.eyelidColor;
					ctx.fillRect(ex - ew, top, ew * 2, height);
				}
			}
			ctx.restore();
		} else {
			// Closed eye (line) — tilt endpoints to match slope
			const slope = side === -1 ? c.eyeSlopeL : c.eyeSlopeR;
			const slopeAmt = slope * eh * 0.4;
			ctx.beginPath();
			ctx.moveTo(ex - ew, eyeY + slopeAmt * side);
			ctx.quadraticCurveTo(ex, eyeY + eh * 0.3, ex + ew, eyeY - slopeAmt * side);
			ctx.lineWidth = ew * 0.15;
			ctx.lineCap = "round";
			ctx.strokeStyle = eyeStroke;
			ctx.stroke();
		}

		// Blush
		if (c.blushAlpha > 0.02) {
			ctx.save();
			ctx.globalAlpha = c.blushAlpha * G.blushAlpha;
			ctx.beginPath();
			ctx.ellipse(
				ex + ew * 0.2 * side, eyeY + eh * 1.0,
				ew * G.blushSize, ew * 0.35,
				0, 0, Math.PI * 2,
			);
			ctx.fillStyle = G.blushColor;
			ctx.fill();
			ctx.restore();
		}

		// Eyebrow
		const browRenderer = resolveBrowRenderer(
			G,
			activeState,
			target.emotion,
			target.emotionSecondary,
			target.emotionBlend,
		);
		if (browRenderer !== "none") {
			const browFill = G.browColor || G.featureColor;
			const browY = eyeY - eh * G.browVert - brow * unit * G.browRange;
			const browThick = baseEyeW * (G.browThick + Math.max(0, -brow) * 0.1);
			const browTilt = browRenderer === "flat"
				? 0
				: (side === -1 ? 1 : -1) * c.confusion * 0.15;
			ctx.save();
			ctx.translate(ex, browY);
			ctx.rotate(browTilt);
			ctx.beginPath();
			if (browRenderer === "flat") {
				ctx.moveTo(-ew * 0.85, 0);
				ctx.lineTo(ew * 0.85, 0);
				ctx.lineWidth = browThick;
				ctx.lineCap = "round";
				ctx.strokeStyle = browFill;
				ctx.stroke();
			} else if (browRenderer === "block") {
				const width = ew * 1.7;
				const height = Math.max(1, browThick * 0.9);
				ctx.rect(-width / 2, -height / 2, width, height);
				ctx.fillStyle = browFill;
				ctx.fill();
			} else if (browRenderer === "arch") {
				ctx.moveTo(-ew * 0.7, browThick * 0.3);
				ctx.quadraticCurveTo(0, -browThick * 0.8, ew * 0.7, browThick * 0.3);
				ctx.lineWidth = browThick;
				ctx.lineCap = "round";
				ctx.strokeStyle = browFill;
				ctx.stroke();
			} else if (browRenderer === "angled") {
				ctx.moveTo(-ew * 0.7, 0);
				ctx.lineTo(-ew * 0.1, -browThick * 0.6);
				ctx.lineTo(ew * 0.7, browThick * 0.2);
				ctx.lineWidth = browThick;
				ctx.lineCap = "round";
				ctx.lineJoin = "round";
				ctx.strokeStyle = browFill;
				ctx.stroke();
			} else if (browRenderer === "thick") {
				const tw = browThick * 1.8;
				ctx.ellipse(0, 0, ew * 0.6, tw, 0, 0, Math.PI * 2);
				ctx.fillStyle = browFill;
				ctx.fill();
			} else if (browRenderer === "dot") {
				ctx.arc(0, 0, browThick * 0.6, 0, Math.PI * 2);
				ctx.fillStyle = browFill;
				ctx.fill();
			} else {
				ctx.moveTo(-ew * 0.85, 0);
				ctx.quadraticCurveTo(0, -unit * 0.02 - brow * unit * G.browCurve, ew * 0.85, 0);
				ctx.lineWidth = browThick;
				ctx.lineCap = "round";
				ctx.strokeStyle = browFill;
				ctx.stroke();
			}
			ctx.restore();
			if (debugOverlay) drawDebugOverlay(ctx, ex, eyeY, ew, openH, bottomH, browY);
		}

		// Eyelash / eyeliner
		if (G.eyelashStyle !== "none" && effectiveLid > 0.08) {
			const eyelashColor = G.eyeStrokeColor || G.featureColor;
			drawEyelash(ctx, G.eyelashStyle, ex, eyeY, ew, openH, side, eyelashColor, unit);
		}
	}
	drawAccessoriesLayer("mid", accessoryContext);

	// Nose — drawn between eyes and mouth
	if (G.noseStyle !== "none") {
		const mouthCYForNose = cy + unit * G.mouthY + breathY;
		const noseColor = G.noseColor || G.featureColor;
		const noseY = (eyeY + mouthCYForNose) / 2 + unit * G.noseVerticalPosition;
		drawNose(ctx, G.noseStyle, cx, noseY, G.noseSize, noseColor, unit);
	}

	// Mouth — ALWAYS a single filled bezier shape. Never a stroked line.
	// A "closed" mouth is just a very thin filled shape (near-zero height).
	// This eliminates all ghost/double-render artifacts.
	const mouthCY = cy + unit * G.mouthY + breathY;
	const mouthW = unit * G.mouthW * (1 + c.mouthWidth * 0.4);
	const smile = c.happiness;
	const asym = c.mouthAsymmetry;
	const asymL = -asym * unit * 0.03;
	const asymR = asym * unit * 0.03;
	const openness = c.mouthOpen;
	const waviness = c.confusion;

	const smileOffset = smile * unit * -0.04;
	const wavyAmt = waviness * unit * 0.025;
	const smileCurve = smile * unit * 0.06;

	const lx = cx - mouthW * 0.85;
	const rx = cx + mouthW * 0.85;
	const ly = mouthCY + smileOffset + asymL;
	const ry = mouthCY + smileOffset + asymR;

	// Per-feature mouth colors (fall back to shared featureColor)
	const mouthFill = G.mouthFillColor || G.featureColor;
	const mouthStroke = G.mouthStrokeColor || G.featureColor;

	const mouthRenderer = resolveMouthRenderer(
		G,
		activeState,
		target.emotion,
		target.emotionSecondary,
		target.emotionBlend,
	);
	const useLineMouth = mouthRenderer === "line";
	const mStyle = G.mouthStyle;

	if (mStyle !== "curve" && mStyle !== "none") {
		// Non-default mouth shapes — use drawMouthShape helper
		const mouthOpenPx = openness * unit * 0.14 + unit * 0.016;
		ctx.beginPath();
		drawMouthShape(ctx, mStyle, cx, mouthCY + smileOffset, mouthW * 0.85, mouthOpenPx);
		if (useLineMouth) {
			const lineW = unit * (0.01 + openness * 0.015);
			ctx.lineWidth = lineW;
			ctx.lineCap = "round";
			ctx.lineJoin = "round";
			ctx.strokeStyle = mouthStroke;
			ctx.stroke();
		} else {
			ctx.closePath();
			ctx.fillStyle = mouthFill;
			ctx.fill();
		}
	} else if (mStyle === "none") {
		// No mouth — skip drawing
	} else if (useLineMouth) {
		// LINE MODE — stroked curve, original MVP style.
		// Openness increases curve deflection + line width, not fill height.
		const deflection = smileCurve + openness * unit * 0.08;
		const lineW = unit * (0.01 + openness * 0.015);
		ctx.beginPath();
		ctx.moveTo(lx, ly);
		ctx.bezierCurveTo(
			cx - mouthW * 0.3, mouthCY + deflection + wavyAmt,
			cx + mouthW * 0.3, mouthCY + deflection - wavyAmt,
			rx, ry,
		);
		ctx.lineWidth = lineW;
		ctx.lineCap = "round";
		ctx.strokeStyle = mouthStroke;
		ctx.stroke();
	} else {
		// FILL MODE — filled bezier shape (default curve)
		const smileThickness = Math.abs(smile) * unit * 0.012;
		const baseThickness = unit * 0.016;
		const mH = baseThickness + smileThickness + openness * unit * 0.14;

		const topCpLY = mouthCY + smileCurve - mH * 0.15 + wavyAmt * 0.8;
		const topCpRY = mouthCY + smileCurve - mH * 0.15 - wavyAmt * 0.8;
		const botCpRY = mouthCY + mH * 1.6 - wavyAmt * 0.5;
		const botCpLY = mouthCY + mH * 1.6 + wavyAmt * 0.5;

		ctx.beginPath();
		ctx.moveTo(lx, ly);
		ctx.bezierCurveTo(cx - mouthW * 0.3, topCpLY, cx + mouthW * 0.3, topCpRY, rx, ry);
		ctx.bezierCurveTo(cx + mouthW * 0.3, botCpRY, cx - mouthW * 0.3, botCpLY, lx, ly);
		ctx.closePath();
		ctx.fillStyle = mouthFill;
		ctx.fill();
	}
	drawDecorations(ctx, unit, cx, eyeY, eyeSpacing, mouthCY, G.decorations);
	drawAccessoriesLayer("front", accessoryContext);
	drawAccessoriesLayer("overlay", accessoryContext);

	// Working dots (gear indicator)
	if (activeState === "working" && c.pulse > 0.01) {
		ctx.save();
		ctx.globalAlpha = c.pulse * 0.5;
		for (let i = 0; i < 4; i++) {
			const a = stateTime * 2 + i * Math.PI / 2;
			ctx.beginPath();
			ctx.arc(
				cx + unit * 0.2 + Math.cos(a) * unit * 0.03,
				cy - unit * 0.16 + breathY + Math.sin(a) * unit * 0.03,
				unit * 0.007, 0, Math.PI * 2,
			);
			ctx.fillStyle = G.featureColor;
			ctx.fill();
		}
		ctx.restore();
	}

	// Thinking dots
	if (activeState === "thinking" && c.pulse > 0.01) {
		ctx.save();
		ctx.globalAlpha = c.pulse * 0.6;
		for (let i = 0; i < 3; i++) {
			const a = stateTime * 1.5 + i * (Math.PI * 2 / 3);
			ctx.beginPath();
			ctx.arc(
				cx + unit * 0.2 + Math.cos(a) * unit * 0.03,
				cy - unit * 0.16 + breathY + Math.sin(a) * unit * 0.03,
				unit * 0.009 * (1 - i * 0.15), 0, Math.PI * 2,
			);
			ctx.fillStyle = G.featureColor;
			ctx.fill();
		}
		ctx.restore();
	}

	// Sleeping Zzz
	if (activeState === "sleeping" && c.lidTop < 0.15) {
		ctx.save();
		ctx.fillStyle = G.featureColor;
		const ph = stateTime * 0.5;
		for (let i = 0; i < 3; i++) {
			const p = ((ph + i * 0.5) % 2) / 2;
			ctx.globalAlpha = 0.7 * (1 - p);
			ctx.font = `bold ${unit * (0.03 + p * 0.02)}px sans-serif`;
			ctx.fillText("z", cx + unit * 0.16 + p * unit * 0.09, cy - unit * 0.09 - p * unit * 0.12);
		}
		ctx.restore();
	}

	// Alert flash (gated on reduced-motion for photosensitivity)
	if (activeState === "alert" && stateTime < 0.3 && !reducedMotion) {
		ctx.save();
		ctx.globalAlpha = (0.3 - stateTime) * 0.4;
		ctx.fillStyle = "#f00";
		ctx.fillRect(cx - w, cy - h, w * 2, h * 2);
		ctx.restore();
	}

	ctx.restore(); // head tilt
}

/**
 * Resolve face color by procedurally adjusting the theme's state color.
 * Emotions shift the theme's OWN color lighter/darker/warmer/cooler —
 * no foreign emotion colors injected. Theme identity stays intact.
 */
export function resolveFaceColor(
	target: TargetState,
	stateColors: Record<string, string>,
	emotionColors: Record<string, string | null>,
	emotionColorBlend: number,
): string {
	if (target.color) return target.color;
	const stateColor = stateColors[target.state] || stateColors.idle || "#4FC3F7";
	if (target.emotion === "neutral" || target.intensity < 0.01) return stateColor;

	const emotionColor = emotionColors[target.emotion];
	if (emotionColor) {
		const [sr, sg, sb] = hexToRGB(stateColor);
		const [er, eg, eb] = hexToRGB(emotionColor);
		const t = clamp(emotionColorBlend * target.intensity, 0, 1);
		return rgbToHex(
			sr + (er - sr) * t,
			sg + (eg - sg) * t,
			sb + (eb - sb) * t,
		);
	}

	let [r, g, b] = hexToRGB(stateColor);
	const i = target.intensity;

	// Procedural emotion shifts — adjust the theme's own color
	// Doubled from original values — previous shifts were imperceptible
	switch (target.emotion) {
		case "happy":
		case "proud":
			r = Math.min(255, r + 50 * i); g = Math.min(255, g + 40 * i); b = Math.min(255, b + 15 * i);
			break;
		case "excited":
			r = Math.min(255, r + 65 * i); g = Math.min(255, g + 45 * i); b = Math.min(255, b + 5 * i);
			break;
		case "sad":
		case "concerned":
			r = Math.max(0, r - 40 * i); g = Math.max(0, g - 30 * i); b = Math.max(0, b - 10 * i);
			break;
		case "confused":
		case "skeptical":
			{ const avg = (r + g + b) / 3; const t = 0.3 * i; r += (avg - r) * t; g += (avg - g) * t; b += (avg - b) * t; }
			break;
		case "frustrated":
			r = Math.min(255, r + 35 * i); g = Math.max(0, g - 40 * i); b = Math.max(0, b - 40 * i);
			break;
		case "surprised":
			r = Math.min(255, r + 40 * i); g = Math.min(255, g + 50 * i); b = Math.min(255, b + 55 * i);
			break;
		case "playful":
			r = Math.min(255, r + 30 * i); g = Math.min(255, g + 10 * i); b = Math.min(255, b + 30 * i);
			break;
		case "determined":
			// Slightly deeper/richer
			r = Math.max(0, r - 10 * i); g = Math.min(255, g + 20 * i); b = Math.max(0, b - 10 * i);
			break;
		case "embarrassed":
			r = Math.min(255, r + 45 * i); g = Math.max(0, g - 15 * i); b = Math.min(255, b + 10 * i);
			break;
	}

	return rgbToHex(r, g, b);
}
