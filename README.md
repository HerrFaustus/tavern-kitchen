# 酒馆后厨 0.2.38

酒馆后厨（Tavern Kitchen）是一个 SillyTavern 扩展。系统以**零手工调整、极简自动流**为核心，每次正文回复后自动维护世界状态、非形式化「后台正文」延伸、剧情摘要与创作札记，并把已确认状态与最近/召回原文提供给下一次续写。

`0.2.38` 已完成构建、9 组无头浏览器界面回归与 ZIP 安装包实机复验（构建 `d168163e6faf2dcfcf13`，`release/tavern-kitchen-0.2.38.zip`），在 `0.2.37` 主干基线上补齐常驻待命提示条、楼末世界变更与总结对接及楼末「手动总结」按钮。宿主生成角色正文；每条回复完成后只跑推演，玩家发送下一轮前强制总结上一楼并完成结构化写库，任何缺失、启动或总结失败都会中止发送并在输入框上方 Agent 横栏要求重试。每份聊天维护单一世界时间线。[成品规则](最终项目目标.md) · [验收记录](docs/validation.json) · [版本历史](历史更新记录.md) · [GitHub Release](https://github.com/HerrFaustus/tavern-kitchen/releases/tag/v0.2.38)

## 安装与开始

1. 全新安装时将 `release/tavern-kitchen-0.2.38.zip`（或仓库目录）解压到宿主的 `public/scripts/extensions/third-party/`，确认 `tavern-kitchen/manifest.json` 与 `tavern-kitchen/dist/host/plugin.js` 在同一扩展目录下，刷新宿主。升级时先在原浏览器的「数据」导出后厨卡，再用新目录覆盖原扩展文件并刷新。沿用原宿主账号、地址和浏览器配置文件即可读回原聊天、IndexedDB 世界以及札记。内置「后厨教程」与幂等升级自检会在启动与切聊时自动守护兼容迁移。
2. 打开聊天，点击顶栏最右的门形图标，或在扩展设置里点击「打开后厨」。顶栏下方显示原生工作台标题栏「酒馆后厨」与六个板块（主角、世界、剧情、编剧、设置、数据）。在「设置 → API → 编辑连接」新建或导入命名连接，填好地址和模型后保存，并分别为总结、推演、编剧 Agent 绑定连接；三者均可直接选择「同酒馆主 API」，也可共用一个命名连接。
3. 所有核心业务模块（人物、地点与地图、局势、总结与召回、自动分层与编剧）均固定默认开启，世界状态恒定注入正文；发前总结与开局世界初始化询问均固定开启且不提供关闭开关。未绑定对应 Agent 时会在输入框上方 Agent 横栏直接拦截生成并给出前往「设置 → API」的入口（缺失编剧 Agent 时软提示并放行正文）。

玩家安装时直接使用随包的 `dist/`，无需准备开发环境。界面只读展示经核验的结构化状态与摘要，**不提供任何手动调整世界/摘要/地图数据或剧情校对、剧情线入口**。业务触发操作保留在对应页内：开局「世界 → 世界生成」、总结页手动补齐与楼末「手动总结」（覆盖到最新已完成楼层 `updateEnd`）、编剧「立即生成／更新札记」、数据页后厨卡导入/导出与只读恢复。切换聊天后重新按当前聊天取数，界面跟随酒馆主题。[工作台路由](core/kitchen-workspace.js) · [启动与聊天切换](core/kitchen-runtime.js) · [新手教程](core/kitchen-tutorial.js)

## 0.2.38 本版变化

- **输入框上方 Agent 横栏常驻待命**：[`core/agent-status.js`](core/agent-status.js) 与 [`core/floor-host.js`](core/floor-host.js) 新增待命态 [`setAgentIdleStatus`](core/agent-status.js) 与 [`syncIdleStatus`](core/floor-host.js)，挂载后不再隐藏 `#tk-agent-status`，空闲及收起报错后显示当前已总结/待总结楼数并提供「手动总结 / 打开后厨」快捷按钮；未解决的阻塞报错仍受保护不被常规 `info` 通知覆盖，`GENERATION_STOPPED` 后同步解锁 `streamStart` 并恢复待命栏。
- **楼末更新框对接世界模块与「手动总结」按钮**：[`modules/story-summary/floor-summary.js`](modules/story-summary/floor-summary.js) 新增 `worldChangesForFloor` 直接从 `world.sources` + `world.events` 投影「本楼变更」，并在 [`modules/story-summary/story-summary.js`](modules/story-summary/story-summary.js) 中补齐楼末快照 `world`（同时在 `readWorld === true` 分支跳过 `worldAuthorityForContext` 防止与 [`getWorldMemorySnapshot`](modules/story-summary/story-summary.js) 互调递归）；楼末更新框新增「手动总结 / 立即手动总结本楼 / 重新总结」按钮直连 `floorHost.summarizeFloor`，未总结楼保留已有后台推演并补齐总结，已总结尾楼支持基于 `turnById` 精确重跑与 `worldService.rewind(world, targetVersion)` 回退。
- **总结 JSON 与实体写回容错补强**：[`modules/world-records/turn-actions.js`](modules/world-records/turn-actions.js) 与 [`modules/world-records/turn-processing.js`](modules/world-records/turn-processing.js) 兼容模型返回顶层分桶、常见中英别名字段、字符串地名/持有者、跨组引用顺序依赖、`item` 全楼名匹配与宽松 `story` 字段，并在跳过开局建档时自动定位或创建主角实体（主角交易与扣款护栏保持不变）。
- **承接 `0.2.37` 主干能力**：保留发送前总结与严格 fail-closed 拦截、全部文本 Agent 复用「同酒馆主 API」、开局全量世界书读取与固定询问、柏宝书分桶契约、发前立即隐藏已总结楼层及工作台只读实时刷新。

## 当前能做什么

| 入口 | 用法与数据边界 |
| --- | --- |
| 主角 | 只读查看玩家的属性、位置、关系、持有物和个人计划。用玩家名、明确别名或地图玩家绑定辨认主角，同名且无法区分时分别保留。[身份匹配](modules/story-state/protagonist-identity.js) · [主角页](modules/story-state/view.js) |
| 世界 | 「人物」按姓名和身份/位置/近期记录展示只读档案，重名实体带出身辨识与交接原楼跳转；所有权缺依据时显示未知。「局势」分只读事态和风物；「地图」支持区域图、局部二维/三维场景浏览；「世界生成」用于开局建档。[只读状态视图](modules/story-state/view.js) · [地图浏览](modules/xiaobai-os/apps/map/ui/AtlasBrowser.vue) · [地点详情](modules/xiaobai-os/apps/map/ui/MapApp.vue) |
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
node scripts/check-installation.mjs release/tavern-kitchen-0.2.38.zip > release/install-verification.json
```

- 本版已通过本地 `node scripts/quality.mjs`（含 ESLint `--max-warnings 0`、版本/边界/乱码/相对导入/退役变量检查）、`node scripts/typecheck.mjs`、`node scripts/build.mjs`、`node scripts/check-project.mjs`、`node scripts/check.mjs`（含 `1441` 项单元测试 0 失败 0 跳过与 `node scripts/check-runtime.mjs` `result=PASS`）、`9` 组无头浏览器界面回归（`node scripts/check-ui.mjs`）、`python3 scripts/package.py`、`node scripts/check-versions.mjs` 及 `node scripts/check-installation.mjs release/tavern-kitchen-0.2.38.zip` 最终 ZIP 复装验真。
- 真实酒馆宿主与在线模型的长程游玩不在自动化验收范围内。[验收凭据](docs/validation.json)

## 署名与许可

Based on LittleWhiteBox by biex. 酒馆后厨由浮士德工坊在小白X基础上删改。上游声明、各素材许可证和构建依赖许可随源码及安装包分发。[LittleWhiteBox](https://github.com/RT15548/LittleWhiteBox) · [上游许可证](docs/LICENSE.md) · [版权声明](docs/COPYRIGHT) · [NOTICE](docs/NOTICE) · [构建依赖许可](dist/THIRD-PARTY-LICENSES.md) · [修改与素材来源](历史更新记录.md#来源与素材)
