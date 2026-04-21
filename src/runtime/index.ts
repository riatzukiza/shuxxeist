/**
 * createRuntime() — factory called once at extension startup.
 *
 * Detects the host browser and returns the appropriate BrowserRuntime
 * implementation. All tools receive this instance via dependency injection;
 * none import browser-specific modules directly.
 *
 * Usage:
 *
 *   import { createRuntime } from "../runtime/index.ts";
 *   const runtime = createRuntime();
 *   // ... inject into tools
 */

export type { BrowserRuntime, BrowserCapability, Cookie } from "./interface.ts";
export { detectCapabilities, isChrome, isFirefox } from "./detect.ts";

import { isFirefox } from "./detect.ts";
import type { BrowserRuntime } from "./interface.ts";

export function createRuntime(): BrowserRuntime {
  if (isFirefox()) {
    // Dynamic import keeps the Chrome bundle clean of Firefox-specific code
    // and vice versa. esbuild tree-shakes the unused branch.
    const { FirefoxRuntime } = require("./firefox-runtime.ts");
    return new FirefoxRuntime();
  }
  const { ChromeRuntime } = require("./chrome-runtime.ts");
  return new ChromeRuntime();
}
