import { describe, expect, test } from "bun:test";
import { renderUnclaimedHtml, renderViewerHtml } from "../src/viewer-pages.js";

describe("renderViewerHtml", () => {
	test("renders viewer with escaped values and expected websocket URL", () => {
		const html = renderViewerHtml("alice", "default", "oface.io");
		expect(html).toContain('server="wss://oface.io/alice/ws/viewer"');
		expect(html).toContain('face="default"');
	});

	test("contains explicit TTS disable handling", () => {
		const html = renderViewerHtml("alice", "default", "oface.io");
		expect(html).toContain('["0", "false", "off", "no"]');
		expect(html).toContain("if (!enabled) return;");
	});
});

describe("renderUnclaimedHtml", () => {
	test("escapes user-controlled values", () => {
		const html = renderUnclaimedHtml('<script>alert("x")</script>');
		expect(html).toContain("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;");
		expect(html).not.toContain('<script>alert("x")</script>');
	});
});
