---
type: folder
node_type: file
grid_w: 20
grid_h: 16
canvas_points: "[[0.5,0,1,0,-1],[0.5,1,1,0,1],[0,0.5,1,-1,0],[1,0.5,1,1,0]]"
---
# core
## 描述
**audit_log.rs**：! Append-only audit log of user/system actions.
!
! Stored in the existing SQLite database (table `audit_log`). Writes are
! best-effort: failures are swallowed so they never block the user action
! they accompany. Reads return newest-first.
!
! The log is auto-pruned to `MAX_ENTRIES` rows on each write so the table
! cannot grow unbounded.

**auto_backup.rs**：! Automatic backup (§3.4): after central-repo changes settle for a couple of
! minutes, commit and push in the background — no snapshot tag (tags are
! reserved for user-visible backup points).
!
! With the object merge engine (merge-engine design §9 3d-γ) a round that
! finds the remote ahead also merges it and pushes, so two devices converge
! hands-free. The one deliberate exception (§4 收窄阻尼): while a remote
! change touches a skill that is pending a local conflict decision, the
! round backs off and waits for a manual sync — unrelated updates keep
! flowing. With the `merge_engine=system` escape hatch the old behavior
! (wait for manual sync whenever the remote is ahead) is kept.

**git2_engine.rs**：! git2-based network engine for the backup remote (backup redesign §3.3,
! Phase 2 pilot).
!
! Scope is deliberately narrow: only the four network operations (fetch,
! push, ls-remote, clone) against http(s) remotes go through libgit2, with
! credentials injected in-memory from the OS keychain. All local operations
! (commit, tag, status, merge, read-tree) stay on system git, and SSH /
! custom remotes always use system git. Opt-in via the `git_backup_engine`
! setting ("git2"); default is the system git engine.
!
! Error normalization matters here: the frontend maps error text produced
! by system git ("Authentication failed", "Could not resolve host",
! "non-fast-forward", …) to plain-language copy. libgit2 phrases the same
! failures differently, so every error leaving this module is prefixed with
! the equivalent system-git marker.

**git_credentials.rs**：! Credential handling for the git backup remote.
!
! Policy (backup redesign §3.7): tokens must never live in URLs on disk
! (`.git/config`, SQLite settings). Credentials embedded in a remote URL are
! extracted into the OS keychain and injected into git at call time through
! a static askpass script that only echoes environment variables.

**github_api.rs**：! Minimal GitHub REST client for the guided backup setup (backup redesign
! Phase 2, PAT mode): validate a token, then find or create the private
! backup repository. The token itself never appears in URLs, logs, or error
! messages — callers store it in the OS keychain.
!
! Errors carry stable prefixes (`GITHUB_TOKEN_INVALID`, `GITHUB_SCOPE`,
! `GITHUB_NETWORK`) the frontend maps to plain-language copy.

**path_guard.rs**：! Centralized path safety helpers.
!
! `sanitize_name` strips characters that are unsafe as filesystem names,
! collapses dot sequences, and caps length — use for any caller-supplied
! skill/directory name before joining it to a base path.
!
! `is_path_safe` canonicalizes both inputs and verifies the target stays
! inside the base directory. Call before any write/delete/copy that
! consumes a path derived from untrusted input.


## 父节点
- [← 返回](@/map/src-tauri/src/main.md)

## 子节点
- [merge](@/map/src-tauri/src/core/merge/main.md)

## 子文件
- [app_state.rs](${ProjectRoot}/src-tauri/src/core/app_state.rs)
- [audit_log.rs](${ProjectRoot}/src-tauri/src/core/audit_log.rs)
- [auto_backup.rs](${ProjectRoot}/src-tauri/src/core/auto_backup.rs)
- [central_repo.rs](${ProjectRoot}/src-tauri/src/core/central_repo.rs)
- [content_hash.rs](${ProjectRoot}/src-tauri/src/core/content_hash.rs)
- [crypto.rs](${ProjectRoot}/src-tauri/src/core/crypto.rs)
- [error.rs](${ProjectRoot}/src-tauri/src/core/error.rs)
- [file_watcher.rs](${ProjectRoot}/src-tauri/src/core/file_watcher.rs)
- [git2_engine.rs](${ProjectRoot}/src-tauri/src/core/git2_engine.rs)
- [git_backup.rs](${ProjectRoot}/src-tauri/src/core/git_backup.rs)
- [git_credentials.rs](${ProjectRoot}/src-tauri/src/core/git_credentials.rs)
- [git_fetcher.rs](${ProjectRoot}/src-tauri/src/core/git_fetcher.rs)
- [github_api.rs](${ProjectRoot}/src-tauri/src/core/github_api.rs)
- [install_cancel.rs](${ProjectRoot}/src-tauri/src/core/install_cancel.rs)
- [installer.rs](${ProjectRoot}/src-tauri/src/core/installer.rs)
- [log_sanitize.rs](${ProjectRoot}/src-tauri/src/core/log_sanitize.rs)
- [migrations.rs](${ProjectRoot}/src-tauri/src/core/migrations.rs)
- [mod.rs](${ProjectRoot}/src-tauri/src/core/mod.rs)
- [panic_log.rs](${ProjectRoot}/src-tauri/src/core/panic_log.rs)
- [path_guard.rs](${ProjectRoot}/src-tauri/src/core/path_guard.rs)
- [project_scanner.rs](${ProjectRoot}/src-tauri/src/core/project_scanner.rs)
- [repo_lock.rs](${ProjectRoot}/src-tauri/src/core/repo_lock.rs)
- [scanner.rs](${ProjectRoot}/src-tauri/src/core/scanner.rs)
- [scenario_service.rs](${ProjectRoot}/src-tauri/src/core/scenario_service.rs)
- [skill_auto_updater.rs](${ProjectRoot}/src-tauri/src/core/skill_auto_updater.rs)
- [skill_metadata.rs](${ProjectRoot}/src-tauri/src/core/skill_metadata.rs)
- [skill_store.rs](${ProjectRoot}/src-tauri/src/core/skill_store.rs)
- [skillssh_api.rs](${ProjectRoot}/src-tauri/src/core/skillssh_api.rs)
- [sync_engine.rs](${ProjectRoot}/src-tauri/src/core/sync_engine.rs)
- [sync_metadata.rs](${ProjectRoot}/src-tauri/src/core/sync_metadata.rs)
- [timing.rs](${ProjectRoot}/src-tauri/src/core/timing.rs)
- [tool_adapters.rs](${ProjectRoot}/src-tauri/src/core/tool_adapters.rs)
- [tool_service.rs](${ProjectRoot}/src-tauri/src/core/tool_service.rs)

