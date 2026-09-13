# Contributing

AI Dock is a Windows 11 Tauri app. Issues and small PRs are welcome after the repository is public.

## Run locally

Need Node.js 22+, Rust stable, and the [Tauri 2 Windows prerequisites](https://v2.tauri.app/start/prerequisites/).

```bash
npm install
npm run tauri:dev
```

Installer:

```bash
npm run tauri:build
```

## Commits

Use [Conventional Commits](https://www.conventionalcommits.org/):

- `feat:` new user-facing behavior
- `fix:` bug fix
- `docs:` README, changelog, comments
- `chore:` version bump, CI, lockfiles

Keep secrets out of git and out of issue text. Never paste a `sessionKey`, OAuth token, or `auth.json`.

## Version

Bump `package.json`, `src-tauri/Cargo.toml`, and `src-tauri/tauri.conf.json` together. Add a `[X.Y.Z]` section in `CHANGELOG.md`.

A GitHub Release is created when you push a tag `vX.Y.Z` matching that version.
