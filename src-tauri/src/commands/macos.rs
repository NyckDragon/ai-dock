//! macOS helpers shared by the setup and usage commands.

use std::path::PathBuf;
use std::process::Command;
use std::sync::atomic::{AtomicBool, Ordering};

/// An app opened from Finder has no shell PATH, so Homebrew's two prefixes
/// (Apple silicon, then Intel) are checked as files.
pub(crate) fn homebrew_tool(name: &str) -> Option<PathBuf> {
    ["/opt/homebrew/bin", "/usr/local/bin"]
        .into_iter()
        .map(|dir| PathBuf::from(dir).join(name))
        .find(|path| path.is_file())
}

const CLAUDE_CODE_ITEM: &str = "Claude Code-credentials";

/// Claude Code keeps its login in the login Keychain on macOS, not in
/// ~/.claude/.credentials.json. Reading it shows the system access prompt once;
/// a refusal is remembered so the prompt does not come back on every refresh.
/// Exit code 44 is "item not found": nothing was asked, so it is not a refusal.
pub(crate) fn claude_code_keychain() -> Option<String> {
    static REFUSED: AtomicBool = AtomicBool::new(false);
    if REFUSED.load(Ordering::Relaxed) {
        return None;
    }
    let output = Command::new("/usr/bin/security")
        .args(["find-generic-password", "-s", CLAUDE_CODE_ITEM, "-w"])
        .output()
        .ok()?;
    if !output.status.success() {
        if output.status.code() != Some(44) {
            REFUSED.store(true, Ordering::Relaxed);
        }
        return None;
    }
    let secret = String::from_utf8_lossy(&output.stdout).trim().to_string();
    (!secret.is_empty()).then_some(secret)
}

/// Without `-w` only the item's attributes are read, which never prompts.
pub(crate) fn claude_code_keychain_exists() -> bool {
    Command::new("/usr/bin/security")
        .args(["find-generic-password", "-s", CLAUDE_CODE_ITEM])
        .output()
        .is_ok_and(|output| output.status.success())
}
