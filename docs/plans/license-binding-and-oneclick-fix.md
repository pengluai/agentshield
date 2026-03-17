# 许可证绑定 + 一键修复 实施方案

> 基于深度研究的两个独立问题的解决方案
> 日期: 2026-03-17

---

## 问题一：Pro 用户看不到一键修复

### 现状分析

**当前代码中 `auto_fixable` 标记情况：**

| Issue 类型 | auto_fixable | 数量 |
|-----------|-------------|------|
| 文件权限过宽 (chmod/ACL) | `true` | 2 处 |
| MCP 命令行运行程序 | `false` | 1 处 |
| MCP 数据传输未加密 (HTTP) | `false` | 1 处 |
| MCP 启动参数安全隐患 | `false` | 1 处 |
| 明文 API Key | `false` | 2 处 |
| Skill 非标准路径 | `false` | 1 处 |
| Skill 安全风险 | `false` | 1 处 |
| 工具运行中 (信息提示) | `false` | 1 处 |
| OpenClaw 审计结果 | `false` | 2 处 |
| MCP 配置概要 (info) | `false` | 1 处 |

**结论：只有文件权限问题可以一键修复，其他 13 种问题都只能手动修复。Pro 用户看到"手动修复"是因为那些 issue 确实没有自动修复逻辑。**

### 修复方案

#### Phase 1: 扩展可自动修复的 issue 类型

以下 issue 类型**可以安全地实现一键修复**：

| Issue 类型 | 修复动作 | 风险 | 优先级 |
|-----------|---------|------|--------|
| 明文 API Key | 将 key 移入系统钥匙串，原位替换为引用占位符 | 中（需备份原文件） | P0 |
| 文件权限过宽 | chmod 600 / ACL 收紧 | 低（已实现） | 已完成 |
| MCP HTTP 未加密 | 将 `http://` 替换为 `https://` | 低 | P1 |

以下 issue 类型**不应自动修复**（会破坏功能）：

| Issue 类型 | 原因 |
|-----------|------|
| MCP 命令行运行程序 | 这是 MCP 的正常工作方式，禁用会导致功能失效 |
| MCP 启动参数安全隐患 | 需要人工判断哪些参数是必要的 |
| Skill 非标准路径 | 可能是用户自定义的合法路径 |
| Skill 安全风险 (通用) | 需要人工评估 |

#### Phase 2: 前端 Pro 按钮显示逻辑修复

当前问题：
- `security-scan.tsx` 第 1238 行：`issue.fixable` 为 `false` 时直接显示手动修复
- 没有区分 "不可自动修复但 Pro 可辅助" vs "完全不可修复"

修复：
1. 对于 `auto_fixable: true` 的 issue → 显示"一键修复"按钮（Pro 可用，免费版提示升级）
2. 对于 `auto_fixable: false` 但有修复命令的 issue → 显示"查看修复命令"（免费版也有）
3. 对于 info 级别 issue → 仅显示查看详情

#### Phase 3: 批量修复按钮可见性

当前：批量修复按钮对所有人可见，点击时 Pro 验证拒绝
修复：免费用户看到带锁图标的按钮 + "升级 Pro" 提示

---

## 问题二：激活码 + 机器码绑定防破解

### 研究结论

#### Creem 平台能力
- Creem 有内置的 license 激活系统：`/licenses/activate`、`/licenses/deactivate`、`/licenses/validate`
- 每个 license 有 `activation_limit`（最大同时激活设备数）
- 每次激活创建一个 `instance`，包含 `id` 和 `name`（自由字符串）
- Creem **不提供**硬件指纹验证 — `instanceName` 只是标签

#### 机器指纹方案
- **推荐 `mid` Rust crate（v5.x）** — 专为 Tauri 构建，月下载 35.9 万次
- 工作原理：读取硬件信息 → SHA-256 哈希 → 输出匿名指纹
  - macOS: 型号+序列号+硬件UUID+SEID
  - Windows: BIOS序列号+主板序列号+OS ID+CPU ID
  - Linux: Product UUID
- **重装系统后指纹不变**（基于硬件，不是 OS 配置）
- 只有更换主板/CPU 才会变

#### 防破解分层策略

| 层级 | 技术 | 强度 | 说明 |
|-----|------|------|------|
| 1 | 服务端验证（Creem API） | 高 | 激活/验证都走服务端 |
| 2 | 机器指纹绑定（mid crate） | 中高 | 指纹作为 instanceName 绑定设备 |
| 3 | 签名本地缓存（Ed25519） | 中 | 离线时用公钥验签，7 天过期 |
| 4 | 定期心跳验证 | 中 | 每 24 小时在线重验 |

