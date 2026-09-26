import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const pkg = JSON.parse(readFileSync("package.json", "utf8"));
const tauri = JSON.parse(readFileSync("src-tauri/tauri.conf.json", "utf8"));
const cargo = readFileSync("src-tauri/Cargo.toml", "utf8");
const changelog = readFileSync("CHANGELOG.md", "utf8");
const readme = readFileSync("README.md", "utf8");

function cargoPackageVersion() {
  const packageBlock = cargo.match(/\[package\]([\s\S]*?)(?:\n\[|$)/)?.[1] ?? "";
  return packageBlock.match(/^version\s*=\s*"([^"]+)"/m)?.[1] ?? null;
}

test("package, Tauri and Cargo versions stay aligned", () => {
  const cargoVersion = cargoPackageVersion();

  assert.ok(cargoVersion, "Cargo package version was not found");
  assert.equal(tauri.version, pkg.version);
  assert.equal(cargoVersion, pkg.version);
});

test("changelog contains the current app version", () => {
  assert.match(changelog, new RegExp(`^## \\[${pkg.version.replace(/\\./g, "\\\\.")}\\]`, "m"));
});

test("README version badge matches the current app version", () => {
  assert.ok(
    readme.includes(`version-${pkg.version}-`),
    `README version badge should reference ${pkg.version}`
  );
});