## 子文件描述
- [app_state.rs]
- [audit_log.rs]
  ! Append-only audit log of user/system actions.
  !
  ! Stored in the existing SQLite database (table `audit_log`). Writes are
  ! best-effort: failures are swallowed so they never block the user action
  ! they accompany. Reads return newest-first.
  !
  ! The log is auto-pruned to `MAX_ENTRIES` rows on each write so the table
  ! cannot grow unbounded.
- [auto_backup.rs]
  ! Automatic backup (§3.4): after central-repo changes settle for a couple of
  ! minutes, commit and push in the background — no snapshot tag (tags are
  ! reserved for user-visible backup points).
  !
  ! With the object merge engine (merge-engine design §9 3d-γ) a round that
  ! finds the remote ahead also merges it and pushes, so two devices converge
  ! hands-free. The one deliberate exception (§4 收窄阻尼): while a remote
  ! change touches a skill that is pending a local conflict decision, the
  ! round backs off and waits for a manual sync — unrelated updates keep
  ! flowing. With the `merge_engine=system` escape hatch the old behavior
  ! (wait for manual sync whenever the remote is ahead) is kept.
- [central_repo.rs]
- [content_hash.rs]
- [crypto.rs]
- [error.rs]
- [file_watcher.rs]
- [git2_engine.rs]
  ! git2-based network engine for the backup remote (backup redesign §3.3,
  ! Phase 2 pilot).
  !
  ! Scope is deliberately narrow: only the four network operations (fetch,
  ! push, ls-remote, clone) against http(s) remotes go through libgit2, with
  ! credentials injected in-memory from the OS keychain. All local operations
  ! (commit, tag, status, merge, read-tree) stay on system git, and SSH /
  ! custom remotes always use system git. Opt-in via the `git_backup_engine`
  ! setting ("git2"); default is the system git engine.
  !
  ! Error normalization matters here: the frontend maps error text produced
  ! by system git ("Authentication failed", "Could not resolve host",
  ! "non-fast-forward", …) to plain-language copy. libgit2 phrases the same
  ! failures differently, so every error leaving this module is prefixed with
  ! the equivalent system-git marker.
- [git_backup.rs]
- [git_credentials.rs]
  ! Credential handling for the git backup remote.
  !
  ! Policy (backup redesign §3.7): tokens must never live in URLs on disk
  ! (`.git/config`, SQLite settings). Credentials embedded in a remote URL are
  ! extracted into the OS keychain and injected into git at call time through
  ! a static askpass script that only echoes environment variables.
- [git_fetcher.rs]
- [github_api.rs]
  ! Minimal GitHub REST client for the guided backup setup (backup redesign
  ! Phase 2, PAT mode): validate a token, then find or create the private
  ! backup repository. The token itself never appears in URLs, logs, or error
  ! messages — callers store it in the OS keychain.
  !
  ! Errors carry stable prefixes (`GITHUB_TOKEN_INVALID`, `GITHUB_SCOPE`,
  ! `GITHUB_NETWORK`) the frontend maps to plain-language copy.
- [install_cancel.rs]
- [installer.rs]
- [log_sanitize.rs]
- [migrations.rs]
- [mod.rs]
- [panic_log.rs]
- [path_guard.rs]
  ! Centralized path safety helpers.
  !
  ! `sanitize_name` strips characters that are unsafe as filesystem names,
  ! collapses dot sequences, and caps length — use for any caller-supplied
  ! skill/directory name before joining it to a base path.
  !
  ! `is_path_safe` canonicalizes both inputs and verifies the target stays
  ! inside the base directory. Call before any write/delete/copy that
  ! consumes a path derived from untrusted input.
- [project_scanner.rs]
- [repo_lock.rs]
- [scanner.rs]
- [scenario_service.rs]
- [skill_auto_updater.rs]
- [skill_metadata.rs]
- [skill_store.rs]
- [skillssh_api.rs]
- [sync_engine.rs]
- [sync_metadata.rs]
- [timing.rs]
- [tool_adapters.rs]
- [tool_service.rs]

## 实际路径
- X:\xiaolu\ai\plugin\skills-manager/src-tauri/src/core

## 节点关联
- @/map/src-tauri/src/core/merge/main.md
  animation: none
