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

## 发布流程（AI 改完代码后必走）

> 本节是**强约束**，违反会导致发版失败 / tag 错位 / 触发空 release。

### 改代码期间（每次提交前必做）

AI 每次实现完成后，**必须**把变更 bullet 写入两个 CHANGELOG 顶部的 `[Unreleased]` / `[未发布]` 区：

- `CHANGELOG.md` → 找 `## [Unreleased]` 章节下的 `### User-facing` / `### Developer & Governance`
- `CHANGELOG-zh.md` → 找 `## [未发布]` 章节下的 `### 用户可见更新` / `### 开发者与治理更新`

要求：

- 一个变更至少写一条 bullet（中英文各一条，不要只写中文）
- bullet 用用户视角描述"行为变化" + "为什么"，不是 commit subject 的复读
- `### Release Overview` / `### 发布概览` 由人类写，AI 不要动
- 不要把 placeholder `_Nothing yet._` / `_暂无。_` 之外的空 bullet 留作占位

如果仓库里**还没有** `[Unreleased]` 骨架（首次启用时），跑一次：

```bash
npm run release:ensure-unreleased
```

幂等，已存在则不动。

### 用户决定发布

```bash
# 1. 准备：bump 版本号 + 把 [Unreleased] 转成 [X.Y.Z] + 清空 [Unreleased]
#    工作区不提交
npm run release:prepare -- patch      # 或 minor / major / 1.28.5

# 2. 用户检查
git diff

# 3. 用户手动提交
git add CHANGELOG.md CHANGELOG-zh.md package.json src-tauri/tauri.conf.json \
        src/i18n/en.json src/i18n/zh.json src/i18n/zh-TW.json
git commit -m "chore(release): bump version to X.Y.Z"

# 4. 打本地 tag（不 push）
npm run release:tag -- X.Y.Z

# 5. 用户手动推送，触发 GitHub Actions 4 平台打包
git push --follow-tags
```

### 铁律

- 任何 release 脚本**永远不**自动 commit / push / push tag
- `[Unreleased]` / `[未发布]` 区为空时禁止发版（脚本会拒绝）
- 工作区脏时禁止发版 / 打 tag（脚本会拒绝）
- `release:tag` 的版本号必须等于 `package.json` 当前版本（脚本会拒绝）
- 已有同名 tag 时禁止打 tag（脚本会拒绝，需 `git tag -d vX.Y.Z` 后重打）

### 失败回滚

- `release:prepare` 后想放弃：`git checkout -- CHANGELOG.md CHANGELOG-zh.md package.json src-tauri/tauri.conf.json src/i18n/{en,zh,zh-TW}.json` 即可，未提交任何东西
- `release:tag` 后想放弃：`git tag -d vX.Y.Z`
- `git push --follow-tags` 后想撤回：参考 GitHub Release 的删除 + 强制覆盖流程（一般不需要）

