# QQ 群「全量监听 + 选择性回复」需求文档

> 交接给负责本项目的 agent。本文档只描述**需求、已验证的事实、目标架构与验收标准**，不含实现细节堆砌；动手前请先读完「已验证的事实」与「约束与风险」两节。

- 文档版本：v1.0
- 编写时间：2026-09-22
- 目标环境：Gateway 主机 `Estrella-02`（Windows 10.0.26200 x64），OpenClaw `2026.9.4`，Node `v26.7.0`
- 涉及通道：QQ 机器人（qqbot）

---

## 1. 项目目标

让 QQ 机器人在**指定群**里满足以下行为：

1. **全量监听**：接收群内每一条消息（不限于 @ 机器人）。
2. **默认沉默**：绝大多数消息**不回复**，且**不因此唤醒模型**（不得"每句都回"，也不得每条消息都产生一次模型调用成本）。
3. **按需主动回复**：在满足触发条件时，**主动发送消息**回到该群。

本质是「低频轮询式」而非「逐条即时唤醒」：周期性地读取群消息、判断是否需要回应，再决定是否主动发言。

---

## 2. 背景与问题

### 2.1 现状

当前该群已配置为 **always-on 模式**（`requireMention: false`）+ `messages.groupChat.visibleReplies: "message_tool"`。

结果：**每条群消息都会唤醒一次模型**，由模型自行决定是否发言。实测表现为「几乎每句话都回复」。

### 2.2 为什么换推荐方式（关键词硬触发）也不满足需求

「关键词硬触发」虽然确定性高，但触发词固定、需要预先枚举，无法满足「周期性、由模型判断是否回应」的设想。

### 2.3 核心矛盾

- 要让机器人**读得到**群消息，QQ 侧唯一可用配置是 always-on（每条消息都进入会话）；
- 但 always-on 又必然**每条都唤醒模型**，与「不逐条唤醒」直接冲突。

需要一个能「旁路记账、不唤醒模型」的数据源，才能打破这个死循环。

---

## 3. 已验证的事实（含证据）

> 以下均为在本机实测/查证，**请勿凭记忆推翻**；如有异议请重新实测。

### 3.1 平台侧（QQ 开放平台）

- 官方**确实提供**「接收全部群消息」能力。
  - 事件名：`GROUP_MESSAGE_CREATE`，官方文档标题为「群消息（全量模式）」。
  - Intent：`GROUP_AND_C2C_EVENT (1 << 25)`。
  - 官方原话：「当机器人开启了"接收所有消息"功能后，群里的每一条消息（不限于@机器人）都会推送此事件。」
  - 官方 FAQ：「接收全量消息能力：当群主设定允许该机器人接收群内全部消息时，机器人可接收到群内所有成员在群内的发言消息。」（需最新版手机 QQ）
- 该开关**不在插件、也不在开发者后台**，而在**群主**手里（群设置 → 群机器人管理 → 选中机器人 → 开启「接收所有消息」，各版本叫法略有出入）。
- **本群已完成该开关的开启**，非 @ 消息已能到达（已由用户确认）。

### 3.2 插件侧

- 插件：`@tencent-connect/openclaw-qqbot`，版本 `v2.0.3`，插件 id `openclaw-qqbot`。
- 插件**已同时处理** `GROUP_AT_MESSAGE_CREATE` 与 `GROUP_MESSAGE_CREATE`，并订阅 `GROUP_AND_C2C` intent —— 即**插件侧链路已完整**，不需要改插件源码。
- **已知坑（重要）**：群配置查找为**大小写敏感的精确匹配**（`groups[groupOpenid]`），而平台下发的是**大写** OpenID。
  - 若配置键写成小写，会被**静默忽略**，回退到默认 `requireMention: true`。
  - 证据：日志 `interaction query: group=C3E939C7… requireMention=true`，而配置文件中为 `false`。
  - 对比：仅 `isGroupAllowed` / `groupAllowFrom` 做了 `.toUpperCase()` 归一化，`resolveGroupConfigFromAccount` 未做。
- 群消息历史存放于**网关进程内存**（`MemoryHistoryStore`），**不落盘**，且**未向自动化/其他会话暴露读取接口**。
  - 源码默认 `DEFAULT_GROUP_HISTORY_LIMIT = 20`（插件 README 写 50，**以源码为准**）。
