# 酒馆后厨 0.2.33

酒馆后厨（Tavern Kitchen）是一个 SillyTavern 扩展。每次正文回复完成后，后厨记录发生了什么，把已确认的世界状态、近期原文和早期经历提供给下一次续写。

0.2.33 在本地提供完整安装包，六项成品验收及最终 ZIP 复装均已通过。宿主生成角色正文，后厨按顺序结算已选回复。每份聊天维护一个世界。全新安装后，各业务开关均关闭。[安装包](release/tavern-kitchen-0.2.33.zip) · [校验值](release/release-info.json) · [成品规则](最终项目目标.md) · [验收记录](docs/validation.json)

## 安装与开始

1. 全新安装时将 `release/tavern-kitchen-0.2.33.zip` 解压到宿主的 `public/scripts/extensions/third-party/`，确认 `tavern-kitchen/manifest.json` 与 `tavern-kitchen/dist/host/plugin.js` 在同一扩展目录下，刷新宿主。升级时先在原浏览器的「数据」导出后厨卡，再用 ZIP 中的同名目录覆盖原扩展文件并刷新。沿用原宿主账号、地址和浏览器配置文件即可读回原聊天、IndexedDB 世界以及札记。
2. 打开聊天，点击顶栏最右的门形图标，或在扩展设置里点击「打开后厨」。在「API → 编辑连接」新建或导入命名连接，填好地址和模型后保存。回到 API 页的更新、推演、编剧三行，为要启用的 Agent 选择连接。三者可以共用一个。
3. 在所需板块的页头设置开启功能。在角色对话里走完一轮，到「剧情 → 总结」看本轮记录。要从角色卡、已启用的世界书条目和开场资料建档，到「世界 → 世界生成」手动生成。要让编剧给续写提供建议，到「编剧」点击「立即生成／更新札记」。

玩家安装时直接使用随包的 `dist/`，无需准备开发环境。首次进入工作台先看到「主角」。六个板块可以直接进入。点页头的「人物设置」「局势设置」等展开本页开关和频率，默认收起以留出阅读空间。收起抽屉再打开可接着看原页。切换聊天后重新按当前聊天取数。界面跟随酒馆主题。[工作台路由](core/kitchen-workspace.js) · [启动与聊天切换](core/kitchen-runtime.js)

## 当前能做什么

| 入口 | 用法与数据边界 |
| --- | --- |
| 主角 | 查看玩家的属性、位置、直接关系、持有物和个人计划，在物品栏登记交易。用玩家名、明确别名或地图玩家绑定辨认主角，同名且无法区分时分别保留。[身份匹配](modules/story-state/protagonist-identity.js) · [主角页](modules/story-state/view.js) |
| 世界 | 「人物」仅有一人时直接显示档案，多人时按姓名和已有身份、位置或近期记录选人。从档案旁的「编辑人物」改名或维护关系，取消后回到同一个人。重要物品有可核对的交接来源时可查原楼，所有权缺依据时显示未知。「局势」分事态和风物，可展开幕后内容，或按组确认、修改和拒绝待核变化。人物动向、事态、风物和街头见闻频率各有设置。[人物与交易编辑](modules/world-records/editor-panel.js) · [局势与演化](modules/xiaobai-os/apps/world/evolution-view.ts) · [提案面板](modules/world-records/proposal-panel.js) |
| 剧情 | 「总结」页头显示已总结与待总结楼数，可筛选记录、查历史树与原楼。「悬念」跟踪未解与结案事项，「剧情线」区分进行中、潜在和已收束，展示焦点、涉及人物和推进轨迹。「校对」可查原文、修订记录、收束阶段与章节。[剧情线与悬念](modules/story-state/view.js) · [校对工具](modules/story-summary/maintenance/tools.js) |
| 编剧 | 单作家按人物、剧情线、局势给出点评、走向预测与建议。全局稿默认折叠，章节稿供正文选用。默认手动更新，打开面板不调用模型。在编剧设置中可开启「章节（L2）保存后自动更新札记」。[编剧入口](modules/story-planner/host.js) |
| API | 首页列出三个 Agent 的绑定。「编辑连接」管理和测试命名连接，「检索服务」选择向量与重排。会话统计分列 Agent 任务数与实际请求，记录失败、耗时和最近 100 条脱敏明细。供应商返回用量时才显示相应计数。[连接与诊断](modules/text-api/profile-service.js) · [统计范围](modules/text-api/call-stats.js) |
| 数据 | 导出、导入后厨卡，核对来源回执，预览受影响的来源与效果，确认后在原世界撤回并重记。[后厨卡格式](modules/kitchen-data/card.js) · [世界恢复](modules/world-records/recovery-panel.js) |

