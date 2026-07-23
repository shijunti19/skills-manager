-- Smart Tag 种子数据：12 个全栈工作流标签
--
-- 用途：新装 skills-manager 后运行一次，建立全栈标签骨架。
-- 运行：sqlite3 ~/.skills-manager/skills-manager.db ".read scripts/seed-smart-tags.sql"
-- 幂等：INSERT OR IGNORE，重复运行安全。
--
-- 设计（来自 .a031/content/3.txt）：
--   - 全部 agents='[]'（全局通用，任意 agent 页面可见可筛选）
--   - 每个标签含中文 description + 中文 prompt（协调指令，拼到生成的提示词尾部）
--   - 绑定关系按 skill name 匹配（子查询），自动适配任意技能库
--   - 排除 deprecated/空描述变体

BEGIN TRANSACTION;

-- ── 12 个标签定义（stable id: tag-seed-01..12）──

INSERT OR IGNORE INTO smart_tags (id, name, agents, description, prompt, sort_order, created_at, updated_at) VALUES
('tag-seed-01', '🚀 项目初始化', '[]',
 '新项目或老项目接入 AI 工作流的第一步。建索引、生成项目结构、规则文件、缓存，让后续 AI 操作省 token、可追溯。',
 '项目接入 AI 工作流的标准启动流程：先用 a031-bootstrap 建索引并初始化 .a031；再用 bmad-generate-project-context 生成项目上下文；setup-matt-pocock-skills 落地 AGENTS.md 规则。wayfinder 做大块工作规划，find-skills 发现技能。按"最少 token、最少文件读取"原则执行。',
 1, strftime('%s','now')*1000, strftime('%s','now')*1000);

INSERT OR IGNORE INTO smart_tags (id, name, agents, description, prompt, sort_order, created_at, updated_at) VALUES
('tag-seed-02', '🎯 需求对齐', '[]',
 '动手写代码前先把需求彻底问清楚。AI 反复拷问、压力测试你的想法，防止返工，每次改动前必用。',
 '动手实现前必须先用这组技能把需求彻底对齐，这是防止返工的关键：grill-me / grill-with-docs 针对具体计划深挖；bmad-forge-idea 压力测试想法；ask-matt 路由到合适流程；zoom-out 拉宽视野。先把需求问清楚再写代码。',
 2, strftime('%s','now')*1000, strftime('%s','now')*1000);

INSERT OR IGNORE INTO smart_tags (id, name, agents, description, prompt, sort_order, created_at, updated_at) VALUES
('tag-seed-03', '📋 规划与文档', '[]',
 '把对齐后的需求转成 PRD、产品规格、技术 spec、任务拆分。BMAD 全流程规划 + Matt 的转换工具。',
 '需求对齐后进入规划阶段，产出可执行的文档：bmad-product-brief / bmad-prd 产出产品需求；to-spec / bmad-spec 转技术规格；to-tickets / bmad-create-epics-and-stories / to-issues 拆成可执行任务；bmad-domain-research / bmad-market-research 做调研支撑。',
 3, strftime('%s','now')*1000, strftime('%s','now')*1000);

INSERT OR IGNORE INTO smart_tags (id, name, agents, description, prompt, sort_order, created_at, updated_at) VALUES
('tag-seed-04', '🏛️ 架构设计', '[]',
 '系统架构脊柱、领域建模、DDD 统一语言、深度模块设计。决定项目骨架的关键技能。',
 '规划完成后、动手写业务代码前用这组搭骨架：bmad-architecture / bmad-create-architecture 产架构脊柱；bmad-agent-architect 是架构师 agent；domain-modeling + ubiquitous-language 建领域模型和统一语言；codebase-design / setup-ts-deep-modules 设计深度模块。遵循 force=false 不覆盖原则。',
 4, strftime('%s','now')*1000, strftime('%s','now')*1000);

