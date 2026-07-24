# 修复 skills-manager 启动卡死 42~100 秒 + 日志盲区

## 根因（已用日志坐实）

不是崩溃，是卡死 + 日志盲区：
1. `reindex_from_metadata`（`src-tauri/src/core/sync_metadata.rs:108-225`）对 182 个 skill 逐个 `hash_directory` 全量读文件算 SHA256（`content_hash.rs:110-111`，无缓存），外加 364 次无外层事务的 autocommit DB 写（`upsert_skill` + `set_tags_for_skill`）。冷启动实测 42~102 秒。
2. 这步跑在 `tauri::Builder` 之前（`lib.rs:774` 的 `initialize_store()`），**阻塞主窗口创建**——窗口几十秒不出现，被系统/用户当"无响应"杀掉。
3. `tauri_plugin_log` 和 panic hook 都装在 Builder 之后的 `setup()` 里（`lib.rs:799-822`），而卡死发生在它们之前。所以盲区里卡死/出错**天然没有任何记录**——这正是"查不出原因"的根因。日志里没有 `last_panic.log` 也印证了它不是 panic 退出。

## 修复方案（4 项，按优先级）

### 修复 1：panic hook + 早期日志前移到 `run()` 第一行（解决"查不出原因"）

让 40~100 秒的盲区可见。下次再卡，立刻能在日志里看到卡在哪一步。

- **改 `src-tauri/src/core/panic_log.rs`**：去掉 `install_panic_hook` 对 `AppHandle` 的依赖。内部用 `dirs::data_local_dir().unwrap().join("com.agentskills.desktop").join("logs")`（identifier 见 `tauri.conf.json:5`，与 Tauri `app_log_dir()` 在 Windows 上等价，已有 `dirs` 依赖见 `Cargo.toml:33`）算出日志目录并塞进 `LOG_DIR`。核心 `panic::set_hook` 逻辑不变。
- `last_panic_path` 保留现有签名（被 `settings.rs` 的 `check_last_panic` 调用），它的 `LOG_DIR.get()` fallback 在 hook 装好后即生效。
- **改 `src-tauri/src/lib.rs:772`**：在 `run()` 第一行（`pre_builder_start` 之前）调用 `core::panic_log::install_panic_hook();`。这样 panic hook 覆盖整个 `initialize_store()` 全程。
- **复用 stash 模式做早期进度日志**：参照 `central_repo.rs:14/40-57` 的 `STARTUP_ERROR_LOG`（`OnceLock<Mutex<Vec<String>>>` + `take_startup_errors`），在 `app_state.rs` 给 `initialize_store_inner` 的每个阶段（`ensure_central_repo`、`open_store`、`reindex_from_metadata` 各子步骤）写入"开始/耗时"条目，在 `lib.rs:834`（`startup_timings.log()` 旁）统一 flush。这样即使卡死在 reindex 中途，日志里也能看到"reindex 处理到第 N 个 skill"。与项目既有风格（`StartupTimings`、`take_startup_errors`）完全一致，零新依赖。

### 修复 2：reindex 后台化（解决"窗口卡几十秒不显示"）

照搬 `lib.rs:843-862` 的 `backfill_stranded_agent_targets` 后台化先例（issue #248）。

- **改 `src-tauri/src/core/app_state.rs`**：把 `initialize_store_inner` 拆成两段：
  - `initialize_store_minimal()`：只做窗口启动必需的 `ensure_central_repo` + `SkillStore::new` + `migrate_legacy_tool_keys`（实测合计 <100ms）。返回 `(Arc<SkillStore>, StartupTimings)`。
  - `run_reindex_if_needed(store)`：封装现有的 `reindex_from_metadata` + `restore_all_skills_sync_included` + `apply_scenario`（这几步只在"外部设备写入了新 metadata"时才真正改变 DB；warm start 下基本 no-op）。