### 开局、地点和模型

「世界生成」读取启用的绑定世界书条目、角色卡、玩家设定、开场白与首条玩家输入。群聊取参与角色的卡。长材料分批核对引文，中断后可重用已核对且来源相同的片段。旧聊天补做开局时，后来的位置和事态有优先权。需要配置时，到「API」为更新 Agent 选择文本连接。旧开局配置会保留，原有选择有分歧时可在更新 Agent 行核对。[开局取材](modules/world-records/opening-input.js) · [分批建档](modules/world-records/opening.js) · [开局写入规则](modules/world-records/opening-projection.js)

「世界 → 地图」按世界、地区、地点、地点要素展开。区域图展示有记录的通路，局部图把缺方位的要素列为「方位待定」。详情里的「此刻」展示仍影响当地的局势，结束后只保留地方常态和已确认的永久变化。点「回到当前位置」可定位主角，浏览其他地点不会移动人物。[地图浏览](modules/xiaobai-os/apps/map/ui/AtlasBrowser.vue) · [地点详情](modules/xiaobai-os/apps/map/ui/MapApp.vue) · [地点回归](scripts/check-place-map.mjs)

开启楼层地图投影后，地图随最后一条适用的角色回复显示。支持的局部场景可切换二维和三维，三维不可用时回到二维。新装默认关闭地图自动维护和局势订阅。[楼层地图](modules/xiaobai-os/apps/map/host/projection-display.ts) · [二维与三维视图](modules/xiaobai-os/apps/map/ui/MapBrowser.vue) · [默认开关](scripts/kitchen.test.mjs)

在「API → 编辑连接 → 从酒馆导入」选「复制完整配置」，可复制宿主可读的连接、模型和生成参数。「只复制连接」留下模型供另选。两者均建立独立快照。支持的聊天补全渠道可直接复制，其他渠道需手动填写。宿主未返回密钥时按服务要求补填，免鉴权的本地接口可留空。[配置界面](modules/text-api/settings-ui.js) · [导入酒馆连接](modules/text-api/tavern-import.js)

「拉取模型」只获取列表，测试按钮会按配置类型实际发起生成、嵌入或重排请求。三个 Agent 使用独立保存的文本连接，编剧还需填写密钥。改名保留绑定，正在使用的连接须先改绑才能删除。旧设置若指向不同连接，API 页会列出原选项供确认。缺绑定时，点业务页的「前往 API」可直达相应行，保存后返回原开关，再次点击才会启用。[功能绑定](modules/text-api/model.js) · [连接测试](modules/text-api/profile-service.js)

### 楼尾、召回与校对

开启总结后，每条已选定的角色回复单独保存一份摘要，取材包含紧邻的上一条玩家发言。已有聊天从最早未结的回复补起，先结清本楼再处理下一楼。默认保留最近五轮问答原文，更早的经历由分层摘要提供背景。[逐楼结算](modules/world-records/turn-processing.js) · [最近原文设置](modules/story-summary/tests/memory-defaults.test.js)

开启总结后，可用原文检索。若希望把找出的旧对白也交给下一次续写，须在「剧情 → 总结」设置中打开「按需注入相关早期原文」，新安装时这个开关关闭。开启后用人物、地点、时间与关键词定位原文块。向量与关键词共用候选池，最多追加一次重排。向量不可用时走关键词，重排失败保留原排序。换向量模型后需用新模型补建索引。[总结设置控件](modules/story-summary/story-summary.html) · [续写取材](modules/story-summary/generate/prompt.js) · [原文检索](modules/story-summary/vector/retrieval/raw-recall.js)

