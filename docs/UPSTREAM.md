# 来源与修改说明

Based on LittleWhiteBox by biex.

- 上游：<https://github.com/RT15548/LittleWhiteBox>
- 固定提交：`e30ebadf69cd53e9fafc5f81f74b9499911f78f5`
- 上游版本：3.2.2；派生版：酒馆后厨 0.1.2。
- 修改日期：2026-10-29。
- 原始快照保留在外层 `references`，不在原始快照上修改。

主要修改：物理删除无关模块与领域模型；缩减 OS host/shell 两端注册表；拆除骰子经济和付费重掷；保留人物属性编辑与已掷结果的确认保存；把配置、文件、数据库和主要全局入口改到后厨命名空间；以精简扩展设置替换原总控页；拆出 API 配置存储；调整构建入口、依赖、测试与独立目录的宿主路径解析；禁用并移除上游自动更新。

`shared/legacy-markup` 的三个解析器来自上游绘图／语音模块，保留纯文本清洗用途。`modules/streaming-generation.js` 属于模型调用适配层，记忆跟随酒馆 API 时仍需要它。

原有源码中的部分类型名、路径、`xb` 指令以及内部标识仍保留，以避免本次删减引入不必要的协议迁移。文件版权依照原始上游；上游许可证和附加声明保持原文。详细删除路径见 `v1-removed-files.json`。

0.1.1 参考柏宝书固定快照 `0a3a1cdfe92bf5ff1b822b6b6588cb694090d0da` 的 `src/topbar.ts`，采用宿主 `#top-settings-holder`、`.drawer` 与 `.drawer-icon` 接入方式。厨师帽 SVG、统一标签工作台、嵌入接口与主题桥接为本次新写实现；未复制柏宝书业务代码。原有记忆、规划、变量和 OS 页面改为嵌入同一工作台，数据格式与消息校验保持原有机制。

0.1.2 将一级导航收敛为记忆、规划、设置，把原记忆设置与模型接口归入设置。参考柏宝书 `floorPanel.ts`／`FloorPanel.vue` 的楼层下方摘要交互，新写 `modules/story-summary/floor-summary.js`；按后厨已提交批次的实际范围展示摘要，不移植柏宝书的数据写回或生成逻辑，也不新增模型调用。
