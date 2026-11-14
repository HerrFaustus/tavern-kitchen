# 小白 OS（普通酒馆）

SillyTavern 中的独立应用面板，与小白酒馆 Phone OS 不共享数据库、会话、领域模型或运行时代码。实际应用注册以 [Host catalog](./host/app-catalog.json) 和 [Shell catalog](./shell/app-catalog.json) 为准。

## 功能

| 应用 | 用途与设计 |
| --- | --- |
| 地图 | [世界图册与场景地图](./docs/map-app-target-design.md)、[场景渲染](./docs/map-scene-rendering-design.md) |
| 世界 | [镜头外新闻、阅读与轻背景](./docs/world-app-target-design.md) |
| Agent API | [共享模型设置与后台维护](./docs/agent-api-and-maintenance-target-design.md) |

设计不等于模型质量保证，未完成的外部服务或实体设备验证见各功能限制。

## 数据范围

- 聊天 metadata 只保存 `xiaobaiOsRef`（格式版本与稳定 osId）。聊天业务保存于 `LittleWhiteBox_OS_<osId>.json`，各 APP 解析自己的分区。
- Agent API 使用 agent-core 的共享配置，不在 OS 另存一份密钥或预设。

编辑、swipe 或删除主聊天不会自动撤销已提交的经济事实。历史分支由各功能解释自己的复制边界；不按消息前缀猜测钱包时点。文件接口没有服务端 CAS，不保证多设备同时写入无冲突。

## 开发边界

`kernel/`提供分区事务、Capability、APP 生命周期和故障隔离；`storage/`适配宿主文件及聊天引用；`host/`与`shell/`分别组合运行与界面入口。业务由`domains/<domain>/`和`apps/<app>/`拥有，不塞入核心或集中业务根。

底座契约见 [Kernel](./docs/os-kernel-target-design.md)，公共界面约定见 [OS 界面设计](./docs/os-ui-design.md)。新增或删除 APP 同步处理功能目录、注册与所属数据；资金、附件或其他保留数据先明确处置策略。

工具的 Host、分区或 UI 故障在工作台内显示错误与重试入口，不影响其他工具。保存未知时先核实原提交，不重新随机、重扣款或重发模型。

## 检查

```sh
npm run build
npm run check
```

构建包含类型检查；自动检查不代替真实宿主、模型或实体 WebView 验证。
