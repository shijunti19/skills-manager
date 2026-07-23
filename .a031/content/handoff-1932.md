# Skills Manager 项目交接文档
**Session**: sess_6d242246d154 | **时间**: 2026-07-23 19:32

---

## 本次工作内容

### 核心功能：全局工作区标签筛选 + 同步整理功能

**目标**：点 Agent（如 zcode）进入技能管理页 → 底部有标签筛选区 → 选标签后主列表替换为该标签关联技能 → 有同步按钮整理 Agent 文件夹。

---

## 已完成的修改

### 1. 后端新命令 `organize_agent_skills`
**文件**: `src-tauri/src/commands/agent_workspace.rs`

```
organize_agent_skills(agent: String, keep_skill_ids: Vec<String>)
  → OrganizeAgentResult { synced, removed, failed }
```

- 扫描磁盘 `skills_root` 下所有顶层目录（不依赖 SKILL.md，包括 repo 嵌套目录也能删）
- 删除：目录名不在 `keep_skill_ids` 对应技能名集合中的 → `sync_engine::remove_target` 删目录
- 同步：目标集里但磁盘没有的 → `sync_engine::sync_skill` 从中央库同步（按 `sync_mode` 软链接/复制）
- 已在 `lib.rs` 注册：`commands::agent_workspace::organize_agent_skills`

### 2. 前端 API
**文件**: `src/lib/tauri.ts`
```ts
export interface OrganizeAgentResult { synced: number; removed: number; failed: number; }
export const organizeAgentSkills = (agent: string, keepSkillIds: string[]) =>
  invoke<OrganizeAgentResult>("organize_agent_skills", { agent, keepSkillIds });
```

### 3. 标签筛选组件（重写）
**文件**: `src/views/extensions/SkillTagFilter.tsx`
- 删除 `/bmad` `@yuni` `@zcode` 快捷按钮
- 「生成」按钮改为白底深字描边样式（`border-border-subtle bg-surface-hover`）
- 改为受控组件：`selectedTagIds` / `onSelectTags` 从父组件传入
- 多标签逻辑改为 **OR/并集**（`.some()` 替代 `.every()`）
- 新增 props：`agentKey: string | null` / `onOrganize: () => void`
- 新增「同步」按钮（Wand2 图标，accent 色）

### 4. 技能行组件（新建）
**文件**: `src/views/extensions/TagSkillRow.tsx`
```ts
// 已同步 → 绿色徽章 + 无按钮
// 未安装 → 灰色徽章 + 「同步」按钮（accent）
// 点击同步 → api.syncSkillToTool(skill.id, agentKey) → onSynced() 刷新
```

### 5. WorkspaceView 主列表改造
**文件**: `src/views/WorkspaceView.tsx`
- 新增 `tagFilterSelected` state + `tagFilteredSkills` memo（OR 并集）
- 选中标签时：主列表替换为 `tagFilteredSkills.map(TagSkillRow)` + 「显示全部」按钮
- 未选标签：原本地技能列表逻辑不变（备份分支）
- 整理确认弹窗：`ConfirmDialog`，无 skill 列表（避免按钮被挤出屏幕）

### 6. i18n 新增键（三语）
**文件**: `src/i18n/{zh,en,zh-TW}.json` → `skillTagFilter.*`
`synced` / `notInstalled` / `sync` / `syncToAgent` / `syncFailed` /
`clearFilter` / `tagFilteredSummary` /
`organize` / `organizeHint` / `organizeNoAgent` /
`organizeConfirmTitle` / `organizeConfirmMessage` /
`organizeDone` / `organizeFailed`

### 7. AGENTS.md（重建）
**文件**: `AGENTS.md`（项目根，需重建）
页面定位、API 说明、数据流

---

## ⚠️ 待修复问题：符号链接

### 问题描述
整理后 Agent 文件夹里保留的技能是 **real dir**（复制模式留下），不是 **symlink**。设置 `sync_mode = symlink` 但已有目录不会被重新 symlink。

### 原因
`organize_agent_skills` 里用 `dest.exists()` 判断是否跳过同步 —— 如果目录已存在（不论是 copy 还是 symlink）就跳过，不会重新同步。

### 修复方案
删除非目标目录后，把**整个目录清空**再重新 `sync_skill`，确保用符号链接重建。核心改动：

```rust
// 改写 dest.exists() 检查：若目录存在但不是 symlink，清空后重建
let needs_resync = if dest.exists() {
    // 检查是不是有效的 symlink（指向正确目标）
    let is_valid_symlink = std::fs::symlink_metadata(&dest)
        .map(|m| m.file_type().is_symlink())
        .unwrap_or(false);
    !is_valid_symlink
} else {
    true
};

if needs_resync {
    let _ = sync_engine::remove_target(&dest);
    sync_engine::sync_skill(&source, &dest, mode)?;
}
```

### 影响范围
`src-tauri/src/commands/agent_workspace.rs` → `organize_agent_skills` 函数（约 736-773 行）

---

## 关键路径速查

| 用途 | 路径 |
|------|------|
| 全局工作区（技能管理页） | `src/views/WorkspaceView.tsx` |
| 标签筛选组件 | `src/views/extensions/SkillTagFilter.tsx` |
| 技能行（已同步/未安装） | `src/views/extensions/TagSkillRow.tsx` |
| 后端整理命令 | `src-tauri/src/commands/agent_workspace.rs`（`organize_agent_skills`） |
| 前端 API 封装 | `src/lib/tauri.ts`（`organizeAgentSkills`） |
| 数据库 | `~/.skills-manager/skills-manager.db` |
| zcode Agent 技能目录 | `C:/Users/52752/.zcode/skills` |
| 数据库中 rust代码 标签 ID | `3cfc85d7-cd00-4f3e-9a60-f6856c590029` |

## 数据库关键数据（当前状态）
- **rust代码 标签**关联技能：bmad-agent-dev, bmad-quick-dev, implement, banner-design（4个）
- **zcode** 整理前有 32 个目录，整理后剩余 4 个（banner-design, bmad-agent-dev, bmad-quick-dev, implement）
- 整理删除了 28 个，但其中部分（无 SKILL.md 的）可能未完全清理 DB target
