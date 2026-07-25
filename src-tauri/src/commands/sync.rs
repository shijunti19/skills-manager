use std::path::PathBuf;
use std::sync::Arc;
use tauri::{AppHandle, State};

use crate::core::{
    error::AppError, scenario_service, skill_store::SkillStore, sync_engine, sync_metadata,
    tool_adapters, tool_service,
};
use serde::Serialize;

#[derive(Debug, Serialize)]
pub struct SkillToolToggleDto {
    pub tool: String,
    pub display_name: String,
    pub installed: bool,
    pub globally_enabled: bool,
    pub enabled: bool,
}

fn disabled_tools(store: &SkillStore) -> Vec<String> {
    tool_service::get_disabled_tools(store)
}

/// Sync commands fire one call per `(skill, agent)` pair when PresetBar
/// applies a preset from the in-app workspace view. Route through the
/// coalescing refresh so a burst rebuilds the tray at most once per window
/// instead of once per row.
fn schedule_tray_refresh(app: &AppHandle) {
    crate::schedule_tray_refresh(app);
}

fn sync_skill_to_tool_internal(
    store: &SkillStore,
    skill_id: &str,
    tool: &str,
) -> Result<(), AppError> {
    scenario_service::sync_single_skill_to_tool(store, skill_id, tool)
}

#[tauri::command]
pub async fn sync_skill_to_tool(
    app: AppHandle,
    skill_id: String,
    tool: String,
    store: State<'_, Arc<SkillStore>>,
) -> Result<(), AppError> {
    let store = store.inner().clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        let outcome = (|| -> Result<(), AppError> {
            sync_skill_to_tool_internal(&store, &skill_id, &tool)?;

            if let Ok(Some(active_id)) = store.get_active_scenario_id() {
                let skill_ids = store
                    .get_skill_ids_for_scenario(&active_id)
                    .map_err(AppError::db)?;
                if skill_ids.contains(&skill_id) {
                    let adapter_keys: Vec<String> =
                        tool_adapters::enabled_installed_adapters(&store)
                            .iter()
                            .map(|a| a.key.clone())
                            .collect();
                    store
                        .ensure_scenario_skill_tool_defaults(&active_id, &skill_id, &adapter_keys)
                        .map_err(AppError::db)?;
                    store
                        .set_scenario_skill_tool_enabled(&active_id, &skill_id, &tool, true)
                        .map_err(AppError::db)?;
                }
            }

            Ok(())
        })();
        log_sync_outcome(&store, "enable", &skill_id, &tool, outcome.as_ref());
        outcome
    })
    .await?;
    if result.is_ok() {
        schedule_tray_refresh(&app);
    }
    result
}

#[tauri::command]
pub async fn unsync_skill_from_tool(
    app: AppHandle,
    skill_id: String,
    tool: String,
    store: State<'_, Arc<SkillStore>>,
) -> Result<(), AppError> {
    let store = store.inner().clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        let outcome = (|| -> Result<(), AppError> {
            let targets = store
                .get_targets_for_skill(&skill_id)
                .map_err(AppError::db)?;

            if let Some(target) = targets.iter().find(|t| t.tool == tool) {
                let target_path = PathBuf::from(&target.target_path);
                sync_engine::remove_target(&target_path).ok();
            }

            store
                .delete_target(&skill_id, &tool)
                .map_err(AppError::db)?;

            if let Ok(Some(active_id)) = store.get_active_scenario_id() {
                let skill_ids = store
                    .get_skill_ids_for_scenario(&active_id)
                    .map_err(AppError::db)?;
                if skill_ids.contains(&skill_id) {
                    let adapter_keys: Vec<String> =
                        tool_adapters::enabled_installed_adapters(&store)
                            .iter()
                            .map(|a| a.key.clone())
                            .collect();
                    store
                        .ensure_scenario_skill_tool_defaults(&active_id, &skill_id, &adapter_keys)
                        .map_err(AppError::db)?;
                    store
                        .set_scenario_skill_tool_enabled(&active_id, &skill_id, &tool, false)
                        .map_err(AppError::db)?;
                }
            }

            Ok(())
        })();
        log_sync_outcome(&store, "disable", &skill_id, &tool, outcome.as_ref());
        outcome
    })
    .await?;
    if result.is_ok() {
        schedule_tray_refresh(&app);
    }
    result
}

