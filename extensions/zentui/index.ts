import type {
	ExtensionAPI,
	ExtensionContext,
	KeybindingsManager,
	Theme,
} from "@earendil-works/pi-coding-agent";
import type { EditorTheme, TUI } from "@earendil-works/pi-tui";
import {
	type ColorSourcesConfig,
	type ExtensionStatusPlacement,
	type PolishedTuiConfig,
	type UiFeaturesConfig,
	ensureConfigExists,
	loadConfig,
	saveColorSourcesPatch,
	saveExtensionStatusPlacement,
	saveUiFeaturesPatch,
} from "./config";
import { installFooter } from "./footer";
import { emptyGitStatus, readGitStatus } from "./git";
import { type StopProjectRefreshInterval, startProjectRefreshInterval } from "./project-refresh";
import { readRuntimeInfo } from "./runtime";
import { installSelectorBorderStyle } from "./selector-border";
import { registerZentuiSettingsCommand } from "./settings-command";
import { type FooterState, createInitialState, syncState } from "./state";
import { PolishedEditor, WrappedPolishedEditor } from "./ui";
import { installUserMessageStyle } from "./user-message";

const ZENTUI_EDITOR_FACTORY = Symbol.for("pi-zentui.editor-factory");

type EditorFactory = NonNullable<Parameters<ExtensionContext["ui"]["setEditorComponent"]>[0]>;

type ZentuiEditorFactory = EditorFactory & {
	[ZENTUI_EDITOR_FACTORY]?: true;
};

type ApplyUiResult = {
	editorBlocked: boolean;
};

type EditorInstallMode = "none" | "standalone" | "wrapper";

function isZentuiEditorFactory(factory: EditorFactory | undefined): boolean {
	return Boolean((factory as ZentuiEditorFactory | undefined)?.[ZENTUI_EDITOR_FACTORY]);
}