- QQ **不支持** OpenClaw 的 ambient room events（静默上下文）机制。该机制目前仅支持 Discord / Slack / Telegram。
- 因此，**开在别的会话里的 cron 任务读不到群消息**。

### 3.3 自动化侧

- 本机 automations 已在正常运行，且**已验证**可定时 `announce` 主动投递到外部通道（现有 `WXTZ-*` 任务即定时 `announce → openclaw-weixin:…`）。
- 即「到点自己判断 → 主动发消息」这条链路**可行**。

---

## 4. 目标架构

采用**原生插件 + 定时自动化**两段式，绕开「逐条唤醒模型」：

```
QQ 群消息
   │
   ▼
① 原生插件（订阅 before_dispatch 入站拦截钩子）
   │   收到群消息 → 追加写入本地缓冲区（文件）→ 返回 handled，吞掉消息
   │   ⚠️ 零模型调用，仅"记账"
   ▼
本地缓冲区（JSONL / JSON 文件，可由定时任务读取）
   │
   ▼
② 定时自动化（cron job，isolated agentTurn）
   │   每 N 分钟：读缓冲区 → 判断是否需要回应 → 若需要，调用 message 工具主动发到群 → 更新游标
   ▼
QQ 群（机器人主动发言）
```

### 4.1 关键 seam：`before_dispatch`

- 属 OpenClaw **原生插件 hooks**（`api.on("before_dispatch", handler)`）。
- 入站消息在**派发给模型之前**到达；返回 `{ handled: true }` 即可**吞掉该消息、完全不唤醒模型**；`{ handled: true, text: "..." }` 则直接回复。
- 需在配置中开启对话钩子权限：`plugins.entries.<pluginId>.hooks.allowConversationAccess: true`。
- 参考：`docs/plugins/hooks.md`、`docs/plugins/hooks/messages.md`。

### 4.2 定时任务侧

- 使用 automations：`sessionTarget` 建议 `isolated`（独立 session），`announce` 投递到 `qqbot:group:<GROUP_OPENID>`。
- 该任务只负责：读缓冲区 → 决策 → 主动发送 → 推进游标。
- 参考：`docs/automation/cron-jobs/*`（尤其 `payloads.md`、`delivery.md`）。

---

## 5. 需求规格

### 5.1 功能需求

| 编号 | 需求 | 说明 |
|---|---|---|
| F1 | 全量采集 | 群内**所有**成员消息（含非 @）都进入缓冲区，一条不丢 |
| F2 | 零唤醒 | 采集过程**不得**触发模型调用 |
| F3 | 周期决策 | 按固定周期（默认建议 5–15 分钟，可配）读取新消息并决策 |
| F4 | 条件回复 | 仅在满足条件时主动发言；条件由决策提示词定义（见 5.3），不在消息本身逐条触发 |
| F5 | 主动投递 | 回复通过 message 工具主动发送到目标群，不依赖被 @ |
| F6 | 去重/游标 | 已处理消息不得重复回复；重启后游标状态需可恢复 |
| F7 | 可观测 | 采集、决策、发送均应有日志或状态可查 |

### 5.2 非功能需求

- **成本**：稳态下不得对每条群消息产生模型调用。
- **可靠性**：网关重启后缓冲区与游标不丢（至少不重复回复）。
- **安全**：插件运行在网关进程内，属信任边界；只允许加载可信代码。
- **最小侵入**：优先使用官方 hooks / automations，避免修改第三方插件源码。

### 5.3 待确认项（实现前需与需求方对齐）

1. **决策周期**：默认多久轮询一次？（建议 5–15 分钟）
2. **回复条件（提示词）**：什么情况下该回复？例如「有人提问且机器人能答」「被点名」「出现待办/提醒类内容」等。需明确，否则会退回「话多」状态。
3. **缓冲区存储位置与格式**：建议工作区内 JSONL；是否接受？
4. **是否保留 @ 即时回复**：当前建议保留「被 @ / 被回复我 / 命中关键词」走即时路径，其余走轮询路径。是否同意？

---

## 6. 验收标准

