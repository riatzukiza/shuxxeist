import { ConsoleRuntimeProvider } from "@mariozechner/pi-web-ui/sandbox/ConsoleRuntimeProvider.js";
import { RUNTIME_MESSAGE_ROUTER } from "@mariozechner/pi-web-ui/sandbox/RuntimeMessageRouter.js";
import type { SandboxRuntimeProvider } from "@mariozechner/pi-web-ui/sandbox/SandboxRuntimeProvider.js";
import {
	BROWSERJS_RUNTIME_PROVIDER_DESCRIPTION,
	NAVIGATE_RUNTIME_PROVIDER_DESCRIPTION,
} from "../../prompts/prompts.js";
import type { BrowserRuntime } from "../../runtime/index.js";
import { getShuvgeistStorage } from "../../storage/app-storage.js";
import { resolveTabTarget } from "../helpers/browser-target.js";
import type { NavigateParams, NavigateTool } from "../navigate.js";
import { buildWrapperCode } from "./userscripts-helpers.js";

/**
 * BrowserJsRuntimeProvider
 *
 * Provides the browserjs() helper to REPL scripts, executing code in the
 * active tab via BrowserRuntime.executeInPage.
 *
 * Chrome: runs in a persistent USER_SCRIPT isolated world (worldId preserved).
 * Firefox: runs in scripting ISOLATED world (no persistent worldId — stateless per call).
 *
 * Usage in REPL:
 *   const title = await browserjs(() => document.title);
 *   const count = await browserjs((sel) => document.querySelectorAll(sel).length, '.product');
 */
export class BrowserJsRuntimeProvider implements SandboxRuntimeProvider {
	private activeSandboxIds: Set<string> = new Set();
	private sandboxAbortSignals = new Map<string, AbortSignal>();

	constructor(
		private readonly runtime: BrowserRuntime,
		private sharedProviders: SandboxRuntimeProvider[],
		private readonly windowId?: number,
	) {}

	getData(): Record<string, any> {
		return {};
	}

	getRuntime(): (sandboxId: string) => void {
		return (_sandboxId: string) => {
			const sendRuntimeMessage = (window as any).sendRuntimeMessage;
			if (typeof sendRuntimeMessage !== "function") {
				throw new Error("sendRuntimeMessage is not available in this context");
			}

			(window as any).browserjs = async (func: () => any, ...args: any[]): Promise<any> => {
				if (typeof func !== "function") {
					throw new Error("First argument to browserjs() must be a function");
				}
				const response = await sendRuntimeMessage({
					type: "browser-js",
					code: func.toString(),
					args: JSON.stringify(args),
				});

				if (response.console && Array.isArray(response.console)) {
					for (const log of response.console) {
						const method = log.type || "log";
						const message = `[browserjs] ${log.text}`;
						if (method === "error") console.error(message);
						else if (method === "warn") console.warn(message);
						else if (method === "info") console.info(message);
						else console.log(message);
					}
				}

				if (!response.success) {
					throw new Error(response.error || "browserjs() execution failed");
				}
				return response.result;
			};
		};
	}

	onExecutionStart(sandboxId: string, signal?: AbortSignal): void {
		if (signal) this.sandboxAbortSignals.set(sandboxId, signal);
	}

	onExecutionEnd(sandboxId: string): void {
		this.sandboxAbortSignals.delete(sandboxId);
	}

