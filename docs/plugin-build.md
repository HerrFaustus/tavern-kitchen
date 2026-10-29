# 酒馆后厨构建

项目使用单个 pnpm 包与 Vite 配置，入口定义在 `scripts/build/browser-entries.mjs`。`pnpm build` 执行质量检查后，在 `output/plugin-build-*` 暂存目录生成产物；类型、资源、宿主导入验证成功后，整套替换 `dist`，失败时保留原产物。

宿主路径按部署在 `public/scripts/extensions/third-party/<folder>` 的逻辑路径计算，与开发目录深度无关。校验优先使用外层参考库中有逐文件哈希收据的 SillyTavern 1.19.0；独立仓库中无该参考时，使用 `scripts/host/official.json` 中固定版本的官方 Git 引用。宿主边界声明只提供本地类型检查所需的外部 API 声明，真实导出名称由构建校验核对。

`pnpm check` 依次执行质量检查、构建一致性检查、回归测试和记忆运行时验证。网络、索引、保存故障由测试夹具模拟；测试不会调用实际模型。`python scripts/package.py` 打包源码、静态资源、构建结果和许可证，排除开发依赖、缓存与日志，并生成 SHA-256。

本验收不包含实际浏览器内的宿主联调或模型效果评估。变更这部分范围时应同步更新 README 和验证记录。
