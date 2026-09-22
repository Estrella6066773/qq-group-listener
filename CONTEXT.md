# QQ 群策略包引擎

OpenClaw 原生插件上下文：在 QQ 群 always-on 入站路径上，用可替换策略包决定唤醒、缓冲与侧效动作。

## Language

**PolicyPack**:
一份可替换的群行为策略（路由、词表、禁言、周期决策），以目录形式存在，由群配置绑定。
_Avoid_: 规则集、配置文件、插件配置

**PolicyRouter**:
按策略包声明的顺序对入站消息求值，产出 RouteDecision 的引擎核心模块。
_Avoid_: 中间件、过滤器

**RouteDecision**:
路由结果：是否唤醒模型、是否写入缓冲区、以及待执行的侧效动作列表。
_Avoid_: 判定结果、处理意见

**Intake**:
把 OpenClaw `before_dispatch` 事件适配成引擎可处理的入站消息，并归一化群 OpenID。
_Avoid_: 钩子处理器、适配层

**BufferStore**:
群消息的本地持久化账本（JSONL）及游标，供定时决策读取，不触发模型。
_Avoid_: 日志、历史、缓存

**StateStore**:
按成员持久化的命中窗口与当日禁言计数，跨网关重启可恢复。
_Avoid_: 状态机、数据库

**HitWindow**:
某一成员在滑动时间窗内的关键词命中时间戳序列。
_Avoid_: 冷却、节流

**MuteAction**:
调用 QQ 群禁言平台接口的侧效动作；失败时必须留下明确日志。
_Avoid_: 踢人、频道管理

**BatchTrigger**:
批决策的触发条件之一：时间间隔、待处理消息条数或空闲时长。
_Avoid_: cron、定时器

**BatchGate**:
根据 BatchTrigger 与缓冲游标算出是否 ready，并写入 `.batch.json` 门闩文件。
_Avoid_: 调度器、队列

**HotReload**:
策略包与群绑定按文件修改时间自动失效缓存，无需重启网关进程。
_Avoid_: 热更新、热部署
