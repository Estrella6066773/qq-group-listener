# 系统说明：策略包引擎

## 引擎 vs 策略包

| | 引擎（本仓库 `src/`） | 策略包（`packs/<id>/`） |
|---|---|---|
| 职责 | 入站适配、路由求值、缓冲、状态、执行动作、批决策门闩 | 声明「何时唤醒 / 缓冲 / 禁言 / 何时批决策」 |
| 改行为 | 改入口/工具代码需重启 Gateway | 改 YAML：**热重载**，无需重启 |
| 信任边界 | 运行在网关进程内 | 同属可信配置；AI 可通过 `qq_group_policy` 改写 |

引擎**不**内置成瘾品词表或禁言阈值；这些只存在于策略包。

## 热重载

- `PackRegistry` 按 `pack.yaml` / 词表 / 提示词 / `groups.yaml` 的 **mtime** 失效缓存。
- AI 可用工具 `qq_group_policy`：`get` / `write_pack` / `apply_pack_edit` / `set_keywords_category` / `bind_group` / `unbind_group` / `reload`。
- 下一则群消息或下一次工具读取即用新规则。
- **插件 JS 代码**变更仍需 `openclaw gateway restart`。

## 入站路径

1. 群须 `requireMention: false`（always-on），否则非 @ 消息到不了 `before_dispatch`。
2. `Intake` 仅处理 `channel/channelId === qqbot` 的真实频道入站；从 `sessionKey` 解析群 OpenID 并**转大写**。Control UI / webchat 在群会话里打字（`channel=webchat`）一律放行，避免误吞操作员输入。
3. 查 `config/groups.yaml` 得到 PolicyPack（热读）；未绑定则放行（fail open）。
4. `PolicyRouter` 按 `route.order` 短路求值。
5. 若 `wake=false`：写入 `BufferStore`，刷新 `.batch.json` 门闩，返回 `{ handled: true }`。
6. 若有侧效（如禁言）：先执行再按 `wake` 决定放行或吞掉。

## 路由语义

- `mention`：被 @ / 被回复机器人 → 通常 `wake: true`。
- `keyword`：按 `route.keyword.match` 可组合规则命中 → 可 `wake` + `countAndMaybeMute`。
- `default`：未命中上述规则 → 通常 `wake: false, buffer: true`。

同条消息内多词命中只记 **1** 次 HitWindow。

### 匹配语法（`route.keyword.match`）

```yaml
match:
  combine: any   # any=任一规则；all=全部规则
  rules:
    - type: category
      categories: [betel, tobacco]
      exclude: [alcohol]   # 叠加 keywords.yaml 的 excludeCategories
      within: any
    - type: terms
      terms: [特殊口令]
    - type: regex
      pattern: "(尼古丁袋)"
```

- 词库在 `keywords.yaml` 的 `categories`（及顶层 `keywords`）；全局 `excludeCategories` 从扁平兜底词表中剔除。
- **无 `match` 块**：兼容旧行为，扁平合并非 exclude 分类后任一命中。
- 非法正则：该规则视为未命中，不拖垮整条消息。

## 静默自动化（禁言）

关键词命中可配置为 **不唤醒 agent**（`route.keyword.wake: false`），由插件在窗口内命中次数超过 `hitsBeforeMute` 后直接调用禁言 API。

流程：

1. 用户发消息 → 命中 keyword → `handled: true`（零模型调用）
2. 原消息若 `buffer: true` 写入 JSONL（`kind: message`）
3. `countAndMaybeMute` 计数；达阈则 `MuteAction` 执行禁言
4. 禁言成功后再追加一条 `kind: mute_event` 系统记录（含时长、触发词），供批决策 agent 事后阅读
5. `@` / `mention` 仍可 `wake: true` 走即时路径

`addiction-mute` 默认即此模式。

禁言阈值语义（`pack.mute`）：

- 滑动窗口内命中次数 **严格大于** `hitsBeforeMute` 才禁言（默认 3 → 第 4 次触发）。
- 当日已禁言次数 `>= dailyMuteThreshold` 时，改用延长时长（默认第 4 次起 10 分钟）。
- 「当天」按 `Asia/Shanghai` 自然日；跨日重置当日计数。
- `message_id` 幂等：同一消息不重复计数。
- 禁言由插件自动执行；成功事件写入缓冲，**不**为此唤醒即时 agent。

## 批决策触发（batchDecision.triggers）

cron **高频轮询**门闩（建议 `pollEveryMinutes: 1`），只有 `ready=true` 才唤醒模型：

| type | 含义 |
|---|---|
| `interval` | 距上次 `batch_ack` 超过 N 分钟（含从未决策） |
| `messageCount` | 游标后未处理消息 ≥ threshold |
| `idle` | 有待处理，且距最新缓冲消息空闲 ≥ N 分钟 |

- `combine: any`（默认）：任一满足即 ready
- `combine: all`：全部同时满足才 ready
- 落盘：`<data>/buffer/<GROUP>.batch.json`
- 工具：`batch_status` 查询并刷新；`batch_ack` 推进游标并记录 `lastDecisionAtMs`

## Control UI

侧栏「QQ 群策略」页（Feature Plugin 原生 UI）。需开启 Labs → Custom plugin UI。页面操作走 Feature session actions，**不**改全局 `tools.allow`。

**结构化编辑（无 YAML 文本框）**，按节即时写入 `apply_pack_edit`：

| 分区 | 能力 |
|---|---|
| 元信息 | description / version |
| 词表 | 分类新建/删除；单条关键词增删 |
| 匹配条件 | `combine` + category/terms/regex 规则增删排序 |
| 路由与禁言 | wake/buffer/onHit、mute 阈值 |
| 批决策 | combine / 触发器卡片增删 |
| 群绑定 | 绑定 OpenID、解绑（左侧总览与本包列表均支持） |

磁盘仍落 `pack.yaml` / `keywords.yaml` / `groups.yaml`；工具侧仍可 `write_pack` 写整份 YAML。

## 激活注意

- `plugins.entries.qq-group-listener.hooks.allowConversationAccess: true`
- 允许工具：仅在 QQ 群配置 `channels.qqbot.groups.<OPENID>.tools.alsoAllow: ["qq_group_policy"]`；**不要**改全局 `tools.allow` / `tools.alsoAllow`
- 群 OpenID 配置键必须大写
- 首次安装或改插件代码后需重启 Gateway；此后改策略包 YAML 可热重载