fn log_sync_outcome(
    store: &SkillStore,
    action: &str,
    skill_id: &str,
    tool: &str,
    outcome: Result<&(), &AppError>,
) {
    let name = store
        .get_skill_by_id(skill_id)
        .ok()
        .flatten()
        .map(|s| s.name)
        .unwrap_or_default();
    let mut draft = crate::core::audit_log::AuditDraft::new(action)
        .skill(skill_id.to_string(), name)
        .tool(tool.to_string());
    draft = match outcome {
        Ok(_) => draft.ok(),
        Err(e) => draft.fail(e.to_string()),
    };
    store.log_audit(draft);
}

#[tauri::command]
pub async fn get_skill_tool_toggles(
    skill_id: String,
    preset_id: String,
    store: State<'_, Arc<SkillStore>>,
) -> Result<Vec<SkillToolToggleDto>, AppError> {
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let skill_ids = store
            .get_skill_ids_for_scenario(&preset_id)
            .map_err(AppError::db)?;
        if !skill_ids.contains(&skill_id) {
            return Err(AppError::not_found("Skill is not enabled in this preset"));
        }

        let disabled = disabled_tools(&store);
        let all_adapters = tool_adapters::all_tool_adapters(&store);
        let default_enabled_keys: Vec<String> = all_adapters
            .iter()
            .filter(|adapter| adapter.is_installed() && !disabled.contains(&adapter.key))
            .map(|adapter| adapter.key.clone())
            .collect();
        store
            .ensure_scenario_skill_tool_defaults(&preset_id, &skill_id, &default_enabled_keys)
            .map_err(AppError::db)?;

        let toggles = store
            .get_scenario_skill_tool_toggles(&preset_id, &skill_id)
            .map_err(AppError::db)?;
        let enabled_map: std::collections::HashMap<String, bool> = toggles
            .into_iter()
            .map(|toggle| (toggle.tool, toggle.enabled))
            .collect();

        Ok(all_adapters
            .into_iter()
            .map(|adapter| {
                let globally_enabled = !disabled.contains(&adapter.key);
                let available = adapter.is_installed() && globally_enabled;
                SkillToolToggleDto {
                    // Unavailable tools are always presented as disabled in UI.
                    enabled: if available {
                        enabled_map.get(&adapter.key).copied().unwrap_or(false)
                    } else {
                        false
                    },
                    tool: adapter.key.clone(),
                    display_name: adapter.display_name.clone(),
                    installed: adapter.is_installed(),
                    globally_enabled,
                }
            })
            .collect())
    })
    .await?
}

#[tauri::command]
pub async fn set_skill_tool_toggle(
    app: AppHandle,
    skill_id: String,
    preset_id: String,
    tool: String,
    enabled: bool,
    store: State<'_, Arc<SkillStore>>,
) -> Result<(), AppError> {
    let store = store.inner().clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        let skill_ids = store
            .get_skill_ids_for_scenario(&preset_id)
            .map_err(AppError::db)?;
        if !skill_ids.contains(&skill_id) {
            return Err(AppError::not_found("Skill is not enabled in this preset"));
        }

        let adapter = tool_adapters::find_adapter_with_store(&store, &tool)
            .ok_or_else(|| AppError::not_found(format!("Unknown tool: {}", tool)))?;
        let disabled = disabled_tools(&store);
        let globally_enabled = !disabled.contains(&tool);

        if enabled {
            if !adapter.is_installed() {
                return Err(AppError::not_found(format!(
                    "{} is not installed",
                    adapter.display_name
                )));
            }
            if !globally_enabled {
                return Err(AppError::invalid_input(format!(
                    "{} is disabled",
                    adapter.display_name
                )));
            }
        }

        sync_metadata::with_repo_lock("set skill tool toggle", || {
            store.set_scenario_skill_tool_enabled(&preset_id, &skill_id, &tool, enabled)?;
            sync_metadata::write_all_from_db_unlocked(&store)
        })
        .map_err(AppError::db)?;

        let is_active = store
            .get_active_scenario_id()
            .map_err(AppError::db)?
            .as_deref()
            == Some(preset_id.as_str());
        if is_active {
            if enabled {
                sync_skill_to_tool_internal(&store, &skill_id, &tool)?;
            } else {
                let targets = store
                    .get_targets_for_skill(&skill_id)
                    .map_err(AppError::db)?;
                if let Some(target) = targets.iter().find(|target| target.tool == tool) {
                    // Safe because the app currently guarantees a single active scenario.
                    sync_engine::remove_target(&PathBuf::from(&target.target_path)).ok();
                }
                store
                    .delete_target(&skill_id, &tool)
                    .map_err(AppError::db)?;
            }
        }

        Ok(())
    })
    .await?;
    if result.is_ok() {
        schedule_tray_refresh(&app);
    }
    result
}

