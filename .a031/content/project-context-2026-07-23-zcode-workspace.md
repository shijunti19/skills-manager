# Skills Manager 项目总览 - 上下文整理

> 生成时间: 2026-07-23
> 会话: sess_6d242246d154
> 用途: 全局工作区 zcode 标签筛选功能 - 上下文交接

---

## 1. 需求摘要

用户要求在全局工作区（WorkspaceView）添加标签筛选和同步功能：

### 核心功能点

1. **标签下拉筛选**
   - 位置：全局工作区页面（`src/views/WorkspaceView.tsx`）
   - 行为：下拉选择单个标签
   - 效果：过滤显示带有该标签的 skills
   - 状态显示：已安装显示"已同步"，未安装显示"未安装"

2. **同步 Skill 按钮**
   - 目标目录：`C:\Users\52752\.zcode\skills`
   - 操作逻辑：
     1. 读取当前选中的标签关联的所有 skills
     2. 删除目标目录下不在标签内的 skills
     3. 将标签内的 skills 同步过去
   - 同步方式：根据设置决定使用软链接还是复制文件（读取 `sync_mode` 设置）

3. **复制提示词按钮**
   - 输出格式：`[$skill-name](full-path-to-SKILL.md)`
   - 追加标签的 prompt 字段内容

4. **简化 UI**
   - 移除 `/bmad @yuni @zcode 生成` 按钮组
   - 只保留白色"生成"按钮

---

## 2. 当前代码状态

### 已实现的部分

| 文件 | 状态 | 说明 |
|------|------|------|
| `src-tauri/src/core/migrations.rs` | ✅ 完成 | v10 migration 添加 prompt 字段 |
| `src-tauri/src/core/skill_store.rs` | ✅ 完成 | SmartTagRecord 添加 prompt 字段 |
| `src-tauri/src/commands/zcode_commands.rs` | ✅ 完成 | 三个 Tauri 命令 |
| `src-tauri/src/extensions/commands_ext.rs` | ✅ 完成 | SmartTagExtDto 添加 prompt |
| `src/lib/tauri.ts` | ✅ 完成 | API 函数和类型 |
| `src/components/extensions/TagPanel.tsx` | ✅ 完成 | 组件已创建 |

### 未实现的部分

| 文件 | 状态 | 说明 |
|------|------|------|
| `src/views/extensions/SkillTagFilter.tsx` | ❌ 不存在 | 应该存在的标签筛选组件 |
| `src/views/extensions/TagSkillRow.tsx` | ❌ 不存在 | 应该存在的技能行组件 |
| `src/views/WorkspaceView.tsx` | ⚠️ 未集成 | TagPanel 未集成到工作区 |

### 关键问题

1. **AGENTS.md 文档与实际不符** - 文档说标签筛选在 `src/views/extensions/SkillTagFilter.tsx`，但该文件不存在
2. **TagPanel 未集成** - TagPanel 组件已创建但未集成到 WorkspaceView
3. **用户需要重建** - 用户反馈看不到按钮，需要重新构建应用

---

## 3. 已实现的文件详情

### src-tauri/src/commands/zcode_commands.rs

三个 Tauri 命令：

```rust
// 1. 同步 skills 到 zcode 目录
#[tauri::command]
pub async fn sync_skills_to_zcode(
    store: State<'_, Arc<SkillStore>>, 
    smart_tag_id: String
) -> Result<SyncToZcodeResult, AppError>

// 2. 生成标签提示词
#[tauri::command]
pub async fn generate_tag_prompt(
    store: State<'_, Arc<SkillStore>>, 
    smart_tag_id: String
) -> Result<String, AppError>

// 3. 检查 zcode skills 状态
#[tauri::command]
pub async fn check_zcode_skills_status(
    store: State<'_, Arc<SkillStore>>, 
    smart_tag_id: String
) -> Result<ZcodeSkillsStatus, AppError>
```

### src/components/extensions/TagPanel.tsx

已创建的组件包含：
- 标签下拉选择器
- 同步状态显示（已同步/未安装数量）
- 同步按钮
- 复制提示词按钮
- 标签表单（含 prompt 字段）

---

## 4. 技术参考

### 同步逻辑（重要）

单个技能同步到某个 Agent 用：

```ts
api.syncSkillToTool(skillId, toolKey)   // 安装（按 sync_mode 软链接/复制）
api.unsyncSkillFromTool(skillId, toolKey) // 卸载
```

后端 `sync_skill_to_tool` 会按全局设置 `sync_mode` 自动落地：
- 设置为 `symlink` → 创建软连接到中央仓库
- 设置为 `copy` → 复制文件

前端无需关心软连接还是复制，只管调 `syncSkillToTool`。

批量整理用：

```ts
api.organizeAgentSkills(agentKey, keepSkillIds)
```

### 判定「某技能是否已同步到当前 Agent」

```ts
skill.targets.some((target) => target.tool === agentKey)
```

### 同步后刷新

```ts
await Promise.all([refreshManagedSkills(), refreshTools(), loadLocalSkills()]);
```

---

## 5. 页面位置（更新）

| 你看到的界面 | 对应文件 | 说明 |
|-------------|----------|------|
| 点 Agent 进入的全局工作区 | `src/views/WorkspaceView.tsx` | 主页面 |
| 标签管理面板 | `src/components/extensions/TagPanel.tsx` | 已有但未集成 |
| 标签筛选组件 | `src/views/extensions/SkillTagFilter.tsx` | ❌ 不存在，需要创建 |
| 技能行组件 | `src/views/extensions/TagSkillRow.tsx` | ❌ 不存在，需要创建 |

---

## 6. 下一步工作

1. 将 TagPanel 或新的 SkillTagFilter 集成到 WorkspaceView
2. 创建 SkillTagFilter.tsx（如需独立组件）
3. 创建 TagSkillRow.tsx 显示带同步状态的技能列表
4. 用户需要重新构建应用

---

## 7. 约束条件

- 使用项目的现有同步机制（symlink/copy）
- 保持与现有标签管理系统的兼容性
- 软链接/复制根据用户设置决定