#### 不应该做的事
- ❌ 限制为 1 台设备 — 用户有笔记本和台式机，会产生大量客服工单
- ❌ 每次启动都强制在线 — 断网时无法使用，用户体验极差
- ❌ 在客户端代码中存储 Creem API Key — 会被反编译提取
- ❌ 过度投入二进制混淆 — ROI 为负，合法用户受害
- ❌ 依赖卸载时解绑 — macOS 删除 .app 没有卸载钩子

### 实施方案

#### 架构设计

> **关键：所有 Creem API 调用必须经过现有的 license-gateway Worker，绝不能从客户端直接调用 Creem API（会暴露 API Key）。**

```
AgentShield App (Tauri)
    |
    ├── (1) 首次启动：用户输入 AGSH.xxx.xxx 激活码
    │       (激活码由 Creem webhook → gateway 签发，流程不变)
    │
    ├── (2) 生成机器指纹 (mid crate + 应用密钥)
    │
    ├── (3) 调用 license-gateway Worker 激活绑定
    │       POST /client/licenses/activate-device
    │       body: { code: "AGSH.xxx.xxx", fingerprint: "sha256-hash" }
    │       → Gateway 内部调 Creem /v1/licenses/activate
    │         (instanceName = fingerprint)
    │       → Gateway 存储 fingerprint ↔ instance 映射
    │       → Gateway 返回签名后的激活证书
    │
    ├── (4) 本地缓存 Gateway 返回的签名激活证书
    │       {
    │         instance_id: "xxx",
    │         code: "AGSH.xxx.xxx",
    │         fingerprint: "sha256",
    │         activated_at: "2026-03-17T...",
    │         last_validated: "2026-03-17T...",
    │         signature: "ed25519-sig"  // Gateway 用私钥签名
    │       }
    │       存储位置: 现有 license.json（向后兼容，新增字段用 serde default）
    │
    ├── (5) 后续启动
    │       ├── 在线 → 调用 Gateway /client/licenses/validate-device
    │       │         body: { code, instanceId, fingerprint }
    │       │         Gateway 比较 fingerprint 一致性（服务端强制）
    │       │         → 刷新本地签名缓存
    │       ├── 离线 → 验证本地缓存签名 + 过期时间
    │       │         + 重新生成本地指纹对比缓存中的 fingerprint（防复制）
    │       │         缓存 7 天内有效
    │       └── 离线超 7 天 → 提示需联网验证
    │
    └── (6) 解绑设备
            App 内"登出此设备"按钮
            → 调用 Gateway /client/licenses/deactivate-device
            → 清空本地缓存
            失去访问的设备（丢失/损坏）→ 联系客服手动解绑
```

#### 现有用户迁移方案

> 部署时不能破坏已有 Pro 用户的激活状态。

1. `LicenseData` 新增 `fingerprint` 和 `instance_id` 字段，使用 `#[serde(default)]`
2. 旧版用户升级后，本地 license.json 可正常反序列化（新字段为空）
3. 首次在线验证时，Gateway 检测到无 fingerprint → 自动触发设备绑定
4. 绑定后写回 license.json，后续按新流程走
5. **不迁移存储方式**：继续使用 license.json，不切换到 Stronghold（避免数据丢失）

#### 具体实现步骤

**Step 1: 添加 `mid` crate 生成机器指纹**
```rust
// Cargo.toml
mid = "5"

// src-tauri/src/commands/license.rs
fn get_machine_fingerprint() -> String {
    mid::get("agentshield-v1-hwid").unwrap_or_default()
}
```

**Step 2: 修改激活流程，经 Gateway 绑定机器码**
```rust
// 通过 license-gateway Worker 激活（绝不直接调 Creem API）
async fn activate_with_device(code: &str) -> Result<ActivationResult, String> {
    let fingerprint = get_machine_fingerprint();
    let resp = reqwest::Client::new()
        .post("https://agentshield-license-gateway.xxx.workers.dev/client/licenses/activate-device")
        .json(&json!({
            "code": code,
            "fingerprint": fingerprint,
        }))
        .send().await?;
    // Gateway 内部调 Creem /v1/licenses/activate (instanceName = fingerprint)
    // Gateway 用私钥签名响应，返回签名证书
    // 存储返回的 instance_id + 签名缓存
}
```

