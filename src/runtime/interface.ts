/**
 * BrowserRuntime — the single seam between tool code and browser APIs.
 *
 * Tools NEVER import from chrome-runtime.ts or firefox-runtime.ts directly.
 * They call methods on a BrowserRuntime instance injected at startup.
 *
 * The `capabilities` set is the epistemic contract: if a capability is absent,
 * the tool degrades gracefully rather than throwing at runtime.
 */

export type BrowserCapability =
  | "trusted-input"     // CDP Input.dispatch* available (Chrome debugger API)
  | "isolated-world"    // userScripts.execute() with isolated worldId available
  | "main-world-eval"   // debugger Runtime.evaluate in MAIN world available
  | "network-capture"   // CDP Network domain available
  | "device-emulation"  // CDP Emulation domain available
  | "offscreen-doc"     // OffscreenDocument API available
  | "sidebar-panel";    // Native side panel / sidebar API available

export interface Cookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  httpOnly: boolean;
  secure: boolean;
}

export interface ExecuteInPageOptions {
  /** Reuse a named isolated world across calls (Chrome: userScripts worldId). */
  worldId?: string;
  /** Target a specific tab; defaults to the active tab. */
  tabId?: number;
  frameId?: number;
  signal?: AbortSignal;
}

export interface InputDispatchOptions {
  tabId?: number;
  signal?: AbortSignal;
}

export interface BrowserRuntime {
  // ── Capability surface ────────────────────────────────────────────────────

  /** Immutable set populated at construction time via capability detection. */
  readonly capabilities: ReadonlySet<BrowserCapability>;

  // ── Script execution ──────────────────────────────────────────────────────

  /**
   * Execute `code` in an isolated script world on the active (or specified) tab.
   *
   * Chrome: chrome.userScripts.execute() in USER_SCRIPT world.
   * Firefox: browser.scripting.executeScript({ world: "ISOLATED" }) — no worldId isolation.
   *
   * Requires capability: "isolated-world" for full parity.
   * Falls back to ISOLATED content-script world on Firefox.
   */
  executeInPage(code: string, opts?: ExecuteInPageOptions): Promise<unknown>;

  /**
   * Execute `code` in the page's MAIN world (access to page JS globals).
   *
   * Chrome: chrome.debugger Runtime.evaluate.
   * Firefox: browser.scripting.executeScript({ world: "MAIN" }).
   *
   * Requires capability: "main-world-eval" for debugger-backed access.
   */
  executeInMainWorld(code: string, opts?: ExecuteInPageOptions): Promise<unknown>;

  /**
   * Terminate any running userScript execution for the given worldId.
   * No-op if the platform does not support it.
   */
  terminateScript(worldId: string, tabId?: number): Promise<void>;

  // ── Trusted input events ──────────────────────────────────────────────────

  /**
   * Dispatch a trusted click at the element matching `selector`.
   *
   * Chrome: CDP Input.dispatchMouseEvent (isTrusted: true).
   * Firefox: synthetic MouseEvent via executeInMainWorld (isTrusted: false).
   *
   * Requires capability: "trusted-input" for isTrusted guarantee.
   */
  dispatchClick(selector: string, opts?: InputDispatchOptions): Promise<void>;

  /**
   * Type `text` into the element matching `selector`, character by character.
   *
   * Chrome: CDP Input.dispatchKeyEvent per char (isTrusted: true).
   * Firefox: synthetic KeyboardEvent sequence (isTrusted: false).
   */
  dispatchType(selector: string, text: string, opts?: InputDispatchOptions): Promise<void>;

  /**
   * Press a single named key (e.g. "Enter", "Tab", "Escape").
   */
  dispatchKeyPress(key: string, opts?: InputDispatchOptions): Promise<void>;

  dispatchKeyDown(key: string, opts?: InputDispatchOptions): Promise<void>;
  dispatchKeyUp(key: string, opts?: InputDispatchOptions): Promise<void>;

  // ── Observation ───────────────────────────────────────────────────────────

  /**
   * Capture a screenshot of the visible tab as a base64-encoded PNG.
   *
   * Chrome: chrome.tabs.captureVisibleTab().
   * Firefox: browser.tabs.captureVisibleTab() — same API, fully portable.
   */
  captureScreenshot(tabId?: number): Promise<string>;

  /**
   * Return all cookies for `domain`, including HttpOnly where permissions allow.
   */
  getCookies(domain: string): Promise<Cookie[]>;

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  /**
   * Release any held resources (e.g. detach debugger).
   * Safe to call multiple times.
   */
  dispose(): Promise<void>;
}