INSERT OR IGNORE INTO smart_tags (id, name, agents, description, prompt, sort_order, created_at, updated_at) VALUES
('tag-seed-05', '⚙️ Rust系统开发', '[]',
 'Rust 后端/系统层开发。包含 bmad agent 编码、快速实现、按规格落地、TDD 红绿重构。',
 'Rust 系统/后端开发用这组技能：bmad-agent-dev 按填充好上下文的 story 文件严格实现，资深工程师级编码；bmad-quick-dev 做小改动、bug 修复、需求调整，产出干净可运行的代码，遵循项目现有架构；implement 按规格或 ticket 集合落地一段工作；bmad-dev-story / bmad-dev-auto / bmad-create-story 执行 story 实现、无人值守开发循环、创建完整上下文 story 文件；tdd 强制红→绿→重构循环。验证：用 cargo test 验证；跨模块改动确认 API 兼容和数据流一致。',
 5, strftime('%s','now')*1000, strftime('%s','now')*1000);

INSERT OR IGNORE INTO smart_tags (id, name, agents, description, prompt, sort_order, created_at, updated_at) VALUES
('tag-seed-06', '🎨 Vue前端开发', '[]',
 'Vue3 全家桶最佳实践：Composition API、JSX、Pinia、Router、测试、可组合函数、UI 界面。',
 'Vue 前端开发用这组技能：vue-best-practices 强制 Composition API；按场景用 vue-pinia / vue-router / vue-jsx / vue-options-api 对应最佳实践；create-adaptable-composable 写库级 composable；vue-testing-best-practices + vue-debug-guides 做测试和调试；ui-styling / ui-ux-pro-max / design-an-interface 做界面。',
 6, strftime('%s','now')*1000, strftime('%s','now')*1000);

INSERT OR IGNORE INTO smart_tags (id, name, agents, description, prompt, sort_order, created_at, updated_at) VALUES
('tag-seed-07', '🐘 PHP后端开发', '[]',
 'Laravel 应用部署到 Cloud、Nightwatch 监控、starter kit 升级、知识库管理。',
 'PHP / Laravel 后端开发用这组技能：deploying-laravel-cloud 部署管理；configure-nightwatch 配数据采集；starter-kit-upgrade 选择性升级；obsidian-vault 管理笔记知识库。注意数据库操作用专用 db_mcp。',
 7, strftime('%s','now')*1000, strftime('%s','now')*1000);

INSERT OR IGNORE INTO smart_tags (id, name, agents, description, prompt, sort_order, created_at, updated_at) VALUES
('tag-seed-08', '🧪 测试与QA', '[]',
 'TDD 红绿重构、E2E 端到端测试生成、交互式 QA 收集、Web 应用测试。质量内建。',
 '质量内建，测试驱动开发：tdd 强制红→绿→重构循环；bmad-qa-generate-e2e-tests 生成端到端测试；qa 交互式 bug 收集；webapp-testing 测试本地 web 应用；scaffold-exercises 搭练习结构。Rust 用 cargo test，Vue 用 Vitest，PHP 用 PHPUnit。',
 8, strftime('%s','now')*1000, strftime('%s','now')*1000);

INSERT OR IGNORE INTO smart_tags (id, name, agents, description, prompt, sort_order, created_at, updated_at) VALUES
('tag-seed-09', '🔍 代码审查与重构', '[]',
 '代码审查、对抗式多层 review、边界用例猎手、验证缺口检查、架构改进、重构计划。',
 '提交前的质量关，以及防止架构腐化：code-review / bmad-code-review 审代码；bmad-review-adversarial-general / bmad-review-edge-case-hunter / bmad-review-verification-gap 三个 reviewer 并行跑；improve-codebase-architecture 每3-5个任务跑一次防架构腐化；request-refactor-plan 出重构计划。遵循"失败即修复即推进"。',
 9, strftime('%s','now')*1000, strftime('%s','now')*1000);

