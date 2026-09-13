use std::{env, path::PathBuf, process::Command};

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

use super::providers::ProviderSetupStatus;

const CREATE_NO_WINDOW: u32 = 0x08000000;

fn run_hidden(program: &str, args: &[&str]) -> std::io::Result<std::process::Output> {
    let mut command = Command::new(program);
    command.args(args);
    #[cfg(target_os = "windows")]
    command.creation_flags(CREATE_NO_WINDOW);
    command.output()
}

fn npm_claude() -> Option<PathBuf> {
    if let Some(appdata) = env::var_os("APPDATA") {
        let npm = PathBuf::from(appdata).join("npm").join("claude.cmd");
        if npm.is_file() {
            return Some(npm);
        }
    }
    None
}

fn npm_available() -> bool {
    run_hidden("where.exe", &["npm.cmd"])
        .map(|output| output.status.success())
        .unwrap_or(false)
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
        run_hidden("cmd.exe", &["/C", "npm uninstall -g @anthropic-ai/claude-code"])
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
