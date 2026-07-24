use std::sync::{Arc, Mutex, OnceLock};
use std::time::Instant;

use anyhow::{Context, Result};

use super::{central_repo, scenario_service, skill_store::SkillStore, sync_metadata, tool_service};

/// Process-wide buffer for early startup progress lines.
///
/// `initialize_store_minimal` and `run_reindex_if_needed` run *before*
/// `tauri_plugin_log` is installed (see `run()` in lib.rs), so a `log::info!`
/// there is swallowed by the default no-op logger. We stash human-readable
/// progress lines here and let `setup` flush them once the real logger exists —
/// the same stash-then-flush pattern used by `central_repo::record_startup_error`.
/// This is what makes the 40-100s pre-Builder window observable: without it a
/// hang in reindex leaves zero log evidence.
static EARLY_PROGRESS: OnceLock<Mutex<Vec<String>>> = OnceLock::new();

fn early_progress_buf() -> &'static Mutex<Vec<String>> {
    EARLY_PROGRESS.get_or_init(|| Mutex::new(Vec::new()))
}

/// Record a progress line during early startup (before the logger is up).
/// Accepts `impl Into<String>` so callers pass `&str` literals without
/// sprinkling `.to_string()` everywhere. Lines are drained by
/// [`take_early_progress`] from `setup()`.
pub fn record_early_progress(message: impl Into<String>) {
    let mut buf = early_progress_buf()
        .lock()
        .unwrap_or_else(|e| e.into_inner());
    buf.push(message.into());
}

/// Drain the stashed early-startup progress lines. Called from
/// `tauri::Builder::setup` once the logger is up so each line lands in the log
/// file that a support bundle collects.
pub fn take_early_progress() -> Vec<String> {
    let mut buf = early_progress_buf()
        .lock()
        .unwrap_or_else(|e| e.into_inner());
    std::mem::take(&mut buf)
}

/// Per-stage timings collected during `initialize_store`. The struct is
/// returned to the caller so the log lines can be emitted once
/// `tauri_plugin_log` is registered — anything logged from inside this
/// function would otherwise be dropped because the logger isn't installed
/// until later in `tauri::Builder::setup`. See issue #153.
#[derive(Debug, Clone)]
pub struct StartupTimings {
    pub ensure_central_repo_ms: u128,
    pub open_store_ms: u128,
    pub migrate_legacy_tool_keys_ms: u128,
    pub skill_count: usize,
    pub reindex_from_metadata_ms: Option<u128>,
    pub restore_sync_included_ms: u128,
    pub restore_sync_included_changed: bool,
    pub write_all_from_db_ms: Option<u128>,
    pub apply_scenario_ms: u128,
    /// "default_startup" (Tauri app) or "cli" (CLI bin). Defaults to
    /// `"unknown"` so a struct that escapes `initialize_store_inner`
    /// without being fully populated still produces an obvious value in
    /// the log instead of an empty string.
    pub apply_scenario_kind: &'static str,
    pub total_ms: u128,
}

impl Default for StartupTimings {
    fn default() -> Self {
        Self {
            ensure_central_repo_ms: 0,
            open_store_ms: 0,
            migrate_legacy_tool_keys_ms: 0,
            skill_count: 0,
            reindex_from_metadata_ms: None,
            restore_sync_included_ms: 0,
            restore_sync_included_changed: false,
            write_all_from_db_ms: None,
            apply_scenario_ms: 0,
            apply_scenario_kind: "unknown",
            total_ms: 0,
        }
    }
}

/// Full synchronous initialization — kept for the CLI bin and any caller that
/// needs the store fully ready (DB reindexed + scenario applied) before
/// proceeding. The Tauri GUI entry point now uses [`initialize_store_minimal`]
/// + [`run_reindex_if_needed`] so the window can come up immediately (the
/// expensive reindex previously blocked window creation for 40-100s).
pub fn initialize_store() -> Result<(Arc<SkillStore>, StartupTimings)> {
    initialize_store_inner(true)
}

pub fn initialize_cli_store() -> Result<Arc<SkillStore>> {
    initialize_store_inner(false).map(|(store, _)| store)
}

