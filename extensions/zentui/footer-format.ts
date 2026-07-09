/**
 * Starship-style footer format string parser and renderer.
 *
 * Pure module (no TUI/config imports) so it is fully unit-testable.
 */

export type FormatToken =
	| { kind: "text"; value: string }
	| { kind: "var"; name: string }
	| { kind: "fill" };

const TOKEN_REGEX = /\$\{([a-zA-Z_][a-zA-Z0-9_]*)\}|\$([a-zA-Z_][a-zA-Z0-9_]*)/g;

/**
 * Tokenize a format string into text/var/fill tokens.
 *
 * `$name` and `${name}` both produce a variable token. A variable named
 * `fill` becomes a fill token instead. Text between/around variables is
 * preserved exactly (including spaces). Empty input produces an empty array.
 */
export function parseFooterFormat(format: string): FormatToken[] {
	if (!format) return [];

	const tokens: FormatToken[] = [];
	let lastIndex = 0;

	for (const match of format.matchAll(TOKEN_REGEX)) {
		if (match.index !== undefined && match.index > lastIndex) {
			tokens.push({ kind: "text", value: format.slice(lastIndex, match.index) });
		}
		const name = match[1] ?? match[2];
		if (name === "fill") {
			tokens.push({ kind: "fill" });
		} else {
			tokens.push({ kind: "var", name });
		}
		lastIndex = (match.index ?? 0) + match[0].length;
	}

	if (lastIndex < format.length) {
		tokens.push({ kind: "text", value: format.slice(lastIndex) });
	}

	return tokens;
}

/**
 * Render tokens into `{ left, right }` by splitting at the FIRST fill token.
 *
 * - Text tokens contribute their `value` verbatim (unstyled/plain).
 * - Var tokens contribute `renderVariable(name)` (already styled by caller).
 * - No automatic spaces are inserted — the user controls all spacing.
 * - If there is no fill token, everything goes into `left` and `right` is `""`.
 * - Additional fill tokens after the first are ignored (render nothing).
 */
export function renderFormatSplit(
	tokens: FormatToken[],
	renderVariable: (name: string) => string,
): { left: string; right: string } {
	const fillIndex = tokens.findIndex((token) => token.kind === "fill");

	if (fillIndex === -1) {
		return { left: renderTokenSlice(tokens, 0, tokens.length, renderVariable), right: "" };
	}

	const left = renderTokenSlice(tokens, 0, fillIndex, renderVariable);
	const rightTokens = tokens.slice(fillIndex + 1).filter((token) => token.kind !== "fill");
	const right = renderTokenSlice(rightTokens, 0, rightTokens.length, renderVariable);
	return { left, right };
}

function renderTokenSlice(
	tokens: FormatToken[],
	start: number,
	end: number,
	renderVariable: (name: string) => string,
): string {
	let result = "";
	for (let i = start; i < end; i++) {
		const token = tokens[i];
		if (!token) continue;
		if (token.kind === "text") {
			result += token.value;
		} else if (token.kind === "var") {
			result += renderVariable(token.name);
		}
	}
	return result;
}