单楼需要纠正时，展开角色回复下的摘要。「总结本楼」单独整理该楼，「重新总结」会提示确认替换。可审查、编辑、确认草稿，或在「更多」标为番外，之后可取消。旧版批次可能覆盖多楼，楼尾显示范围时按标出的来源核对。[楼尾操作](modules/story-summary/inline/panel.js) · [楼尾与区间回归](modules/story-summary/tests/floor-summary.test.js)

自动校对按已完成的角色回复计数，默认每五轮一次，可设为 1–100 轮或关闭。阶段和章节由校对者引用原楼并说明收束理由。校对中止后，已确认的修改保留，可在成果页核对已完成楼层。遇到「保存结果尚未确认」先核对存档。若修改已保存、仅检索索引失败，使用「重试更新」即可补索引。[校对设置](modules/story-summary/maintenance/settings.js) · [校对反馈](modules/story-summary/maintenance/copy.js)

续写前若读取当前世界失败，后厨会中止这次发送，可核对存档后重试。远程查询向量调用失败时可退回关键词，编剧稿无法读取时可略过札记继续正文。[世界读取](modules/world-records/generation-host.js) · [召回降级](modules/story-summary/tests/raw-recall.test.js) · [可选札记](modules/story-planner/host.js)

### 存档、迁移与恢复

0.2.32 多分支存档沿用原来的活动指针。其余旧资料仍在原浏览器，指针有歧义时到「数据 → 世界版本与恢复」核对来源。升级不会重放已经成交的交易。[存储与迁移](modules/world-records/storage.js)

| 遇到的情况 | 操作与可预期的结果 |
| --- | --- |
| 换设备、换浏览器，或要给另一段聊天带入资料 | 在「数据」导出当前聊天的后厨卡。卡含总结、来源历史、世界和本聊天的札记。功能开关、API 配置、密钥和向量缓存留在原环境。卡与目标原文一致时保留逐楼来源和分层历史。原文不同时以可移植总结作为基线，原来源单独归档。导入先暂存，宿主确认保存后才启用。旧卡若缺札记，须回原存档取回。[卡校验与切换](modules/kitchen-data/card.js) · [导入原文判定](modules/story-summary/story-summary.js) |
| 改写旧楼、换候选或撤销某次成交 | 到「数据 → 世界版本与恢复」核对配对原楼、受影响的钱物和重记起点，确认后在原世界恢复。旧回执仍可审计，后台从有效前缀继续处理。旧导入基线无法拆分时，按预览显示的实际起点处理。[原位恢复](modules/world-records/recovery-panel.js) |
| 点保存后结果未知，或正在处理时切换聊天 | 回到对应聊天核对最后一次已确认的进度与回执。宿主保存结果未知时先读回，核对后再继续写。临时草稿、模型响应和界面显示都不足以证明已落盘。[总结确认与读回](modules/story-summary/data/memory-commit.js) · [世界效果回执](modules/world-records/turn-ledger.js) |

总结与来源历史随宿主聊天元数据保存。当前世界及旧档案保存在浏览器的 `TavernKitchen_WorldArchive`，编剧札记在 `TavernKitchen.StoryPlanner`，本机记忆索引使用 `TavernKitchen_Memory`。嵌入工具另有酒馆文件与聊天引用。仅复制聊天文件不能保证搬完整个世界。后厨有独立命名空间，小白X的旧设置及文件保留原位，旧变量只作历史数据保存。[宿主元数据](modules/story-summary/data/memory-commit.js) · [世界存储](modules/world-records/storage.js) · [札记存储](modules/story-planner/storage.js) · [检索数据库](modules/story-summary/data/db.js) · [聊天文件引用](modules/xiaobai-os/storage/chat-reference.ts)

## 本版行为与验证范围

