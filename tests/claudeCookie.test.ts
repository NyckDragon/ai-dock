import test from "node:test";
import assert from "node:assert/strict";

import { normalizeClaudeCookieInput } from "../src/lib/claudeCookie.ts";

test("extracts only allowed Claude cookies from markdown table", () => {
  const input = `
| Name | Value | Domain |
| --- | --- | --- |
| sessionKey | session-12345678901234567890 | claude.ai |
| cf_clearance | cf-token | .claude.ai |
| __cf_bm | bm-token | .claude.ai |
| anthropic-device-id | device-1 | .claude.ai |
| unrelated | ignore-me | .claude.ai |
`;

  assert.equal(
    normalizeClaudeCookieInput(input),
    "sessionKey=session-12345678901234567890; cf_clearance=cf-token; __cf_bm=bm-token; anthropic-device-id=device-1"
  );
});

test("extracts allowed cookies from tab-separated DevTools rows", () => {
  const input = [
    "sessionKey\tsession-12345678901234567890\t.claude.ai",
    "cf_clearance\tcf-token\t.claude.ai",
    "unrelated\tignore-me\t.claude.ai"
  ].join("\n");

  assert.equal(
    normalizeClaudeCookieInput(input),
    "sessionKey=session-12345678901234567890; cf_clearance=cf-token"
  );
});

test("accepts a complete Cookie header", () => {
  const input = "Cookie: sessionKey=session-123; cf_clearance=cf-token; __cf_bm=bm-token";
  assert.equal(
    normalizeClaudeCookieInput(input),
    "sessionKey=session-123; cf_clearance=cf-token; __cf_bm=bm-token"
  );
});

test("keeps raw legacy input as fallback", () => {
  const input = "legacy-session-key-value";
  assert.equal(normalizeClaudeCookieInput(input), input);
});

test("deduplicates cookie names in table input", () => {
  const input = [
    "sessionKey\tfirst-value",
    "sessionKey\tsecond-value",
    "cf_clearance\tcf-token"
  ].join("\n");

  assert.equal(
    normalizeClaudeCookieInput(input),
    "sessionKey=first-value; cf_clearance=cf-token"
  );
});
