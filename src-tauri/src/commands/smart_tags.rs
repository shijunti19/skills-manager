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
    skill_store::{SmartTagImportEntry, SmartTagRecord, SkillStore},
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

// ── Import / export as text ─────────────────────────────────────────────

/// A suggested install parsed from the import text's `## 建议安装` /
/// `## Suggested installs` section. The frontend installs these via git.
#[derive(Debug, Clone, Serialize)]
pub struct SuggestedInstall {
    pub name: String,
    pub github: String,
}

/// Result of an import: counts plus any skill names that didn't resolve to a
/// managed skill (so the frontend can surface them), and any skills the AI
/// suggested installing from github.
#[derive(Debug, Serialize)]
pub struct ImportResult {
    pub tags_created: usize,
    pub bindings_created: usize,
    pub skills_unmatched: Vec<String>,
    pub suggested_installs: Vec<SuggestedInstall>,
}

/// One parsed tag block from the import text: its text fields and the list
/// of skill *names* (not yet resolved to ids) that appear under it.
struct ParsedTagBlock {
    name: String,
    description: Option<String>,
    skill_names: Vec<String>,
}

/// Parsed output of the import text: tag blocks + any suggested installs.
struct ParsedImport {
    blocks: Vec<ParsedTagBlock>,
    suggested: Vec<SuggestedInstall>,
}

/// True when a `##` heading marks the "suggested installs" section. Matches
/// the section names used by the skills-list instruction in any locale.
fn is_suggested_section(heading: &str) -> bool {
    let h = heading.trim().to_lowercase();
    h == "建议安装"
        || h == "建議安裝"
        || h == "suggested installs"
        || h == "suggested installs:"
        || h == "suggested"
        || h.contains("建议安装")
        || h.contains("建議安裝")
        || h.contains("suggested install")
}

/// Parse the import text into tag blocks + suggested installs. Format:
/// ```text
/// # 标签名
/// 描述行(可选,多行)
///
/// - 技能名: 介绍 | github | 目录
/// - 技能名2: ...
///
/// ## 建议安装
/// - 技能名: https://github.com/owner/repo
/// ```
/// Lines starting with `##` (double-hash) open a special section — currently
/// only "建议安装"/"Suggested installs" is recognized, whose items are parsed
/// as `name: github` pairs for the frontend to install. Lines starting with a
/// single `#` open a normal tag. Lines starting with `-` are skill bindings.
fn parse_import_text(text: &str) -> Result<ParsedImport, AppError> {
    let mut blocks: Vec<ParsedTagBlock> = Vec::new();
    let mut desc_lines: Vec<String> = Vec::new();
    let mut suggested: Vec<SuggestedInstall> = Vec::new();
    // When inside a `## 建议安装` section, list items go to `suggested`
    // instead of the current tag block.
    let mut in_suggested_section = false;

    for raw in text.lines() {
        let line = raw.trim_end();
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        // Double-hash heading: a special section, NOT a tag.
        if let Some(rest) = trimmed.strip_prefix("##") {
            // Flush the previous block's description before switching context.
            if let Some(last) = blocks.last_mut() {
                if !desc_lines.is_empty() {
                    last.description = Some(desc_lines.join("\n"));
                    desc_lines.clear();
                }
            }
            in_suggested_section = is_suggested_section(rest);
            // Unknown ## sections are simply ignored (treated as comments).
            continue;
        }
        if let Some(rest) = trimmed.strip_prefix('#') {
            let name = rest.trim().to_string();
            if name.is_empty() {
                return Err(AppError::invalid_input(
                    "encountered a '#' heading with an empty tag name",
                ));
            }
            // A single-hash tag heading exits the suggested-install section.
            in_suggested_section = false;
            // Flush the previous block's description before starting a new one.
            if let Some(last) = blocks.last_mut() {
                if !desc_lines.is_empty() {
                    last.description = Some(desc_lines.join("\n"));
                    desc_lines.clear();
                }
            }
            blocks.push(ParsedTagBlock {
                name,
                description: None,
                skill_names: Vec::new(),
            });
            continue;
        }
        if trimmed.starts_with('-') || trimmed.starts_with('•') {
            let body = trimmed
                .trim_start_matches(['-', '•', ' ', '*', '+'])
                .trim();
            if in_suggested_section {
                // "技能名: github" — split on the first ':'.
                if let Some(idx) = body.find(':') {
                    let name = body[..idx].trim().to_string();
                    let github = body[idx + 1..].trim().to_string();
                    if !name.is_empty() && !github.is_empty() {
                        suggested.push(SuggestedInstall { name, github });
                    }
                }
                continue;
            }
            // Skill name is the segment before the first ':' (or '|' if no colon).
            let skill_name = body
                .split([':', '|'])
                .next()
                .unwrap_or("")
                .trim()
                .to_string();
            if !skill_name.is_empty() {
                if let Some(last) = blocks.last_mut() {
                    last.skill_names.push(skill_name);
                }
            }
            continue;
        }
        // Any other non-empty line is description text for the current block.
        if !in_suggested_section && blocks.last().is_some() {
            desc_lines.push(line.to_string());
        }
    }
    // Flush trailing description onto the last block.
    if let Some(last) = blocks.last_mut() {
        if !desc_lines.is_empty() {
            last.description = Some(desc_lines.join("\n"));
        }
    }

    if blocks.is_empty() {
        return Err(AppError::invalid_input(
            "no tags found — text must contain at least one '# 标签名' heading",
        ));
    }
    Ok(ParsedImport { blocks, suggested })
}

/// Import (replace) the full smart-tag set from a structured text blob.
/// Atomically clears `smart_tags` + `skill_smart_tag_relations`, then
/// rebuilds from the parsed text. Skills are matched by name against the
/// managed library; unmatched names are returned for the UI to surface.
#[tauri::command]
pub async fn import_smart_tags_from_text(
    text: String,
    store: State<'_, Arc<SkillStore>>,
) -> Result<ImportResult, AppError> {
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let parsed = parse_import_text(&text)?;

        // Resolve skill names -> ids, collecting unmatched names.
        let mut entries: Vec<SmartTagImportEntry> = Vec::with_capacity(parsed.blocks.len());
        let mut unmatched: Vec<String> = Vec::new();
        let mut unmatched_seen = std::collections::HashSet::new();
        for block in parsed.blocks {
            let mut skill_ids: Vec<String> = Vec::new();
            for name in &block.skill_names {
                match store.get_skill_id_by_name(name) {
                    Ok(Some(id)) => skill_ids.push(id),
                    _ => {
                        if unmatched_seen.insert(name.clone()) {
                            unmatched.push(name.clone());
                        }
                    }
                }
            }
            entries.push(SmartTagImportEntry {
                name: block.name,
                description: block.description,
                prompt: None,
                skill_ids,
            });
        }

        // Clear then rebuild, inside the bulk insert's own transaction.
        store.clear_all_smart_tags().map_err(AppError::db)?;
        let (tags_created, bindings_created) = store
            .bulk_import_smart_tags(&entries)
            .map_err(AppError::db)?;

        Ok(ImportResult {
            tags_created,
            bindings_created,
            skills_unmatched: unmatched,
            suggested_installs: parsed.suggested,
        })
    })
    .await?
}
