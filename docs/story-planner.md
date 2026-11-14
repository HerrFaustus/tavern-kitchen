# 编剧与剧情线协同机制

`modules/story-planner/` 是后厨中唯一的后台编剧，从当前世界状态、角色状态与剧情线总结中读取已核验资料，分别生成跨轮演进的 `global`（全局札记）和供给当轮正文的 `chapter`（章节札记）。

## 1. 下游规划材料流向

1. **剧情线总结（`modules/story-state/plot-lines.js`）**
   - 单楼回复提取与增量总结会在每轮抽取出 `plotLines`（含 `title`、`status`、`reading`、`quote` 及可选 `summary`、`characters`、`nextFocus`），且仅当 `quote` 逐字出自该轮真实 `summary` 时采信。
   - `collectPlotLines` / `summarizePlotLines` 将结构化记录（`plan`、`suspense`、`situation`）与所有有效历史轮次的剧情线进展合并，按楼层汇总出完整时间线 `beats`、涉及人物 `characters`、关联局势 `situationIds`、当前焦点 `nextFocus` 与累计脉络 `summary`。
   - `plotLineStateDigest` 汇总每条线的状态、累计总结、最新楼层、当前焦点与涉及人物；任一字段推进或回滚都会刷新 `lineState`，自动触发编剧重算（`chapter-change`）。
2. **三类规划实体组装（`buildPlanningTargets`）**
   - `plannerSnapshot` 与 `writerInput` 将规划材料明确收口为三类实体：
     - **人物（`characters`）**：实体的公开属性、标注清晰的管理员私有字段（`管理员私有/...`）、在场度与依据、认知清单（`knowledge`）、个人计划/目标（`agendas`）以及关联剧情线。
     - **剧情线（`plotLines`）**：直接承接 `collectPlotLines` 产出的汇总总结与 `beats` 轨迹；`potential` 线仅作未证实联系，`closed` 线仅作背景。
     - **局势（`situations`）**：非景物类局势与未结悬念的涉及方、范围、影响、解除条件、期限、历史与幕后进展。

## 2. 实体札记结构与安全护栏

- **结构化规划输出**：编剧的 `global` 与 `chapter` 以 `人物（characters）`、`剧情线（plotLines）`、`局势（situations）` 为唯一规划对象，对每个实体输出三段式分析：
  - `commentary`（**点评**）：动机代价、认知边界、线头张力与矛盾评估；
  - `prediction`（**走向预测**）：基于既定条件的短期/多向态势推演（绝不替玩家决定行动或伪造已发生事实）；
  - `suggestion`（**建议**）：面向全局铺垫或当章正文呈现的可执行动作/氛围/信息边界建议。
- **兼容性与文本渲染**：模型可提交 `entities` 分组并省略 `text`，由 `formatPlannerEntities` 自动排版成面向正文写手的 `【本章札记】` 纯文本；同时继续兼容纯 `{ text, dependencies }` JSON 返回。
- **隐私与前提校验**：`chapter.text` 与 `chapter.entities` 内所有字段均受宿主宏检查（禁止 `{{`）及 `管理员私有/` 字段值过滤（禁止把后台秘密泄入章节稿）；`global` 仍收起于折叠面板（默认关闭，剧透防护）。
- **分支与撤销隔离**：札记按 `owner`（账号+聊天/世界分支）与聊天前缀摘要存储于 IndexedDB，切换聊天、改写/删除楼层、更新剧情线或世界版本失效时立即失活，不复用陈旧稿件，也不污染聊天原文。

## 3. 原生界面展示

`modules/story-planner/settings-view.js` 与 `modules/story-state/view.js` 均采用宿主 `.standoutHeader`、`.inline-drawer` 与主题变量呈现：
- 规划面板展示实体统计芯片（人物／剧情线／局势条目数）及按三类实体分组的卡片（`点评` / `走向预测` / `建议` 标签）。
- 剧情线面板在分组中直观展示线头统计、`脉络总结`、`最新动态`、`当前焦点`、`涉及人物` 与可展开的多轮 `推进轨迹`。
