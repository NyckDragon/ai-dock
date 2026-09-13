# Security

AI Dock runs on your machine and talks only to the official provider endpoints that each CLI already uses.

## What we read

- Claude Code: `%USERPROFILE%\.claude\.credentials.json` or `CLAUDE_CODE_OAUTH_TOKEN`
- Codex: `%USERPROFILE%\.codex\auth.json` or `CODEX_HOME`
- Antigravity: process list + language server on localhost

Those files are never written back, printed, or uploaded to a server we control.

## What we do not do yet

- OAuth refresh
- Claude Desktop session
- Claude Web `sessionKey` in the UI (backend exists, UI does not)

## Report a vulnerability

Open a private note with the repo owner (`NyckDragon`). Do not attach live tokens.
