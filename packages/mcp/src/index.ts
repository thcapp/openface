#!/usr/bin/env bun

/**
 * @openface/mcp — MCP server for controlling Open Face from Claude and other AI clients.
 *
 * 8 tools: set_face_state, set_face_look, face_wink, face_speak, set_face_progress, face_emote, get_face_state, face_reset
 *
 * Usage: FACE_URL=https://face.example.com bunx @openface/mcp
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const FACE_URL = process.env.FACE_URL || "http://127.0.0.1:9999";
const FACE_API_KEY = process.env.FACE_API_KEY || "";

const STATES = [
	"idle", "thinking", "speaking", "listening", "reacting",
	"puzzled", "alert", "working", "sleeping",
	"waiting", "loading",
] as const;

const EMOTIONS = [
	"neutral", "happy", "sad", "confused", "excited",
	"concerned", "surprised", "playful",
	"frustrated", "skeptical", "determined", "embarrassed", "proud",
] as const;

async function facePost(body: Record<string, unknown>): Promise<unknown> {
	const headers: Record<string, string> = { "Content-Type": "application/json" };
	if (FACE_API_KEY) headers.Authorization = `Bearer ${FACE_API_KEY}`;

	const res = await fetch(`${FACE_URL}/api/state`, {
		method: "POST",
		headers,
		body: JSON.stringify(body),
	});

	if (!res.ok) {
		const text = await res.text().catch(() => "");
		throw new Error(`Face API error ${res.status}: ${text}`);
	}

	return res.json();
}

async function faceGet(): Promise<unknown> {
	const res = await fetch(`${FACE_URL}/api/state`);
	if (!res.ok) {
		const text = await res.text().catch(() => "");
		throw new Error(`Face API error ${res.status}: ${text}`);
	}
	return res.json();
}

const server = new McpServer({
	name: "openface",
	version: "0.1.0",
});

server.tool(
	"set_face_state",
	"Set the face's current state, emotion, intensity, and other parameters. States: idle, thinking, speaking, listening, reacting, puzzled, alert, working, sleeping, waiting (blocked on input), loading (booting/initializing). Emotions: neutral, happy, sad, confused, excited, concerned, surprised, playful, frustrated, skeptical, determined, embarrassed, proud.",
	{
		state: z.enum(STATES).describe("Face state"),
		emotion: z.enum(EMOTIONS).optional().describe("Primary emotional expression"),
		emotionSecondary: z.enum(EMOTIONS).optional().describe("Secondary emotion to blend with primary"),
		emotionBlend: z.number().min(0).max(1).optional().describe("Blend factor between primary and secondary emotion (0=primary only, 1=secondary only)"),
		intensity: z.number().min(0).max(1).optional().describe("Emotion intensity multiplier (0=subtle, 1=full). Default 1"),
		amplitude: z.number().min(0).max(1).optional().describe("Animation amplitude (0-1)"),
		color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional().describe("Face color as hex (#RRGGBB)"),
	},
	async ({ state, emotion, emotionSecondary, emotionBlend, intensity, amplitude, color }) => {
		const body: Record<string, unknown> = { state };
		if (emotion !== undefined) body.emotion = emotion;
		if (emotionSecondary !== undefined) body.emotionSecondary = emotionSecondary;
		if (emotionBlend !== undefined) body.emotionBlend = emotionBlend;
		if (intensity !== undefined) body.intensity = intensity;
		if (amplitude !== undefined) body.amplitude = amplitude;
		if (color !== undefined) body.color = color;

		const result = await facePost(body);
		return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
	},
);

server.tool(
	"set_face_look",
	"Control eye gaze direction",
	{
		x: z.number().min(-1).max(1).describe("Horizontal gaze (-1 left, 1 right)"),
		y: z.number().min(-1).max(1).describe("Vertical gaze (-1 down, 1 up)"),
	},
	async ({ x, y }) => {
		const result = await facePost({ lookAt: { x, y } });
		return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
	},
);

server.tool(
	"face_wink",
	"Wink one eye",
	{
		eye: z.enum(["left", "right"]).describe("Which eye to wink"),
		duration: z.number().min(100).max(5000).default(800).describe("Wink duration in ms"),
	},
	async ({ eye, duration }) => {
		const body = eye === "left" ? { winkLeft: 1 } : { winkRight: 1 };
		await facePost(body);

		setTimeout(async () => {
			try {
				await facePost(eye === "left" ? { winkLeft: 0 } : { winkRight: 0 });
			} catch { /* fire-and-forget */ }
		}, duration);

		return {
			content: [{ type: "text" as const, text: `Winked ${eye} eye for ${duration}ms` }],
		};
	},
);

server.tool(
	"face_speak",
	"Display text on the face (speech bubble) and set speaking state",
	{
		text: z.string().max(500).describe("Text to display"),
		duration: z.number().min(500).max(30000).default(3000).describe("Display duration in ms"),
	},
	async ({ text, duration }) => {
		const result = await facePost({
			state: "speaking",
			text,
			textDuration: duration,
		});
		return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
	},
);

server.tool(
	"set_face_progress",
	"Set progress for long-running operations. Shows visual progress indication on the face during working or loading states. Set to null to clear.",
	{
		progress: z.number().min(0).max(1).nullable().describe("Completion fraction (0.0-1.0), or null to clear"),
		state: z.enum(["working", "loading"]).optional().describe("Optionally set state to working or loading"),
		text: z.string().max(200).optional().describe("Optional status text to display"),
	},
	async ({ progress, state, text }) => {
		const body: Record<string, unknown> = { progress };
		if (state !== undefined) body.state = state;
		if (text !== undefined) body.text = text;

		const result = await facePost(body);
		return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
	},
);

server.tool(
	"face_emote",
	"Set emotion and intensity together for expressive reactions. Convenience tool for quickly setting emotional state without changing the activity state.",
	{
		emotion: z.enum(EMOTIONS).describe("Primary emotion"),
		intensity: z.number().min(0).max(1).optional().describe("Emotion intensity (0=subtle, 1=full). Default 1"),
		emotionSecondary: z.enum(EMOTIONS).optional().describe("Secondary emotion to blend"),
		emotionBlend: z.number().min(0).max(1).optional().describe("Blend factor (0=primary, 1=secondary)"),
	},
	async ({ emotion, intensity, emotionSecondary, emotionBlend }) => {
		const body: Record<string, unknown> = { emotion };
		if (intensity !== undefined) body.intensity = intensity;
		if (emotionSecondary !== undefined) body.emotionSecondary = emotionSecondary;
		if (emotionBlend !== undefined) body.emotionBlend = emotionBlend;

		const result = await facePost(body);
		return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
	},
);

server.tool(
	"get_face_state",
	"Get the face's current state",
	{},
	async () => {
		const result = await faceGet();
		return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
	},
);

server.tool(
	"face_reset",
	"Reset face to default idle state",
	{},
	async () => {
		await facePost({ type: "reset" });
		return { content: [{ type: "text" as const, text: "Face reset to defaults" }] };
	},
);

const transport = new StdioServerTransport();
await server.connect(transport);
