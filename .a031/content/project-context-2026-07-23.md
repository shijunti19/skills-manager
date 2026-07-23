# Skills Manager 项目上下文 (2026-07-23)

## 项目概述

**Skills Manager** 是一个 Tauri 桌面应用程序，用于集中管理 AI Agent 技能（Skills）。它支持多工具集成、Git 备份同步、中央仓库管理等企业级功能。

- **版本**: 1.28.3
- **许可证**: MIT
- **技术栈**: Rust (后端) + Vue/TypeScript/React (前端)

---

## 技术架构

### 前端
- **框架**: React 19 + TypeScript
- **构建**: Vite 7
- **UI**: Tailwind CSS + Lucide React 图标
- **状态管理**: React Context (AppContext, ThemeContext)
- **路由**: React Router DOM 7
- **国际化**: i18next (支持 en, zh, zh-TW)
- **桌面集成**: Tauri API (@tauri-apps/api)

### 后端 (Rust)
- **框架**: Tauri 2.10
- **数据库**: SQLite (rusqlite, bundled)
- **Git 操作**: git2
- **加密**: aes-gcm, sha2
- **异步**: tokio

### 插件
- tauri-plugin-log
- tauri-plugin-dialog
- tauri-plugin-shell
- tauri-plugin-opener
- tauri-plugin-clipboard-manager
- tauri-plugin-updater (自动更新)

---

## 目录结构

```
skills-manager/
├── src/                          # 前端 Vue/React 源码
│   ├── components/                # React 组件
│   │   ├── AddProjectDialog.tsx
│   │   ├── AddSkillsSheet.tsx
│   │   ├── AgentIcon.tsx
│   │   ├── AgentToggleSection.tsx
│   │   ├── BatchTagDialog.tsx
│   │   ├── CommandPalette.tsx
│   │   ├── ConfirmDialog.tsx
│   │   ├── CreatePresetDialog.tsx
│   │   ├── DetailSheet.tsx
│   │   ├── DocumentDiffViewer.tsx
│   │   ├── Layout.tsx
│   │   ├── Sidebar.tsx           # 侧边栏（核心导航）
│   │   ├── SkillDetailPanel.tsx  # 技能详情面板
│   │   ├── SyncDots.tsx
│   │   └── TagRenameDialog.tsx
│   ├── context/
│   │   ├── AppContext.tsx        # 全局状态管理
│   │   └── ThemeContext.tsx
│   ├── hooks/                    # React Hooks
│   ├── i18n/                    # 国际化资源
│   │   ├── en.json
│   │   ├── zh.json
│   │   └── zh-TW.json
│   ├── lib/
│   │   ├── tauri.ts              # Tauri API 调用封装
│   │   └── ...
│   └── views/                    # 页面视图
│       ├── MySkills.tsx          # 我的技能库
│       └── ...
├── src-tauri/                    # Tauri/Rust 后端
│   ├── src/
│   │   ├── commands/             # Tauri 命令 (RPC)
│   │   │   ├── agent_workspace.rs
│   │   │   ├── git_backup.rs
│   │   │   ├── presets.rs
│   │   │   ├── projects.rs
│   │   │   ├── scan.rs
│   │   │   ├── settings.rs
│   │   │   ├── skills.rs
│   │   │   ├── sync.rs
│   │   │   └── tools.rs
│   │   └── core/                 # 核心业务逻辑
│   │       ├── skill_store.rs    # 技能存储
│   │       ├── migrations.rs     # 数据库迁移
│   │       ├── sync_engine.rs    # 同步引擎
│   │       ├── git_backup.rs     # Git 备份
│   │       ├── merge/            # 三方合并引擎
│   │       └── ...
│   └── Cargo.toml
└── .a031/                       # 项目管理目录
    ├── map/                     # 节点地图
    ├── content/                 # 上下文
    ├── tasks/                   # 任务
    └── rules/                  # 规则
```

---

## 核心功能模块

### 1. 技能管理 (Skills)
- 从中央仓库安装/更新技能
- 支持多个 AI 工具 (Claude, GPT, Gemini 等)
- 技能源管理 (Git 仓库)
- 预设管理 (Presets)

