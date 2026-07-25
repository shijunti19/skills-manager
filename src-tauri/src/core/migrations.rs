use anyhow::{bail, Context, Result};
use rusqlite::{params, Connection};

/// Current schema version. Bump this when adding a new migration.
const LATEST_VERSION: u32 = 9;

/// Run all pending migrations on the database.
///
/// - New databases: creates full schema and sets version to LATEST_VERSION.
/// - Existing databases (user_version == 0): runs incremental migrations
///   to bring them up to date.
/// - Databases newer than this app version: tolerated forward-compatibly.
///   The user may have run a newer build (e.g. a since-reverted feature
///   branch that already created tables). We run the idempotent "ensure"
///   passes below so any columns THIS version expects are present, then
///   proceed without bumping the version down. This avoids a hard failure
///   that would lock the user out of their data.
pub fn run_migrations(conn: &Connection) -> Result<()> {
    let current: u32 = conn.pragma_query_value(None, "user_version", |row| row.get(0))?;

    if current > LATEST_VERSION {
        log::warn!(
            "Database schema version ({current}) is newer than this app supports \
             ({LATEST_VERSION}). Running forward-compat ensure passes and continuing."
        );
        // Still run the ensure passes so any columns this version needs exist.
        run_ensure_passes(conn)?;
        return Ok(());
    }

    if current == LATEST_VERSION {
        return Ok(());
    }

    // Run each migration step in a transaction
    for version in current..LATEST_VERSION {
        conn.execute_batch("BEGIN EXCLUSIVE")?;
        match migrate_step(conn, version) {
            Ok(()) => {
                conn.pragma_update(None, "user_version", version + 1)?;
                conn.execute_batch("COMMIT")?;
            }
            Err(e) => {
                let _ = conn.execute_batch("ROLLBACK");
                return Err(e).with_context(|| {
                    format!("migration from version {version} to {} failed", version + 1)
                });
            }
        }
    }

    Ok(())
}

/// Execute a single migration step: version N → N+1.
fn migrate_step(conn: &Connection, from_version: u32) -> Result<()> {
    match from_version {
        0 => migrate_v0_to_v1(conn),
        1 => migrate_v1_to_v2(conn),
        2 => migrate_v2_to_v3(conn),
        3 => migrate_v3_to_v4(conn),
        4 => migrate_v4_to_v5(conn),
        5 => migrate_v5_to_v6(conn),
        6 => migrate_v6_to_v7(conn),
        7 => migrate_v7_to_v8(conn),
        8 => migrate_v8_to_v9(conn),
        _ => bail!("unknown migration version: {from_version}"),
    }
}

