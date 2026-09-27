# Contributing

Issues and small, focused pull requests are welcome. For bigger changes, open an issue first so we can agree on the approach.

## Run locally

Needs Windows 11, Node.js 22+, Rust stable and the [Tauri 2 Windows prerequisites](https://v2.tauri.app/start/prerequisites/). The frontend and the Rust tests also run on Linux and macOS.

```bash
npm install
npm run tauri:dev       # app with hot reload
npm run test:frontend   # frontend tests
npx tsc --noEmit        # type check
cd src-tauri && cargo test
```

`npm run dev` alone opens the UI in a browser as a local preview, without provider data.

## Guidelines

- Keep the privacy rules in [SECURITY.md](SECURITY.md): credentials are read only or live in Windows Credential Manager, never in logs, localStorage or the repository. AI Dock does not read browser cookies.
- UI text is Portuguese in the code and goes through `t("…")` (see `src/lib/i18n.ts`). Add the English text to `src/lib/i18n-en.ts`; `tests/i18n.test.ts` fails when one is missing.
- Messages from Rust that reach the UI also need an English entry, shown through `tr()`.
- Match the surrounding code style. Add or update tests with behavior changes.

## Commits

Use [Conventional Commits](https://www.conventionalcommits.org/): `feat:`, `fix:`, `docs:`, `chore:`, `test:`, `refactor:`.

Never paste a `sessionKey`, cookie, OAuth token or `auth.json` in commits, issues, logs or screenshots.

## Releases

1. Bump the version in `package.json`, `src-tauri/Cargo.toml` and `src-tauri/tauri.conf.json` together, and the badges in `README.md` and `README.pt-BR.md`.
2. Add a `## [X.Y.Z] - YYYY-MM-DD` section to `CHANGELOG.md`.
3. Merge to `main`.

CI then builds the Windows installer and the portable exe and, when `vX.Y.Z` has no release yet, creates the tag and the GitHub Release with that CHANGELOG section as its notes. `tests/releaseConsistency.test.ts` checks that versions, changelog and badges agree.

Pull requests run the frontend and Rust checks on Linux. The Windows build runs on `main`, on `v*` tags and on demand from the Actions tab (Windows Build → Run workflow), which also uploads a test build as an artifact.
