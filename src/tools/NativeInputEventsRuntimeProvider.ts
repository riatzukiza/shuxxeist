import type { SandboxRuntimeProvider } from "@mariozechner/pi-web-ui/sandbox/SandboxRuntimeProvider.js";
import { NATIVE_INPUT_EVENTS_DESCRIPTION } from "../prompts/prompts.js";
import type { BrowserRuntime } from "../runtime/index.js";

/**
 * Provides native input event functions to JavaScript REPL.
 *
 * Delegates all input dispatch to BrowserRuntime so Chrome (CDP/isTrusted)
 * and Firefox (synthetic events) are handled transparently.
 *
 * If the runtime lacks "trusted-input" capability, events will still fire
 * but isTrusted will be false — acceptable for most sites.
 */
export class NativeInputEventsRuntimeProvider implements SandboxRuntimeProvider {
	private readonly runtime: BrowserRuntime;

	constructor(runtime: BrowserRuntime) {
		this.runtime = runtime;
	}

	getData(): Record<string, any> {
		return {
			__trustedInput: this.runtime.capabilities.has("trusted-input"),
		};
	}

	getRuntime(): (sandboxId: string) => void {
		return (_sandboxId: string) => {
			const sendRuntimeMessage = (window as any).sendRuntimeMessage;
			if (typeof sendRuntimeMessage !== "function") {
				throw new Error("sendRuntimeMessage is not available in this context");
			}

			(window as any).nativeClick = async (selector: string): Promise<void> => {
				await sendRuntimeMessage({ type: "native-input", action: "click", selector });
			};

			(window as any).nativeType = async (selector: string, text: string): Promise<void> => {
				await sendRuntimeMessage({ type: "native-input", action: "type", selector, text });
			};

			(window as any).nativePress = async (key: string): Promise<void> => {
				await sendRuntimeMessage({ type: "native-input", action: "press", key });
			};

			(window as any).nativeKeyDown = async (key: string): Promise<void> => {
				await sendRuntimeMessage({ type: "native-input", action: "keyDown", key });
			};

			(window as any).nativeKeyUp = async (key: string): Promise<void> => {
				await sendRuntimeMessage({ type: "native-input", action: "keyUp", key });
			};
		};
	}

	async handleMessage(message: any, respond: (response: any) => void): Promise<void> {
		if (message.type !== "native-input") return;

		try {
			switch (message.action) {
				case "click":
					await this.runtime.dispatchClick(message.selector);
					break;
				case "type":
					await this.runtime.dispatchType(message.selector, message.text);
					break;
				case "press":
					await this.runtime.dispatchKeyPress(message.key);
					break;
				case "keyDown":
					await this.runtime.dispatchKeyDown(message.key);
					break;
				case "keyUp":
					await this.runtime.dispatchKeyUp(message.key);
					break;
				default:
					respond({ success: false, error: `Unknown action: ${message.action}` });
					return;
			}
			respond({ success: true });
		} catch (error) {
			respond({ success: false, error: error instanceof Error ? error.message : String(error) });
		}
	}

	getDescription(): string {
		return NATIVE_INPUT_EVENTS_DESCRIPTION;
	}
}
