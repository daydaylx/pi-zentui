import { homedir } from "node:os";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import type { PolishedTuiConfig } from "./config";
import { sanitizeExtensionStatusText } from "./extension-status";
import type { FooterState } from "./state";
import { renderStyleForSource } from "./style";

export type AgentFooterVariant = "wide" | "medium" | "narrow";

export type AgentFooterLabels = {
	variant: AgentFooterVariant;
	cwd: string;
	workflow: string;
	model: string;
	thinking: string;
	risk?: string;
};

type AgentFooterInput = {
	cwd: string;
	model: string;
	provider: string;
	thinkingLevel: string | undefined;
	statuses: ReadonlyMap<string, string>;
	width: number;
};

const separator = " · ";

function normalizePath(cwd: string): string {
	const normalized = cwd.replace(/\\/g, "/").replace(/\/+$/, "");
	return normalized || "/";
}

function formatWidePath(cwd: string): string {
	const normalized = normalizePath(cwd);
	try {
		const home = normalizePath(homedir());
		if (normalized === home) return "~";
		if (normalized.startsWith(`${home}/`)) return `~${normalized.slice(home.length)}`;
	} catch {
		// Keep the absolute path when the home directory cannot be read.
	}
	return normalized;
}

function pathTail(cwd: string, count: number): string {
	const parts = normalizePath(cwd).split("/").filter(Boolean);
	if (parts.length === 0) return "/";
	return parts.slice(-count).join("/");
}

function normalizedWorkflow(value: string | undefined): string {
	const workflow = value ? sanitizeExtensionStatusText(value) : "";
	return workflow || "WORK";
}

function formatWorkflow(value: string, variant: AgentFooterVariant): string {
	const normalized = value.toUpperCase();
	if (variant === "wide" && (normalized === "ARCH" || normalized === "ARCH PLAN")) {
		return "ARCHITEKTURPLAN";
	}
	if (variant !== "wide" && (normalized === "ARCHITEKTURPLAN" || normalized === "ARCH PLAN")) {
		return "ARCH";
	}
	return value;
}

function normalizedThinkingLevel(value: string | undefined): string {
	const normalized = (value || "high").trim().toLowerCase();
	const labels: Record<string, string> = {
		off: "OFF",
		minimal: "MINIMAL",
		low: "LOW",
		medium: "MEDIUM",
		high: "HIGH",
		xhigh: "XHIGH",
	};
	return labels[normalized] ?? (normalized.toUpperCase() || "HIGH");
}

function formatThinking(level: string, variant: AgentFooterVariant): string {
	if (variant === "wide") return `THINKING ${level}`;
	if (variant === "medium") return level;
	const narrow: Record<string, string> = {
		OFF: "OF",
		MINIMAL: "MI",
		LOW: "LO",
		MEDIUM: "ME",
		HIGH: "HI",
		XHIGH: "XH",
	};
	return narrow[level] ?? truncateToWidth(level, 2, "");
}

function formatModel(model: string, provider: string, variant: AgentFooterVariant): string {
	const modelLabel = model || "no-model";
	if (variant === "wide") return provider ? `${provider}/${modelLabel}` : modelLabel;
	if (variant === "medium") return modelLabel;

	const version = modelLabel.match(/(\d+(?:\.\d+)+)$/)?.[1];
	if (version) return version;
	const tail = modelLabel.split(/[\/_-]+/).filter(Boolean).at(-1);
	return tail || modelLabel;
}

function joinSegments(segments: string[]): string {
	return segments.filter(Boolean).join(separator);
}

function fitLabels(labels: AgentFooterLabels, width: number): AgentFooterLabels {
	const makeSegments = (value: AgentFooterLabels) => [
		value.cwd,
		value.workflow,
		value.model,
		value.thinking,
		value.risk ?? "",
	];
	const fits = (value: AgentFooterLabels) => visibleWidth(joinSegments(makeSegments(value))) <= width;
	if (fits(labels)) return labels;

	const compacted = { ...labels };
	const fixedWidth = visibleWidth(
		joinSegments([compacted.cwd, compacted.workflow, compacted.thinking, compacted.risk ?? ""]),
	);
	const remainingModelWidth = Math.max(1, width - fixedWidth - visibleWidth(separator));
	compacted.model = truncateToWidth(compacted.model, remainingModelWidth, "…");
	if (fits(compacted)) return compacted;

	if (compacted.risk) {
		compacted.risk = "⚠";
		if (fits(compacted)) return compacted;
	}

	compacted.model = "";
	if (fits(compacted)) return compacted;

	const fixedWithoutCwd = visibleWidth(
		joinSegments([compacted.workflow, compacted.thinking, compacted.risk ?? ""]),
	);
	const cwdWidth = Math.max(1, width - fixedWithoutCwd - visibleWidth(separator));
	compacted.cwd = truncateToWidth(compacted.cwd, cwdWidth, "…");
	return compacted;
}

export function resolveAgentFooterLabels(input: AgentFooterInput): AgentFooterLabels {
	const workflow = normalizedWorkflow(input.statuses.get("workflow"));
	const risk = sanitizeExtensionStatusText(input.statuses.get("permissions") ?? "") || undefined;
	const thinking = normalizedThinkingLevel(input.thinkingLevel);
	const variants: AgentFooterVariant[] = ["wide", "medium", "narrow"];

	for (const variant of variants) {
		const labels: AgentFooterLabels = {
			variant,
			cwd:
				variant === "wide"
					? formatWidePath(input.cwd)
					: variant === "medium"
						? pathTail(input.cwd, 2)
						: pathTail(input.cwd, 1),
			workflow: formatWorkflow(workflow, variant),
			model: formatModel(input.model, input.provider, variant),
			thinking: formatThinking(thinking, variant),
			...(risk ? { risk } : {}),
		};
		if (visibleWidth(joinSegments([labels.cwd, labels.workflow, labels.model, labels.thinking, labels.risk ?? ""])) <= input.width) {
			return labels;
		}
	}

	return fitLabels(
		{
			variant: "narrow",
			cwd: pathTail(input.cwd, 1),
			workflow: formatWorkflow(workflow, "narrow"),
			model: formatModel(input.model, input.provider, "narrow"),
			thinking: formatThinking(thinking, "narrow"),
			...(risk ? { risk } : {}),
		},
		input.width,
	);
}

export function renderAgentFooter(options: {
	cwd: string;
	state: FooterState;
	config: PolishedTuiConfig;
	statuses: ReadonlyMap<string, string>;
	thinkingLevel: string | undefined;
	theme: Theme;
	width: number;
}): string {
	const labels = resolveAgentFooterLabels({
		cwd: options.cwd,
		model: options.state.modelLabel,
		provider: options.state.modelProviderId,
		thinkingLevel: options.thinkingLevel,
		statuses: options.statuses,
		width: options.width,
	});
	const source = options.config.colorSources.starship;
	const styled = [
		renderStyleForSource(options.theme, source, options.config.colors.cwd, labels.cwd),
		renderStyleForSource(
			options.theme,
			source,
			options.config.colors.extensionStatus,
			labels.workflow,
		),
		renderStyleForSource(options.theme, source, options.config.colors.tokens, labels.model),
		renderStyleForSource(options.theme, source, options.config.colors.contextNormal, labels.thinking),
		labels.risk
			? renderStyleForSource(options.theme, source, options.config.colors.contextWarning, labels.risk)
			: "",
	];
	const styledSeparator = renderStyleForSource(
		options.theme,
		source,
		options.config.colors.separator,
		separator,
	);
	return truncateToWidth(styled.filter(Boolean).join(styledSeparator), options.width, "");
}
