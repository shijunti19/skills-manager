# 全局工作区标签筛选功能 - 上下文整理

> 更新: 2026-07-23 - 根据实际代码状态修订

## 需求概述

用户要求在全局工作区（Global Workspace）添加标签筛选和同步功能。

## 当前代码状态

### ✅ 已完成

| 文件 | 状态 |
|------|------|
| `src-tauri/src/core/migrations.rs` | v10 migration 添加 prompt 字段 |
| `src-tauri/src/core/skill_store.rs` | SmartTagRecord 添加 prompt 字段 |
| `src-tauri/src/commands/zcode_commands.rs` | 三个 Tauri 命令 |
| `src-tauri/src/extensions/commands_ext.rs` | SmartTagExtDto 添加 prompt |
| `src/lib/tauri.ts` | API 函数和类型 |
| `src/components/extensions/TagPanel.tsx` | 组件已创建 |

### ⚠️ 未集成

- `TagPanel.tsx` 已创建但未集成到 `WorkspaceView`
- 用户需要重新构建应用才能看到按钮
- `src/views/extensions/SkillTagFilter.tsx` 不存在（应创建或集成 TagPanel）

## 核心功能点

### 1. 标签下拉筛选
- 位置：全局工作区页面（`src/views/WorkspaceView.tsx`）
- 行为：下拉选择单个标签
- 效果：过滤显示带有该标签的 skills
- 状态显示：
  - 已安装到 Agent 的显示"已同步"
  - 未安装的显示"未安装"

### 2. 同步 Skill 按钮
- 目标目录：`C:\Users\52752\.zcode\skills`
- 操作逻辑：
  1. 读取当前选中的标签关联的所有 skills
  2. 删除目标目录下不在标签内的 skills
  3. 将标签内的 skills 同步过去
- 同步方式：根据设置决定使用软链接还是复制文件
  - 读取 `sync_mode` 设置（"symlink" 或 "copy"）

### 3. 复制提示词按钮
- 输出格式：
  ```
  [$grill-me](C:\Users\52752\.zcode\skills\grill-me\SKILL.md)
  [$bmad-generate-project-context](...)
  ```
- 追加标签的 prompt 字段内容

### 4. UI 简化
- 移除 `/bmad @yuni @zcode 生成` 按钮组
- 只保留白色"生成"按钮

## 技术参考

### 同步逻辑

```ts
api.syncSkillToTool(skillId, toolKey)   // 安装（按 sync_mode 软链接/复制）
api.organizeAgentSkills(agentKey, keepSkillIds) // 批量整理
```

### 判定技能是否已同步

```ts
skill.targets.some((target) => target.tool === agentKey)
```

### 同步后刷新

```ts
await Promise.all([refreshManagedSkills(), refreshTools(), loadLocalSkills()]);
```

## 约束条件

- 使用项目的现有同步机制（symlink/copy）
- 保持与现有标签管理系统的兼容性
- 软链接/复制根据用户设置决定
