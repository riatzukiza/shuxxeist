/**
 * Runtime capability detection.
 *
 * Called once at startup to produce the immutable capability set
 * that BrowserRuntime implementations expose.
 *
 * Detection is conservative: a capability is only declared present
 * when the underlying API is confirmed available, not merely assumed.
 */

import type { BrowserCapability } from "./interface.ts";

/** True when running inside a Chrome/Chromium extension context. */
export function isChrome(): boolean {
  return typeof chrome !== "undefined" && typeof chrome.runtime?.id === "string";
}

/** True when running inside a Firefox extension context. */
export function isFirefox(): boolean {
  return (
    typeof browser !== "undefined" &&
    // @ts-ignore — navigator.userAgent available in all extension contexts
    navigator.userAgent.includes("Firefox")
  );
}

/**
 * Detect which capabilities are available in the current extension context.
 *
 * This is the canonical source of truth — BrowserRuntime adapters must
 * pass this set unmodified as their `capabilities` property.
 */
export function detectCapabilities(): ReadonlySet<BrowserCapability> {
  const caps = new Set<BrowserCapability>();

  // CDP-backed APIs — Chrome only
  if (typeof chrome?.debugger?.attach === "function") {
    caps.add("trusted-input");
    caps.add("main-world-eval");
    caps.add("network-capture");
    caps.add("device-emulation");
  }

  // Isolated userScript worlds — Chrome 138+ MV3
  if (typeof chrome?.userScripts?.execute === "function") {
    caps.add("isolated-world");
  }

  // main-world via scripting (Firefox fallback — no debugger needed)
  if (
    !caps.has("main-world-eval") &&
    typeof (globalThis as any).browser?.scripting?.executeScript === "function"
  ) {
    caps.add("main-world-eval");
  }

  // OffscreenDocument (Chrome MV3)
  if (typeof chrome?.offscreen?.createDocument === "function") {
    caps.add("offscreen-doc");
  }

  // Sidebar panel — Chrome sidePanel or Firefox sidebarAction
  if (
    typeof chrome?.sidePanel?.open === "function" ||
    typeof (globalThis as any).browser?.sidebarAction?.open === "function"
  ) {
    caps.add("sidebar-panel");
  }

  return caps;
}