/// v0 → v1: Initial schema.
///
/// For new databases this creates all tables from scratch.
/// For existing pre-migration databases, the `CREATE TABLE IF NOT EXISTS`
/// statements are no-ops, and the `add_column_if_missing` calls handle
/// columns that were added incrementally before the migration system existed.
fn migrate_v0_to_v1(conn: &Connection) -> Result<()> {
    conn.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS skills (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            description TEXT,
            source_type TEXT NOT NULL,
            source_ref TEXT,
            source_ref_resolved TEXT,
            source_subpath TEXT,
            source_branch TEXT,
            source_revision TEXT,
            remote_revision TEXT,
            central_path TEXT NOT NULL UNIQUE,
            content_hash TEXT,
            enabled INTEGER DEFAULT 1,
            created_at INTEGER,
            updated_at INTEGER,
            status TEXT DEFAULT 'ok',
            update_status TEXT DEFAULT 'unknown',
            last_checked_at INTEGER,
            last_check_error TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_skills_name ON skills(name);

        CREATE TABLE IF NOT EXISTS skill_targets (
            id TEXT PRIMARY KEY,
            skill_id TEXT NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
            tool TEXT NOT NULL,
            target_path TEXT NOT NULL,
            mode TEXT NOT NULL,
            status TEXT DEFAULT 'ok',
            synced_at INTEGER,
            last_error TEXT,
            source_hash TEXT,
            UNIQUE(skill_id, tool)
        );

        CREATE TABLE IF NOT EXISTS discovered_skills (
            id TEXT PRIMARY KEY,
            tool TEXT NOT NULL,
            found_path TEXT NOT NULL,
            name_guess TEXT,
            fingerprint TEXT,
            found_at INTEGER NOT NULL,
            imported_skill_id TEXT REFERENCES skills(id) ON DELETE SET NULL
        );

        CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS skillssh_cache (
            cache_key TEXT PRIMARY KEY,
            data TEXT NOT NULL,
            fetched_at INTEGER
        );

        CREATE TABLE IF NOT EXISTS scenarios (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL UNIQUE,
            description TEXT,
            icon TEXT,
            sort_order INTEGER DEFAULT 0,
            created_at INTEGER,
            updated_at INTEGER
        );

        CREATE TABLE IF NOT EXISTS scenario_skills (
            scenario_id TEXT NOT NULL REFERENCES scenarios(id) ON DELETE CASCADE,
            skill_id TEXT NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
            added_at INTEGER,
            PRIMARY KEY(scenario_id, skill_id)
        );

        CREATE TABLE IF NOT EXISTS scenario_skill_tools (
            scenario_id TEXT NOT NULL REFERENCES scenarios(id) ON DELETE CASCADE,
            skill_id TEXT NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
            tool TEXT NOT NULL,
            enabled INTEGER NOT NULL DEFAULT 1,
            updated_at INTEGER NOT NULL,
            PRIMARY KEY(scenario_id, skill_id, tool)
        );

        CREATE TABLE IF NOT EXISTS active_scenario (
            key TEXT PRIMARY KEY DEFAULT 'current',
            scenario_id TEXT REFERENCES scenarios(id) ON DELETE SET NULL
        );

        CREATE TABLE IF NOT EXISTS projects (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            path TEXT NOT NULL UNIQUE,
            workspace_type TEXT NOT NULL DEFAULT 'project',
            linked_agent_key TEXT,
            linked_agent_name TEXT,
            disabled_path TEXT,
            sort_order INTEGER DEFAULT 0,
            created_at INTEGER,
            updated_at INTEGER
        );

        CREATE TABLE IF NOT EXISTS skill_tags (
            skill_id TEXT NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
            tag TEXT NOT NULL,
            PRIMARY KEY(skill_id, tag)
        );
        CREATE INDEX IF NOT EXISTS idx_skill_tags_tag ON skill_tags(tag);
        ",
    )?;

    // For pre-migration databases: add columns that didn't exist in the original schema.
    // For new databases these are already in the CREATE TABLE, so the calls are no-ops.
    add_column_if_missing(conn, "scenarios", "icon", "TEXT")?;
    add_column_if_missing(conn, "skills", "source_ref_resolved", "TEXT")?;
    add_column_if_missing(conn, "skills", "source_subpath", "TEXT")?;
    add_column_if_missing(conn, "skills", "source_branch", "TEXT")?;
    add_column_if_missing(conn, "skills", "remote_revision", "TEXT")?;
    add_column_if_missing(conn, "skills", "update_status", "TEXT DEFAULT 'unknown'")?;
    add_column_if_missing(conn, "skills", "last_checked_at", "INTEGER")?;
    add_column_if_missing(conn, "skills", "last_check_error", "TEXT")?;

    Ok(())
}

/// v1 → v2: Add per-scenario, per-skill tool toggle table.
fn migrate_v1_to_v2(conn: &Connection) -> Result<()> {
    conn.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS scenario_skill_tools (
            scenario_id TEXT NOT NULL REFERENCES scenarios(id) ON DELETE CASCADE,
            skill_id TEXT NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
            tool TEXT NOT NULL,
            enabled INTEGER NOT NULL DEFAULT 1,
            updated_at INTEGER NOT NULL,
            PRIMARY KEY(scenario_id, skill_id, tool)
        );
        ",
    )?;
    Ok(())
}

/// v2 → v3: Add sort_order to scenario_skills for drag-and-drop reordering.
fn migrate_v2_to_v3(conn: &Connection) -> Result<()> {
    add_column_if_missing(conn, "scenario_skills", "sort_order", "INTEGER DEFAULT 0")?;
    Ok(())
}

