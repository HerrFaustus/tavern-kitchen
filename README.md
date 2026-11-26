# 酒馆后厨 0.2.42

酒馆后厨（Tavern Kitchen）是一个 SillyTavern 扩展。系统以**零手工调整、极简自动流**为核心，每次正文回复后自动维护世界状态、非形式化「后台正文」延伸、剧情摘要与创作札记，并把已确认状态与最近/召回原文提供给下一次续写。

`0.2.42` 已完成构建、9 组无头浏览器界面回归与 ZIP 安装包实机复验（构建 `3cb232141b021b32121a`，`release/tavern-kitchen-0.2.42.zip`），一次性落地前端体验、视觉、深浅主题、跨模块联动、流式 DOM 性能、历史死代码清理与零 iframe 统一挂载共 27 项全量优化（Phase 1–4，涵盖 `A1–A11`、`B1–B7`、`C1–C3`、`D1–D3`、`E1–E2`、`F1`）。宿主生成角色正文；每条回复完成后只跑推演，玩家发送下一轮前强制锁定并总结上一楼完成结构化写库，任何缺失、启动或总结失败都会锁定发送并在输入框上方 Agent 横栏要求重试。每份聊天维护单一世界时间线。[成品规则](最终项目目标.md) · [验收记录](docs/validation.json) · [版本历史](历史更新记录.md) · [GitHub Release](https://github.com/HerrFaustus/tavern-kitchen/releases/tag/v0.2.42)

## 安装与开始

1. 全新安装时将 `release/tavern-kitchen-0.2.42.zip`（或仓库目录）解压到宿主的 `public/scripts/extensions/third-party/`，确认 `tavern-kitchen/manifest.json` 与 `tavern-kitchen/dist/host/plugin.js` 在同一扩展目录下，刷新宿主。升级时先在原浏览器的「数据」导出后厨卡，再用新目录覆盖原扩展文件并刷新。沿用原宿主账号、地址和浏览器配置文件即可读回原聊天、IndexedDB 世界以及札记。内置「后厨教程」与幂等升级自检会在启动与切聊时自动守护兼容迁移。
2. 打开聊天，点击顶栏最右的门形图标，或在扩展设置里点击「打开后厨」。顶栏下方显示原生工作台标题栏「酒馆后厨」与六个板块（主角、世界、剧情、编剧、设置、数据）。在「设置 → API → 编辑连接」新建或导入命名连接，填好地址和模型后保存，并分别为总结、推演、编剧 Agent 绑定连接；三者均可直接选择「同酒馆主 API」（支持一键全绑），也可共用一个命名连接。
3. 所有核心业务模块（人物、地点与地图、局势、总结与召回、自动分层与编剧）均固定默认开启，世界状态恒定注入正文；发前总结与开局世界初始化询问均固定开启且不提供关闭开关。未绑定对应 Agent 时会在输入框上方 Agent 横栏直接拦截生成并给出前往「设置 → API」的入口（缺失编剧 Agent 时软提示并放行正文）。

玩家安装时直接使用随包的 `dist/`，无需准备开发环境。界面只读展示经核验的结构化状态与摘要，**不提供任何手动调整世界/摘要/地图数据或剧情校对、剧情线入口**。业务触发操作保留在对应页内：开局「世界 → 世界生成」、总结页手动补齐与楼末「手动总结」（覆盖到最新已完成楼层 `updateEnd`）、编剧「立即生成／更新札记」、数据页后厨卡导入/导出与只读恢复。切换聊天后重新按当前聊天取数，界面跟随酒馆深浅主题。[工作台路由](core/kitchen-workspace.js) · [启动与聊天切换](core/kitchen-runtime.js) · [新手教程](core/kitchen-tutorial.js)

## 0.2.42 本版变化

- **视觉、排版与深浅主题全量修复（`A1–A11`）**：
  - `319px` 桌面窄侧栏下 6 大顶栏板块单行排满不折行；取消全局 `button !important` 暴力覆盖并改用 `:where(...)` 低权重作用域，恢复人物行左对齐、地图树与行内提及样式以及主/次/危险按钮清晰视觉层级。
  - 修复召回轮次下拉框横向溢出（`+37px → 0`）、设置底栏半透明压字重影（改为独立滚动主区 + 不透明固定底栏）、嵌入式与宿主 `<select>` 下拉箭头（含无宿主图标时的 SVG 兜底）、浅色主题输入框/标题条发灰与低对比度状态色、360px 手机端抽屉宽度及教程弹窗底部按钮竖排、楼尾推演框展开重复预览与缺旋转箭头、悬念/局势来源间距与报错提示串台、地图页空操作栏和列表挤占首屏等问题。
- **日常交互补全与宽屏查阅联动（`B1–B7`、`C1–C3`）**：
  - 阻断报错点「收起」保持紧凑红色锁条不再误退回「待命」；发前总结运行中实时显示秒表计时与「取消自动发送」；非尾楼不再误显「重新总结」；宿主居中不透明宽弹窗承接「查看原楼」与「大图查看」交互式区域地图；「设置 → API」新增「一键全绑同酒馆主 API」与切连接未保存草稿提醒；记忆表面内支持 `Esc` 优先关子弹窗或收起侧栏；离线教程 4 节内容与恢复预览中文模块名对齐现行架构。
  - 为总结、人物、局势、悬念与地图列表全面补齐本地即时搜索/筛选及「全部展开/收起」；打通总结 ↔ 人物 ↔ 地图 ↔ 原楼跨模块点击跳转（含地点「在此地的人物」徽章）；主角与人物页顶部新增状态摘要徽章区并统一多端卡片层级。
- **流式 DOM 性能优化、死代码清理与零 iframe 架构统一（`D1–D3`、`E1–E2`、`F1`）**：
  - 收窄 `send-lock`、`agent-status` 与 `kitchen-workspace` 的全树 `MutationObserver`，`floorProgress()` 改为事件驱动缓存计数，彻底消除流式吐字期全扫 `chat[]`；宿主主题同步改用单例 `ensureHostThemeSync` + `requestAnimationFrame` 合批与签名去重；楼尾双框引入 `WeakMap` 变更索引与流式防抖，总结条目超 30 条自动开启分页。
  - **彻底拆除 `story-summary.html` 与 `xiaobai-os.html` 双层 iframe（`F1`）**：全部侧栏子应用改以 Open Shadow DOM（`.tk-embedded-host` + `.tk-surface` 容器查询）原位挂载并走内存直连桥接（零 `<iframe>`、零 `postMessage` 跨窗拷贝与二次文档启动），与酒馆全局样式双向隔离且天然继承 `--SmartTheme*` 主题变量。
  - 累计清理 5 份主样式表退役样式（`story-summary.css` 由 `2,899` 行精简至 `209` 行）及 `113` 个零生产引用死代码/旧 iframe 壳文件（含 `82` 个未入包 3D/旧地图 UI 文件、`modules/agent-core/ui/`、`modules/xiaobai-os/apps/world/ui/`、`modules/debug-panel/`、`widgets/message-toolbar.js` 及 `story-summary.html`、`xiaobai-os.html`、`first-party-iframe-app.js`、`frame-bridge.ts`、`host.css` 等），移除 `three`、`@types/three`、`meshoptimizer`、`showdown` 四项冗余依赖，构建收敛为 `8` 入口、`675` 模块、`45` 分块。

## 当前能做什么

| 入口 | 用法与数据边界 |
| --- | --- |
| 主角 | 只读查看玩家的属性、位置、关系、持有物和个人计划。用玩家名、明确别名或地图玩家绑定辨认主角，同名且无法区分时分别保留。[身份匹配](modules/story-state/protagonist-identity.js) · [主角页](modules/story-state/view.js) |
| 世界 | 「人物」支持搜索、在场筛选、状态与地点标签及交接原楼跳转；「局势」分只读事态和风物并支持关键词筛选与原楼居中查看；「地图」支持地点搜索、区域示意、居中大图交互弹窗、局部示意与「在此地的人物」点击联动；「世界生成」用于开局建档。[只读状态视图](modules/story-state/view.js) · [地图浏览](modules/xiaobai-os/apps/map/ui/AtlasBrowser.vue) · [地点详情](modules/xiaobai-os/apps/map/ui/MapApp.vue) |
| 剧情 | 「总结」页头显示已总结与待总结楼数及「手动补齐总结」按钮（覆盖到最新已完成楼层 `updateEnd`），按分层树展开自动压缩节点与逐楼来源；「召回」按轮展示检索模式、焦点人物、命中/重排得分与裁剪片段（包含已结算楼的后台正文）；「悬念」跟踪未解与结案事项。不再提供「剧情线」与「校对」。[总结与召回界面](modules/story-summary/story-summary-ui.js) · [分层摘要](modules/story-summary/data/summary-layers.js) |
| 编剧 | 单作家直接面向**世界状态、剧情总结（分层 + 近期 `L0`）与相关原文（近期对白含后台正文 + `recallRawMemory` 早期召回）**围绕「人物」与「局势」生成点评、走向预测与建议。全局稿默认折叠，章节稿供正文选用；支持手动更新，并在自动 `L2` 章节压缩完成后触发 `onChapter()`。仅打开或展开札记时不调用模型。[编剧入口](modules/story-planner/host.js) · [札记构造](modules/story-planner/notes.js) |
| 设置 | 下设三个子页：「API」管理命名连接、总结/推演/编剧三类 Agent 绑定、向量与重排服务及调用统计，全部文本 Agent 可选「同酒馆主 API」；「剧情与召回」提供隐藏已总结楼层（默认开启）、保留原文轮数（默认 `0`，即隐藏全部已总结楼层）、早期原文召回注入、召回超时及向量索引补齐/重建；「世界与推演」仅保留街头见闻/推演风味偏好（关闭/偶尔/频繁），世界状态注入与发前总结固定开启。[连接设置](modules/text-api/settings-ui.js) · [世界偏好设置](modules/xiaobai-os/apps/world/evolution-view.ts) |
| 数据 | 导出、导入后厨卡，预览来源冲突与受影响世界效果，确认后在当前世界原位撤回并从断点重记，兼容历史 `0.2.32–0.2.35` 存档。[后厨卡格式](modules/kitchen-data/card.js) · [世界恢复](modules/world-records/recovery-panel.js) |

### 双时序流水线、楼尾双框与自动分层

- **生成即推演，发送前总结（无滞后）**：每条已选定叙事 AI 回复完成后，只由推演 Agent（`simulation`）生成楼尾后台正文；玩家发送 `normal` / `continue` / `group` 前，拦截器锁定队列并由总结 Agent（兼容绑定键 `update`）结算上一段（配对玩家发言 + 上一楼 AI 回复 + 该楼后台正文），随后放行正文。`swipe` / `regenerate` 跳过待替换楼。失败、缺绑定、启动未就绪或拦截器异常一律中止发送，不静默放行。[双边界定义](modules/story-summary/data/turn-bounds.js) · [队列调度](core/turn-queue.js) · [楼层宿主](core/floor-host.js)
- **每楼独立推演后台正文（`simulationEnd`）**：推演 Agent 在每条最新叙事 AI 回复完成后独立调用一次，产出非形式化的「后台正文」延伸（未满足特定人物/局势条件时输出风味/琐碎见闻，满足条件时写幕后动向），单独存入 `floorSimulations` 并绑定候选与原文指纹，**不直接写结构化总结或世界账本**；最新楼 Swipe 或重生成时自动作废重推，零 `worldArchive` 冲突。升级前已完成更新结算的历史旧楼不追溯补跑推演。[后台正文生成](modules/world-records/turn-processing.js)
- **正文注入深度与召回切片**：生成下一条正文前，刚在发送前完成结算的权威世界状态按 `depth = 1` 紧贴注入（`swipe` 替换当前最新回复时按 `depth = 2` 注入在待替换回复之前），不再滞后挂起未结算草稿。某楼结算后，其 `[主楼 + 后台正文]` 一并纳入词法与向量原文切片供 `raw-recall` 检索；未结算楼的新鲜后台正文不提前进入历史召回索引。总结落库后会取消旧召回预取并按新状态重建。[正文注入宿主](modules/world-records/generation-host.js) · [原文召回](modules/story-summary/vector/retrieval/raw-recall.js)
- **楼尾只读双框与默认全隐藏**：每条叙事 AI 回复底部统一挂载上下双框：上方「更新框」显示总结与从世界模块投影的「本楼变更」，未总结楼支持直接点击「手动总结」（已总结尾楼支持「重新总结」），下方「推演框」显示该楼「后台正文」及必要错误重试，全前端推演统一收敛至此。设置默认 `hideSummarized: true` 与 `keepVisibleCount: 0`（从旧版默认 `5` 自动迁移为 `0`）。[楼尾双框投影](modules/story-summary/floor-summary.js) · [配置与迁移](modules/story-summary/data/config.js)
- **自动分层压缩**：原独立校对模块与 `memory` 模型槽位已移除。[`summary-layers.js`](modules/story-summary/data/summary-layers.js) (`minDepth = 0`) 与 [`chapter-processing.js`](core/chapter-processing.js) 在发送前结算中由总结 Agent 自动推进 `L0 → L1(stage) → L2(chapter) → L3+` 压缩，并在生成新 `L2` 章节后标记待编剧状态触发 `planner.onChapter()`。

### 存档、迁移与恢复

- **兼容旧聊与旧后厨卡**：`0.2.32–0.2.36` 升级后保留原有世界与总结历史，对已结算旧楼不补跑推演，此前因滞后未总结的末尾已完成 AI 楼会在下次发送或手动补齐时顺畅结算；旧存档或旧后厨卡内的 `plotLines`、`maintenance`、`floorDrafts`、`arcs`、废弃地图配置字段只读兼容忽略，旧默认 `keepVisibleCount = 5` 自动迁移至 `0`，忽略旧 `injectToStory: false`。
- **原位恢复与存储守恒**：聊天元数据保存总结历史、来源回执、`floorWork` 与 `floorSimulations`；IndexedDB 中的 `TavernKitchen_WorldArchive`、`TavernKitchen.StoryPlanner`、`TavernKitchen_Memory` 分别承载世界、编剧札记与原文索引。保留大聊天回读降级、IndexedDB 文件镜像回退与 `CHAT_DELETED` 三库级联清理。[总结提交](modules/story-summary/data/memory-commit.js) · [恢复面板](modules/world-records/recovery-panel.js)

## 开发与验证范围

宿主从清单加载 `dist/host/plugin.js`；工作台与核心运行时位于 `core/` 与 `modules/`。[扩展清单](manifest.json) · [启动源码](plugin-entry.js) · [打包脚本](scripts/package.py)

在仓库根目录（Node.js `24.22.3`、pnpm `11.25.0`、Python `3.9.6`）执行以下命令可复现本版构建与验证：

```sh
pnpm build
pnpm check
node scripts/typecheck.mjs
node scripts/check-project.mjs
node scripts/check-ui.mjs
python3 scripts/package.py
node scripts/check-versions.mjs
node scripts/check-installation.mjs release/tavern-kitchen-0.2.42.zip > release/install-verification.json
```

- 本版已通过本地 `node scripts/quality.mjs`（含 ESLint `--max-warnings 0`、版本/边界/乱码/相对导入/退役变量检查）、`node scripts/typecheck.mjs`、`node scripts/build.mjs`、`node scripts/check-project.mjs`、`node scripts/check.mjs`（含 `1455` 项单元测试 0 失败 0 跳过与 `node scripts/check-runtime.mjs` `result=PASS`）、`9` 组无头浏览器界面回归（`node scripts/check-ui.mjs`）、`python3 scripts/package.py`、`node scripts/check-versions.mjs` 及 `node scripts/check-installation.mjs release/tavern-kitchen-0.2.42.zip` 最终 ZIP 复装验真。
- 真实酒馆宿主与在线模型的长程游玩不在自动化验收范围内。[验收凭据](docs/validation.json)

## 署名与许可

Based on LittleWhiteBox by biex. 酒馆后厨由浮士德工坊在小白X基础上删改。上游声明、各素材许可证和构建依赖许可随源码及安装包分发。[LittleWhiteBox](https://github.com/RT15548/LittleWhiteBox) · [上游许可证](docs/LICENSE.md) · [版权声明](docs/COPYRIGHT) · [NOTICE](docs/NOTICE) · [构建依赖许可](dist/THIRD-PARTY-LICENSES.md) · [修改与素材来源](历史更新记录.md#来源与素材)