export default function (pi: ExtensionAPI) {
	const state: FooterState = createInitialState(emptyGitStatus());

	let currentConfig: PolishedTuiConfig = loadConfig();
	let activeTheme: Theme | undefined;
	let requestFooterRender: (() => void) | undefined;
	let getActiveExtensionStatuses: () => ReadonlyMap<string, string> = () => new Map();
	let stopRefreshInterval: StopProjectRefreshInterval = () => {};
	let cleanupPrototypePatches: () => void = () => {};
	let footerInstalled = false;
	let editorInstalled = false;
	let editorInstallMode: EditorInstallMode = "none";
	let wrappedEditorFactory: EditorFactory | undefined;
	let prototypePatchesInstalled = false;
	let projectRefreshInFlight = false;
	let projectRefreshPending = false;

	const refresh = () => requestFooterRender?.();
	const getActiveTheme = () => activeTheme;
	const getCurrentConfig = () => currentConfig;
	const getThinkingLevel = () => pi.getThinkingLevel();
	const syncFooterState = (ctx: ExtensionContext) =>
		syncState(state, ctx, currentConfig.icons.cacheHit);

	const refreshProjectState = async (ctx: ExtensionContext) => {
		const [gitStatus, runtime] = await Promise.all([
			readGitStatus(ctx.cwd),
			readRuntimeInfo(ctx.cwd),
		]);
		Object.assign(state, gitStatus);
		state.runtime = runtime;
	};

	const scheduleProjectRefresh = (ctx: ExtensionContext) => {
		if (projectRefreshInFlight) {
			projectRefreshPending = true;
			return;
		}

		projectRefreshInFlight = true;
		void refreshProjectState(ctx).finally(() => {
			projectRefreshInFlight = false;
			refresh();
			if (projectRefreshPending) {
				projectRefreshPending = false;
				scheduleProjectRefresh(ctx);
			}
		});
	};

	const refreshInteractiveState = (ctx: ExtensionContext, project = false) => {
		if (!ctx.hasUI) return;
		syncFooterState(ctx);
		if (project && currentConfig.features.statusLine) scheduleProjectRefresh(ctx);
		refresh();
	};

	const stopProjectRefresh = () => {
		stopRefreshInterval();
		stopRefreshInterval = () => {};
		projectRefreshInFlight = false;
		projectRefreshPending = false;
	};

	const installPrototypePatches = () => {
		if (prototypePatchesInstalled) return;
		const cleanupSelectorBorderStyle = installSelectorBorderStyle(getActiveTheme, getCurrentConfig);
		const cleanupUserMessageStyle = installUserMessageStyle(getActiveTheme, getCurrentConfig);
		cleanupPrototypePatches = () => {
			cleanupSelectorBorderStyle();
			cleanupUserMessageStyle();
		};
		prototypePatchesInstalled = true;
	};

	const uninstallPrototypePatches = () => {
		cleanupPrototypePatches();
		cleanupPrototypePatches = () => {};
		prototypePatchesInstalled = false;
	};

	const makeEditorFactory = (ctx: ExtensionContext): ZentuiEditorFactory => {
		const factory = ((tui: TUI, theme: EditorTheme, keybindings: KeybindingsManager) =>
			new PolishedEditor(
				tui,
				theme,
				keybindings,
				ctx.ui.theme,
				getCurrentConfig,
				() => ({
					modelLabel: state.modelLabel,
					providerLabel: state.providerLabel,
				}),
				getThinkingLevel,
			)) as ZentuiEditorFactory;
		factory[ZENTUI_EDITOR_FACTORY] = true;
		return factory;
	};

	const makeWrappedEditorFactory = (
		ctx: ExtensionContext,
		baseFactory: EditorFactory,
	): ZentuiEditorFactory => {
		const factory = ((tui: TUI, theme: EditorTheme, keybindings: KeybindingsManager) =>
			new WrappedPolishedEditor(
				baseFactory(tui, theme, keybindings),
				ctx.ui.theme,
				getCurrentConfig,
				() => ({
					modelLabel: state.modelLabel,
					providerLabel: state.providerLabel,
				}),
				getThinkingLevel,
			)) as ZentuiEditorFactory;
		factory[ZENTUI_EDITOR_FACTORY] = true;
		return factory;
	};

	const installEditor = (ctx: ExtensionContext): boolean => {
		const currentFactory = ctx.ui.getEditorComponent();
		if (currentFactory && isZentuiEditorFactory(currentFactory)) {
			editorInstalled = true;
			return true;
		}

		installPrototypePatches();
		if (currentFactory) {
			wrappedEditorFactory = currentFactory;
			ctx.ui.setEditorComponent(makeWrappedEditorFactory(ctx, currentFactory));
			editorInstallMode = "wrapper";
		} else {
			wrappedEditorFactory = undefined;
			ctx.ui.setEditorComponent(makeEditorFactory(ctx));
			editorInstallMode = "standalone";
		}
		editorInstalled = true;
		return true;
	};

	const uninstallEditor = (ctx: ExtensionContext): boolean => {
		const currentFactory = ctx.ui.getEditorComponent();
		if (currentFactory && !isZentuiEditorFactory(currentFactory)) return false;

		uninstallPrototypePatches();
		ctx.ui.setEditorComponent(
			editorInstallMode === "wrapper" && wrappedEditorFactory ? wrappedEditorFactory : undefined,
		);
		wrappedEditorFactory = undefined;
		editorInstallMode = "none";
		editorInstalled = false;
		return true;
	};

	const installStatusLine = (ctx: ExtensionContext) => {
		if (footerInstalled) return;
		installFooter(ctx, state, getCurrentConfig, {
			setRequestRender: (fn) => {
				requestFooterRender = fn;
			},
			scheduleProjectRefresh,
			setExtensionStatusesGetter(fn) {
				getActiveExtensionStatuses = fn ?? (() => new Map());
			},
		});
		footerInstalled = true;
		stopProjectRefresh();
		stopRefreshInterval = startProjectRefreshInterval(currentConfig.projectRefreshIntervalMs, () =>
			scheduleProjectRefresh(ctx),
		);
		scheduleProjectRefresh(ctx);
		refresh();
	};

	const uninstallStatusLine = (ctx: ExtensionContext) => {
		stopProjectRefresh();
		ctx.ui.setFooter(undefined);
		footerInstalled = false;
		requestFooterRender = undefined;
		getActiveExtensionStatuses = () => new Map();
	};

	const applyConfiguredUi = (ctx: ExtensionContext): ApplyUiResult => {
		const result: ApplyUiResult = { editorBlocked: false };
		if (!ctx.hasUI) return result;
		activeTheme = ctx.ui.theme;
		if (currentConfig.features.editor) {
			const currentFactory = ctx.ui.getEditorComponent();
			const editorMissingOrReplaced = !editorInstalled || !isZentuiEditorFactory(currentFactory);
			if (editorMissingOrReplaced) result.editorBlocked = !installEditor(ctx);
		} else if (editorInstalled || prototypePatchesInstalled) {
			result.editorBlocked = !uninstallEditor(ctx);
		}

		if (currentConfig.features.statusLine) {
			installStatusLine(ctx);
		} else if (footerInstalled) {
			uninstallStatusLine(ctx);
		}
		return result;
	};

	const installUi = (ctx: ExtensionContext) => {
		if (!ctx.hasUI) return;
		activeTheme = ctx.ui.theme;
		uninstallPrototypePatches();
		footerInstalled = false;
		editorInstalled = false;
		ensureConfigExists();
		currentConfig = loadConfig();
		syncFooterState(ctx);
		stopProjectRefresh();
		applyConfiguredUi(ctx);
		refresh();
	};

	const scheduleEditorReconciliation = (ctx: ExtensionContext) => {
		setTimeout(() => {
			if (!ctx.hasUI || !currentConfig.features.editor) return;
			const currentFactory = ctx.ui.getEditorComponent();
			if (currentFactory && !isZentuiEditorFactory(currentFactory)) {
				applyConfiguredUi(ctx);
				refresh();
			}
		}, 0);
	};

	const cleanupUi = (ctx?: ExtensionContext) => {
		uninstallPrototypePatches();
		stopProjectRefresh();
		requestFooterRender = undefined;
		getActiveExtensionStatuses = () => new Map();
		if (ctx?.hasUI) {
			ctx.ui.setFooter(undefined);
			const currentFactory = ctx.ui.getEditorComponent();
			if (!currentFactory || isZentuiEditorFactory(currentFactory)) {
				ctx.ui.setEditorComponent(
					editorInstallMode === "wrapper" && wrappedEditorFactory
						? wrappedEditorFactory
						: undefined,
				);
			}
		}
		wrappedEditorFactory = undefined;
		editorInstallMode = "none";
		footerInstalled = false;
		editorInstalled = false;
		activeTheme = undefined;
	};

	const syncInteractiveState = (_event: unknown, ctx: ExtensionContext) => {
		refreshInteractiveState(ctx);
	};
	const syncInteractiveAndProjectState = (_event: unknown, ctx: ExtensionContext) => {
		refreshInteractiveState(ctx, true);
	};

	pi.on("session_start", async (_event, ctx) => {
		installUi(ctx);
		scheduleEditorReconciliation(ctx);
	});

	registerZentuiSettingsCommand(pi, {
		getConfig: getCurrentConfig,
		setColorSources(patch: Partial<ColorSourcesConfig>) {
			currentConfig = saveColorSourcesPatch(patch);
		},
		setUiFeatures(patch: Partial<UiFeaturesConfig>, ctx: ExtensionContext) {
			currentConfig = saveUiFeaturesPatch(patch);
			const result = applyConfiguredUi(ctx);
			return {
				applied: !(patch.editor !== undefined && result.editorBlocked),
				reason: result.editorBlocked
					? "another extension is currently managing the editor; reload Pi to apply this change"
					: undefined,
			};
		},
		getActiveExtensionStatuses() {
			return getActiveExtensionStatuses();
		},
		setExtensionStatusPlacement(key: string, placement: ExtensionStatusPlacement) {
			currentConfig = saveExtensionStatusPlacement(key, placement);
		},
		requestRender() {
			refresh();
		},
	});

	pi.on("session_shutdown", async (_event, ctx) => {
		cleanupUi(ctx);
	});

	pi.on("agent_start", syncInteractiveState);
	pi.on("agent_end", syncInteractiveAndProjectState);
	pi.on("model_select", syncInteractiveState);
	pi.on("thinking_level_select", syncInteractiveState);
	pi.on("message_end", syncInteractiveAndProjectState);
	pi.on("tool_execution_end", syncInteractiveAndProjectState);
	pi.on("session_compact", syncInteractiveAndProjectState);
	pi.on("session_tree", syncInteractiveAndProjectState);
}