/// v3 → v4: Expand projects into generic workspace records.
fn migrate_v3_to_v4(conn: &Connection) -> Result<()> {
    conn.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS projects (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            path TEXT NOT NULL UNIQUE,
            workspace_type TEXT NOT NULL DEFAULT 'project',
            linked_agent_key TEXT,
            linked_agent_name TEXT,
            disabled_path TEXT,
            sort_order INTEGER DEFAULT 0,
            created_at INTEGER,
            updated_at INTEGER
        );
        ",
    )?;
    add_column_if_missing(
        conn,
        "projects",
        "workspace_type",
        "TEXT NOT NULL DEFAULT 'project'",
    )?;
    add_column_if_missing(conn, "projects", "linked_agent_key", "TEXT")?;
    add_column_if_missing(conn, "projects", "linked_agent_name", "TEXT")?;
    add_column_if_missing(conn, "projects", "disabled_path", "TEXT")?;
    Ok(())
}

/// v4 → v5: Add audit log table — append-only history of user/system actions.
fn migrate_v4_to_v5(conn: &Connection) -> Result<()> {
    conn.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS audit_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            ts INTEGER NOT NULL,
            action TEXT NOT NULL,
            skill_id TEXT,
            skill_name TEXT,
            tool TEXT,
            success INTEGER NOT NULL,
            detail TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_audit_log_ts ON audit_log(ts);
        ",
    )?;
    Ok(())
}

/// v5 → v6: Add `source_hash` to `skill_targets`. Lets the sync engine
/// skip a Copy-mode resync when the central skill content has not
/// changed since the last successful sync, avoiding the per-startup
/// recursive copy that pinned Windows users on issue #153.
///
/// Existing rows get NULL, which is treated as "no recorded hash" and
/// forces one copy on the first post-upgrade sync. No backfill needed.
fn migrate_v5_to_v6(conn: &Connection) -> Result<()> {
    add_column_if_missing(conn, "skill_targets", "source_hash", "TEXT")?;
    Ok(())
}

/// v6 → v7: pending-conflict projection for the object merge engine
/// (merge-engine design §4). A local UI cache only — the source of truth is
/// the commit trailers plus `refs/skills-manager/conflict/*`, from which
/// this table is rebuilt at startup and after every merge.
fn migrate_v6_to_v7(conn: &Connection) -> Result<()> {
    conn.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS pending_conflicts (
            skill_id TEXT PRIMARY KEY,
            theirs_commit TEXT NOT NULL,
            theirs_path TEXT,
            detected_at INTEGER NOT NULL
        );
        ",
    )?;
    Ok(())
}

/// v7 → v8: Smart Tag system (multi-tag classification + per-tag prompt).
///
/// `smart_tags` stores named tag groups (e.g. "⚙️ Rust 系统开发") with an
/// optional `prompt` that is appended when generating a combined prompt.
/// `agents` is a JSON array (kept as TEXT) — empty array means the tag is
/// global (shown on every agent page). `skill_smart_tag_relations` is the
/// many-to-many join between skills and smart tags.
///
/// Uses `IF NOT EXISTS` + `add_column_if_missing` so it is safe to run on a
/// database that a previous (since-reverted) build already created these
/// tables in — it only adds any missing columns (notably `sort_order`).
fn migrate_v7_to_v8(conn: &Connection) -> Result<()> {
    conn.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS smart_tags (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL UNIQUE,
            agents TEXT NOT NULL DEFAULT '[]',
            description TEXT,
            prompt TEXT,
            sort_order INTEGER NOT NULL DEFAULT 0,
            created_at INTEGER,
            updated_at INTEGER
        );

        CREATE TABLE IF NOT EXISTS skill_smart_tag_relations (
            skill_id TEXT NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
            smart_tag_id TEXT NOT NULL REFERENCES smart_tags(id) ON DELETE CASCADE,
            PRIMARY KEY(skill_id, smart_tag_id)
        );
        CREATE INDEX IF NOT EXISTS idx_smart_tag_relations_tag
            ON skill_smart_tag_relations(smart_tag_id);
        ",
    )?;
    // Forward-compat: a pre-existing smart_tags table (from a newer build)
    // may lack `sort_order` and these columns. add_column_if_missing is a
    // no-op when the column already exists.
    add_column_if_missing(
        conn,
        "smart_tags",
        "sort_order",
        "INTEGER NOT NULL DEFAULT 0",
    )?;
    add_column_if_missing(conn, "smart_tags", "description", "TEXT")?;
    add_column_if_missing(conn, "smart_tags", "prompt", "TEXT")?;
    add_column_if_missing(conn, "smart_tags", "agents", "TEXT NOT NULL DEFAULT '[]'")?;
    Ok(())
}

