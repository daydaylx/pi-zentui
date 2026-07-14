import { homedir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { resolveAgentFooterLabels } from "../extensions/zentui/agent-footer";

const cwd = join(homedir(), "Projekte", "daydaylx", "pi");

function labels(width: number, statuses: ReadonlyMap<string, string> = new Map()) {
	return resolveAgentFooterLabels({
		cwd,
		model: "gpt-5.6",
		provider: "openai-codex",
		thinkingLevel: "xhigh",
		statuses,
		width,
	});
}

describe("agent footer labels", () => {
	it("uses the fixed wide directory, workflow, model, and thinking sequence", () => {
		expect(labels(160, new Map([["workflow", "ARCH PLAN"]]))).toMatchObject({
			variant: "wide",
			cwd: "~/Projekte/daydaylx/pi",
			workflow: "ARCHITEKTURPLAN",
			model: "openai-codex/gpt-5.6",
			thinking: "THINKING XHIGH",
		});
	});

	it("shortens model information before the mandatory folder and mode at 60 columns", () => {
		expect(labels(60, new Map([["workflow", "ARCH PLAN"]]))).toMatchObject({
			variant: "medium",
			cwd: "daydaylx/pi",
			workflow: "ARCH",
			model: "gpt-5.6",
			thinking: "XHIGH",
		});
	});

	it("uses the narrow required folder and mode labels", () => {
		expect(labels(30, new Map([["workflow", "ARCH PLAN"]]))).toMatchObject({
			variant: "narrow",
			cwd: "pi",
			workflow: "ARCH",
			model: "5.6",
			thinking: "XH",
		});
	});

	it("keeps work progress in the workflow segment and appends only a risk warning", () => {
		expect(
			labels(160, new Map([
				["workflow", "WORK 3/7"],
				["permissions", "⚠ YOLO"],
				["subagents", "3 active"],
			])),
		).toMatchObject({
			workflow: "WORK 3/7",
			risk: "⚠ YOLO",
		});
	});

	it("ignores ordinary permission and unrelated extension statuses", () => {
		expect(
			labels(160, new Map([
				["permissions", "RW"],
				["subagents", "3 active"],
			])),
		).not.toHaveProperty("risk");
	});
});