INSERT OR IGNORE INTO smart_tags (id, name, agents, description, prompt, sort_order, created_at, updated_at) VALUES
('tag-seed-10', '🐛 Bug诊断', '[]',
 '硬 bug 和性能回归的纪律性诊断循环，Five Whys 根因分析、重大变更管理。',
 'Bug 修复用纪律性诊断循环，而非瞎猜瞎改：diagnose / diagnosing-bugs 走 Five Whys + 鱼骨图定位根因；bmad-correct-course 管理执行中的重大变更；migrate-to-shoehorn 处理 TS 类型迁移；bmad-retrospective 复盘。先定位根因再修，禁止盲改。',
 10, strftime('%s','now')*1000, strftime('%s','now')*1000);

INSERT OR IGNORE INTO smart_tags (id, name, agents, description, prompt, sort_order, created_at, updated_at) VALUES
('tag-seed-11', '✍️ 写作与内容', '[]',
 '文章编辑、写作工作流（挖素材→搭节奏→塑形）、品牌视觉、设计系统、PPT、Banner、网页克隆。',
 '内容创作和写作用这组技能：写作三件套按顺序用 writing-fragments（挖素材）→ writing-beats（搭节奏）→ writing-shape（塑形）；edit-article 改文章；slides 做 HTML 演示；banner-design 设计横幅；brand / design / design-system 做品牌视觉；clone-website 一键克隆网站；seedance-prompt-en 写多模态 AI 提示词。',
 11, strftime('%s','now')*1000, strftime('%s','now')*1000);

INSERT OR IGNORE INTO smart_tags (id, name, agents, description, prompt, sort_order, created_at, updated_at) VALUES
('tag-seed-12', '🧹 上下文管理', '[]',
 '整理压缩当前对话，生成交接文档，新开会话省 token。长会话必用，防止上下文超限。',
 '上下文管理，长会话和会话切换时必用：handoff 把当前对话压缩成交接文档供新会话继续；claude-handoff 把当前对话转交给新的后台 agent；workspace-memory 当静默记忆秘书；caveman 极限压缩通信模式，减少约 75% token 使用；to-questionnaire 把无法完全回答的决策转成问卷，分批解决。铁律：上下文变长时立即整理，不要硬撑浪费 token；新会话先读交接文档恢复上下文。',
 12, strftime('%s','now')*1000, strftime('%s','now')*1000);


-- ── 技能绑定关系（按 skill name 匹配，自动适配任意技能库）──
-- 用 INSERT OR IGNORE + 子查询，只绑定技能库中实际存在的技能。

-- 标签1 项目初始化
INSERT OR IGNORE INTO skill_smart_tag_relations (skill_id, smart_tag_id)
SELECT id, 'tag-seed-01' FROM skills WHERE name IN
('a031-bootstrap','bmad-generate-project-context','setup-matt-pocock-skills',
 'bmad-document-project','bmad-customize','write-a-skill','skill-creator',
 'git-guardrails-claude-code','find-skills','wayfinder','setup-pre-commit');

-- 标签2 需求对齐
INSERT OR IGNORE INTO skill_smart_tag_relations (skill_id, smart_tag_id)
SELECT id, 'tag-seed-02' FROM skills WHERE name IN
('grill-me','grill-with-docs','grilling','batch-grill-me','loop-me',
 'bmad-forge-idea','bmad-party-mode','ask-matt','zoom-out','bmad-help');

-- 标签3 规划与文档
INSERT OR IGNORE INTO skill_smart_tag_relations (skill_id, smart_tag_id)
SELECT id, 'tag-seed-03' FROM skills WHERE name IN
('bmad-product-brief','bmad-prd','bmad-create-prd','bmad-edit-prd','bmad-validate-prd',
 'bmad-prfaq','to-prd','to-spec','bmad-spec','to-tickets','bmad-create-epics-and-stories',
 'to-issues','bmad-domain-research','bmad-market-research','research','bmad-index-docs',
 'bmad-shard-doc','bmad-agent-pm','bmad-agent-analyst','bmad-agent-tech-writer',
 'bmad-agent-ux-designer','bmad-sprint-status','bmad-sprint-planning');

