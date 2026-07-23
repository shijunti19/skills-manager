---
title: Skills Manager 项目总览
generated_at: 2026-07-23
generator: a031-bootstrap §6b
sources:
  - ${ProjectRoot}/package.json
  - ${ProjectRoot}/src-tauri/Cargo.toml
  - ${ProjectRoot}/src-tauri/tauri.conf.json
  - ${ProjectRoot}/README.md
  - ${ProjectRoot}/AGENTS.md
  - ${ProjectRoot}/.a031/map/main.md
---

# Skills Manager 项目总览

## 1. 项目身份

| 字段 | 值 |
|------|---|
| 名称 | skills-manager |
| 版本 | 1.28.3（`package.json`） |
| 类型 | Tauri 桌面应用（Rust + Vue） |
| License | MIT |
| 简介 | AI Agent Skills 管理器，统一管理跨多个编码助手的技能库 |
| 项目根 | `X:\xiaolu\ai\plugin\skills-manager` |
| a031 工作区 | `${ProjectRoot}/.a031` |

## 2. 技术栈

### 桌面壳（Tauri）
- Tauri 2.x（`src-tauri/Cargo.toml`）
- WebView 内核走系统默认（macOS WKWebView / Windows WebView2 / Linux WebKitGTK）

### 后端（Rust）
- 语言：Rust 2021 edition
- 数据库：SQLite（`rusqlite` + `r2d2` 连接池）
- 异步运行时：Tokio
- HTTP 客户端：`reqwest`
- CLI / 配置：`serde` + `serde_json`
- 日志：`tracing` + `tracing-subscriber`
- 路径：`dunce`（Windows UNC 规范化）

### 前端（Vue + React 混用）
- 主栈：Vue 3 + TypeScript
- 部分组件用 React（如 `PromptPreviewDialog`）
- 构建：Vite 7
- 样式：Tailwind CSS 3.4
- i18n：i18next + 三语 `zh.json` / `en.json` / `zh-TW.json`
- 状态：React Context（`AppContext`）+ Vue ref
- DnD：`@dnd-kit/core` + `@dnd-kit/sortable`
- 图标：`lucide-react` / `lucide-vue-next`

### 包管理器
- pnpm（`pnpm-workspace.yaml` 单包）

## 3. 目录结构

```
${ProjectRoot}/
├── src/                    # 前端（Vue + React）
│   ├── views/              # 顶层页面
│   │   ├── WorkspaceView.tsx
│   │   ├── MySkills.tsx
│   │   └── Settings.tsx
│   ├── components/         # 通用组件
│   │   ├── HelpDialog.tsx
│   │   ├── PromptPreviewDialog.tsx
│   │   └── PromptSpecHelpDialog.tsx
│   ├── views/extensions/   # 子组件（标签筛选 / 标签面板）
│   ├── lib/tauri.ts        # Tauri 命令 TS 封装
│   ├── i18n/               # 三语 JSON
│   └── context/AppContext.tsx
├── src-tauri/              # 后端（Rust）
│   ├── src/
│   │   ├── main.rs
│   │   ├── lib.rs          # invoke_handler 注册
│   │   ├── commands/       # Tauri 命令按域分文件
│   │   │   ├── settings.rs
│   │   │   ├── tools.rs    # 自定义 / 内置 Agent CRUD + skills_prompt_spec
│   │   │   ├── skills.rs
│   │   │   ├── smart_tags.rs
│   │   │   └── presets.rs
│   │   ├── core/           # 领域逻辑
│   │   │   ├── skill_store.rs      # SQLite 持久层
│   │   │   ├── tool_adapters.rs    # ToolAdapter + CustomToolDef 定义
│   │   │   ├── tool_service.rs     # 列表聚合、路径合并
│   │   │   ├── migrations.rs
│   │   │   └── central_repo.rs
│   │   └── extensions/     # 标签系统扩展
│   ├── tauri.conf.json
│   └── Cargo.toml
└── .a031/                  # a031 工作流产物（本目录）
    ├── map/main.md
    ├── content/            # 上下文 / 总览（此文件位置）
    ├── tasks/
    ├── tools/
    └── rules/
```

## 4. 核心领域模型

### 4.1 Agent（编码助手）
- `ToolAdapter`（内置 agent）：Claude Code / Cursor / Codex / zcode 等
- `CustomToolDef`（用户自定义 agent）：用户通过设置页添加
- 二者统一转为 `ToolInfo` 给前端展示
- 字段：
  - `key` / `display_name`
  - `skills_dir` / `project_relative_skills_dir`
  - `is_custom` / `category` / `installed`
  - **`skills_prompt_spec`**（v1.28+ 新增）：占位变量模板 `[${{name}}]({{path}})`
  - **`tool_prompt_specs`** 设置（v1.28+ 新增）：内置 agent 的规范覆盖 JSON map

### 4.2 Skill
- 中央仓库路径唯一标识，名称可重复多版本
- DB 表：`skills` / `skill_versions` / `skill_files`
- 关系：`<skill> --*-- <agent>`（同步关系，多对多）

### 4.3 Smart Tag（智能标签）
- v1.28+ 新功能，作用：技能多对多分类
- DB 表：`smart_tags` / `skill_smart_tag_relations`
- 字段：`name` / `agents[]` / `description` / `prompt`
- 用户场景：按"前端 / 后端 / 全栈"等标签筛技能，再生成提示词
- 12 个预设标签已写在中央库 + 智能绑定 181 条关联

