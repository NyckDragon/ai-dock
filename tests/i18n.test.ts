import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { EN } from "../src/lib/i18n-en.ts";
import { resolveLanguage, setLocale, t, tr, trLabel } from "../src/lib/i18n.ts";

function files(dir: string, pattern: RegExp): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return files(path, pattern);
    return pattern.test(path) ? [path] : [];
  });
}

test("every t() key in src has an English translation", () => {
  const missing = new Set<string>();
  for (const file of files("src", /\.tsx?$/)) {
    const source = readFileSync(file, "utf8");
    for (const match of source.matchAll(/\bt\(\s*("(?:[^"\\]|\\.)*")/g)) {
      const key = JSON.parse(match[1]) as string;
      if (!(key in EN)) missing.add(file + ": " + key);
    }
  }
  assert.deepEqual([...missing], []);
});

test("module-level strings rendered through t() have translations", () => {
  const settings = readFileSync("src/components/SettingsPanel.tsx", "utf8");
  const onboarding = readFileSync("src/components/Onboarding.tsx", "utf8");
  const settingsLib = readFileSync("src/lib/settings.ts", "utf8");
  const keys = [
    ...[...settings.matchAll(/\{ id: "\w+", title: "([^"]+)", description: "([^"]+)" \}/g)].flatMap((m) => [m[1], m[2]]),
    ...[...settings.matchAll(/\{ id: "\w+", label: "([^"]+)" \}/g)].map((m) => m[1]),
    ...[...(onboarding.match(/const STEPS = \[([^\]]+)\]/)?.[1] || "").matchAll(/"([^"]+)"/g)].map((m) => m[1]),
    settingsLib.match(/GLOBAL_SHORTCUT_LABEL = "([^"]+)"/)?.[1] || ""
  ];
  assert.ok(keys.length >= 12);
  assert.deepEqual(keys.filter((key) => !(key in EN)), []);
});

test("user-facing Rust messages have translations for tr()", () => {
  const missing: string[] = [];
  for (const file of files("src-tauri/src", /\.rs$/)) {
    const source = readFileSync(file, "utf8").split("#[cfg(test)]")[0];
    for (const match of source.matchAll(/"((?:[^"\\]|\\.)*)"/g)) {
      const text = match[1].replace(/\\\\/g, "\\");
      // Only Portuguese sentences: window labels go through trLabel, formats through tr's patterns.
      if (!/[à-úÀ-Ú]|\bnão\b/.test(text) || text.includes("{") || text.includes(" · ") || !/\s/.test(text)) continue;
      if (/^(Sessão|Sonnet|Opus|Uso |Sob )/.test(text)) continue;
      if (!(text in EN)) missing.push(file + ": " + text);
    }
  }
  assert.deepEqual(missing, []);
});

test("t fills placeholders and falls back to Portuguese", () => {
  setLocale("pt");
  assert.equal(t("Reseta em {time}", { time: "2h" }), "Reseta em 2h");
  setLocale("en");
  assert.equal(t("Reseta em {time}", { time: "2h" }), "Resets in 2h");
  assert.equal(t("Texto sem tradução"), "Texto sem tradução");
  setLocale("pt");
});

test("tr translates Rust messages, including the ones with a variable part", () => {
  setLocale("en");
  assert.equal(tr("Codex não conectado."), "Codex not connected.");
  assert.equal(tr("Cursor retornou HTTP 502."), "Cursor returned HTTP 502.");
  assert.equal(tr("Tela 2"), "Display 2");
  assert.equal(tr(null), "");
  assert.equal(trLabel("Sessão · 5h"), "Session · 5h");
  assert.equal(trLabel("Opus · semanal"), "Opus · weekly");
  assert.equal(trLabel("Pro · Ilimitado"), "Pro · Unlimited");
  setLocale("pt");
  assert.equal(tr("Codex não conectado."), "Codex não conectado.");
  assert.equal(trLabel("Sessão · 5h"), "Sessão · 5h");
});

test("automatic language follows the system", () => {
  assert.equal(resolveLanguage("auto", "pt-BR"), "pt");
  assert.equal(resolveLanguage("auto", "en-US"), "en");
  assert.equal(resolveLanguage("auto", "es-ES"), "en");
  assert.equal(resolveLanguage("pt", "en-US"), "pt");
});
