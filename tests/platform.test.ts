import assert from "node:assert/strict";
import { test } from "node:test";
import { currentPlatform } from "../src/lib/platform.ts";

test("the webview user agent names the platform", () => {
  assert.equal(currentPlatform("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Edg/140.0"), "windows");
  assert.equal(currentPlatform("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15"), "macos");
  assert.equal(currentPlatform("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/605.1.15"), "linux");
});