## 5. 数据库 / 持久化

### DB 文件
- 路径：`%USERPROFILE%/.skills-manager/skills-manager.db`（Windows）
- 引擎：SQLite 单文件

### 配置存储（settings 表 KV）
| Key | 用途 |
|-----|------|
| `custom_tools` | JSON 数组，存用户自定义 Agent |
| `tool_prompt_specs` | JSON map，内置 Agent 的 skills_prompt_spec 覆盖 |
| `disabled_tools` | JSON 数组，已禁用的 Agent keys |
| `custom_tool_paths` | JSON map，Agent → override skills_dir |
| `central_repo_path` | 中央仓库位置 |
| `sync_mode` | symlink / copy 模式 |

## 6. Tauri 命令清单（按模块）

> 注册位置：`src-tauri/src/lib.rs:invoke_handler`

### Settings
- `get_settings` / `set_settings`
- `set_central_repo_path` / `open_central_repo_folder` / `open_folder`（任意路径）

### Tools
- `list_tool_info` / `get_tool_status`
- `add_custom_tool` / `remove_custom_tool`
- `set_custom_tool_project_path` / `reset_custom_tool_project_path`
- **`set_custom_tool_prompt_spec`**（v1.28+ 新增）

### Skills
- `list_skills` / `get_skill` / `sync_skill`
- `get_skill_content` / `save_skill_content`
- `delete_skill` / `organize_agent`

### Smart Tags
- `get_smart_tags_ext` / `create_smart_tag_ext` / `update_smart_tag_ext`
- `delete_smart_tag_ext` / `get_smart_tag_ids_for_skill`
- `bind_smart_tags_to_skill` / `unbind_smart_tags_from_skill`

### Presets / App Update / Diagnostics
- 见 `src-tauri/src/commands/`

## 7. 前端路由与页面

| 路由 | 组件 | 说明 |
|------|------|------|
| `/` | `WorkspaceView` | 全局工作区：标签筛选 + 技能管理 |
| `/skills` | `MySkills` | "我的 Skill" 列表 |
| `/settings` | `Settings` | Agent / 同步 / 备份 / App 设置 |

`Sidebar` 控制右侧导航切换。

## 8. i18n

- 默认中文
- 三语：`zh.json`（默认）/ `en.json` / `zh-TW.json`
- 顶层 key：
  - `sidebar` / `globalWorkspace` / `mySkills` / `settings`
  - `skillTagFilter` / `tagPanel` / `promptPreview` / `promptSpecHelp`
  - `help` / `toast` / `common`

## 9. 关键变更日志（v1.28）

| 主题 | 摘要 |
|------|------|
| Smart Tag 系统 | 12 个全栈标签 + 181 条绑定 |
| `skills_prompt_spec` 字段 | 自定义 Agent + 内置 Agent 双重支持 |
| `PromptPreviewDialog` | 多行可滚动 modal + 本地缓存用户任务 + 模板变量替换 |
| `PromptSpecHelpDialog` | 占位变量 `{{name}}` / `{{path}}` 说明弹窗 |
| 路径点击 | Workspace 顶部 skills_dir 点击直接资源管理器 |
| `open_folder` 命令 | 跨平台打开任意路径 |

## 10. 开发约定

> 详见 `${ProjectRoot}/AGENTS.md`

- 中文优先，简洁回复，控制上下文长度
- 大输出命令用 `rtk` 前缀（项目根 `AGENTS.md` 强制）
- 修改数据库先用 `cargo check`，应用在跑时不能用 `cargo build`
- 改字段用 `#[serde(default)]` 保证旧 JSON 可读
- 前端 i18n 改 key 必同步三语言

## 11. 待办与已知限制

- 编译必须关掉运行中的 skills-manager.exe（文件锁）
- 仓库 SQLite 没启用 WAL，并发写入偶发 `SQLITE_BUSY`
- 部分 Vue 组件（`TagPanel`）混用 React 风格的 `t(key, default)` 已迁移
- **zcode 标签筛选功能**：后端已完成，前端 TagPanel 组件已创建但未集成到 WorkspaceView，用户需重建应用

## 12. zcode 标签筛选功能状态（2026-07-23）

> 详见 `.a031/content/project-context-2026-07-23-zcode-workspace.md`

| 组件 | 状态 | 文件 |
|------|------|------|
| Rust 后端命令 | ✅ 完成 | `src-tauri/src/commands/zcode_commands.rs` |
| 数据库 migration | ✅ 完成 | `src-tauri/src/core/migrations.rs` (v10) |
| 前端 API | ✅ 完成 | `src/lib/tauri.ts` |
| TagPanel 组件 | ✅ 完成 | `src/components/extensions/TagPanel.tsx` |
| WorkspaceView 集成 | ⚠️ 未完成 | `src/views/WorkspaceView.tsx` |

**同步命令**：`api.syncSkillToTool(skillId, toolKey)` - 自动根据 `sync_mode` 设置决定软链接或复制

## 13. 引用

- AI 工作流根：`C:\Users\52752\.skills-manager\skills\a031-bootstrap\SKILL.md`（v3.0）
- a031 平台规则：`mcp__a031_mcp__read_workflow_rules`
- 项目 a031 索引：`${ProjectRoot}/.a031/map/main.md`
- zcode 工作区功能详情：`.a031/content/project-context-2026-07-23-zcode-workspace.md`
