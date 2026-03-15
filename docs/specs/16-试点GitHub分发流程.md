# 16 - 试点 GitHub 分发流程

更新日期: 2026-03-09  
状态: 已落库

## 1. 适用场景

如果你当前的目标是：

- 先把 `exe` / `dmg` 放到 GitHub 给测试用户下载
- 先验证产品价值和误杀率
- 暂时不做面向大众用户的正式商业发布

那么应该走 `pilot` 分发，而不是 `public` 发布。

## 2. 为什么这条路不要求你本机先装完整 Xcode

对 Tauri 桌面开发，官方前提是：

- 如果只做桌面应用，`Xcode Command Line Tools` 就足够进行基础开发
- 完整 `Xcode` 主要在更完整的 macOS 签名 / notarization / iOS 场景下才是硬要求

对你的当前目标，更关键的是：

- Windows `exe` 直接可走 GitHub 分发
- macOS `dmg` 可以先走试点分发，但如果只做 ad-hoc signing，用户仍可能需要去 `Privacy & Security` 手动放行

所以：

- `pilot` 阶段不把完整 Xcode 当成本机硬门槛
- `public` 阶段才把签名、公证、updater 当硬门槛

## 3. 已提供的仓库能力

### 3.1 本地 gate

```bash
RELEASE_PROFILE=pilot pnpm run release:gate
```

这会验证：

- cargo test
- pnpm build
- vitest
- playwright smoke
- tauri info

并且不会因为缺少正式签名凭据而直接判死，但会给出 warning。

### 3.2 GitHub 试点工作流

已提供：

- [publish-pilot-artifacts.yml](/Users/luheng/Downloads/ai01/agentshield/.github/workflows/publish-pilot-artifacts.yml)

工作流会：

1. 在 `macos-latest` / `windows-latest` 构建
2. 运行 `RELEASE_PROFILE=pilot pnpm run release:gate`
3. 产出 GitHub draft/prerelease 资产
4. macOS runner 使用 ad-hoc signing 标识 `-`

## 4. 风险边界

这条路适合：

- 试点部署
- 小范围邀请测试
- 设计合作客户验证

这条路不适合直接对外宣传成：

- 已完成面向大众用户的正式商业发布
- 已具备完整系统级防恶意能力
- 已完成 Apple notarization 与 Windows 正式签名信任链

## 5. 用户体验预期

### Windows

- 用户可以直接下载 `exe` / 安装包
- 如果没有正式证书，仍可能碰到信任提示，但总体阻力较低

### macOS

- ad-hoc signing 能降低 Apple Silicon 上完全无法运行的概率
- 但用户仍可能需要在 `Privacy & Security` 手动允许应用运行
- 因此更适合试点验证，而不是面向普通消费者的大规模公开投放

## 6. 建议顺序

1. 本地跑：

```bash
RELEASE_PROFILE=pilot pnpm run release:gate
```

2. 提交后触发：

- [publish-pilot-artifacts.yml](/Users/luheng/Downloads/ai01/agentshield/.github/workflows/publish-pilot-artifacts.yml)

3. 拿 GitHub draft/prerelease 资产给小范围用户下载

4. 同步执行：

- [14-干净机实机回归清单.md](/Users/luheng/Downloads/ai01/agentshield/docs/specs/14-干净机实机回归清单.md)
- `pnpm run report:guard`
- `pnpm run test:soak`

5. 等试点数据稳定后，再转到正式 `public` 发布链

## 7. 参考

- Tauri v2 macOS prerequisites / signing / ad-hoc signing，Context7 检索日期 2026-03-09
- [Tauri v2 macOS Code Signing](https://v2.tauri.app/distribute/sign/macos/), 检索日期 2026-03-09
- [Tauri v2 Prerequisites](https://v2.tauri.app/start/prerequisites/), 检索日期 2026-03-09
