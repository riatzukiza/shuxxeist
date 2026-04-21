/**
 * FirefoxRuntime — BrowserRuntime adapter for Firefox MV3.
 *
 * CDP-backed capabilities (trusted-input, network-capture, device-emulation)
 * are absent. Tools should check `runtime.capabilities` before using them
 * and degrade gracefully.
 *
 * executeInPage falls back to browser.scripting.executeScript with
 * world: "ISOLATED" — no persistent worldId, but functionally equivalent
 * for most REPL use cases.
 *
 * executeInMainWorld uses browser.scripting.executeScript({ world: "MAIN" }),
 * which does NOT require the debugger API.
 */

import type {
  BrowserCapability,
  BrowserRuntime,
  Cookie,
  ExecuteInPageOptions,
  InputDispatchOptions,
} from "./interface.ts";
import { detectCapabilities } from "./detect.ts";

// Firefox exposes WebExtension APIs under `browser`, not `chrome`.
declare const browser: typeof chrome;

export class FirefoxRuntime implements BrowserRuntime {
  readonly capabilities: ReadonlySet<BrowserCapability>;

  constructor() {
    this.capabilities = detectCapabilities();
  }

  // ── Script execution ──────────────────────────────────────────────────────

  async executeInPage(code: string, opts: ExecuteInPageOptions = {}): Promise<unknown> {
    const tabId = opts.tabId ?? (await this.#activeTabId());
    const results = await browser.scripting.executeScript({
      target: { tabId, frameIds: opts.frameId != null ? [opts.frameId] : undefined },
      // Firefox MV3 supports world: "ISOLATED" | "MAIN"
      world: "ISOLATED" as any,
      func: new Function(code) as () => unknown,
    });
    return results?.[0]?.result;
  }

  async executeInMainWorld(code: string, opts: ExecuteInPageOptions = {}): Promise<unknown> {
    const tabId = opts.tabId ?? (await this.#activeTabId());
    const results = await browser.scripting.executeScript({
      target: { tabId, frameIds: opts.frameId != null ? [opts.frameId] : undefined },
      world: "MAIN" as any,
      func: new Function(code) as () => unknown,
    });
    return results?.[0]?.result;
  }

  async terminateScript(_worldId: string, _tabId?: number): Promise<void> {
    // No equivalent API in Firefox — no-op.
    // Long-running scripts must use AbortSignal passed via executeInPage.
  }

  // ── Input events (synthetic — isTrusted: false) ───────────────────────────

  async dispatchClick(selector: string, opts: InputDispatchOptions = {}): Promise<void> {
    await this.executeInMainWorld(
      `document.querySelector(${JSON.stringify(selector)})?.click()`,
      opts
    );
  }

  async dispatchType(selector: string, text: string, opts: InputDispatchOptions = {}): Promise<void> {
    // Synthetic input — sufficient for most forms, not isTrusted
    await this.executeInMainWorld(
      `
      const el = document.querySelector(${JSON.stringify(selector)});
      if (el) {
        el.focus();
        for (const char of ${JSON.stringify(text)}) {
          el.dispatchEvent(new KeyboardEvent('keydown', { key: char, bubbles: true }));
          el.dispatchEvent(new KeyboardEvent('keypress', { key: char, bubbles: true }));
          if ('value' in el) el.value += char;
          el.dispatchEvent(new InputEvent('input', { data: char, bubbles: true }));
          el.dispatchEvent(new KeyboardEvent('keyup', { key: char, bubbles: true }));
        }
      }
      `,
      opts
    );
  }

  async dispatchKeyPress(key: string, opts: InputDispatchOptions = {}): Promise<void> {
    await this.executeInMainWorld(
      `document.activeElement?.dispatchEvent(new KeyboardEvent('keypress', { key: ${JSON.stringify(key)}, bubbles: true }))`,
      opts
    );
  }

  async dispatchKeyDown(key: string, opts: InputDispatchOptions = {}): Promise<void> {
    await this.executeInMainWorld(
      `document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(key)}, bubbles: true }))`,
      opts
    );
  }

  async dispatchKeyUp(key: string, opts: InputDispatchOptions = {}): Promise<void> {
    await this.executeInMainWorld(
      `document.activeElement?.dispatchEvent(new KeyboardEvent('keyup', { key: ${JSON.stringify(key)}, bubbles: true }))`,
      opts
    );
  }

  // ── Observation ───────────────────────────────────────────────────────────

  async captureScreenshot(tabId?: number): Promise<string> {
    const id = tabId ?? (await this.#activeTabId());
    // browser.tabs.captureVisibleTab is fully portable
    return (browser.tabs as any).captureVisibleTab(
      (await browser.tabs.get(id)).windowId,
      { format: "png" }
    );
  }

  async getCookies(domain: string): Promise<Cookie[]> {
    const raw = await browser.cookies.getAll({ domain });
    return raw.map((c) => ({
      name: c.name,
      value: c.value,
      domain: c.domain,
      path: c.path,
      httpOnly: c.httpOnly,
      secure: c.secure,
    }));
  }

  async dispose(): Promise<void> {
    // Nothing to release — Firefox adapter holds no persistent handles.
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  async #activeTabId(): Promise<number> {
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) throw new Error("No active tab");
    return tab.id;
  }
}
