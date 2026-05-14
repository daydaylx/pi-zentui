import { afterEach, describe, expect, it, vi } from "vitest";
import { startProjectRefreshInterval } from "../extensions/zentui/project-refresh";

describe("startProjectRefreshInterval", () => {
	afterEach(() => {
		vi.useRealTimers();
	});

	it("runs the refresh callback at the configured interval", () => {
		vi.useFakeTimers();
		const refresh = vi.fn();

		const stop = startProjectRefreshInterval(30_000, refresh);

		vi.advanceTimersByTime(29_999);
		expect(refresh).not.toHaveBeenCalled();

		vi.advanceTimersByTime(1);
		expect(refresh).toHaveBeenCalledTimes(1);

		vi.advanceTimersByTime(30_000);
		expect(refresh).toHaveBeenCalledTimes(2);

		stop();
		vi.advanceTimersByTime(30_000);
		expect(refresh).toHaveBeenCalledTimes(2);
	});

	it("does not start a timer when polling is disabled", () => {
		vi.useFakeTimers();
		const refresh = vi.fn();

		const stop = startProjectRefreshInterval(0, refresh);

		vi.advanceTimersByTime(120_000);
		expect(refresh).not.toHaveBeenCalled();
		expect(() => stop()).not.toThrow();
	});
});
