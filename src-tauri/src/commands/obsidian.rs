use serde::Serialize;
use serde_yaml::Value;
use std::{fs, path::Path};
use walkdir::WalkDir;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PromptItem {
    path: String,
    title: String,
    category: Option<String>,
    tags: Vec<String>,
    favorite: bool,
    content: String,
}

fn string_field(value: Option<&Value>) -> Option<String> {
    value.and_then(Value::as_str).map(str::trim).filter(|v| !v.is_empty()).map(str::to_string)
}

fn tags_field(value: Option<&Value>) -> Vec<String> {
    match value {
        Some(Value::Sequence(items)) => items
            .iter()
            .filter_map(Value::as_str)
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(str::to_string)
            .collect(),
        Some(Value::String(text)) => text
            .split(',')
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(str::to_string)
            .collect(),
        _ => vec![],
    }
}

fn parse_markdown(path: &Path, raw: &str) -> PromptItem {
    let mut body = raw.trim().to_string();
    let mut title = path
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("Prompt")
        .to_string();
    let mut category = None;
    let mut tags = vec![];
    let mut favorite = false;

    if let Some(rest) = raw.strip_prefix("---\n").or_else(|| raw.strip_prefix("---\r\n")) {
        let delimiter = if raw.starts_with("---\r\n") { "\r\n---" } else { "\n---" };
        if let Some(end) = rest.find(delimiter) {
            let yaml = &rest[..end];
            let after = &rest[end + delimiter.len()..];
            body = after.trim_start_matches(&['\r', '\n'][..]).trim().to_string();

            if let Ok(Value::Mapping(map)) = serde_yaml::from_str::<Value>(yaml) {
                let key = |name: &str| Value::String(name.to_string());
                title = string_field(map.get(&key("title"))).unwrap_or(title);
                category = string_field(map.get(&key("category")));
                tags = tags_field(map.get(&key("tags")));
                favorite = map.get(&key("favorite")).and_then(Value::as_bool).unwrap_or(false);
            }
        }
    }

    PromptItem {
        path: path.to_string_lossy().to_string(),
        title,
        category,
        tags,
        favorite,
        content: body,
    }
}

#[tauri::command]
pub fn scan_obsidian_prompts(root_path: String) -> Result<Vec<PromptItem>, String> {
    let root = Path::new(&root_path);
    if !root.is_dir() {
        return Err("A pasta selecionada não existe ou não é um diretório.".to_string());
    }

    let mut prompts = Vec::new();
    for entry in WalkDir::new(root).follow_links(false).into_iter().filter_map(Result::ok) {
        if prompts.len() >= 5000 {
            break;
        }
        let path = entry.path();
        if !entry.file_type().is_file() || path.extension().and_then(|v| v.to_str()) != Some("md") {
            continue;
        }
        let Ok(metadata) = entry.metadata() else { continue };
        if metadata.len() > 1_000_000 {
            continue;
        }
        if let Ok(raw) = fs::read_to_string(path) {
            prompts.push(parse_markdown(path, &raw));
        }
    }

    prompts.sort_by(|a, b| b.favorite.cmp(&a.favorite).then_with(|| a.title.to_lowercase().cmp(&b.title.to_lowercase())));
    Ok(prompts)
}
