//! Smart Tag commands — multi-tag classification with per-tag prompt.
//!
//! A smart tag is a named group (e.g. "⚙️ Rust 系统开发") that classifies
//! skills many-to-many. Each tag carries an optional `prompt` that is
//! appended when generating a combined prompt, and an `agents` JSON array
//! (`[]` = global, shown on every agent page).

use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tauri::State;

use crate::core::{
    error::AppError,
    skill_store::{SmartTagRecord, SkillStore},
};

/// Frontend-facing smart tag DTO. `agents` is surfaced as a parsed Vec so
/// the frontend never has to JSON.parse a string.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SmartTagDto {
    pub id: String,
    pub name: String,
    pub agents: Vec<String>,
    pub description: Option<String>,
    pub prompt: Option<String>,
    pub sort_order: i32,
    pub created_at: i64,
    pub updated_at: i64,
}

impl From<SmartTagRecord> for SmartTagDto {
    fn from(rec: SmartTagRecord) -> Self {
        let agents = serde_json::from_str::<Vec<String>>(&rec.agents).unwrap_or_default();
        Self {
            id: rec.id,
            name: rec.name,
            agents,
            description: rec.description,
            prompt: rec.prompt,
            sort_order: rec.sort_order,
            created_at: rec.created_at,
            updated_at: rec.updated_at,
        }
    }
}

/// Input payload for create/update.
#[derive(Debug, Deserialize)]
pub struct SmartTagInput {
    pub name: String,
    #[serde(default)]
    pub agents: Vec<String>,
    pub description: Option<String>,
    pub prompt: Option<String>,
}

fn now_secs() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

/// Return all smart tags, ordered by sort_order then name.
#[tauri::command]
pub async fn get_smart_tags_ext(
    store: State<'_, Arc<SkillStore>>,
) -> Result<Vec<SmartTagDto>, AppError> {
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        store
            .get_all_smart_tags()
            .map(|rows| rows.into_iter().map(SmartTagDto::from).collect())
            .map_err(AppError::db)
    })
    .await?
}

/// Return a map: skill_id -> vec of smart_tag_ids. Used by the workspace to
/// resolve tag membership for every managed skill in one query.
#[tauri::command]
pub async fn get_smart_tags_map(
    store: State<'_, Arc<SkillStore>>,
) -> Result<std::collections::HashMap<String, Vec<String>>, AppError> {
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        store.get_smart_tags_map().map_err(AppError::db)
    })
    .await?
}

/// Create a new smart tag. Returns the created tag (with its generated id).
#[tauri::command]
pub async fn create_smart_tag_ext(
    input: SmartTagInput,
    store: State<'_, Arc<SkillStore>>,
) -> Result<SmartTagDto, AppError> {
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let name = input.name.trim().to_string();
        if name.is_empty() {
            return Err(AppError::invalid_input("Smart tag name cannot be empty"));
        }
        let agents = serde_json::to_string(&input.agents)
            .map_err(|e| AppError::db(format!("serialize agents: {e}")))?;
        let now = now_secs();
        let id = uuid::Uuid::new_v4().to_string();
        let rec = SmartTagRecord {
            id: id.clone(),
            name,
            agents,
            description: input.description,
            prompt: input.prompt,
            sort_order: 0,
            created_at: now,
            updated_at: now,
        };
        store.insert_smart_tag(&rec).map_err(AppError::db)?;
        store
            .get_smart_tag_by_id(&id)
            .map_err(AppError::db)?
            .map(SmartTagDto::from)
            .ok_or_else(|| AppError::db("smart tag vanished after insert"))
    })
    .await?
}

/// Update name/agents/description/prompt of an existing smart tag.
#[tauri::command]
pub async fn update_smart_tag_ext(
    id: String,
    input: SmartTagInput,
    store: State<'_, Arc<SkillStore>>,
) -> Result<SmartTagDto, AppError> {
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let name = input.name.trim().to_string();
        if name.is_empty() {
            return Err(AppError::invalid_input("Smart tag name cannot be empty"));
        }
        let agents = serde_json::to_string(&input.agents)
            .map_err(|e| AppError::db(format!("serialize agents: {e}")))?;
        store
            .update_smart_tag(
                &id,
                &name,
                &agents,
                input.description.as_deref(),
                input.prompt.as_deref(),
            )
            .map_err(AppError::db)?;
        store
            .get_smart_tag_by_id(&id)
            .map_err(AppError::db)?
            .map(SmartTagDto::from)
            .ok_or_else(|| AppError::not_found("smart tag not found"))
    })
    .await?
}

/// Delete a smart tag. Cascade removes all skill bindings.
#[tauri::command]
pub async fn delete_smart_tag_ext(
    id: String,
    store: State<'_, Arc<SkillStore>>,
) -> Result<(), AppError> {
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        store.delete_smart_tag(&id).map_err(AppError::db)
    })
    .await?
}

/// Return the list of smart-tag ids bound to a skill.
#[tauri::command]
pub async fn get_smart_tag_ids_for_skill(
    skill_id: String,
    store: State<'_, Arc<SkillStore>>,
) -> Result<Vec<String>, AppError> {
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        store.get_smart_tag_ids_for_skill(&skill_id).map_err(AppError::db)
    })
    .await?
}

/// Replace the full set of smart tags bound to a skill (sync semantics).
#[tauri::command]
pub async fn bind_smart_tags_to_skill(
    skill_id: String,
    smart_tag_ids: Vec<String>,
    store: State<'_, Arc<SkillStore>>,
) -> Result<(), AppError> {
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        store
            .set_smart_tags_for_skill(&skill_id, &smart_tag_ids)
            .map_err(AppError::db)
    })
    .await?
}

/// Remove all smart-tag bindings from a skill (convenience for clearing).
#[tauri::command]
pub async fn unbind_smart_tags_from_skill(
    skill_id: String,
    store: State<'_, Arc<SkillStore>>,
) -> Result<(), AppError> {
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        store
            .set_smart_tags_for_skill(&skill_id, &[])
            .map_err(AppError::db)
    })
    .await?
}