/// Result of organizing an agent's skills directory.
#[derive(Debug, Serialize)]
pub struct OrganizeResultDto {
    pub kept: usize,
    pub removed: usize,
}

/// Organize an agent's skills directory so it contains exactly the given
/// `keep_skill_ids`: remove synced skills that aren't in the keep set, and
/// sync any missing ones. Honors the global `sync_mode` (symlink or copy).
///
/// This is the "organize agent folder" primitive behind the tag-filter
/// "sync all" button — it makes the agent's folder mirror a tag's skill set,
/// so only the needed skills load into the agent's context (saving tokens).
///
/// Splits into a pure synchronous `core` (testable, no Tauri handle) and a
/// thin `#[tauri::command]` wrapper. The core does **not** trust the DB
/// `skill_targets` table to know what's on disk — it re-reads the agent's
/// skills directory fresh, because skills installed outside the manager
/// (or with stale DB rows) would otherwise survive the cleanup. The DB is
/// only used to find which skills belong to the keep set and to record the
/// freshly re-synced targets at the end.
#[tauri::command]
pub async fn organize_agent_skills(
    app: AppHandle,
    agent_key: String,
    keep_skill_ids: Vec<String>,
    store: State<'_, Arc<SkillStore>>,
) -> Result<OrganizeResultDto, AppError> {
    let store = store.inner().clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        organize_agent_skills_core(&store, &agent_key, &keep_skill_ids)
    })
    .await?;
    if result.is_ok() {
        schedule_tray_refresh(&app);
    }
    result
}

