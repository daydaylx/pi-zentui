import { describe, expect, it } from "vitest";
import { type PolishedTuiConfig, defaultConfig } from "../extensions/zentui/config";
import {
	collectExtensionStatusSegments,
	sanitizeExtensionStatusText,
} from "../extensions/zentui/extension-status";

function configWithExtensionStatuses(
	extensionStatuses: Partial<PolishedTuiConfig["extensionStatuses"]>,
): PolishedTuiConfig {
	return {
		...defaultConfig,
		extensionStatuses: {
			...defaultConfig.extensionStatuses,
			...extensionStatuses,
			placements: {
				...defaultConfig.extensionStatuses.placements,
				...(extensionStatuses.placements ?? {}),
			},
		},
	};
}

describe("sanitizeExtensionStatusText", () => {
	it("strips ANSI, terminal control sequences, and control whitespace", () => {
		expect(sanitizeExtensionStatusText("\x1b[31mred\x1b[0m\nnext\tline")).toBe("red next line");
		expect(sanitizeExtensionStatusText("\x1b]133;A\x07prompt\x1b]133;B\x07")).toBe("prompt");
		expect(sanitizeExtensionStatusText("  a\r\n\t b   c \x00\x08 ")).toBe("a b c");
	});

	it("returns an empty string when no visible status remains", () => {
		expect(sanitizeExtensionStatusText("\x1b[31m\x1b[0m\n\t")).toBe("");
	});
});

describe("collectExtensionStatusSegments", () => {
	it("routes active statuses by placement and defaults unsaved keys to right", () => {
		const config = configWithExtensionStatuses({
			placements: {
				alpha: "left",
				beta: "middle",
				gamma: "right",
				hidden: "off",
			},
		});
		const segments = collectExtensionStatusSegments(
			new Map([
				["gamma", "gamma"],
				["unsaved", "unsaved"],
				["hidden", "hidden"],
				["beta", "beta"],
				["alpha", "alpha"],
			]),
			config,
		);

		expect(segments.left.map((segment) => segment.key)).toEqual(["alpha"]);
		expect(segments.middle.map((segment) => segment.key)).toEqual(["beta"]);
		expect(segments.right.map((segment) => segment.key)).toEqual(["gamma", "unsaved"]);
		expect(
			[...segments.left, ...segments.middle, ...segments.right].map((segment) => segment.key),
		).not.toContain("hidden");
	});

	it("sorts each placement alphabetically and skips sanitized-empty statuses", () => {
		const config = configWithExtensionStatuses({ defaultPlacement: "left" });
		const segments = collectExtensionStatusSegments(
			new Map([
				["zeta", "z"],
				["empty", "\x1b[31m\x1b[0m"],
				["alpha", "a"],
			]),
			config,
		);

		expect(segments.left.map((segment) => segment.key)).toEqual(["alpha", "zeta"]);
		expect(segments.left.map((segment) => segment.text)).toEqual(["a", "z"]);
	});
});