- 打开更新功能后，最早缺少有效回执的角色楼先处理。同楼的推演、校对、跨章归并和节点编剧按各自开关与条件执行。状态条标出失败楼、原因及重试或核对入口。主动关闭最后一项逐楼任务，宿主立即继续响应。[逐楼队列](core/turn-queue.js)
- 主角以实付、实收价格结算钱物。配角的重要物品分别记录所有人、保管人和使用人。东桥被封锁后，地图即刻读取新事实，正文保留角色知情范围。旧角色弧光退出新请求和卡内活跃记忆，人物关系、承诺与剧情线仍可查。[交易与交接](modules/world-records/turn-actions.js)
- 三个连续且有来源的已确认章节生成一个跨章总结，更高层按同样规则处理。改写证据后旧节点退出续写。过期札记可在编剧页查阅，重新发布合规稿后才进入正文。[章节保存](modules/story-summary/maintenance/commit.js) · [札记有效性](modules/story-planner/notes.js)
- 模型请求使用 API 页保存的连接。回归使用虚构对白与本地模型桩，覆盖干净安装和 0.2.32 旧档升级。真实宿主和在线模型的长时间游玩未纳入本版验收。浏览器源码及网络请求可供客户端使用者检查。[六项验收与复跑命令](docs/validation.json)

## 开发与发布

宿主从扩展清单加载 `dist/host/plugin.js`。改启动和工作台行为时，从 `plugin-entry.js` 进入原生抽屉的引导与运行时。`index.js` 为仍缓存旧入口的安装转发到构建产物。改领域行为时，可从上面各功能的源码或测试进入。[扩展清单](manifest.json) · [启动源码](plugin-entry.js) · [旧入口](index.js)

使用 Node.js 24、pnpm 11.25.0 和 Python 3。在仓库根目录运行以下命令，输出的安装包在 `release/`。

```sh
pnpm install --frozen-lockfile --ignore-scripts
pnpm build
pnpm check
python3 scripts/package.py
node scripts/check-versions.mjs
node scripts/check-ui.mjs
node scripts/check-installation.mjs release/tavern-kitchen-0.2.33.zip > release/install-verification.json
```

`pnpm build` 在暂存目录生成并校验产物后替换 `dist/`。`pnpm check` 核对质量、构建一致性、全部单元测试与记忆运行时。用 `node scripts/check-ui.mjs` 运行九组无头界面回归，也可单独运行其中一组。使用已有浏览器时可指定 `CHROMIUM_BIN` 与 `PLAYWRIGHT_MODULE`。[构建入口](scripts/build.mjs) · [检查入口](scripts/check.mjs)

发版以 `manifest.json` 为准，同步 `package.json`、本页标题、更新记录的最新版本和机器验收记录。切换版本可在干净检出中构建与验证，避免把上一版的本地归档带入版本检查。打包脚本输出 ZIP、SHA-256 和 `release-info.json`。正式发布由对应的 `v<版本>` 标签触发，工作流重新验证、打包并上传三份附件。[机器验收记录](docs/validation.json) · [打包脚本](scripts/package.py) · [版本校验](scripts/check-versions.mjs)

日常开发可用 `pnpm test` 跑单元测试，或从根目录用 `node --import tsx --test <测试文件>` 运行单项。界面回归按改动选择编剧、API、楼尾、地点地图或提案脚本。首次校验宿主接口可能需要取得固定版本的源码，已有本地参考树时按回执校验来源。[测试入口](scripts/test.mjs) · [宿主版本固定清单](scripts/host/official.json) · [本地参考树](scripts/host/local-reference.mjs)

发版时核对下载所得 ZIP 的 SHA-256、`release-info.json` 的版本和归档名。包内须有可安装的 `dist/`、对应源码、四份文档和随附许可。已推送标签保留在原提交，错误版本用新补丁号修复。[持续验证](https://github.com/HerrFaustus/tavern-kitchen/blob/506146623383fd9b6fea3cdd27c3ca1ca115f31a/.github/workflows/verify.yml) · [标签发布工作流](https://github.com/HerrFaustus/tavern-kitchen/blob/506146623383fd9b6fea3cdd27c3ca1ca115f31a/.github/workflows/release.yml)

## 署名与许可

Based on LittleWhiteBox by biex. 酒馆后厨由浮士德工坊在小白X基础上删改。上游声明、各素材许可证和构建依赖许可随源码及安装包分发。[LittleWhiteBox](https://github.com/RT15548/LittleWhiteBox) · [上游许可证](docs/LICENSE.md) · [版权声明](docs/COPYRIGHT) · [NOTICE](docs/NOTICE) · [构建依赖许可](dist/THIRD-PARTY-LICENSES.md) · [修改与素材来源](历史更新记录.md#来源与素材)