/// v8 → v9: Normalize `skill_smart_tag_relations` to the 2-column schema
/// (skill_id, smart_tag_id) that this fork's migrations.rs declared in v7→v8.
///
/// Background: a since-reverted intermediate build created the table with an
/// extra `created_at INTEGER NOT NULL` column. Databases from that build
/// (including any produced by users who ran it) violate the 2-column INSERT
/// that all the read/write helpers in skill_store.rs use, so every
/// `INSERT OR IGNORE INTO skill_smart_tag_relations (skill_id, smart_tag_id)
/// VALUES (?, ?)` silently failed with NOT NULL constraint violation —
/// surfaced as "smart tag bindings never persist after refresh" in the UI.
///
/// This migration rebuilds the table with exactly the two columns the code
/// expects, preserving all existing (skill_id, smart_tag_id) pairs. Safe to
/// run on a 2-column table (it's a no-op detected via has_column).
fn migrate_v8_to_v9(conn: &Connection) -> Result<()> {
    normalize_smart_tag_relations_schema(conn)
}

/// Rebuild `skill_smart_tag_relations` to the 2-column schema if it has a
/// `created_at` column (or any extra column). Idempotent: a table already on
/// the 2-column schema is left untouched. Used both by the v8→v9 migration
/// and by `run_ensure_passes` (to repair databases whose user_version is
/// already > LATEST_VERSION and thus skip the normal migration chain).
fn normalize_smart_tag_relations_schema(conn: &Connection) -> Result<()> {
    if !has_table(conn, "skill_smart_tag_relations")? {
        return Ok(());
    }
    // Only rebuild when the table has MORE than the expected (skill_id,
    // smart_tag_id) columns. A 2-column table is already canonical.
    let mut stmt = conn.prepare("PRAGMA table_info(skill_smart_tag_relations)")?;
    let column_count: usize = stmt.query_map([], |_| Ok(()))?.count();
    if column_count <= 2 {
        return Ok(());
    }
    log::info!(
        "normalizing skill_smart_tag_relations: rebuilding {}-column table to canonical 2-column schema",
        column_count
    );
    conn.execute_batch(
        "
        BEGIN;
        CREATE TABLE skill_smart_tag_relations_new (
            skill_id TEXT NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
            smart_tag_id TEXT NOT NULL REFERENCES smart_tags(id) ON DELETE CASCADE,
            PRIMARY KEY(skill_id, smart_tag_id)
        );
        INSERT OR IGNORE INTO skill_smart_tag_relations_new (skill_id, smart_tag_id)
            SELECT skill_id, smart_tag_id FROM skill_smart_tag_relations;
        DROP TABLE skill_smart_tag_relations;
        ALTER TABLE skill_smart_tag_relations_new RENAME TO skill_smart_tag_relations;
        CREATE INDEX IF NOT EXISTS idx_skill_smart_tag_relations_skill_id
            ON skill_smart_tag_relations(skill_id);
        CREATE INDEX IF NOT EXISTS idx_skill_smart_tag_relations_smart_tag_id
            ON skill_smart_tag_relations(smart_tag_id);
        COMMIT;
        ",
    )?;
    Ok(())
}

/// Idempotent "ensure" passes for databases that come from a newer app
/// version (current > LATEST_VERSION). Makes sure every column THIS version's
/// code reads/writes exists, without touching the schema version number.
fn run_ensure_passes(conn: &Connection) -> Result<()> {
    // Ensure the smart_tags table family exists with our expected columns.
    if has_table(conn, "smart_tags")? {
        add_column_if_missing(
            conn,
            "smart_tags",
            "sort_order",
            "INTEGER NOT NULL DEFAULT 0",
        )?;
        add_column_if_missing(conn, "smart_tags", "description", "TEXT")?;
        add_column_if_missing(conn, "smart_tags", "prompt", "TEXT")?;
        add_column_if_missing(conn, "smart_tags", "agents", "TEXT NOT NULL DEFAULT '[]'")?;
    }
    // Repair any `skill_smart_tag_relations` table that came from a newer
    // (since-reverted) build with an extra `created_at NOT NULL` column: our
    // 2-column INSERTs would otherwise silently fail with NOT NULL constraint
    // violations masked by INSERT OR IGNORE. Idempotent — no-op on the
    // canonical 2-column schema.
    normalize_smart_tag_relations_schema(conn)?;
    Ok(())
}