- **改 `src-tauri/src/lib.rs:774`**：`run()` 里只调 `initialize_store_minimal()`，拿到 store 立即进入 Builder → setup → 创建窗口。窗口秒开。
- **在 `lib.rs` 的 `.setup()` 内**（紧邻现有 `spawn_blocking` 块，约 `lib.rs:851` 旁）加一个 `tauri::async_runtime::spawn_blocking` 跑 `run_reindex_if_needed(store)`。完成后 emit 一个 Tauri event（如 `app-files-changed` 或新增 `skills-reindexed`），前端 `AppContext.tsx` 已有事件监听路径（`AppContext.tsx:296/311/350`）会自动触发 `refreshManagedSkills` 刷新。
- **前端零改动**：warm start 下 DB 已有上次的数据，前端首次 `get_managed_skills` 直接拿现有数据，几乎总是正确；只有"首次冷启动空 DB"或"外部刚 sync"才需等后台 reindex 完后的事件刷新。前端本就支持 loading 态（`WorkspaceView.tsx:1003`）。

### 修复 3：reindex 批量化事务（降低后台 reindex 实际耗时）

消除 364 次 autocommit fsync。

- **改 `src-tauri/src/core/skill_store.rs`**：新增接受 `&rusqlite::Transaction` 的 `upsert_skill_tx` / `set_tags_for_skill_tx`（参考 `skill_store.rs:1310` `rename_tag` 已有的 `unchecked_transaction` 写法）。
- **改 `sync_metadata.rs:115` `reindex_from_metadata_unlocked`**：在 `for meta in skills` 循环外开一个 `store.unchecked_transaction()?`，循环内调用 `_tx` 版本，循环结束统一 commit。预计把 DB 写部分从数十秒降到亚秒级。

### 修复 4（可选增强）：mtime 短路，warm start 直接跳过 reindex

让 warm start 从"几十秒"降到"几百毫秒"。

- 在 `metadata_dir()` 写一个 `last_reindex.json`（含上次 reindex 完成时的 skills_dir 最新 mtime 戳）。
- `reindex_from_metadata` 入口（`sync_metadata.rs:116` 之后）用 `content_hash::latest_modified_ms`（已实现，`content_hash.rs:125`，一次 walk 即可，比 182 次 hash 便宜得多）扫一遍 `central_repo::skills_dir()`，若最大 mtime ≤ `last_reindex_ms` 则 `return Ok(())` 整体跳过。
- reindex 成功结束时更新 `last_reindex.json`。

## 验证

1. `cd src-tauri && cargo check`（编译通过）
2. `npm run tauri:dev` 启动，观察窗口是否在数秒内出现（不再卡 42~100 秒）
3. 查日志 `C:\Users\52752\AppData\Local\com.agentskills.desktop\logs\skills-manager.log`：应能看到 `initialize_store` 各阶段的早期进度条目（修复 1 生效）
4. 若仍异常卡顿，日志里能看到卡在哪一步（修复 1 的诊断价值）

## 风险评估

- 修复 1（日志前移）：纯诊断增强，零行为变更，风险极低。
- 修复 2（后台化）：warm start 下数据一致性风险低（DB 已是上次结果）。唯一边界是"外部设备刚 sync 新数据"时前端短暂显示旧数据，reindex 完成后事件刷新——可接受。已有 issue #248 同款改动的先例。
- 修复 3（批量化）：需保证事务内失败时正确回滚（reindex 本就是 idempotent 全量重建，回滚到旧状态安全）。
- 修复 4（短路）：需保证"mtime 没变但内容变了"的边界（极少见，如外部工具原地改文件不改 mtime）有兜底——可加一个"强制 reindex"的 CLI/设置入口，或用 content_hash 的 `latest_modified_ms` 失败时回退全量。

## 改动文件清单

- `src-tauri/src/core/panic_log.rs`（去 AppHandle 依赖）
- `src-tauri/src/lib.rs`（run() 第一行装 hook；setup 内加后台 reindex spawn；flush 早期日志）
- `src-tauri/src/core/app_state.rs`（拆分 initialize_store_minimal / run_reindex_if_needed；加早期进度 stash）
- `src-tauri/src/core/skill_store.rs`（新增 _tx 版本写入函数）
- `src-tauri/src/core/sync_metadata.rs`（循环外包事务；可选 mtime 短路）
- 复用 `central_repo.rs` 的 stash 模式（可能新增一个 early_log 模块或在 app_state 内联）