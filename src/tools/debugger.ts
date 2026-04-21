import type { AgentTool } from "@mariozechner/pi-agent-core";
import { type Static, StringEnum, Type } from "@mariozechner/pi-ai";
import type { BrowserRuntime } from "../runtime/index.js";
import { resolveBrowserTarget } from "./helpers/browser-target.js";

// ============================================================================
// TYPES
// ============================================================================

const debuggerSchema = Type.Object({
	action: StringEnum(["eval", "cookies"], {
		description: "Action to perform",
	}),
	tabId: Type.Optional(Type.Number({ description: "Optional tab ID override for bridge workflows" })),
	frameId: Type.Optional(Type.Number({ description: "Optional frame ID override for MAIN-world evaluation" })),
	code: Type.Optional(
		Type.String({
			description: "JavaScript code to execute in MAIN world context (required for eval action)",
		}),
	),
});

export type DebuggerParams = Static<typeof debuggerSchema>;

export interface DebuggerResult {
	value: unknown;
}

export interface DebuggerToolOptions {
	windowId?: number;
	runtime: BrowserRuntime;
}

// ============================================================================
// TOOL
// ============================================================================

export class DebuggerTool implements AgentTool<typeof debuggerSchema, DebuggerResult> {
	label = "Debugger";
	name = "debugger";
	description = `Execute JavaScript in the MAIN world or access browser APIs that browserjs() and repl tool cannot.

ACTIONS:

1. eval - Execute JavaScript in MAIN world context
   USE CASES (what browserjs() and repl tool CANNOT access):
   - Page's own JavaScript variables, functions, framework instances (React, Vue, Angular state)
   - window properties set by page scripts
   - All other MAIN world internals that USER_SCRIPT world cannot see

   Examples:
   { action: "eval", code: "window.myApp.state" } - Access app state
   { action: "eval", code: "window.myFunction()" } - Call page function
   { action: "eval", code: "JSON.stringify(localStorage)" } - Get localStorage

2. cookies - Get all cookies for current domain (including HttpOnly)
   Returns cookies in format: name: value (one per line)

   Example:
   { action: "cookies" } - Get all cookies

CRITICAL: Use browserjs() and repl tool for DOM manipulation. Use this ONLY for MAIN world access or browser APIs.`;
	parameters = debuggerSchema;
	windowId?: number;
	private readonly runtime: BrowserRuntime;

	constructor(options: DebuggerToolOptions) {
		this.windowId = options.windowId;
		this.runtime = options.runtime;
	}

	async execute(
		_toolCallId: string,
		args: DebuggerParams,
		signal?: AbortSignal,
	): Promise<{ content: Array<{ type: "text"; text: string }>; details: DebuggerResult }> {
		if (signal?.aborted) throw new Error("Debugger command aborted");

		const { tab } = await resolveBrowserTarget({
			windowId: this.windowId,
			tabId: args.tabId,
			frameId: args.frameId,
		});

		try {
			if (args.action === "cookies") {
				if (!tab.url) throw new Error("Cannot get cookies for a tab without a URL");
				const domain = new URL(tab.url).hostname;
				const cookies = await this.runtime.getCookies(domain);
				const output = cookies.map((c) => `${c.name}: ${c.value}`).join("\n");
				return { content: [{ type: "text", text: output }], details: { value: cookies } };
			}

			if (args.action === "eval") {
				if (!args.code) throw new Error("eval action requires code parameter");
				const result = await this.runtime.executeInMainWorld(args.code, {
					tabId: args.tabId,
					frameId: args.frameId,
					signal,
				});
				let output: string;
				if (result === undefined) output = "undefined";
				else if (typeof result === "string") output = result;
				else output = JSON.stringify(result, null, 2);
				return { content: [{ type: "text", text: output }], details: { value: result } };
			}

			throw new Error(`Unknown action: ${args.action}`);
		} catch (error) {
			throw new Error(`Debugger error: ${error instanceof Error ? error.message : String(error)}`);
		}
	}
}