fn initialize_store_inner(
    apply_startup_default: bool,
) -> Result<(Arc<SkillStore>, StartupTimings)> {
    let total_start = Instant::now();
    let mut timings = StartupTimings::default();

    let step = Instant::now();
    central_repo::ensure_central_repo().context("Failed to create central repo")?;
    timings.ensure_central_repo_ms = step.elapsed().as_millis();

    let db_path = central_repo::db_path();
    let step = Instant::now();
    let store = Arc::new(SkillStore::new(&db_path).context("Failed to initialize database")?);
    timings.open_store_ms = step.elapsed().as_millis();

    let step = Instant::now();
    tool_service::migrate_legacy_tool_keys(&store)
        .map_err(|e| anyhow::anyhow!(e.to_string()))
        .context("Failed to migrate legacy tool keys")?;
    timings.migrate_legacy_tool_keys_ms = step.elapsed().as_millis();

    timings.skill_count = store.get_all_skills().map(|s| s.len()).unwrap_or(0);

    if sync_metadata::metadata_exists() {
        let step = Instant::now();
        sync_metadata::reindex_from_metadata(&store)
            .context("Failed to reindex from sync metadata")?;
        timings.reindex_from_metadata_ms = Some(step.elapsed().as_millis());
    }

    let step = Instant::now();
    let changed = scenario_service::restore_all_skills_sync_included(&store)
        .map_err(|e| anyhow::anyhow!(e.to_string()))
        .context("Failed to restore skill sync inclusion")?;
    timings.restore_sync_included_ms = step.elapsed().as_millis();
    timings.restore_sync_included_changed = changed;
    if changed {
        let step = Instant::now();
        sync_metadata::write_all_from_db(&store)
            .context("Failed to persist restored skill sync inclusion")?;
        timings.write_all_from_db_ms = Some(step.elapsed().as_millis());
    }

    let step = Instant::now();
    if apply_startup_default {
        scenario_service::ensure_default_startup_scenario(&store)
            .map_err(|e| anyhow::anyhow!(e.to_string()))
            .context("Failed to initialize startup scenario")?;
        timings.apply_scenario_kind = "default_startup";
    } else {
        scenario_service::ensure_cli_scenario_state(&store)
            .map_err(|e| anyhow::anyhow!(e.to_string()))
            .context("Failed to initialize CLI scenario state")?;
        timings.apply_scenario_kind = "cli";
    }
    timings.apply_scenario_ms = step.elapsed().as_millis();

    timings.total_ms = total_start.elapsed().as_millis();
    Ok((store, timings))
}

/// Minimal store initialization the main window needs to come up:
/// central repo + DB open + legacy tool-key migration. Deliberately excludes
/// the expensive sync-metadata reindex and scenario application so the window
/// (and, critically, the frontend's first IPC like `getSettings`) can respond
/// in well under a second. Those steps run afterwards in the background via
/// [`run_reindex_if_needed`] — see `lib.rs::run`.
///
/// Progress lines are stashed via [`record_early_progress`] because this still
/// runs before `tauri_plugin_log` is installed.
pub fn initialize_store_minimal() -> Result<Arc<SkillStore>> {
    let total_start = Instant::now();

    let step = Instant::now();
    central_repo::ensure_central_repo().context("Failed to create central repo")?;
    record_early_progress(format!(
        "early-startup: ensure_central_repo in {} ms",
        step.elapsed().as_millis()
    ));

    let db_path = central_repo::db_path();
    let step = Instant::now();
    let store = Arc::new(SkillStore::new(&db_path).context("Failed to initialize database")?);
    record_early_progress(format!(
        "early-startup: open_store in {} ms",
        step.elapsed().as_millis()
    ));

    let step = Instant::now();
    tool_service::migrate_legacy_tool_keys(&store)
        .map_err(|e| anyhow::anyhow!(e.to_string()))
        .context("Failed to migrate legacy tool keys")?;
    record_early_progress(format!(
        "early-startup: migrate_legacy_tool_keys in {} ms",
        step.elapsed().as_millis()
    ));

    let skill_count = store.get_all_skills().map(|s| s.len()).unwrap_or(0);
    record_early_progress(format!(
        "early-startup: minimal init total {} ms (skills in DB = {})",
        total_start.elapsed().as_millis(),
        skill_count
    ));

    Ok(store)
}

/// Outcome of [`run_reindex_if_needed`]: whether the reindex actually ran, so
/// the caller can decide whether to emit a refresh event to the frontend.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ReindexOutcome {
    /// The reindex ran and may have altered skill rows / tags / scenarios.
    Ran,
    /// No sync metadata exists, so there was nothing to reindex.
    SkippedNoMetadata,
}

