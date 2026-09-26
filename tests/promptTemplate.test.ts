import test from "node:test";
import assert from "node:assert/strict";

import { fillPrompt, promptPreview, promptVariables } from "../src/lib/promptTemplate.ts";

test("finds each variable once, with its default", () => {
  const content = "Campanha para {{marca}} em tom {{ tom | sofisticado }}. Assinado: {{marca}}.";
  assert.deepEqual(promptVariables(content), [
    { name: "marca", fallback: "" },
    { name: "tom", fallback: "sofisticado" }
  ]);
});

test("fills values and falls back to defaults", () => {
  const content = "Campanha para {{marca}} em tom {{tom|sofisticado}}.";
  assert.equal(fillPrompt(content, { marca: "Kreatz" }), "Campanha para Kreatz em tom sofisticado.");
  assert.equal(fillPrompt(content, { marca: "Kreatz", tom: "leve" }), "Campanha para Kreatz em tom leve.");
});

test("a prompt without variables is left untouched", () => {
  assert.deepEqual(promptVariables("Resuma o texto."), []);
  assert.equal(fillPrompt("Resuma o texto.", {}), "Resuma o texto.");
});

test("preview collapses whitespace and trims", () => {
  assert.equal(promptPreview("  linha 1\n\nlinha   2  "), "linha 1 linha 2");
});