**Step 3: 验证时经 Gateway 检查机器指纹（服务端强制）**
```rust
async fn validate_with_device(code: &str, instance_id: &str) -> Result<bool, String> {
    let fingerprint = get_machine_fingerprint();
    let resp = reqwest::Client::new()
        .post("https://agentshield-license-gateway.xxx.workers.dev/client/licenses/validate-device")
        .json(&json!({
            "code": code,
            "instanceId": instance_id,
            "fingerprint": fingerprint,
        }))
        .send().await?;
    // Gateway 比较 fingerprint 与存储值一致后返回签名响应
    // 不一致 → 拒绝验证
}
```

**离线验证必须重新生成指纹对比：**
```rust
fn validate_offline_cache(cache: &LicenseCache) -> bool {
    // 1. 验证 Ed25519 签名
    if !verify_ed25519_signature(&cache.signature, &cache.payload, &PUBLIC_KEY) {
        return false;
    }
    // 2. 检查过期时间（7 天）
    if cache.last_validated + Duration::days(7) < Utc::now() {
        return false;
    }
    // 3. 关键：重新生成本地指纹，对比缓存中的指纹（防止复制缓存文件到其他机器）
    let local_fingerprint = get_machine_fingerprint();
    if local_fingerprint != cache.fingerprint {
        return false;
    }
    true
}
```

**Step 4: 设置 activation_limit = 3**
- 在 Creem 后台创建产品时设置 `activation_limit: 3`
- 覆盖场景：台式机 + 笔记本 + 1 个备用

**Step 5: 添加"登出此设备"按钮**
- 设置页面添加按钮
- 调用 Creem `/licenses/deactivate` 释放名额
- 清空本地缓存

**Step 6: Ed25519 签名缓存（防篡改）**
```rust
// 生成密钥对（一次性，私钥存服务端/构建环境）
// 公钥嵌入 app 二进制

// 激活/验证成功后，用私钥签名缓存数据
// 离线验证时，用公钥验签
```

#### 卸载重装场景处理

| 场景 | 指纹变化 | 处理方式 |
|------|---------|---------|
| 同机重装系统 | 不变 | 自动识别为同一设备，无需操作 |
| 同机重装 App | 不变 | 输入激活码后自动匹配已有 instance |
| 换新电脑 | 变 | 旧电脑"登出"或自动占用新名额（3个内） |
| 分享激活码 | 不同机器指纹 | 超过 3 台时激活被拒绝 |
| 硬件大改（换主板） | 变 | 手动联系客服重置 |

#### Rust Crate 清单

| Crate | 用途 |
|-------|------|
| `mid` v5.x | 机器指纹生成 |
| `ed25519-dalek` | Ed25519 签名/验签 |
| `serde` + `serde_json` | 序列化缓存数据 |
| `chrono` | 时间戳和过期计算 |
| `reqwest` | HTTP 请求 Creem API |

---

## 合规审查

- [x] 只传输哈希后的指纹，不传输原始硬件信息（隐私合规）
- [x] 允许 3 台设备同时使用（合理的使用场景覆盖）
- [x] 离线 7 天宽限期（不影响正常使用）
- [x] 用户可自助解绑（不锁死用户）
- [x] 重装系统不影响激活（同硬件指纹不变）
- [x] 不在客户端存储 API 密钥
- [x] 不依赖卸载钩子（macOS 没有）

---

## 审查修正记录

反向审查发现的 3 个关键问题（已在文档中修正）：

1. **~~客户端直接调 Creem API~~** → 已改为全部经 license-gateway Worker 转发
2. **~~无服务端指纹验证~~** → 已添加 Gateway 服务端指纹比对
3. **~~无现有用户迁移方案~~** → 已添加 serde(default) 渐进迁移方案

其他改进：
- 离线验证必须重新生成本地指纹对比缓存（防复制缓存文件）
- 明文 Key 自动修复因格式复杂度从 P0 降为 P1
- Creem API 路径统一使用 `/v1/` 前缀

## 实施优先级

| 优先级 | 任务 | 预计工作量 |
|-------|------|----------|
| P0 | 修复 Pro 用户一键修复按钮显示逻辑 | 前端改动 |
| P1 | 添加 `mid` crate 机器指纹 | Rust 后端 |
| P1 | Gateway 新增 activate-device / validate-device / deactivate-device 端点 | Gateway Worker |
| P1 | 客户端激活流程集成机器指纹 | Rust 后端 |
| P1 | 现有用户迁移兼容（serde default + 首次在线自动绑定） | Rust 后端 |
| P1 | 明文 API Key 自动修复到钥匙串（需处理多种文件格式） | Rust 后端 |
| P2 | 设置页面"登出此设备"按钮 | 前端 + 后端 |
| P2 | MCP HTTP→HTTPS 自动修复 | Rust 后端 |
| P2 | 激活失败错误提示 UX | 前端 |