/// Run the post-window startup work that previously blocked window creation:
/// reindex skills from sync metadata, restore sync-inclusion flags, and apply
/// the default startup scenario. Intended to run inside `spawn_blocking` from
/// `setup()` so the window is already up while this churns in the background.
///
/// Errors are stashed via [`record_early_progress`] and never propagated: a
/// background reindex failure must not crash an already-running app. The DB
/// simply retains its last-known-good state (the previous session's reindexed
/// result), so the frontend keeps working with slightly-stale data until the
/// next launch.
pub fn run_reindex_if_needed(store: &Arc<SkillStore>) -> ReindexOutcome {
    if !sync_metadata::metadata_exists() {
        record_early_progress("early-startup: no sync metadata, skipping reindex");
        return ReindexOutcome::SkippedNoMetadata;
    }

    let total = Instant::now();
    record_early_progress("early-startup: reindex_from_metadata starting");

    let step = Instant::now();
    match sync_metadata::reindex_from_metadata(store).context("Failed to reindex from sync metadata") {
        Ok(()) => record_early_progress(format!(
            "early-startup: reindex_from_metadata done in {} ms",
            step.elapsed().as_millis()
        )),
        Err(e) => {
            record_early_progress(format!(
                "early-startup: reindex_from_metadata FAILED in {} ms: {e:#}",
                step.elapsed().as_millis()
            ));
            return ReindexOutcome::Ran;
        }
    }

    let step = Instant::now();
    match scenario_service::restore_all_skills_sync_included(store)
        .map_err(|e| anyhow::anyhow!(e.to_string()))
        .context("Failed to restore skill sync inclusion")
    {
        Ok(changed) => {
            record_early_progress(format!(
                "early-startup: restore_sync_included in {} ms (changed={})",
                step.elapsed().as_millis(),
                changed
            ));
            if changed {
                if let Err(e) = sync_metadata::write_all_from_db(store) {
                    record_early_progress(format!(
                        "early-startup: write_all_from_db FAILED: {e:#}"
                    ));
                }
            }
        }
        Err(e) => record_early_progress(format!(
            "early-startup: restore_sync_included FAILED: {e:#}"
        )),
    }

    let step = Instant::now();
    match scenario_service::ensure_default_startup_scenario(store)
        .map_err(|e| anyhow::anyhow!(e.to_string()))
        .context("Failed to initialize startup scenario")
    {
        Ok(()) => record_early_progress(format!(
            "early-startup: apply_scenario (default_startup) in {} ms",
            step.elapsed().as_millis()
        )),
        Err(e) => record_early_progress(format!(
            "early-startup: apply_scenario FAILED: {e:#}"
        )),
    }

    record_early_progress(format!(
        "early-startup: run_reindex_if_needed total {} ms",
        total.elapsed().as_millis()
    ));

    ReindexOutcome::Ran
}

impl StartupTimings {
    /// Emit a single human-readable log block from the captured timings.
    /// Called from `tauri::Builder::setup` once `tauri_plugin_log` is
    /// installed; calling it before that point would lose the output to
    /// the no-op default logger.
    pub fn log(&self) {
        log::info!(
            "startup: initialize_store total {} ms (skills={})",
            self.total_ms,
            self.skill_count
        );
        log::info!(
            "startup: ensure_central_repo {} ms, open_store {} ms, migrate_legacy_tool_keys {} ms",
            self.ensure_central_repo_ms,
            self.open_store_ms,
            self.migrate_legacy_tool_keys_ms
        );
        if let Some(ms) = self.reindex_from_metadata_ms {
            log::info!(
                "startup: reindex_from_metadata {} ms (skills={})",
                ms,
                self.skill_count
            );
        }
        if self.restore_sync_included_changed {
            log::info!(
                "startup: restore_sync_included changed in {} ms, write_all_from_db {} ms",
                self.restore_sync_included_ms,
                self.write_all_from_db_ms.unwrap_or(0)
            );
        } else {
            log::info!(
                "startup: restore_sync_included no-op in {} ms",
                self.restore_sync_included_ms
            );
        }
        log::info!(
            "startup: apply_scenario ({}) {} ms (skills={})",
            self.apply_scenario_kind,
            self.apply_scenario_ms,
            self.skill_count
        );
    }
}
