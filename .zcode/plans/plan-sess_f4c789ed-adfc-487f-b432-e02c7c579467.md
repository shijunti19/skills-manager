# 重做计划：Skills Manager 标签管理 + 提示词生成 + 同步机制

## 背景

仓库被删后重新拉取，之前 AI 私自实现的功能代码全部丢失，当前是干净的基线。`.a031/content` 的 1.txt–4.txt 保留了完整需求。本计划把这些需求重新落地为**可提交、可验证**的功能。

## 基线确认（来自探索）

- 前端：React（`.tsx`），Vite 7，Tailwind 3.4，i18next 三语
- 标签系统：简单 `tags: string[]`（命令 `get_all_tags`/`set_skill_tags`/`rename_tag`/`delete_tag`，存 `skill_store.rs`）—— **无 smart_tags 表**
- 同步：`sync_skill_to_tool` / `unsync_skill_from_tool` 存在，按全局 `sync_mode`（symlink/copy）落地（`sync_engine.rs`），Windows symlink 失败自动回退 copy/junction
- **缺失**：smart_tags 表、`skills_prompt_spec` 字段、TagPanel、PromptPreviewDialog、SkillTagFilter、TagSkillRow、organize 命令
- 同步判定惯用法：`skill.targets.some(t => t.tool === agentKey)`

## 产出形式

按 a031 v6 规范，在 `.a031/` 建立任务结构（plan 批准后第一步执行）：
1. 在 `.a031/tasks/` 写一份总蓝图文档 `skills-tag-system-rebuild.md`（给执行 AI 的完整上下文）
2. 建一个引导节点 + 7 个子任务（task_\<随机\>/main.md），每个含目标/文件清单/步骤/验收

---

## 子任务清单（7 个，线性为主）

### 子任务 1：Smart Tag 智能标签系统后端（数据层 + 命令）⭐基础
**目标**：新增 smart_tags 表 + 关系表 + 带 prompt 字段 + 7 个 Tauri 命令
**文件**：
- 改 `src-tauri/src/core/migrations.rs`：新增 migration（建 `smart_tags`(id/name/agents/description/prompt) + `skill_smart_tag_relations`(skill_id/smart_tag_id)）
- 改 `src-tauri/src/core/skill_store.rs`：SmartTagRecord 结构 + CRUD 方法（get_all_smart_tags/get_smart_tags_for_skill/insert/update/delete/get_skill_ids_for_smart_tag/get_smart_tag_prompt）
- 新建 `src-tauri/src/commands/smart_tags.rs`：`get_smart_tags_ext`/`create_smart_tag_ext`/`update_smart_tag_ext`/`delete_smart_tag_ext`/`get_smart_tag_ids_for_skill`/`bind_smart_tags_to_skill`/`unbind_smart_tags_from_skill`
- 改 `src-tauri/src/lib.rs`：注册 7 命令
- 改 `src/lib/tauri.ts`：SmartTagExtDto 类型 + API 封装
**验收**：`cargo build` 通过；sqlite 查到两张表；前端能调 `getSmartTagsExt()` 返回空数组

### 子任务 2：标签库种子数据（12 全栈标签 + 绑定关系）
**依赖**：子任务 1
**目标**：写入 3.txt 定义的 12 个标签（项目初始化/需求对齐/规划/架构/Rust/Vue/PHP/测试/审查/Bug/写作/上下文管理），每个含中文描述+中文提示词，全部 `agents=[]`（全局通用），+ 约 181 条技能绑定
**方式**：生成 SQL 脚本（事务包裹），skill_id 按 name 匹配取主版本；排除 deprecated-shim/空描述变体
**验收**：smart_tags 表 12 条 agents='[]' description/prompt 非空；每个有效技能至少 1 归属；输出标签→技能数统计表

### 子任务 3：Agent skills_prompt_spec 字段（后端 + 设置页）
**目标**：自定义/内置 Agent 支持提示词规范模板 `[${{name}}](${{path}})`
**文件**：
- 后端：`tool_adapters.rs`（CustomToolDef+ToolAdapter 加 `#[serde(default)] skills_prompt_spec`）、`tool_service.rs`（ToolInfo）、`commands/tools.rs`（ToolInfoDto、add_custom_tool 加参数、新增 `set_custom_tool_prompt_spec` 命令）、内置 agent 用 `tool_prompt_specs` settings KV 覆盖、`lib.rs` 注册
- 前端：`tauri.ts`（ToolInfo/addCustomTool/setCustomToolPromptSpec）、`Settings.tsx`（新增表单 Textarea + 已有卡片内联编辑 UI）
- i18n 三语补 key
**验收**：设置页新增 Agent 能填规范；已有卡片能编辑；`cargo build` + `pnpm build` 通过

