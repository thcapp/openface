/**
 * Frame-rate independent interpolation.
 * Smoothly moves `current` toward `target` at `speed` (0–1),
 * adjusted for the elapsed `dt` in seconds.
 */
export function dlerp(current: number, target: number, speed: number, dt: number): number {
	return current + (target - current) * (1 - Math.pow(1 - speed, dt * 60));
}

export function hexToRGB(hex: string): [number, number, number] {
	const n = parseInt(hex.slice(1), 16);
	return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function rgbToHex(r: number, g: number, b: number): string {
	return "#" + ((1 << 24) + (Math.round(r) << 16) + (Math.round(g) << 8) + Math.round(b)).toString(16).slice(1);
}

/**
 * Soft limiting — values compress smoothly as they approach limits.
 * No hard clipping. Uses tanh to create smooth rolloff.
 */
export function softLimit(val: number, min: number, max: number): number {
	const mid = (min + max) / 2;
	const range = (max - min) / 2;
	return mid + range * Math.tanh((val - mid) / range);
}

export function brighten(r: number, g: number, b: number, amt: number): [number, number, number] {
	return [Math.min(255, r + amt), Math.min(255, g + amt), Math.min(255, b + amt)];
}

/**
 * Saccade-aware lerp for eye gaze.
 * Large jumps (> threshold) use fast saccade speed; small adjustments use slow drift.
 * Mimics real eye movement: snap to target, then micro-correct.
 */
export function saccadeLerp(
	current: number,
	target: number,
	dt: number,
	threshold = 0.3,
	saccadeSpeed = 0.35,
	driftSpeed = 0.04,
): number {
	const delta = Math.abs(target - current);
	const speed = delta > threshold ? saccadeSpeed : driftSpeed;
	return dlerp(current, target, speed, dt);
}
