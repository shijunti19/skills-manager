# Skills Manager — 关键页面与数据流索引

> 本文件帮助 AI 快速定位「点击 Agent（如 zcode）进入的技能管理页」及相关数据/同步逻辑。
> 标签系统有两套并存：简单标签（`skill_tags` 字符串）+ 智能标签（`smart_tags` 多对多分类 + prompt）。

## 页面位置

| 你看到的界面 | 对应文件 | i18n 命名空间 |
| --- | --- | --- |
| 点 Agent 进入的「全局工作区」技能管理页（摘要 + 搜索 + 技能网格/列表） | `src/views/WorkspaceView.tsx` | `globalWorkspace.localSkills.*` |
| 智能标签筛选条（下拉选标签 + 生成提示词 + 同步全部按钮） | `src/views/extensions/SkillTagFilter.tsx` | `promptPreview.*` |
| 标签筛选后的技能行（已同步 emerald / 未安装 + 同步按钮） | `src/views/extensions/TagSkillRow.tsx` | `promptPreview.*` |
| 生成提示词弹窗（多行预览 + 用户任务输入 + 本地缓存） | `src/components/PromptPreviewDialog.tsx` | `promptPreview.*` |
| 提示词拼接工具函数（assemblePrompt / formatSkillLine） | `src/views/extensions/promptAssembly.ts` | — |
| 设置页 Agent 提示词规范编辑（Textarea + 卡片内联编辑） | `src/views/Settings.tsx` | `promptPreview.promptSpec*` |

## 数据来源

- **技能库全部技能**（中央仓库）：`managedSkills`，来自 `useApp()` → `api.getManagedSkills()`（`src/lib/tauri.ts` → `get_managed_skills`）。`ManagedSkill` 类型在 `src/lib/tauri.ts`。
- **当前 Agent 本地目录技能**（含非 Manager 安装的）：`api.getGlobalLocalSkills(toolKey)`，类型 `ProjectSkill`。
- **智能标签定义**：`api.getSmartTagsExt()` → `SmartTag[]`（id / name / agents / description / prompt）。
- **智能标签 → 技能映射**：`api.getSmartTagsMap()` → `Record<skill_id, smart_tag_id[]>`。

## 智能标签系统（smart_tags）

后端：`src-tauri/src/commands/smart_tags.rs`（7 命令）+ `src-tauri/src/core/skill_store.rs`（SmartTagRecord + CRUD）。
DB 表：`smart_tags`（id/name/agents/description/prompt/sort_order）+ `skill_smart_tag_relations`（skill_id/smart_tag_id）。
种子数据：`scripts/seed-smart-tags.sql`（12 个全栈标签 + 按 name 匹配绑定）。

## 同步逻辑（重要）

单个技能同步到某个 Agent 用：

```ts
api.syncSkillToTool(skillId, toolKey)   // 安装（按 sync_mode 软链接/复制）
api.unsyncSkillFromTool(skillId, toolKey) // 卸载
```

后端 `sync_skill_to_tool` 会**按全局设置 `sync_mode` 自动落地**：

- 设置为 `symlink` → 创建软连接到中央仓库（Windows 失败回退 junction/copy）
- 设置为 `copy` → 复制文件

前端**无需关心软连接还是复制**，只管调 `syncSkillToTool`。

批量整理（让 Agent 文件夹只保留选中标签的技能）用：

```ts
api.organizeAgentSkills(agentKey, keepSkillIds)
// keepSkillIds = 选中标签关联的全部 ManagedSkill.id 数组
// 返回 { kept, removed }
// 后端 organize_agent_skills：删非目标集 + 同步缺失项，按 sync_mode 落地
```

## 提示词生成

```ts
import { assemblePrompt } from "./views/extensions/promptAssembly";
// assemblePrompt(selectedTags, skills, promptSpec)
// promptSpec 用 agent.skills_prompt_spec，默认 "[$(name)]((path))"
// 支持 $(name)/$(path) 和 {{name}}/{{path}} 占位
```

技能路径自动转为 `central_path + "/SKILL.md"`（正斜杠，跨终端兼容）。

## 判定「某技能是否已同步到当前 Agent」

代码库统一惯用法：

```ts
skill.targets.some((target) => target.tool === agentKey)
```

## 同步后刷新

统一三件套：

```ts
await Promise.all([refreshManagedSkills(), refreshTools(), loadLocalSkills()]);
```

## 其他相关

- 从技能库批量添加：`src/components/AddSkillsSheet.tsx`（右抽屉，复选框 + 底部 CTA）。
- Preset 一键激活：`src/components/PresetBar.tsx`（chip 状态 active/partial/inactive）。
- 单技能行状态徽章样式参考：`src/components/SkillPickerRow.tsx`（emerald=已同步 / rose=冲突 / surface-hover=不可用）。
- Agent skills_prompt_spec 字段：后端 `tool_adapters.rs`（CustomToolDef）+ `tool_service.rs`（ToolInfo 合并 custom/内置 spec）+ 设置页编辑 UI。

