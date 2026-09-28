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
    #[cfg(target_os = "windows")]
    {
        if let Some(appdata) = env::var_os("APPDATA") {
            let npm = PathBuf::from(appdata).join("npm").join("claude.cmd");
            if npm.is_file() {
                return Some(npm);
            }
        }
        return None;
    }
    #[cfg(target_os = "macos")]
    {
        for candidate in ["/opt/homebrew/bin/claude", "/usr/local/bin/claude"] {
            let path = PathBuf::from(candidate);
            if path.is_file() {
                return Some(path);
            }
        }
        return None;
    }
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        None
    }
}

fn npm_available() -> bool {
    #[cfg(target_os = "windows")]
    {
        return run_hidden("where.exe", &["npm.cmd"])
            .map(|output| output.status.success())
            .unwrap_or(false);
    }
    #[cfg(target_os = "macos")]
    {
        return ["/opt/homebrew/bin/npm", "/usr/local/bin/npm"]
            .into_iter()
            .any(|path| PathBuf::from(path).is_file());
    }
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        Command::new("npm")
            .arg("--version")
            .output()
            .map(|output| output.status.success())
            .unwrap_or(false)
    }
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
        #[cfg(target_os = "macos")]
        {
            let npm = ["/opt/homebrew/bin/npm", "/usr/local/bin/npm"]
                .into_iter()
                .find(|path| PathBuf::from(path).is_file())
                .ok_or_else(|| std::io::Error::new(std::io::ErrorKind::NotFound, "npm"))?;
            run_hidden(npm, &["uninstall", "-g", "@anthropic-ai/claude-code"])
        }
        #[cfg(not(any(target_os = "windows", target_os = "macos")))]
        {
            run_hidden("npm", &["uninstall", "-g", "@anthropic-ai/claude-code"])
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