	async handleMessage(message: any, respond: (response: any) => void): Promise<void> {
		if (message.type !== "browser-js") return;

		const replSandboxId = message.sandboxId;
		const abortSignal = replSandboxId ? this.sandboxAbortSignals.get(replSandboxId) : undefined;

		const { tab, tabId } = await resolveTabTarget({ windowId: this.windowId });

		if (!tab?.id) {
			respond({ success: false, error: "No active tab found" });
			return;
		}

		if (
			tab.url?.startsWith("chrome://") ||
			tab.url?.startsWith("chrome-extension://") ||
			tab.url?.startsWith("moz-extension://") ||
			tab.url?.startsWith("about:")
		) {
			respond({
				success: false,
				error: `Cannot execute scripts on ${tab.url}. Extension pages and internal URLs are protected.`,
			});
			return;
		}

		// Load URL-matched skills
		const skillsRepo = getShuvgeistStorage().skills;
		let skillLibrary = "";
		if (tab.url) {
			const matchingSkills = await skillsRepo.getSkillsForUrl(tab.url);
			if (matchingSkills.length > 0) {
				skillLibrary = `${matchingSkills.map((s: any) => s.library).join("\n\n")}\n\n`;
			}
		}

		const sandboxId = `browserjs_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

		let parsedArgs: any[] = [];
		if (message.args) {
			try {
				parsedArgs = JSON.parse(message.args);
			} catch (e) {
				respond({ success: false, error: `Failed to parse arguments: ${e}` });
				return;
			}
		}

		this.activeSandboxIds.add(sandboxId);

		const pageConsoleProvider = new ConsoleRuntimeProvider();
		const wrapperCode = buildWrapperCode(
			message.code,
			skillLibrary,
			false,
			[pageConsoleProvider, ...this.sharedProviders],
			sandboxId,
			parsedArgs,
		);

		try {
			const raw = await this.runtime.executeInPage(wrapperCode, {
				tabId,
				worldId: "shuvgeist-browser-script",
				signal: abortSignal,
			});

			const consoleLogs = pageConsoleProvider.getLogs();
			const result = raw as any;

			if (!result) {
				respond({ success: true, error: "No result returned from script execution", console: consoleLogs });
				return;
			}
			if (!result.success) {
				respond({ success: false, error: result.error, stack: result.stack, console: consoleLogs });
				return;
			}
			respond({ success: true, result: result.lastValue, console: consoleLogs });
		} catch (error: any) {
			const wasCancelled = abortSignal?.aborted;
			respond({
				success: false,
				error: wasCancelled ? "Script execution was cancelled" : error.message || String(error),
				cancelled: wasCancelled,
			});
		} finally {
			this.cleanup(sandboxId);
		}
	}

	getDescription(): string {
		return BROWSERJS_RUNTIME_PROVIDER_DESCRIPTION;
	}

	private cleanup(sandboxId: string) {
		if (this.activeSandboxIds.has(sandboxId)) {
			RUNTIME_MESSAGE_ROUTER.unregisterSandbox(sandboxId);
			this.activeSandboxIds.delete(sandboxId);
		}
	}

	public cleanupAll() {
		for (const sandboxId of this.activeSandboxIds) {
			RUNTIME_MESSAGE_ROUTER.unregisterSandbox(sandboxId);
		}
		this.activeSandboxIds.clear();
	}
}

/**
 * NavigateRuntimeProvider — unchanged, no chrome.* calls to refactor.
 */
export class NavigateRuntimeProvider implements SandboxRuntimeProvider {
	constructor(private navigateTool: NavigateTool) {}

	getData(): Record<string, any> {
		return {};
	}

	getRuntime(): (sandboxId: string) => void {
		return (_sandboxId: string) => {
			const sendRuntimeMessage = (window as any).sendRuntimeMessage;
			if (typeof sendRuntimeMessage !== "function") {
				throw new Error("sendRuntimeMessage is not available in this context");
			}
			(window as any).navigate = async (args: any): Promise<any> => {
				const response = await sendRuntimeMessage({ type: "navigate", args });
				if (!response.success) throw new Error(response.error || "navigate() execution failed");
				return response.result;
			};
		};
	}

	async handleMessage(message: any, respond: (response: any) => void): Promise<void> {
		if (message.type !== "navigate") return;
		try {
			const result = await this.navigateTool.execute(`navigate_${Date.now()}`, message.args as NavigateParams);
			respond({
				success: true,
				result: { finalUrl: result.details.finalUrl, title: result.details.title, skills: result.details.skills },
			});
		} catch (error: any) {
			respond({ success: false, error: error.message || String(error) });
		}
	}

	getDescription(): string {
		return NAVIGATE_RUNTIME_PROVIDER_DESCRIPTION;
	}
}
