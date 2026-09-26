# Security

AI Dock runs locally on Windows and reads provider data only from sources required for the supported integrations.

## What we read

- **Claude Code:** `%USERPROFILE%\.claude\.credentials.json` or `CLAUDE_CODE_OAUTH_TOKEN`
- **Codex:** `%USERPROFILE%\.codex\auth.json` or `CODEX_HOME`
- **Cursor:** the authenticated editor state in `%APPDATA%\Cursor\User\globalStorage\state.vscdb`, opened read-only
- **Antigravity:** local process/language-server state
- **Claude Web:** the claude.ai session the user signs in to inside AI Dock, or a Cookie the user pastes manually

## Claude Web credential handling

There are two ways to connect Claude Web:

1. **Entrar com claude.ai (recommended).** AI Dock opens claude.ai's own login page in an AI Dock window. The user signs in there. The cookies of that window live in AI Dock's private WebView2 profile, not in Chrome or Edge. AI Dock reads the claude.ai cookies of that profile only.
2. **Manual paste.** A full authenticated `Cookie` header or the cookies table copied from DevTools.

Either way, the app keeps only:

- `sessionKey`
- `cf_clearance`
- `__cf_bm`
- `anthropic-device-id`

Those values are stored in **Windows Credential Manager** through the native keyring integration. WebView2 keeps its own copy of the claude.ai cookies in AI Dock's profile folder, encrypted by WebView2 like Edge does.

AI Dock does **not** read cookies from Chrome, Edge or any other browser profile.

### Session renewal

- When claude.ai rotates a cookie through `Set-Cookie` on a usage request, AI Dock stores the new value.
- When the session stops working, AI Dock opens claude.ai in a hidden AI Dock window for a few seconds, at most once every 20 minutes, so the site can renew its own session and Cloudflare cookies, and reads them back. This is what a browser tab left open does; AI Dock does not solve or bypass Cloudflare challenges.
- Only when renewal fails does AI Dock ask the user to sign in again.
- "Sair" in Settings deletes the stored Cookie and the claude.ai cookies in AI Dock's WebView2 profile.

### Isolation of the login window

The claude.ai windows are remote content. They have no Tauri capability, and Tauri 2 rejects IPC from remote origins without one, so claude.ai scripts cannot call AI Dock commands or plugins.

Older builds may have written a legacy Claude session fallback in AppData. The current version migrates that legacy value to Credential Manager when possible and removes the legacy file. New credentials are not written to that plaintext fallback.

## What we do not persist

- Cursor access tokens
- Codex tokens
- Claude Code OAuth values
- provider credentials in frontend localStorage
- provider credentials in logs
- cookies/tokens in repository files

Cursor credentials are re-read from the local editor database only when needed and remain in memory for the request.

The frontend provider cache stores only non-sensitive quota/provider metadata.

## Logging

The app does not intentionally log tokens, cookies, session keys or OAuth credentials.

Development builds write a small `boot.log` with dock placement diagnostics. Release builds do not write it. Credential values must never be added to those messages.

## Network boundaries

AI Dock does not operate its own backend for provider credentials.

Requests go to the provider endpoints required by the supported integration. Local-only sources such as Cursor SQLite and Antigravity local state remain local.

The packaged app ships a Content Security Policy that only allows its own scripts, styles and images, plus Tauri IPC.

## Known limitations

- Claude Web relies on session cookies controlled by claude.ai and Cloudflare; claude.ai can still sign the user out, and then a new login is needed.
- Google may refuse sign-in inside embedded browsers. Signing in to claude.ai by email works in the AI Dock window.
- AI Dock does not bypass Cloudflare challenges. Temporary challenges are treated separately from authentication expiry.
- The Windows binary is not yet code-signed, so SmartScreen may warn on first launch.

## Report a vulnerability

Contact the repository owner privately (`NyckDragon`).

Do not paste live tokens, cookies, session keys, auth files or other credentials into issues, screenshots, logs or documentation.
