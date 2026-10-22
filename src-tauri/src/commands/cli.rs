use std::{path::PathBuf, process::Command};

#[cfg(target_os = "windows")]
use std::env;

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

use super::providers::ProviderSetupStatus;

#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x08000000;

#[cfg(any(target_os = "windows", target_os = "macos"))]
fn run_hidden(program: impl AsRef<std::ffi::OsStr>, args: &[&str]) -> std::io::Result<std::process::Output> {
    let mut command = Command::new(program);
    command.args(args);
    #[cfg(target_os = "windows")]
    command.creation_flags(CREATE_NO_WINDOW);
    command.output()
}

#[cfg(target_os = "windows")]
fn npm_claude() -> Option<PathBuf> {
    let npm = PathBuf::from(env::var_os("APPDATA")?).join("npm").join("claude.cmd");
    npm.is_file().then_some(npm)
}

#[cfg(target_os = "windows")]
fn npm_available() -> bool {
    run_hidden("where.exe", &["npm.cmd"])
        .map(|output| output.status.success())
        .unwrap_or(false)
}

#[cfg(target_os = "macos")]
fn npm_claude() -> Option<PathBuf> {
    super::macos::homebrew_tool("claude")
}

#[cfg(target_os = "macos")]
fn npm_available() -> bool {
    super::macos::homebrew_tool("npm").is_some()
}

/// The global npm bin places `claude` beside `npm`. That is the install this button removes.
#[cfg(target_os = "linux")]
fn npm_claude() -> Option<PathBuf> {
    let claude = super::linux::tool("npm")?.parent()?.join("claude");
    claude.is_file().then_some(claude)
}

#[cfg(target_os = "linux")]
fn npm_available() -> bool {
    super::linux::tool("npm").is_some()
}

#[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
fn npm_claude() -> Option<PathBuf> {
    None
}

#[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
fn npm_available() -> bool {
    false
}

#[tauri::command]
pub async fn uninstall_provider_cli() -> Result<ProviderSetupStatus, String> {
    if npm_claude().is_none() {
        return Err("Só desinstalo o Claude Code CLI instalado via npm, que é o caminho do AI Dock.".to_string());
    }
    if !npm_available() {
        return Err("npm não foi encontrado para desinstalar o Claude Code CLI.".to_string());
    }

    let output = tauri::async_runtime::spawn_blocking(|| {
        #[cfg(target_os = "windows")]
        {
            run_hidden("cmd.exe", &["/C", "npm uninstall -g @anthropic-ai/claude-code"])
        }
        #[cfg(target_os = "linux")]
        {
            let Some(npm) = super::linux::tool("npm") else {
                return Err(std::io::Error::new(std::io::ErrorKind::NotFound, "npm"));
            };
            Command::new(npm)
                .args(["uninstall", "-g", "@anthropic-ai/claude-code"])
                .output()
        }
        #[cfg(target_os = "macos")]
        {
            let npm = super::macos::homebrew_tool("npm")
                .ok_or_else(|| std::io::Error::new(std::io::ErrorKind::NotFound, "npm"))?;
            run_hidden(npm, &["uninstall", "-g", "@anthropic-ai/claude-code"])
        }
        #[cfg(not(any(target_os = "windows", target_os = "linux", target_os = "macos")))]
        {
            Err(std::io::Error::new(std::io::ErrorKind::Unsupported, "npm"))
        }
    })
    .await
    .map_err(|_| "A desinstalação do Claude Code CLI foi interrompida.".to_string())?
    .map_err(|_| "Não foi possível iniciar a desinstalação do Claude Code CLI.".to_string())?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(if stderr.is_empty() {
            "A desinstalação do Claude Code CLI falhou.".to_string()
        } else {
            format!("A desinstalação falhou: {stderr}")
        });
    }

    Ok(super::providers::provider_setup_status())
}
