export type StopProjectRefreshInterval = () => void;

export function startProjectRefreshInterval(
	intervalMs: number,
	refresh: () => void,
): StopProjectRefreshInterval {
	if (intervalMs <= 0) return () => {};

	const timer = setInterval(refresh, intervalMs);
	timer.unref?.();

	return () => clearInterval(timer);
}
