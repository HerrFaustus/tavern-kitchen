# 发布流程

本文件说明酒馆后厨的版本号维护、构建、验证、打包和 GitHub Release 流程。版本号的唯一来源是 `manifest.json`；其他文件必须与它一致。

## 1. 准备环境

- Node.js 24
- pnpm 11.25.0
- Python 3（仅用于生成本地安装 ZIP）
- 可推送标签的 GitHub 仓库权限（仅正式发布需要）

安装依赖：

```sh
pnpm install --frozen-lockfile --ignore-scripts
```

发布前确认工作区没有未提交的临时修改。`release/` 是本地生成目录，不随仓库提交。

## 2. 修改版本号与发布说明

将版本号改为新的补丁版本，例如 `0.2.9`，并同步检查：

1. `manifest.json` 的 `version`。
2. `package.json` 的 `version`。
3. `README.md` 的一级标题和本版说明。
4. `docs/UPSTREAM.md` 的“派生版：酒馆后厨 …”。
5. `docs/VALIDATION.md` 新增当前版本段。
6. `docs/validation.json` 的顶层 `version`。

版本一致性检查会核对以上文件；如果存在 `release/release-info.json`，还会核对归档名、版本和 SHA-256。标签构建还会核对 `v*` 标签与 `manifest.json` 版本一致。

## 3. 构建

```sh
pnpm build
```

`build` 先执行静态质量检查，再执行类型检查、Vite 打包和宿主资源验证。成功后整套替换 `dist/`，并输出构建 ID、入口数、模块数和 JS chunk 数。记录这些数据到验证文档。

`settings.html` 等构建页面发生变化时必须重新构建 `dist/`；只改文档不需要重建 `dist/`，但发布前仍要重新生成安装包，并让 `pnpm check` 通过构建一致性检查。

## 4. 完整验证

```sh
pnpm check
```

`check` 依次执行：

1. `scripts/quality.mjs`：版本一致性、项目边界、乱码、相对导入和 ESLint。
2. `scripts/build.mjs --check`：用当前源码重建并与 `dist/` 比较。
3. `scripts/test.mjs`：全部回归测试。
4. `scripts/check-runtime.mjs`：记忆运行时检查。

将实际测试数、构建 ID、入口／模块／chunk 数和通过结果写入 `docs/VALIDATION.md` 与 `docs/validation.json`。修改验证文档后建议再运行一次 `pnpm check`，确认文档变更没有破坏版本检查或构建一致性。

## 5. 生成本地安装包

```sh
python scripts/package.py
```

输出：

- `release/tavern-kitchen-<version>.zip`
- `release/tavern-kitchen-<version>.zip.sha256`
- `release/release-info.json`

归档包含源码、`dist/`、文档和许可文件，不包含 `node_modules`、缓存、日志或私密数据。`release/` 被 `.gitignore` 忽略，不应提交到仓库。

打包后运行版本检查：

```sh
node scripts/check-versions.mjs
```

该检查会重新计算归档 SHA-256，并与 `release/release-info.json` 比较。

## 6. 打标签并发布

在 Git 仓库中提交版本变更后创建标签：

```sh
git tag -a v0.2.9 -m "酒馆后厨 0.2.9"
git push origin main
git push origin v0.2.9
```

推送 `v*` 标签会触发 `.github/workflows/release.yml`：

1. 安装固定依赖。
2. 执行完整 `pnpm check`。
3. 运行 `python scripts/package.py` 重新生成归档。
4. 运行 `node scripts/check-versions.mjs` 核对归档名、版本和 SHA-256。
5. 使用 GitHub Actions 自带令牌创建 Release，上传 ZIP、SHA-256 和 `release-info.json`。

也可以手工创建 Release，但必须使用同一标签和同一构建产物，并核对 SHA-256。

## 7. 发布后核对

- GitHub Actions 的 `Kitchen verification` 与 `Kitchen release` 均为成功。
- Release 标签与 `manifest.json` 版本一致。
- Release 附件包含 ZIP、`.sha256` 和 `release-info.json`。
- 下载 ZIP 后重新计算 SHA-256，与 `.sha256` 文件一致。
- `release/release-info.json` 的版本、归档名、文件数和 SHA-256 与实际产物一致。
- `docs/validation.json` 的构建 ID 和测试数与实际产物一致。

## 8. 失败与回滚

- 不要覆盖或移动已经推送的版本标签；需要修复时发布新的补丁版本。
- 如果 Release 创建失败，先修复工作流或权限，再重新运行工作流；不要手工上传与验证记录不一致的包。
- 如果发布包内容有误，将 Release 标记为预发布或撤回，并发布新的补丁版本。

## 当前环境的限制

当前开发目录不是 Git 仓库，也没有 `gh` CLI 或 GitHub 令牌。因此本文件只定义了可执行的发布流程；实际打标签、推送和创建 GitHub Release 需要在具备仓库权限的环境中完成。本地生成的 ZIP 和 `release-info.json` 可用于核对，但不能代替 GitHub 上的正式 Release。
