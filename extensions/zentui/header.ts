import { basename } from "node:path";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { truncateToWidth } from "@earendil-works/pi-tui";

export type HeaderController = {
	compact: () => void;
	dispose: () => void;
};

function projectName(cwd: string): string {
	const normalized = cwd.replace(/[\\/]+$/, "");
	return basename(normalized) || normalized || "pi";
}

export function installHeader(ctx: ExtensionContext): HeaderController {
	let compact = false;
	let requestRender: (() => void) | undefined;

	ctx.ui.setHeader((tui, theme) => {
		requestRender = () => tui.requestRender();
		return {
			dispose() {
				requestRender = undefined;
			},
			invalidate() {},
			render(width: number): string[] {
				const name = projectName(ctx.cwd);
				const title = theme.bold("PI AGENT");
				if (compact) {
					return [truncateToWidth(`${title} · ${name}`, width, "")];
				}
				return [
					truncateToWidth(title, width, ""),
					truncateToWidth(`· ${name}`, width, ""),
				];
			},
		};
	});

	return {
		compact() {
			if (compact) return;
			compact = true;
			requestRender?.();
		},
		dispose() {
			requestRender = undefined;
			ctx.ui.setHeader(undefined);
		},
	};
}
