use serde::Serialize;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KoraStatus {
    pub version: &'static str,
    pub ready: bool,
    pub storage: &'static str,
    pub event_bus: &'static str,
    pub task_adapter: &'static str,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KoraTask {
    pub id: String,
    pub project: String,
    pub task_type: String,
    pub status: String,
    pub complexity: String,
    pub risk: String,
    pub next_action: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KoraJob {
    pub id: String,
    pub task_id: Option<String>,
    pub executor: String,
    pub model: Option<String>,
    pub status: String,
    pub started_at: Option<String>,
    pub updated_at: String,
    pub error: Option<String>,
}

#[tauri::command]
pub fn kora_status() -> KoraStatus {
    KoraStatus {
        version: "0.1",
        ready: false,
        storage: "pending",
        event_bus: "tauri",
        task_adapter: "pending",
    }
}

#[tauri::command]
pub fn kora_list_tasks() -> Vec<KoraTask> {
    Vec::new()
}

#[tauri::command]
pub fn kora_list_jobs() -> Vec<KoraJob> {
    Vec::new()
}
