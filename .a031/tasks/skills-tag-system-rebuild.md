---
title: Skills Manager 标签系统重做总蓝图
created_at: 2026-07-23
status: in-progress
scope: 后端(Rust) + 前端(React) + 数据库(SQLite) + 种子数据
baseline_version: 1.28.3
---

# Skills Manager 标签管理 + 提示词生成 + 同步机制 重做总蓝图

> 仓库被删后重新拉取，基线干净（DB migration v7，无 smart_tags 表，无 prompt_spec 字段）。
> 本蓝图把 `.a031/content/1.txt~4.txt` 的需求重新落地为可提交可验证的功能。

## 1. 要解决的问题（来自 4.txt）

安装大量 Skill 后，仅技能名称+描述就消耗几万 Token（2000+ Skill ≈ 8 万 Token，占 40% 上下文），导致：
- 长会话容易超限
- 每轮响应变贵变慢
- 有效思考空间被挤占

**解决方案**：标签管理 + 动态生成提示词 + 同步机制，实现"按需组合、轻量加载"。

## 2. 三大功能模块

### 模块 A：Smart Tag 智能标签系统（多对多分类 + prompt）
- 新增 `smart_tags` 表：id/name/agents/description/prompt
- 新增 `skill_smart_tag_relations` 表：skill_id/smart_tag_id（多对多）
- 7 个 Tauri 命令（CRUD + 绑定/解绑）
- 12 个全栈预设标签 + 约 181 条技能绑定（种子数据，见 3.txt）

### 模块 B：提示词生成（PromptPreviewDialog）
- 点"生成"弹多行可滚动 modal
- 按 skills_prompt_spec 模板（默认 `[$(name)]((path))`）拼装技能链接
- 内容：标签描述 + 技能链接列表 + 标签提示词 + 用户任务输入框
- 用户任务文字 localStorage 缓存（key: `skills-manager:taskDraft`）

### 模块 C：标签筛选 + 同步集成（WorkspaceView）
- 点标签 → 主列表替换为该标签关联技能
- 显示已同步(emerald)/未安装(灰)状态 + 单技能同步按钮
- 一键 organize：让 agent 目录只保留选中标签技能（删非目标 + 同步缺失），按 sync_mode 落地

## 3. 基线事实（探索确认）

| 项 | 现状 |
|---|---|
| DB migration | `LATEST_VERSION = 7`（`src-tauri/src/core/migrations.rs:5`） |
| smart_tags 表 | ❌ 不存在 |
| skills_prompt_spec | ❌ 不存在 |
| 简单标签 | ✅ `skill_tags` 表 + `get_all_tags`/`set_skill_tags`/`rename_tag`/`delete_tag`（保留，与 smart_tag 并存） |
| 同步 | ✅ `sync_skill_to_tool`/`unsync_skill_from_tool` 按 sync_mode 落地（`sync_engine.rs`） |
| 同步判定 | `skill.targets.some(t => t.tool === agentKey)` |
| 前端 | React(.tsx) + Vite 7 + Tailwind 3.4 + i18next 三语 |
| 命令注册 | `src-tauri/src/lib.rs` invoke_handler（约 110 命令） |

## 4. 子任务拆分（7 个）

| # | 标题 | 优先级 | 依赖 |
|---|------|--------|------|
| 1 | Smart Tag 智能标签系统后端 | high | — |
| 2 | 标签库种子数据（12 标签 + 181 绑定） | high | 1 |
| 3 | Agent skills_prompt_spec 字段 | medium | — |
| 4 | PromptPreviewDialog 提示词生成弹窗 | high | 1,3 |
| 5 | WorkspaceView 标签筛选集成 | high | 1,4 |
| 6 | 同步机制增强（一键 organize） | medium | 1 |
| 7 | AGENTS.md 更新 + 收尾 | medium | 全部 |

执行顺序：1 → 2 → 3 → 4 → 5 → 6 → 7（线性推进）。

## 5. 验证标准

- Rust：`cargo build`（改 DB 前 `cargo check`，编译需关掉运行中的 exe）
- 前端：`pnpm lint` + `pnpm build`
- 数据库：`sqlite3 ~/.skills-manager/skills-manager.db`（操作前备份）
- i18n：改 key 必同步 zh/en/zh-TW
- 端到端：打标签 → 选 agent → 选标签 → 主列表替换 → 生成提示词 → 同步

## 6. 需求文档引用

- `.a031/content/1.txt`：标签筛选交互（下拉单选 + 同步按钮 + 复制提示词）
- `.a031/content/2.txt`：技能管理页改造计划（任务1-3）
- `.a031/content/3.txt`：12 标签库 + Agent prompt_spec + PromptPreviewDialog
- `.a031/content/4.txt`：功能价值说明 + `[$name](path)` 模板示例
