# 验收清单（对照需求 A1–A7 / B1–B7）

激活前置：
- [ ] `plugins.entries.qq-group-listener.hooks.allowConversationAccess: true`
- [ ] 插件已 link 安装并**重启** Gateway
- [ ] 目标群 `requireMention: false`（always-on）
- [ ] 群主已开「接收所有消息」；禁言验收前机器人已是群管理员
- [ ] 建议先 `dryRun: true` 跑禁言路径

## 监听（A）

| ID | 项 | 通过标准 | 结果 |
|---|---|---|---|
| A1 | 非 @ 采集 | 普通消息出现在 buffer JSONL | |
| A2 | 零唤醒 | A1 期间无对应 agent turn / token | |
| A3 | 周期决策 | cron 到点读到新缓冲并决策一次 | |
| A4 | 条件回复 | 命中提示词条件才主动发言 | |
| A5 | 不重复 | 游标推进后同消息不二回 | |
| A6 | 重启恢复 | 重启后缓冲/游标仍在 | |
| A7 | 不话痨 | 连续闲聊保持沉默 | |

## 关键词与禁言（B）

| ID | 项 | 通过标准 | 结果 |
|---|---|---|---|
| B1 | 关键词静默 | 命中词表 → 不唤醒即时 agent（handled）；消息入缓冲 | |
| B2 | @ 仍有效 | 被 @ 正常唤醒 | |
| B3 | 计数 | 30 分钟内第 4 次命中触发禁言；同条多词计 1 | |
| B4 | 时长 | 当日禁言 ≤3 次 → 1 分钟；第 4 次起 → 10 分钟 | |
| B5 | 权限容错 | 非管理员时日志明确失败，不静默成功 | |
| B6 | 状态持久 | 重启后窗口与当日次数不丢 | |
| B7 | 不误伤 | 烟囱 / nice 等不触发 | |
| B8 | 禁言入缓冲 | 禁言成功后 JSONL 出现 kind=mute_event，批决策可读 | |
| B9 | 关键词撤回 | recallHitMessage=true 时命中即尝试撤回；成功出现 kind=recall_event；超时/无权限仅日志失败 | |

## Control UI 结构化编辑（C）

| ID | 项 | 通过标准 | 结果 |
|---|---|---|---|
| C1 | 词表增删 | 页面添加/删除关键词后，下一则消息即按新词命中 | |
| C2 | 匹配规则 | 增删 category/terms/regex 规则并保存后生效；combine any/all 行为正确 | |
| C3 | 批触发器 | 可视化增删 interval/messageCount/idle，门闩 reasons 随之变化 | |
| C4 | 群绑定 | 可绑定与解绑；解绑后该群 fail-open | |
| C5 | 无 YAML 框 | 管理页无整份 pack.yaml textarea | |

## 配置核对

- 群 OpenID（大写）：`C3E939C7B5642D6C67C990CFB945967E`
- 策略包：`addiction-mute`（见 `config/groups.yaml`）