### 子任务 4：PromptPreviewDialog 提示词生成弹窗 ⭐核心
**依赖**：子任务 1（标签 prompt）+ 子任务 3（spec 模板）
**目标**：点"生成"弹多行可滚动 modal，按 `[$name](path)` 拼装（用 skills_prompt_spec 模板，默认 `[$(name)]((path))`），含标签描述+技能链接列表+标签提示词+用户任务输入框
**文件**：
- 新建 `src/components/PromptPreviewDialog.tsx`：Props(open/onClose/generatedText/...)，展示区 `<pre whitespace-pre-wrap>`，任务输入 textarea onChange→localStorage(key `skills-manager:taskDraft`)，重新生成/复制全部按钮
- 新建 `src/components/PromptSpecHelpDialog.tsx`：`{{name}}`/`{{path}}` 占位说明
- i18n 三语补 promptPreview/promptSpecHelp key
**验收**：弹窗按格式渲染；任务文字本地缓存下次恢复；重新生成清空重拼；复制全部到剪贴板

### 子任务 5：WorkspaceView 标签筛选集成（SkillTagFilter + TagSkillRow）⭐核心
**依赖**：子任务 1、4
**目标**：点标签→主列表替换为该标签关联技能，显示已同步/未安装状态 + 单技能同步按钮
**文件**：
- 新建 `src/views/extensions/SkillTagFilter.tsx`：受控选中（selectedTagIds/onSelectTags 提升到父）、生成按钮（打开 PromptPreviewDialog）、删除旧的 /bmad @yuni @zcode 快捷按钮、生成按钮改白底描边
- 新建 `src/views/extensions/TagSkillRow.tsx`：skill + agentKey + onSynced；`isSynced = skill.targets.some(t=>t.tool===agentKey)`；emerald 已同步徽章 / 未安装徽章 + 同步按钮（调 `syncSkillToTool` 后刷三件套）
- 改 `src/views/WorkspaceView.tsx`：tagFilterSelected state；tagFilteredSkills 计算；选中时主列表替换为 TagSkillRow 网格 + "显示全部"切回；原列表作默认分支保留
- i18n 三语 skillTagFilter 补 synced/notInstalled/sync/syncToAgent/clearFilter/tagFilteredSummary
**验收**：`pnpm lint` + `pnpm build` 通过；点标签→主列表替换→未装项显示同步按钮→点同步→刷新变已同步→显示全部切回

### 子任务 6：同步机制增强（一键 organize）
**依赖**：子任务 1
**目标**：1.txt/4.txt 的"同步skill"按钮——让 agent 目录只保留选中标签关联的技能（删非目标集 + 同步缺失项），按 sync_mode 落地
**文件**：
- 后端新增 `organize_agent_skills(agent_key, keep_skill_ids)` 命令：复用 `sync_engine` + `scenario_service` 的 apply 逻辑——扫描 agent skills_dir 顶层目录，删除不在 keep_skill_ids 的受管理项，对缺失项调 sync_skill 落盘，保留用户手动放入的非受管项
- 修复 handoff-1932 标注的 symlink Bug：organize 后保留项若是 real dir 而非 symlink，需先检测有效性再按 sync_mode 重建
- 前端 SkillTagFilter 加"同步全部到 {agent}"按钮：keepSkillIds = 选中标签关联的全部 ManagedSkill.id
- 同步后三件套刷新
**验收**：点同步全部→agent 目录只剩选中标签技能；切标签再同步→目录更新；symlink 模式生成的是链接

### 子任务 7：AGENTS.md 更新 + 收尾
**依赖**：全部
**目标**：更新仓库根 AGENTS.md，把"未实现"标注改为实际文件路径；同步 project-context；补全 i18n 缺失 key；整体回归测试
**验收**：AGENTS.md 路径准确；三语 key 齐全；完整流程跑通（打标签→选 agent→选标签→生成提示词→同步）

---

## 执行顺序与并行

```
1(后端基础) ──┬→ 2(种子数据)
              ├→ 3(prompt_spec) ──┐
              ├→ 6(同步增强)      ├→ 4(弹窗) → 5(筛选集成) → 7(收尾)
              └───────────────────┘
```
默认按 1→2→3→4→5→6→7 线性推进（符合 AGENTS.md "不停顿、直接推进"）。3、6 可与 2 并行。

## 验证命令（全程）
- Rust：`cargo build`（改数据库前先 `cargo check`，编译需关掉运行中的 exe 避免文件锁）
- 前端：`pnpm lint` + `pnpm build`（tsc -b && vite build）
- 数据库：`sqlite3 ~/.skills-manager/skills-manager.db`（操作前先备份）
- i18n：改 key 必同步 zh/en/zh-TW 三语

## 第一步动作（plan 批准后）
创建 a031 任务结构：`.a031/tasks/skills-tag-system-rebuild.md` 总蓝图 + 引导节点 + 7 个子任务 main.md，然后立即开始子任务 1（Smart Tag 后端）。