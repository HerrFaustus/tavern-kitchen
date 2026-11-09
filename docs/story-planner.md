# 单作家剧情规划

在「编剧」面板启用功能，并在面板下方选择已创建的文本模型。编剧自动工作，无需批准。

第一次符合条件的正文请求等待作家发布全局与章节札记。之后读取当前章节定稿。已确认的章节边界改变，或作家登记的关键世界字段、剧情记录发生变化，才重新审稿。篇目收束不单独触发。全局前提仍适用时只更新章节稿。作者可全视后台，章节稿按写手可见范围成稿，正文只读该稿全文。独立更新、聊天原文、总结与召回不写入创作稿。

版本保存在当前客户端 IndexedDB，按账号、聊天和世界分支隔离，附楼层来源摘要与世界版本。编辑、回退或切换聊天时重新核验来源。「编剧」上半区展示当前章节札记；全局札记默认折叠，可能包含剧透。前提发生变化时标明需要更新；打开面板不请求模型，旧版导入札记仍按既有规则恢复归属。札记预算为传入上下文上限的四分之一，无法容纳时整段略过。独立模型失败时正文继续，可在编剧设置中点击「下次正文重试」解除本次审稿的失败抑制。

后台验收：`node --import tsx --test modules/story-planner/planner.test.js modules/story-planner/host.test.js modules/world-records/turn-host.test.js`；界面与浏览器 IndexedDB 验证：`node scripts/check-planner-ui.mjs`、`node scripts/check-planner-workspace.mjs`。后者可通过 `PLAYWRIGHT_MODULE`、`CHROMIUM_BIN` 指定浏览器依赖，通过 `TK_PLANNER_SHOTS` 指定截图目录。

后台提示词明确处理三种偏离：离场后线索留在原处，另辟路线按现有资源与条件判断，提前查明的事实立即更新人物知情范围。
