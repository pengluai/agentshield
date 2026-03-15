# 15 - GitHub 发布流水线与密钥配置

更新日期: 2026-03-09  
状态: 已落库，待填充真实密钥

## 1. 目的

本文件定义 AgentShield 的 GitHub 发布流水线、所需密钥和上线前检查方式。

仓库中已提供：

- 试点分发工作流: [publish-pilot-artifacts.yml](/Users/luheng/Downloads/ai01/agentshield/.github/workflows/publish-pilot-artifacts.yml)
- 发布工作流: [publish-signed-release.yml](/Users/luheng/Downloads/ai01/agentshield/.github/workflows/publish-signed-release.yml)
- 发布密钥模板: [.env.release.example](/Users/luheng/Downloads/ai01/agentshield/.env.release.example)
- 发布前 gate: [release-gate.sh](/Users/luheng/Downloads/ai01/agentshield/scripts/release-gate.sh)
- 更新器配置样例: [tauri.release.example.json](/Users/luheng/Downloads/ai01/agentshield/src-tauri/tauri.release.example.json)

## 2. 工作流结构

### 2.1 试点分发

`publish-pilot-artifacts.yml` 用于：

- GitHub draft/prerelease 资产分发
- 小范围试点用户下载
- macOS ad-hoc signing
- 不要求 Apple notarization / Windows 正式证书 / updater key

### 2.2 正式发布

`publish-signed-release.yml` 会做这些事：

1. checkout 仓库
2. 安装 `pnpm` / Node / Rust
3. 安装前端依赖
4. 在 Windows runner 导入 `.pfx` 证书
5. 在 macOS runner 导入 Apple 签名证书
6. 跑 `pnpm run release:gate`
7. 调用 `tauri-action` 生成签名安装包与发布产物

当前矩阵：

- `macos-latest`
- `windows-latest`

## 3. 必要 Secrets

### 3.1 Tauri Updater

- `TAURI_SIGNING_PRIVATE_KEY`
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`

### 3.2 macOS

- `APPLE_ID`
- `APPLE_PASSWORD`
- `APPLE_TEAM_ID`
- `APPLE_SIGNING_IDENTITY`
- `APPLE_CERTIFICATE`
- `APPLE_CERTIFICATE_PASSWORD`
- `KEYCHAIN_PASSWORD`

### 3.3 Windows

- `WINDOWS_CERTIFICATE`
- `WINDOWS_CERTIFICATE_PASSWORD`
- `WINDOWS_CERTIFICATE_THUMBPRINT`
- `WINDOWS_TIMESTAMP_URL`

## 4. 配置步骤

### A. 填 updater 配置

把真实 `pubkey` 和发布端点写入：

- [tauri.release.example.json](/Users/luheng/Downloads/ai01/agentshield/src-tauri/tauri.release.example.json)

然后将其内容合并到正式 `tauri.conf.json` 或 CI 专用配置。

### B. 配 GitHub Secrets

按 `.env.release.example` 中的变量名逐一写入 GitHub Actions secrets。

### C. 触发 workflow

两种方式：

- 试点分发：推送到 `pilot` 分支或手动 `workflow_dispatch`
- 正式发布：推送到 `release` 分支或手动 `workflow_dispatch`

## 5. 失败解释

### `release:gate` 失败

表示代码通过，但发布前置条件不完整，例如：

- Xcode 未安装
- Apple 公证账号缺失
- Windows 签名变量缺失
- updater key 缺失

### `tauri-action` 失败

通常表示：

- 证书导入失败
- Apple identity 与证书不匹配
- Windows 证书未正确导入
- 更新器配置缺少 `pubkey` 或 endpoint

## 6. 放行建议

只有在以下条件同时满足时才执行公开发布：

- `cross-platform-validation.yml` 持续通过
- `publish-signed-release.yml` 能在 macOS / Windows 成功产出签名包
- [14-干净机实机回归清单.md](/Users/luheng/Downloads/ai01/agentshield/docs/specs/14-干净机实机回归清单.md) 两个平台均通过
- `pnpm run report:guard` 输出中没有异常增长的 critical 事件

## 7. 参考

- Tauri v2 GitHub Pipelines / 签名 / Updater，Context7 检索日期 2026-03-09
- [Tauri v2 GitHub Pipelines](https://v2.tauri.app/distribute/pipelines/github/), 检索日期 2026-03-09
- [Tauri v2 Windows Code Signing](https://v2.tauri.app/distribute/sign/windows/), 检索日期 2026-03-09
- [Tauri v2 macOS Code Signing](https://v2.tauri.app/distribute/sign/macos/), 检索日期 2026-03-09
- [Tauri v2 Updater](https://v2.tauri.app/plugin/updater/), 检索日期 2026-03-09