/// Filesystem-truth implementation of "make this agent's skills dir contain
/// exactly `keep_skill_ids`". Two phases:
///
/// **Phase 1 — wipe the agent's skills directory.** Read every entry on disk
/// (not the DB) and clear it:
///   - symlink/junction → just unlink (central holds the source)
///   - real dir **not** present in central → copy it into central first, so a
///     skill that only lives in the agent folder isn't lost, then delete
///   - real dir already in central → just delete
///
///   Hidden entries (`.git`, `.DS_Store`) and stray files are left alone.
///
/// **Phase 2 — re-materialize the keep set from central**, honoring
/// `sync_mode` (with the Windows symlink → junction → copy fallback). DB
/// `skill_targets` rows for this agent are dropped first, then re-inserted by
/// each successful Phase 2 sync, so they always reflect the final disk state.
pub fn organize_agent_skills_core(
    store: &SkillStore,
    agent_key: &str,
    keep_skill_ids: &[String],
) -> Result<OrganizeResultDto, AppError> {
    // Resolve the adapter (must be installed + enabled).
    let adapter = tool_adapters::find_adapter_with_store(store, agent_key)
        .ok_or_else(|| AppError::not_found(format!("Unknown tool: {}", agent_key)))?;
    if !adapter.is_installed() {
        return Err(AppError::not_found(format!(
            "{} is not installed",
            adapter.display_name
        )));
    }
    if tool_service::get_disabled_tools(store).contains(&agent_key.to_string()) {
        return Err(AppError::invalid_input(format!(
            "{} is disabled",
            adapter.display_name
        )));
    }

    // Directory names the keep-set skills will occupy, so Phase 1 can tell
    // "cleared because you didn't select it" apart from "cleared then
    // re-synced" for an accurate `removed` count.
    //
    // Bulk-fetched in one SELECT via `get_skills_by_ids` — the prior
    // per-id `get_skill_by_id` loop was the main hot spot of "sync all",
    // turning N db round-trips + lock acquisitions into one. We tolerate
    // missing ids here (they'll show up as failed in Phase 2) instead of
    // erroring the whole batch, matching the resilience of the inner
    // Phase 2 loop.
    let keep_skills = store
        .get_skills_by_ids(keep_skill_ids)
        .map_err(AppError::db)?;
    let keep_dir_names: std::collections::HashSet<String> = keep_skills
        .iter()
        .map(|skill| {
            sync_engine::target_dir_name(
                std::path::Path::new(&skill.central_path),
                &skill.name,
            )
        })
        .collect();

    let skills_root = adapter.skills_dir();
    let central_root = crate::core::central_repo::skills_dir();

    // Phase 1: filesystem-truth cleanup. Re-read the agent's skills dir
    // fresh from disk — DB targets can be stale or miss skills installed
    // outside the manager, which is why unselected skills used to survive —
    // and clear every skill directory:
    //   - symlink/junction        -> just unlink (central holds the source)
    //   - real dir missing central -> back it up into central first, so a
    //     skill that only lives in the agent folder isn't lost, then delete
    //   - real dir already central -> just delete
    // Whatever is in the keep set gets re-materialized in Phase 2.
    let mut removed = 0usize;
    if let Ok(entries) = std::fs::read_dir(&skills_root) {
        for entry in entries.filter_map(|e| e.ok()) {
            let path = entry.path();
            let Some(name) = path
                .file_name()
                .and_then(|n| n.to_str())
                .map(str::to_string)
            else {
                continue;
            };
            // Leave hidden/metadata entries (e.g. ".git") untouched.
            if name.starts_with('.') {
                continue;
            }
            let symlink_meta = match std::fs::symlink_metadata(&path) {
                Ok(meta) => meta,
                Err(_) => continue,
            };
            let is_link = sync_engine::is_link_or_junction(&path);
            // Only manage directories and directory links; skip stray files.
            if !is_link && !symlink_meta.is_dir() {
                continue;
            }
            if !is_link {
                // Real directory: preserve it in central if central lacks it.
                let central_candidate = central_root.join(&name);
                if !central_candidate.exists() {
                    if let Err(e) = sync_engine::sync_skill(
                        &path,
                        &central_candidate,
                        sync_engine::SyncMode::Copy,
                    ) {
                        log::warn!("organize: failed to back up {name} to central: {e}");
                        // Never remove the only known copy when its rescue failed.
                        continue;
                    }
                }
            }
            if let Err(e) = sync_engine::remove_target(&path) {
                log::warn!("organize: failed to remove {}: {e}", path.display());
                continue;
            }
            if !keep_dir_names.contains(&name) {
                removed += 1;
            }
        }
    }

    // The directory is now empty of managed skills; every target row for
    // this agent is stale. Drop them all in one DELETE — Phase 2
    // re-inserts fresh rows. This replaces a per-skill `delete_target`
    // loop that fired N round-trips + lock acquisitions.
    store
        .delete_targets_for_tool(agent_key)
        .map_err(AppError::db)?;

    // Phase 2: re-sync exactly the keep set from central, honoring sync_mode
    // (and the Windows symlink->junction->copy fallback).
    //
    // Routed through the batch `sync_skills_to_tool` so adapter resolution,
    // the disabled-tool check, the `sync_mode` setting read, and the skill
    // row SELECT each happen **once** instead of N times. Individual
    // failing skills are counted as failed and logged, not fatal — same
    // semantics as the prior per-skill loop.
    let stats = scenario_service::sync_skills_to_tool(store, keep_skill_ids, agent_key)?;
    let kept = stats.synced;

    Ok(OrganizeResultDto {
        kept,
        removed,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::skill_store::SkillRecord;
    use crate::core::tool_adapters::CustomToolDef;
    use std::fs;
    use tempfile::tempdir;

    fn sample_skill(id: &str, name: &str, central_path: &std::path::Path) -> SkillRecord {
        SkillRecord {
            id: id.to_string(),
            name: name.to_string(),
            description: None,
            source_type: "import".to_string(),
            source_ref: Some(central_path.to_string_lossy().to_string()),
            source_ref_resolved: None,
            source_subpath: None,
            source_branch: None,
            source_revision: None,
            remote_revision: None,
            central_path: central_path.to_string_lossy().to_string(),
            content_hash: None,
            enabled: true,
            created_at: 1,
            updated_at: 1,
            status: "ok".to_string(),
            update_status: "local_only".to_string(),
            last_checked_at: None,
            last_check_error: None,
        }
    }

    fn write_skill_dir(base: &std::path::Path, dir_name: &str, marker: &str) -> PathBuf {
        let dir = base.join(dir_name);
        fs::create_dir_all(&dir).unwrap();
        fs::write(
            dir.join("SKILL.md"),
            format!("---\nname: {dir_name}\n---\n"),
        )
        .unwrap();
        fs::write(dir.join("unique.txt"), marker).unwrap();
        dir
    }

    fn configure_single_custom_tool(store: &SkillStore, target_base: &std::path::Path) {
        let custom_tools = vec![CustomToolDef {
            key: "test_agent".to_string(),
            display_name: "Test Agent".to_string(),
            skills_dir: target_base.to_string_lossy().to_string(),
            project_relative_skills_dir: None,
            category: Default::default(),
            skills_prompt_spec: None,
        }];
        store
            .set_setting(
                "custom_tools",
                &serde_json::to_string(&custom_tools).unwrap(),
            )
            .unwrap();
        let disabled_builtin_tools: Vec<String> = tool_adapters::default_tool_adapters()
            .into_iter()
            .map(|adapter| adapter.key)
            .collect();
        store
            .set_setting(
                "disabled_tools",
                &serde_json::to_string(&disabled_builtin_tools).unwrap(),
            )
            .unwrap();
        store.set_setting("sync_mode", "copy").unwrap();
    }

    #[test]
    fn sync_skill_to_tool_keeps_duplicate_skill_names_separate() {
        let tmp = tempdir().unwrap();
        let store = SkillStore::new(&tmp.path().join("test.db")).unwrap();
        let source_base = tmp.path().join("central");
        let target_base = tmp.path().join("agent-skills");
        fs::create_dir_all(&source_base).unwrap();
        fs::create_dir_all(&target_base).unwrap();
        configure_single_custom_tool(&store, &target_base);

        let first_dir = write_skill_dir(&source_base, "skill123", "first");
        let second_dir = write_skill_dir(&source_base, "skill123-2", "second");
        store
            .insert_skill(&sample_skill("first", "skill123", &first_dir))
            .unwrap();
        store
            .insert_skill(&sample_skill("second", "skill123", &second_dir))
            .unwrap();

        sync_skill_to_tool_internal(&store, "first", "test_agent").unwrap();
        sync_skill_to_tool_internal(&store, "second", "test_agent").unwrap();

        assert_eq!(
            fs::read_to_string(target_base.join("skill123/unique.txt")).unwrap(),
            "first"
        );
        assert_eq!(
            fs::read_to_string(target_base.join("skill123-2/unique.txt")).unwrap(),
            "second"
        );
    }

    /// Reproduce the regression where the tag-filter "sync all to qoder"
    /// button left unselected skills behind in the agent's skills directory.
    ///
    /// Setup mirrors the real failure mode: the agent's directory starts with
    /// a mix of copied skills (some in the keep set, some not), and the
    /// central library holds the sources. After organize with keep=[selected],
    /// the agent dir must contain ONLY the selected skill — the others must
    /// have been deleted (not left behind).
    #[test]
    fn organize_removes_unselected_skills_in_copy_mode() {
        let _guard = crate::core::central_repo::test_base_dir_lock();
        let tmp = tempdir().unwrap();
        let central_base = tmp.path().join("central");
        let agent_base = tmp.path().join("agent-skills");
        fs::create_dir_all(&agent_base).unwrap();

        // Point central_repo::skills_dir() at <tmp>/central so the core sees
        // a library root it can both read from and back up into.
        crate::core::central_repo::set_test_base_dir_override(Some(central_base.clone()));
        let central_skills = crate::core::central_repo::skills_dir();
        fs::create_dir_all(&central_skills).unwrap();

        let store = SkillStore::new(&tmp.path().join("test.db")).unwrap();
        configure_single_custom_tool(&store, &agent_base);

        // Three skills in central; the agent dir starts with all three copied
        // (mirrors a real .qoder/skills that accumulated skills over time).
        let selected_dir = write_skill_dir(&central_skills, "selected-keep", "keep");
        let stray1_dir = write_skill_dir(&central_skills, "stray-one", "s1");
        let stray2_dir = write_skill_dir(&central_skills, "stray-two", "s2");
        store
            .insert_skill(&sample_skill("keep", "selected-keep", &selected_dir))
            .unwrap();
        store
            .insert_skill(&sample_skill("s1", "stray-one", &stray1_dir))
            .unwrap();
        store
            .insert_skill(&sample_skill("s2", "stray-two", &stray2_dir))
            .unwrap();

        // Pre-populate the agent dir with all three (copy mode), so two of
        // them are unselected "residual" directories organize must remove.
        sync_skill_to_tool_internal(&store, "keep", "test_agent").unwrap();
        sync_skill_to_tool_internal(&store, "s1", "test_agent").unwrap();
        sync_skill_to_tool_internal(&store, "s2", "test_agent").unwrap();
        assert!(agent_base.join("selected-keep/SKILL.md").exists());
        assert!(agent_base.join("stray-one/SKILL.md").exists());
        assert!(agent_base.join("stray-two/SKILL.md").exists());

        // Organize: keep only "keep". The two strays must be cleared.
        let result =
            organize_agent_skills_core(&store, "test_agent", &["keep".to_string()]).unwrap();

        assert_eq!(result.kept, 1);
        assert_eq!(result.removed, 2);
        // THE REGRESSION ASSERTION: unselected skills must be gone.
        assert!(
            agent_base.join("selected-keep/SKILL.md").exists(),
            "kept skill should still be installed"
        );
        assert!(
            !agent_base.join("stray-one").exists(),
            "unselected stray-one must be removed (regression)"
        );
        assert!(
            !agent_base.join("stray-two").exists(),
            "unselected stray-two must be removed (regression)"
        );
    }

    /// A skill directory that exists ONLY in the agent folder (no central
    /// source) must be backed up into central before being deleted, so the
    /// user doesn't lose a skill the manager didn't import. This is the
    /// "central 不存在就复制过去" branch of Phase 1.
    #[test]
    fn organize_backs_up_orphan_skill_to_central_before_removing() {
        let _guard = crate::core::central_repo::test_base_dir_lock();
        let tmp = tempdir().unwrap();
        let central_base = tmp.path().join("central");
        let agent_base = tmp.path().join("agent-skills");
        fs::create_dir_all(&agent_base).unwrap();
        crate::core::central_repo::set_test_base_dir_override(Some(central_base.clone()));

        // central_repo::skills_dir() resolves to <central_base>/skills — that's
        // where both registered skill sources and Phase-1 backups live.
        let central_skills = crate::core::central_repo::skills_dir();
        fs::create_dir_all(&central_skills).unwrap();

        let store = SkillStore::new(&tmp.path().join("test.db")).unwrap();
        configure_single_custom_tool(&store, &agent_base);

        // One registered skill (the keep target) living under central/skills.
        let keep_dir = write_skill_dir(&central_skills, "keep-skill", "keep");
        store
            .insert_skill(&sample_skill("keep", "keep-skill", &keep_dir))
            .unwrap();
        sync_skill_to_tool_internal(&store, "keep", "test_agent").unwrap();

        // The orphan: lives only in the agent dir, central has no "orphan-x".
        write_skill_dir(&agent_base, "orphan-x", "orphan-data");

        let result =
            organize_agent_skills_core(&store, "test_agent", &["keep".to_string()]).unwrap();

        assert_eq!(result.kept, 1);
        assert_eq!(result.removed, 1);
        // Orphan removed from agent dir...
        assert!(!agent_base.join("orphan-x").exists());
        // ...but rescued into central first (data not lost).
        assert!(
            central_skills.join("orphan-x/SKILL.md").exists(),
            "orphan skill must be backed up to central before removal"
        );
        assert_eq!(
            fs::read_to_string(central_skills.join("orphan-x/unique.txt")).unwrap(),
            "orphan-data"
        );
    }

    #[test]
    fn organize_keeps_orphan_when_backup_fails() {
        let _guard = crate::core::central_repo::test_base_dir_lock();
        let tmp = tempdir().unwrap();
        let central_base = tmp.path().join("central");
        let agent_base = tmp.path().join("agent-skills");
        fs::create_dir_all(&agent_base).unwrap();
        crate::core::central_repo::set_test_base_dir_override(Some(central_base.clone()));

        let central_skills = crate::core::central_repo::skills_dir();
        fs::create_dir_all(&central_skills).unwrap();
        let store = SkillStore::new(&tmp.path().join("test.db")).unwrap();
        configure_single_custom_tool(&store, &agent_base);

        let orphan = write_skill_dir(&agent_base, "orphan-x", "orphan-data");
        // Force the backup destination to be unusable without touching the
        // source: a regular file cannot contain central/orphan-x.
        fs::remove_dir_all(&central_skills).unwrap();
        fs::write(&central_skills, "blocked").unwrap();

        let result = organize_agent_skills_core(&store, "test_agent", &[]).unwrap();

        assert_eq!(result.removed, 0);
        assert!(orphan.join("SKILL.md").exists());
        assert_eq!(
            fs::read_to_string(orphan.join("unique.txt")).unwrap(),
            "orphan-data"
        );
    }

    #[cfg(windows)]
    #[test]
    fn organize_unlinks_junction_without_touching_central_source() {
        let _guard = crate::core::central_repo::test_base_dir_lock();
        let tmp = tempdir().unwrap();
        let central_base = tmp.path().join("central");
        let agent_base = tmp.path().join("agent-skills");
        fs::create_dir_all(&agent_base).unwrap();
        crate::core::central_repo::set_test_base_dir_override(Some(central_base.clone()));
        let central_skills = crate::core::central_repo::skills_dir();
        fs::create_dir_all(&central_skills).unwrap();

        let store = SkillStore::new(&tmp.path().join("test.db")).unwrap();
        configure_single_custom_tool(&store, &agent_base);
        let source = write_skill_dir(&central_skills, "junction-skill", "central-data");
        let target = agent_base.join("junction-skill");
        junction::create(&source, &target).unwrap();

        let result = organize_agent_skills_core(&store, "test_agent", &[]).unwrap();

        assert_eq!(result.removed, 1);
        assert!(fs::symlink_metadata(&target).is_err());
        assert_eq!(
            fs::read_to_string(source.join("unique.txt")).unwrap(),
            "central-data"
        );
    }

    /// Symlink mode: Phase 1 unlinks the symlink (doesn't follow + delete the
    /// central source), Phase 2 re-creates a fresh symlink. This is the
    /// "如果是软连接直接删了" branch.
    #[cfg(unix)]
    #[test]
    fn organize_symlink_mode_unlinks_and_recreates_symlink() {
        use std::os::unix::fs::symlink;
        let _guard = crate::core::central_repo::test_base_dir_lock();
        let tmp = tempdir().unwrap();
        let central_base = tmp.path().join("central");
        let agent_base = tmp.path().join("agent-skills");
        fs::create_dir_all(&agent_base).unwrap();
        crate::core::central_repo::set_test_base_dir_override(Some(central_base.clone()));
        let central_skills = crate::core::central_repo::skills_dir();
        fs::create_dir_all(&central_skills).unwrap();

        let store = SkillStore::new(&tmp.path().join("test.db")).unwrap();
        // Switch to symlink mode for this scenario.
        let custom_tools = vec![CustomToolDef {
            key: "test_agent".to_string(),
            display_name: "Test Agent".to_string(),
            skills_dir: agent_base.to_string_lossy().to_string(),
            project_relative_skills_dir: None,
            category: Default::default(),
            skills_prompt_spec: None,
        }];
        store
            .set_setting(
                "custom_tools",
                &serde_json::to_string(&custom_tools).unwrap(),
            )
            .unwrap();
        let disabled_builtin_tools: Vec<String> = tool_adapters::default_tool_adapters()
            .into_iter()
            .map(|adapter| adapter.key)
            .collect();
        store
            .set_setting(
                "disabled_tools",
                &serde_json::to_string(&disabled_builtin_tools).unwrap(),
            )
            .unwrap();
        store.set_setting("sync_mode", "symlink").unwrap();

        let keep_dir = write_skill_dir(&central_skills, "keep-sym", "keep");
        let stray_dir = write_skill_dir(&central_skills, "stray-sym", "stray");
        store
            .insert_skill(&sample_skill("keep", "keep-sym", &keep_dir))
            .unwrap();
        store
            .insert_skill(&sample_skill("stray", "stray-sym", &stray_dir))
            .unwrap();

        // Both start as symlinks in the agent dir.
        sync_skill_to_tool_internal(&store, "keep", "test_agent").unwrap();
        sync_skill_to_tool_internal(&store, "stray", "test_agent").unwrap();
        assert!(agent_base.join("keep-sym").is_symlink());
        assert!(agent_base.join("stray-sym").is_symlink());

        let result =
            organize_agent_skills_core(&store, "test_agent", &["keep".to_string()]).unwrap();

        assert_eq!(result.kept, 1);
        assert_eq!(result.removed, 1);
        // Stray symlink gone; central source untouched.
        assert!(!agent_base.join("stray-sym").exists());
        assert!(central_skills.join("stray-sym/SKILL.md").exists());
        // Kept one re-materialized as a fresh symlink.
        assert!(agent_base.join("keep-sym").is_symlink());
    }
}