-- 标签4 架构设计
INSERT OR IGNORE INTO skill_smart_tag_relations (skill_id, smart_tag_id)
SELECT id, 'tag-seed-04' FROM skills WHERE name IN
('bmad-architecture','bmad-create-architecture','bmad-agent-architect',
 'domain-modeling','codebase-design','ubiquitous-language','setup-ts-deep-modules',
 'bmad-technical-research');

-- 标签5 Rust系统开发
INSERT OR IGNORE INTO skill_smart_tag_relations (skill_id, smart_tag_id)
SELECT id, 'tag-seed-05' FROM skills WHERE name IN
('bmad-agent-dev','bmad-quick-dev','implement','tdd','bmad-dev-story',
 'bmad-dev-auto','bmad-create-story');

-- 标签6 Vue前端开发
INSERT OR IGNORE INTO skill_smart_tag_relations (skill_id, smart_tag_id)
SELECT id, 'tag-seed-06' FROM skills WHERE name IN
('vue-best-practices','vue-jsx-best-practices','vue-options-api-best-practices',
 'vue-pinia-best-practices','vue-router-best-practices','vue-testing-best-practices',
 'vue-debug-guides','create-adaptable-composable','ui-styling','ui-ux-pro-max',
 'design-an-interface','bmad-ux','prototype','accessibility');

-- 标签7 PHP后端开发
INSERT OR IGNORE INTO skill_smart_tag_relations (skill_id, smart_tag_id)
SELECT id, 'tag-seed-07' FROM skills WHERE name IN
('deploying-laravel-cloud','configure-nightwatch','starter-kit-upgrade','obsidian-vault');

-- 标签8 测试与QA
INSERT OR IGNORE INTO skill_smart_tag_relations (skill_id, smart_tag_id)
SELECT id, 'tag-seed-08' FROM skills WHERE name IN
('tdd','bmad-qa-generate-e2e-tests','qa','webapp-testing','scaffold-exercises',
 'bmad-check-implementation-readiness');

-- 标签9 代码审查与重构
INSERT OR IGNORE INTO skill_smart_tag_relations (skill_id, smart_tag_id)
SELECT id, 'tag-seed-09' FROM skills WHERE name IN
('code-review','bmad-code-review','bmad-review-adversarial-general',
 'bmad-review-edge-case-hunter','bmad-review-verification-gap',
 'improve-codebase-architecture','request-refactor-plan',
 'resolving-merge-conflicts','bmad-checkpoint-preview');

-- 标签10 Bug诊断
INSERT OR IGNORE INTO skill_smart_tag_relations (skill_id, smart_tag_id)
SELECT id, 'tag-seed-10' FROM skills WHERE name IN
('diagnose','diagnosing-bugs','bmad-correct-course','migrate-to-shoehorn','bmad-retrospective');

-- 标签11 写作与内容
INSERT OR IGNORE INTO skill_smart_tag_relations (skill_id, smart_tag_id)
SELECT id, 'tag-seed-11' FROM skills WHERE name IN
('edit-article','writing-fragments','writing-beats','writing-shape','slides',
 'banner-design','brand','design','design-system','clone-website','seedance-prompt-en',
 'bmad-editorial-review-prose','bmad-editorial-review-structure','writing-great-skills','wizard');

-- 标签12 上下文管理
INSERT OR IGNORE INTO skill_smart_tag_relations (skill_id, smart_tag_id)
SELECT id, 'tag-seed-12' FROM skills WHERE name IN
('handoff','claude-handoff','workspace-memory','caveman','to-questionnaire','teach');

COMMIT;

-- ── 验证 ──
SELECT '标签数: ' || COUNT(*) FROM smart_tags;
SELECT '绑定数: ' || COUNT(*) FROM skill_smart_tag_relations;
SELECT t.name || ': ' || COUNT(r.skill_id) || ' 个技能'
  FROM smart_tags t LEFT JOIN skill_smart_tag_relations r ON t.id = r.smart_tag_id
  GROUP BY t.id ORDER BY t.sort_order;