// ── Helpers ──

fn add_column_if_missing(
    conn: &Connection,
    table: &str,
    column: &str,
    definition: &str,
) -> Result<()> {
    // Validate identifiers to prevent SQL injection if call sites ever change.
    validate_identifier(table)?;
    validate_identifier(column)?;

    if !has_column(conn, table, column)? {
        conn.execute(
            &format!("ALTER TABLE {table} ADD COLUMN {column} {definition}"),
            [],
        )?;
    }
    Ok(())
}

fn validate_identifier(name: &str) -> Result<()> {
    if name.is_empty() || !name.chars().all(|c| c.is_ascii_alphanumeric() || c == '_') {
        anyhow::bail!("Invalid SQL identifier: {}", name);
    }
    Ok(())
}

fn has_column(conn: &Connection, table: &str, column: &str) -> Result<bool> {
    let mut stmt = conn.prepare(&format!("PRAGMA table_info({table})"))?;
    let columns: Vec<String> = stmt
        .query_map([], |row| row.get::<_, String>(1))?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(columns.iter().any(|name| name == column))
}

fn has_table(conn: &Connection, table: &str) -> Result<bool> {
    validate_identifier(table)?;
    let mut stmt = conn.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name = ?1")?;
    Ok(stmt.exists(params![table])?)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_fresh_database_migrates_to_latest() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("PRAGMA foreign_keys=ON;").unwrap();

        run_migrations(&conn).unwrap();

        let version: u32 = conn
            .pragma_query_value(None, "user_version", |row| row.get(0))
            .unwrap();
        assert_eq!(version, LATEST_VERSION);

        // Verify tables exist
        let tables: Vec<String> = conn
            .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
            .unwrap()
            .query_map([], |row| row.get(0))
            .unwrap()
            .filter_map(|r| r.ok())
            .collect();

        assert!(tables.contains(&"skills".to_string()));
        assert!(tables.contains(&"skill_targets".to_string()));
        assert!(tables.contains(&"scenarios".to_string()));
        assert!(tables.contains(&"projects".to_string()));
        assert!(tables.contains(&"skill_tags".to_string()));
        assert!(tables.contains(&"scenario_skill_tools".to_string()));
        assert!(tables.contains(&"audit_log".to_string()));
    }

    #[test]
    fn test_idempotent_migration() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("PRAGMA foreign_keys=ON;").unwrap();

        run_migrations(&conn).unwrap();
        // Running again should be a no-op
        run_migrations(&conn).unwrap();

        let version: u32 = conn
            .pragma_query_value(None, "user_version", |row| row.get(0))
            .unwrap();
        assert_eq!(version, LATEST_VERSION);
    }

    #[test]
    fn test_pre_migration_database_upgrades() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("PRAGMA foreign_keys=ON;").unwrap();

        // Simulate a pre-migration database: create skills table without newer columns
        conn.execute_batch(
            "
            CREATE TABLE skills (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                description TEXT,
                source_type TEXT NOT NULL,
                source_ref TEXT,
                source_revision TEXT,
                central_path TEXT NOT NULL UNIQUE,
                content_hash TEXT,
                enabled INTEGER DEFAULT 1,
                created_at INTEGER,
                updated_at INTEGER,
                status TEXT DEFAULT 'ok'
            );
            CREATE TABLE scenarios (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL UNIQUE,
                description TEXT,
                sort_order INTEGER DEFAULT 0,
                created_at INTEGER,
                updated_at INTEGER
            );
            ",
        )
        .unwrap();

        // user_version is 0 (default), so migration should run
        run_migrations(&conn).unwrap();

        // Verify new columns were added
        assert!(has_column(&conn, "skills", "source_ref_resolved").unwrap());
        assert!(has_column(&conn, "skills", "source_subpath").unwrap());
        assert!(has_column(&conn, "skills", "source_branch").unwrap());
        assert!(has_column(&conn, "skills", "remote_revision").unwrap());
        assert!(has_column(&conn, "skills", "update_status").unwrap());
        assert!(has_column(&conn, "skills", "last_checked_at").unwrap());
        assert!(has_column(&conn, "skills", "last_check_error").unwrap());
        assert!(has_column(&conn, "scenarios", "icon").unwrap());

        let version: u32 = conn
            .pragma_query_value(None, "user_version", |row| row.get(0))
            .unwrap();
        assert_eq!(version, LATEST_VERSION);
    }

    #[test]
    fn test_v1_database_upgrades_to_v2() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("PRAGMA foreign_keys=ON;").unwrap();

        conn.execute_batch(
            "
            CREATE TABLE skills (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                description TEXT,
                source_type TEXT NOT NULL,
                source_ref TEXT,
                source_ref_resolved TEXT,
                source_subpath TEXT,
                source_branch TEXT,
                source_revision TEXT,
                remote_revision TEXT,
                central_path TEXT NOT NULL UNIQUE,
                content_hash TEXT,
                enabled INTEGER DEFAULT 1,
                created_at INTEGER,
                updated_at INTEGER,
                status TEXT DEFAULT 'ok',
                update_status TEXT DEFAULT 'unknown',
                last_checked_at INTEGER,
                last_check_error TEXT
            );
            CREATE TABLE scenarios (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL UNIQUE,
                description TEXT,
                icon TEXT,
                sort_order INTEGER DEFAULT 0,
                created_at INTEGER,
                updated_at INTEGER
            );
            CREATE TABLE scenario_skills (
                scenario_id TEXT NOT NULL REFERENCES scenarios(id) ON DELETE CASCADE,
                skill_id TEXT NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
                added_at INTEGER,
                PRIMARY KEY(scenario_id, skill_id)
            );
            CREATE TABLE skill_targets (
                id TEXT PRIMARY KEY,
                skill_id TEXT NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
                tool TEXT NOT NULL,
                target_path TEXT NOT NULL,
                mode TEXT NOT NULL,
                status TEXT DEFAULT 'ok',
                synced_at INTEGER,
                last_error TEXT,
                UNIQUE(skill_id, tool)
            );
            PRAGMA user_version = 1;
            ",
        )
        .unwrap();

        run_migrations(&conn).unwrap();
        assert!(has_column(&conn, "scenario_skill_tools", "enabled").unwrap());
        assert!(has_column(&conn, "skill_targets", "source_hash").unwrap());

        let version: u32 = conn
            .pragma_query_value(None, "user_version", |row| row.get(0))
            .unwrap();
        assert_eq!(version, LATEST_VERSION);
    }

    #[test]
    fn test_newer_schema_forward_compat() {
        // Forward-compat: a newer-schema DB is NOT hard-rejected — that would
        // lock the user out of their data after a downgrade. The app runs the
        // idempotent "ensure" passes so every column THIS version expects
        // exists, then returns Ok and logs a warning. The runtime code path
        // that surfaces the version gap to the user is the warning log; the
        // test pins both halves of the contract (no error, AND an ensure pass
        // actually ran — if ensure is skipped, the column check below fails).
        let conn = Connection::open_in_memory().unwrap();
        // Seed a newer-schema `smart_tags` table WITHOUT the `prompt` and
        // `agents` columns this version's ensure pass expects to add. If
        // run_migrations skips ensure, the column checks below fail.
        conn.execute_batch(
            "CREATE TABLE smart_tags (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL UNIQUE,
                description TEXT,
                icon TEXT,
                sort_order INTEGER DEFAULT 0,
                created_at INTEGER,
                updated_at INTEGER
            );",
        )
        .unwrap();
        conn.pragma_update(None, "user_version", LATEST_VERSION + 1)
            .unwrap();

        // Must succeed (no Err) on a forward-compat DB.
        run_migrations(&conn).unwrap();

        // ensure pass must have run: smart_tags gained the `prompt` and
        // `agents` columns this version expects.
        assert!(
            has_column(&conn, "smart_tags", "prompt").unwrap(),
            "forward-compat path should still run ensure passes (prompt)"
        );
        assert!(
            has_column(&conn, "smart_tags", "agents").unwrap(),
            "forward-compat path should still run ensure passes (agents)"
        );
        // Version is left alone (we never downgrade user_version).
        let version: u32 = conn
            .pragma_query_value(None, "user_version", |row| row.get(0))
            .unwrap();
        assert_eq!(version, LATEST_VERSION + 1);
    }
}
