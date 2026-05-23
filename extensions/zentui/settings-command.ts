import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { getSettingsListTheme } from "@earendil-works/pi-coding-agent";
import {
	type SettingItem,
	SettingsList,
	type SettingsListTheme,
	truncateToWidth,
} from "@earendil-works/pi-tui";
import {
	type ColorSource,
	type ColorSourcesConfig,
	type ExtensionStatusPlacement,
	type PolishedTuiConfig,
	getExtensionStatusPlacement,
	isExtensionStatusPlacement,
} from "./config";
import { sanitizeExtensionStatusText } from "./extension-status";
import { EDITOR_BORDER_STYLE, renderChromeBorder, safeThemeFg } from "./style";

const colorSourceValues: ColorSource[] = ["theme", "terminal"];
const extensionStatusPlacementValues: ExtensionStatusPlacement[] = [
	"off",
	"left",
	"middle",
	"right",
];

type SettingId = "starship" | "editorMessages";

type SettingsCommandDeps = {
	getConfig: () => PolishedTuiConfig;
	setColorSources: (patch: Partial<ColorSourcesConfig>) => void;
	getActiveExtensionStatuses: () => ReadonlyMap<string, string>;
	setExtensionStatusPlacement: (key: string, placement: ExtensionStatusPlacement) => void;
	requestRender: () => void;
	settingsListTheme?: SettingsListTheme;
};

const settingLabels: Record<SettingId, string> = {
	starship: "Starship/footer colors",
	editorMessages: "Editor + previous messages",
};

const settingDescriptions: Record<SettingId, string> = {
	starship:
		"Choose whether footer runtime/git/context colors use Pi theme tokens or terminal palette styles.",
	editorMessages:
		"Choose whether editor and previous user-message borders/rails use Pi theme colors or terminal palette styles.",
};

function isColorSource(value: string): value is ColorSource {
	return value === "theme" || value === "terminal";
}

function isSettingId(value: string): value is SettingId {
	return value === "starship" || value === "editorMessages";
}

function editorMessageValue(config: PolishedTuiConfig): ColorSource | "mixed" {
	return config.colorSources.editor === config.colorSources.userMessages
		? config.colorSources.editor
		: "mixed";
}

function patchForSetting(id: SettingId, value: ColorSource): Partial<ColorSourcesConfig> {
	return id === "starship" ? { starship: value } : { editor: value, userMessages: value };
}

function buildItems(
	config: PolishedTuiConfig,
	activeStatusCount: number,
	thirdPartyStatusesSubmenu: SettingItem["submenu"],
): SettingItem[] {
	return [
		...(Object.keys(settingLabels) as SettingId[]).map((key) => ({
			id: key,
			label: settingLabels[key],
			description: settingDescriptions[key],
			currentValue: key === "starship" ? config.colorSources.starship : editorMessageValue(config),
			values: colorSourceValues,
		})),
		{
			id: "thirdPartyStatuses",
			label: "Third-party statuses",
			description:
				"Configure active ctx.ui.setStatus() footer statuses. Only currently active keys are listed.",
			currentValue: `${activeStatusCount} active`,
			submenu: thirdPartyStatusesSubmenu,
		},
	];
}

export function registerZentuiSettingsCommand(pi: ExtensionAPI, deps: SettingsCommandDeps): void {
	pi.registerCommand("zentui", {
		description: "Configure Zentui",
		handler: async (_args, ctx) => {
			if (!ctx.hasUI) return;

			await ctx.ui.custom<void>((tui, theme, _keybindings, done) => {
				const settingsListTheme = deps.settingsListTheme ?? getSettingsListTheme();
				const makeThirdPartyStatusesSubmenu: SettingItem["submenu"] = (_currentValue, close) => {
					const activeStatuses = Array.from(deps.getActiveExtensionStatuses().entries()).sort(
						([a], [b]) => (a < b ? -1 : a > b ? 1 : 0),
					);

					if (activeStatuses.length === 0) {
						return {
							render(width: number) {
								return [
									truncateToWidth(safeThemeFg(theme, "accent", "Third-party statuses"), width, ""),
									"",
									truncateToWidth(
										safeThemeFg(theme, "muted", "No third-party statuses are active."),
										width,
										"",
									),
									truncateToWidth(
										safeThemeFg(
											theme,
											"muted",
											"This menu only lists statuses currently published through ctx.ui.setStatus().",
										),
										width,
										"",
									),
									"",
									truncateToWidth(safeThemeFg(theme, "muted", "Esc to go back"), width, ""),
								];
							},
							invalidate() {},
							handleInput(data: string) {
								if (data === "\x1b" || data === "\u0003") close(undefined);
							},
						};
					}

					const statusItems: SettingItem[] = activeStatuses.map(([key, value]) => {
						const sanitizedText = sanitizeExtensionStatusText(value);
						return {
							id: key,
							label: key,
							description: sanitizedText ? `Current status: ${sanitizedText}` : undefined,
							currentValue: getExtensionStatusPlacement(deps.getConfig(), key),
							values: extensionStatusPlacementValues,
						};
					});
					const statusSettingsList = new SettingsList(
						statusItems,
						8,
						settingsListTheme,
						(key, newValue) => {
							if (!isExtensionStatusPlacement(newValue)) return;

							try {
								deps.setExtensionStatusPlacement(key, newValue);
								statusSettingsList.updateValue(key, newValue);
								deps.requestRender();
								ctx.ui.notify(`Third-party status ${key}: ${newValue}`, "info");
								tui.requestRender();
							} catch (error) {
								const message = error instanceof Error ? error.message : String(error);
								ctx.ui.notify(`Could not update Zentui settings: ${message}`, "error");
							}
						},
						() => close(undefined),
					);
					return statusSettingsList;
				};
				const settingsList = new SettingsList(
					buildItems(
						deps.getConfig(),
						deps.getActiveExtensionStatuses().size,
						makeThirdPartyStatusesSubmenu,
					),
					5,
					settingsListTheme,
					(id, newValue) => {
						if (!isSettingId(id) || !isColorSource(newValue)) return;

						try {
							deps.setColorSources(patchForSetting(id, newValue));
							settingsList.updateValue(id, newValue);
							deps.requestRender();
							ctx.ui.notify(`${settingLabels[id]}: ${newValue}`, "info");
							tui.requestRender();
						} catch (error) {
							const message = error instanceof Error ? error.message : String(error);
							ctx.ui.notify(`Could not update Zentui settings: ${message}`, "error");
						}
					},
					() => done(undefined),
				);

				return {
					render(width: number) {
						const colorSource = deps.getConfig().colorSources.editor;
						const border = renderChromeBorder(
							theme,
							colorSource,
							EDITOR_BORDER_STYLE,
							"─".repeat(Math.max(0, width)),
						);
						const header = safeThemeFg(theme, "accent", theme.bold("Zentui settings"));
						const hint = safeThemeFg(theme, "muted", "Enter/Space cycles values · Esc closes");
						return [
							truncateToWidth(border, width, ""),
							truncateToWidth(header, width, ""),
							truncateToWidth(hint, width, ""),
							"",
							...settingsList.render(width),
							truncateToWidth(border, width, ""),
						];
					},
					invalidate() {
						settingsList.invalidate();
					},
					handleInput(data: string) {
						settingsList.handleInput(data);
					},
				};
			});
		},
	});
}
