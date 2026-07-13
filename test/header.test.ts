import { describe, expect, it } from "vitest";
import { installHeader } from "../extensions/zentui/header";

describe("agent header", () => {
	it("starts compacting only after the first input and never repeats footer metadata", () => {
		let factory: ((tui: { requestRender(): void }, theme: { bold(value: string): string }) => {
			render(width: number): string[];
		}) | undefined;
		let renders = 0;
		const controller = installHeader({
			cwd: "/work/pi",
			ui: {
				setHeader(value: typeof factory) {
					factory = value;
				},
			},
		} as never);

		const header = factory?.({ requestRender: () => { renders += 1; } }, { bold: (value) => value });
		expect(header?.render(80)).toEqual(["PI AGENT", "· pi"]);

		controller.compact();
		expect(renders).toBe(1);
		expect(header?.render(80)).toEqual(["PI AGENT · pi"]);
		controller.dispose();
		expect(factory).toBeUndefined();
	});
});