| 编号 | 验收项 | 通过标准 |
|---|---|---|
| A1 | 非 @ 消息采集 | 群成员发一条**不带 @** 的普通消息 → 缓冲区中出现该条记录 |
| A2 | 零唤醒 | A1 期间**无**对应的模型调用/token 消耗（日志无该消息的 agent turn） |
| A3 | 周期决策 | 到达轮询周期时，任务自动读取新消息并产生一次决策 |
| A4 | 条件回复 | 命中回复条件时，机器人**主动**在群里发消息；未命中时**保持沉默** |
| A5 | 不重复 | 同一条消息不会被回复两次；窗口内多条消息按一次批处理 |
| A6 | 重启恢复 | 重启网关后，缓冲区/游标仍在，未处理消息不丢、已处理不重发 |
| A7 | 不话痨 | 连续多轮日常闲聊下，机器人**不回复**（关键回归项） |

---

## 7. 约束与风险

1. **大小写坑**：任何涉及群 OpenID 的配置键**必须大写**（见 3.2），否则静默失效。
2. **平台权限依赖**：F1 成立的前提是群主已开启「接收所有消息」；若更换机器人或群，需重新确认。
3. **原生插件信任边界**：插件在网关进程内执行，等同可信代码；不可引入不受控依赖。
4. **插件为第三方包**：升级 `@tencent-connect/openclaw-qqbot` 可能改变内部行为（如大小写处理、默认值）；升级后需回归 A1–A7。
5. **网络不稳**：本机 QQ 通道当前偶发 `error: socket hang up` 与 DNS 解析偶发失败（`ENOTFOUND api.sgroup.qq.com`），会自行重连；验收时若遇发送失败请重试并查日志。
6. **文档与实现可能不一致**：以**源码实测**为准（例：historyLimit 默认值 README 与源码不符）。
7. **不要走弯路**：已验证「QQ 无 ambient 模式」「插件群历史不落盘」「cron 读不到群会话」——不要在这三条上重复试错。

---

## 8. 环境与关键标识

- Gateway 主机：`Estrella-02`，Windows `10.0.26200` x64
- OpenClaw：`2026.9.4`；Node：`v26.7.0`；Shell：PowerShell
- **目标群 OpenID（务必大写）**：`C3E939C7B5642D6C67C990CFB945967E`
- 群会话 key：`agent:main:qqbot:group:c3e939c7b5642d6c67c990cfb945967e`
- QQ 插件安装路径：
  `C:\Users\C3542\.openclaw\npm\projects\tencent-connect-openclaw-qqbot-a7ec020d86__openclaw-generation__g-bf17e205db7bfd0e\node_modules\@tencent-connect\openclaw-qqbot`
- 关键配置路径：
  - `channels.qqbot.groups.C3E939C7B5642D6C67C990CFB945967E.requireMention`
  - `channels.qqbot.groups.C3E939C7B5642D6C67C990CFB945967E.prompt`
  - `messages.groupChat.visibleReplies`
  - `plugins.entries.<pluginId>.hooks.allowConversationAccess`

---

## 9. 参考资料

- QQ 机器人官方文档（全量消息事件）：`https://bot.q.qq.com/wiki/develop/api-v2/`
  - 群消息（全量模式）：事件 `GROUP_MESSAGE_CREATE`
- OpenClaw 文档（本机）：
  - `docs/plugins/hooks.md`（原生插件 hooks、`before_dispatch`、权限门）
  - `docs/plugins/hooks/messages.md`（入站拦截与出站改写）
  - `docs/plugins/building-plugins.md`、`docs/plugins/manifest.md`
  - `docs/automation/cron-jobs/payloads.md`（payload 与执行方式）
  - `docs/automation/cron-jobs/delivery.md`（announce 投递）
  - `docs/channels/qqbot.md`、`docs/channels/groups.md`、`docs/channels/ambient-room-events.md`
- 插件自带说明：`@tencent-connect/openclaw-qqbot/README.zh.md`

---

## 10. 交付物建议

1. 原生插件（本地目录，含 `package.json` / `openclaw.plugin.json` / 入口文件），实现 `before_dispatch` 采集与缓冲。
2. 缓冲区文件规范（路径、格式、游标字段）。
3. 一个 automation cron job 定义（读取 → 决策 → 主动发送）。
4. 一份验证记录：逐条对应 A1–A7 的实测证据。