### 2. 工具集成 (Tools)
- 支持 coding 和 lobster 两种工具类别
- 每个工具独立的技能目录
- 工具启用/禁用控制

### 3. 同步与备份
- Git-based 备份到远程仓库
- 自动备份机制
- 中央仓库同步
- 冲突检测与解决 (merge engine)

### 4. 项目管理
- 多项目支持
- 项目级别的工具配置
- 项目级别的技能覆盖

### 5. 自动更新
- Tauri updater 插件
- GitHub releases 集成
- 签名验证

---

## 最近实现的功能

### 智能标签系统 (Smart Tags) - v1.28.x

#### 后端实现
- **新增表**: `smart_tags`, `skill_smart_tag_relations`
- **命令**: `get_smart_tags_ext`, `create_smart_tag_ext`, `update_smart_tag_ext`, `delete_smart_tag`, `get_smart_tag_relations`, `set_smart_tags_for_skill`
- **位置**: `src-tauri/src/core/skill_store.rs`, `src-tauri/src/commands/smart_tags.rs`

#### 前端实现
- **TagPanel 组件**: `src/components/extensions/TagPanel.tsx`
  - CRUD 操作支持
  - 代理多选 (包含 "all" 选项)
  - 描述字段
  
- **SmartTagEditor**: `src/views/extensions/SkillSmartTagEditor.tsx`
  - 点击即保存模式
  - 紫色标签显示
  - 用于技能库技能卡

- **MySkills 页面**: `src/views/MySkills.tsx`
  - 顶部标签过滤器
  - 技能卡显示标签
  - 详情按钮 (工具栏)
  - 点击卡牌不打开详情

#### 翻译资源
- `src/i18n/en.json` - `tagPanel.*`, `mySkills.smartTags.*`
- `src/i18n/zh.json`
- `src/i18n/zh-TW.json`

---

## 数据库 schema

### smart_tags 表
```sql
CREATE TABLE smart_tags (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    agents TEXT NOT NULL,  -- JSON array
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);
```

### skill_smart_tag_relations 表
```sql
CREATE TABLE skill_smart_tag_relations (
    skill_id TEXT NOT NULL,
    tag_id TEXT NOT NULL,
    PRIMARY KEY (skill_id, tag_id)
);
```

---

## API 绑定 (Tauri Commands)

| Command | 用途 |
|---------|------|
| `get_smart_tags_ext` | 获取所有智能标签 (含代理信息) |
| `create_smart_tag_ext` | 创建智能标签 |
| `update_smart_tag_ext` | 更新智能标签 |
| `delete_smart_tag` | 删除智能标签 |
| `get_smart_tag_relations` | 获取技能的标签关联 |
| `set_smart_tags_for_skill` | 设置技能的标签 |
| `get_skills` | 获取技能列表 |
| `get_skill_detail` | 获取技能详情 |
| `sync_projects` | 同步项目 |
| `backup_repository` | 备份仓库 |

---

## 构建与发布

### 构建命令
```bash
pnpm tauri:build    # 生产构建
pnpm tauri:dev      # 开发模式
```

### 代码签名
- 使用 Tauri updater 插件
- 公钥已配置在 `tauri.conf.json`
- 签名密钥: `src-tauri/keys/skills-manager.key`

---

## 配置文件

| 文件 | 用途 |
|------|------|
| `tauri.conf.json` | Tauri 应用配置 |
| `package.json` | npm 依赖配置 |
| `src-tauri/Cargo.toml` | Rust 依赖配置 |
| `tailwind.config.js` | Tailwind CSS 配置 |
| `vite.config.ts` | Vite 构建配置 |

---

## 状态标记

- **Session**: `sess_27616a59c78c`
- **项目**: skills-manager (id: 3a8do7s3rddu)
- **上下文路径**: `.a031/content/`
- **Map 节点数**: ~50+

---

## 已知问题

1. 扩展目录 (`extensions/`) 不存在 - 某些扩展功能可能需要创建
2. `.a031` 目录有未跟踪的更改

---

## 下一步

如需继续开发或修改功能，请参考:
- `.a031/map/` 中的节点地图
- `.a031/tasks/` 中的任务记录
- `.a031/content/` 中的上下文历史
