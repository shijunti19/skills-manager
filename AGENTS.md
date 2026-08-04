# Skills Manager — 项目指南

<!-- ⚠ a031 治理：数据按时期分组，>3天旧数据自动归档到 .a031/。手动编辑请保留此声明。 -->

## 系统说明

> 完整文档在 `.a031/docs/系统说明/`，按需 Read，禁止整份灌入。

| 文档 | 内容 |
| --- | --- |
| [页面与数据流](.a031/docs/系统说明/页面与数据流.md) | 页面位置表 / 数据来源 / 其他组件索引 |
| [智能标签系统](.a031/docs/系统说明/智能标签系统.md) | smart_tags 后端 7 命令 / DB 表 / 前端绑定技能输入 |
| [同步逻辑](.a031/docs/系统说明/同步逻辑.md) | syncSkillToTool / organizeAgentSkills / 同步判定 / 刷新三件套 |
| [提示词生成](.a031/docs/系统说明/提示词生成.md) | assemblePrompt / 占位符 / 路径转换 |

## 当前未完成的任务

> 详见 `.a031/tasks/deferred-work.md`（review 发现的既有问题，非 bug 修复引入）。

- **智能标签绑定串行 await 无事务 + stale map**（critical）：`handleSave` 逐技能串行 `bindSmartTagsToSkill`（后端 DELETE+INSERT 全量替换），中途失败部分提交无回滚；重试用旧 map 可能抹掉外部新增绑定。方向：后端批量事务接口 / catch 后强制 loadAll。
- **containment 模糊匹配静默误绑**（major）：`parseSkillsText` 的 containment fallback 让输入 "code" 静默命中 code-review，预览不显示命中名。方向：预览列出 matched 名 / 删 containment 分支。

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
