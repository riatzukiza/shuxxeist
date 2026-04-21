/**
 * ChromeRuntime — BrowserRuntime adapter for Chrome/Edge MV3.
 *
 * This is a thin extraction of the existing direct chrome.* calls
 * scattered across tools. Behavior is identical to pre-abstraction code;
 * this is a pure refactor — no logic changes.
 */

import type {
  BrowserCapability,
  BrowserRuntime,
  Cookie,
  ExecuteInPageOptions,
  InputDispatchOptions,
} from "./interface.ts";
import { detectCapabilities } from "./detect.ts";

export class ChromeRuntime implements BrowserRuntime {
  readonly capabilities: ReadonlySet<BrowserCapability>;

  constructor() {
    this.capabilities = detectCapabilities();
  }

  // ── Script execution ──────────────────────────────────────────────────────

  async executeInPage(code: string, opts: ExecuteInPageOptions = {}): Promise<unknown> {
    const tabId = opts.tabId ?? (await this.#activeTabId());
    const worldId = opts.worldId ?? "shuvgeist-browser-script";

    // Delegate to existing chrome.userScripts.execute() path
    const results = await chrome.userScripts.execute({
      target: { tabId, frameIds: opts.frameId != null ? [opts.frameId] : undefined },
      world: "USER_SCRIPT",
      worldId,
      injectImmediately: true,
      js: [{ code }],
    });
    return results?.[0]?.result;
  }

  async executeInMainWorld(code: string, opts: ExecuteInPageOptions = {}): Promise<unknown> {
    const tabId = opts.tabId ?? (await this.#activeTabId());
    // Use debugger Runtime.evaluate for MAIN world access
    await chrome.debugger.attach({ tabId }, "1.3");
    try {
      const result = await chrome.debugger.sendCommand(
        { tabId },
        "Runtime.evaluate",
        { expression: code, returnByValue: true }
      ) as { result?: { value?: unknown } };
      return result?.result?.value;
    } finally {
      await chrome.debugger.detach({ tabId }).catch(() => {});
    }
  }

  async terminateScript(worldId: string, tabId?: number): Promise<void> {
    const id = tabId ?? (await this.#activeTabId());
    // Chrome 138+
    if (typeof chrome.userScripts.terminate === "function") {
      await chrome.userScripts.terminate({ worldId, tabId: id }).catch(() => {});
    }
  }

  // ── Trusted input events ──────────────────────────────────────────────────

  async dispatchClick(selector: string, opts: InputDispatchOptions = {}): Promise<void> {
    const tabId = opts.tabId ?? (await this.#activeTabId());
    await this.#cdpInput(tabId, selector, "click");
  }

  async dispatchType(selector: string, text: string, opts: InputDispatchOptions = {}): Promise<void> {
    const tabId = opts.tabId ?? (await this.#activeTabId());
    await chrome.debugger.attach({ tabId }, "1.3");
    try {
      for (const char of text) {
        await chrome.debugger.sendCommand({ tabId }, "Input.dispatchKeyEvent", {
          type: "keyDown",
          text: char,
        });
        await chrome.debugger.sendCommand({ tabId }, "Input.dispatchKeyEvent", {
          type: "keyUp",
          text: char,
        });
      }
    } finally {
      await chrome.debugger.detach({ tabId }).catch(() => {});
    }
  }

  async dispatchKeyPress(key: string, opts: InputDispatchOptions = {}): Promise<void> {
    await this.dispatchKeyDown(key, opts);
    await this.dispatchKeyUp(key, opts);
  }

  async dispatchKeyDown(key: string, opts: InputDispatchOptions = {}): Promise<void> {
    const tabId = opts.tabId ?? (await this.#activeTabId());
    await chrome.debugger.attach({ tabId }, "1.3");
    await chrome.debugger.sendCommand({ tabId }, "Input.dispatchKeyEvent", { type: "keyDown", key });
  }

  async dispatchKeyUp(key: string, opts: InputDispatchOptions = {}): Promise<void> {
    const tabId = opts.tabId ?? (await this.#activeTabId());
    await chrome.debugger.sendCommand({ tabId }, "Input.dispatchKeyEvent", { type: "keyUp", key });
    await chrome.debugger.detach({ tabId }).catch(() => {});
  }

  // ── Observation ───────────────────────────────────────────────────────────

  async captureScreenshot(tabId?: number): Promise<string> {
    const id = tabId ?? (await this.#activeTabId());
    return chrome.tabs.captureVisibleTab(
      (await chrome.tabs.get(id)).windowId,
      { format: "png" }
    );
  }

  async getCookies(domain: string): Promise<Cookie[]> {
    const raw = await chrome.cookies.getAll({ domain });
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
    // Nothing to tear down at the runtime level;
    // per-call debugger attach/detach handles lifecycle.
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  async #activeTabId(): Promise<number> {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) throw new Error("No active tab");
    return tab.id;
  }

  async #cdpInput(tabId: number, selector: string, action: "click"): Promise<void> {
    await chrome.debugger.attach({ tabId }, "1.3");
    try {
      // Resolve element center via Runtime.evaluate, then dispatch mouse event
      const rectResult = await chrome.debugger.sendCommand(
        { tabId },
        "Runtime.evaluate",
        {
          expression: `(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.left + r.width/2, y: r.top + r.height/2 }; })()`,
          returnByValue: true,
        }
      ) as { result?: { value?: { x: number; y: number } } };

      const pos = rectResult?.result?.value;
      if (!pos) throw new Error(`Element not found: ${selector}`);

      for (const type of ["mousePressed", "mouseReleased"] as const) {
        await chrome.debugger.sendCommand({ tabId }, "Input.dispatchMouseEvent", {
          type,
          x: pos.x,
          y: pos.y,
          button: "left",
          clickCount: 1,
        });
      }
    } finally {
      await chrome.debugger.detach({ tabId }).catch(() => {});
    }
  }
}
