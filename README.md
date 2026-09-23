# QQ 群策略包

OpenClaw 插件：按群绑定策略包，用「泄流闸」决定群消息何时唤醒模型、何时只记账、何时旁路禁言/撤回；**不限制** agent 回复内容。唤醒时会把近期缓冲聊天记录注入 prompt。

## 你能做什么

- 给不同 QQ 群绑定不同策略包（例如「成瘾品禁言+撤回」或「只记账」）
- 在 Control UI 侧栏 **QQ 群策略** 结构化管理词表 / 匹配条件 / 批触发器 / 群绑定（无 YAML 文本框）
- 策略包 YAML 仍落盘，改完按 mtime 热重载；插件 JS 变更需重启 Gateway
- 让模型通过工具 `qq_group_policy` 读写策略包与群绑定（需按群单独放行）

## 安装

1. 安装并启用插件（把路径换成你的仓库目录）：

```bash
openclaw plugins install --link <本仓库路径> --force --accept-capabilities --acknowledge-install-policy-warning
```

2. 写入必要配置（可参考 `config/install.batch.json`），至少包括：

| 配置项 | 作用 |
|---|---|
| `plugins.entries.qq-group-listener.hooks.allowConversationAccess: true` | 允许插件处理会话 |
| `plugins.entries.qq-group-listener.config.dryRun` | `true` 时只记日志、不真正禁言/撤回（建议先开） |
| 目标群 `requireMention: false` | 未 @ 机器人的消息也能进入插件 |
| 目标群 `tools.alsoAllow: ["qq_group_policy"]` | 仅该群允许改策略工具；不要改全局 `tools.allow` |

3. 重启 Gateway。

## 绑定群与策略包

编辑 `config/groups.yaml`：群 OpenID（必须大写）→ 策略包 id。

```yaml
groups:
  C3E939C7B5642D6C67C990CFB945967E: addiction-mute
```

内置示例策略包：

| 策略包 | 行为 |
|---|---|
| `addiction-mute` | 命中词表静默入缓冲、可自动撤回并按频次禁言；被 @ 立即唤醒 |
| `silent-buffer` | 只记账，不唤醒、不禁言、不撤回 |

未出现在 `groups.yaml` 中的群：插件不介入，消息照常放行。

改 `groups.yaml` 或策略包 YAML 后会按文件修改时间自动生效；改插件代码后仍需重启 Gateway。

## Control UI

1. Settings → Labs → 开启 **Custom plugin UI**（`gateway.controlUi.experimental.customPlugins: true`）
2. 打开 Control UI（如 `http://127.0.0.1:18789/`）并刷新页面
3. 侧栏进入 **QQ 群策略**

页面可改策略包正文、刷新或确认批决策门闩。本地改了 UI 源码后执行 `npm run build`，再在 Plugins → Customize UI → **Reload plugin UI**。

## 日常行为（以 addiction-mute 为例）

| 消息情况 | 结果 |
|---|---|
| 有人 @ 或回复机器人 | 立即唤醒模型 |
| 命中策略包词表 | 默认不唤醒；可撤回该条；滑动窗口内命中次数超过阈值则禁言 |
| 其他普通群聊 | 不唤醒，写入缓冲，供之后批决策 |

禁言阈值、撤回开关、匹配规则、批决策触发条件可在 Control UI 结构化编辑，或直接改 `packs/<id>/pack.yaml` / `keywords.yaml`，改完热重载即可。

批决策：按策略包里的间隔 / 积压条数 / 空闲时长判断是否 `ready`；建议用 cron 每分钟轮询，仅在 `ready=true` 时再唤醒模型。

## 开发与深入文档

```bash
npm install
npm test
npm run build
```

| 文档 | 内容 |
|---|---|
| [CONTEXT.md](CONTEXT.md) | 领域词表 |
| [docs/SYSTEM.md](docs/SYSTEM.md) | 引擎与策略包语义 |
| [docs/ACCEPTANCE.md](docs/ACCEPTANCE.md) | 验收清单 |
