/**
 * 策略包引擎的共享类型。
 * 联动：load.ts 解析 YAML → PolicyPack；router.ts 产出 RouteDecision；
 * Intake / Actions 消费 InboundMessage 与 PendingAction。
 */

/** 入站消息（已由 Intake 归一化）。 */
export type InboundMessage = {
  messageId: string;
  groupOpenId: string;
  memberOpenId: string;
  text: string;
  mentioned: boolean;
  timestampMs: number;
  raw?: unknown;
};

export type RouteRuleKind = "mention" | "keyword" | "default";

export type RouteRule = {
  wake: boolean;
  buffer: boolean;
  keywordsRef?: string;
  onHit?: "countAndMaybeMute" | "none";
};

export type MutePolicy = {
  timezone: string;
  windowMinutes: number;
  /** Mute when hits in window strictly exceed this (default 3 => 4th hit). */
  hitsBeforeMute: number;
  muteSeconds: number;
  /** Extend duration once mutes today reach this count (default 3 => 4th mute). */
  dailyMuteThreshold: number;
  extendedMuteSeconds: number;
};

/** 批决策触发器：任一/全部满足即可进入决策（由 combine 决定）。 */
export type BatchTrigger =
  | {
      /** 距上次决策超过 N 分钟（含从未决策）。 */
      type: "interval";
      everyMinutes: number;
    }
  | {
      /** 游标后未处理消息条数达到阈值。 */
      type: "messageCount";
      threshold: number;
    }
  | {
      /** 有待处理消息，且距最新缓冲消息空闲 N 分钟（适合「聊完再总结」）。 */
      type: "idle";
      idleMinutes: number;
    };

export type BatchDecisionPolicy = {
  /**
   * @deprecated 请用 triggers[{type:interval}]；保留以兼容旧 pack。
   */
  intervalMinutes?: number;
  promptFile: string;
  deliveryChannelPrefix: string;
  /** cron 建议轮询周期（分钟）；实际是否决策看 triggers。默认 1。 */
  pollEveryMinutes?: number;
  /** any=任一触发；all=全部同时满足。默认 any。 */
  combine?: "any" | "all";
  triggers?: BatchTrigger[];
};

/** 落盘批决策门闩，供 cron / 工具读取。 */
export type BatchStatusFile = {
  groupOpenId: string;
  packId: string;
  ready: boolean;
  reasons: string[];
  pendingCount: number;
  lastMessageAtMs: number;
  lastDecisionAtMs: number;
  updatedAtMs: number;
  combine: "any" | "all";
};

export type PolicyPack = {
  id: string;
  version: string;
  description?: string;
  route: {
    order: RouteRuleKind[];
    mention?: RouteRule;
    keyword?: RouteRule;
    default: RouteRule;
  };
  mute?: MutePolicy;
  batchDecision?: BatchDecisionPolicy;
  /** Flattened keywords from keywordsRef file. */
  keywords: string[];
  packDir: string;
};

export type PendingAction =
  | {
      type: "countAndMaybeMute";
      matchedKeywords: string[];
    };

export type RouteDecision = {
  packId: string;
  matchedRule: RouteRuleKind;
  wake: boolean;
  buffer: boolean;
  matchedKeywords: string[];
  actions: PendingAction[];
};

export type GroupsConfig = {
  /** Uppercase group OpenID → pack id */
  groups: Record<string, string>;
};

export type PluginEngineConfig = {
  bufferDir: string;
  stateDir: string;
  logLevel: "debug" | "info" | "warn" | "error";
};

export type BufferRecord = {
  messageId: string;
  groupOpenId: string;
  memberOpenId: string;
  text: string;
  mentioned: boolean;
  timestampMs: number;
  packId: string;
  matchedRule: RouteRuleKind;
};

export type HitStateFile = {
  keywordsVersion?: string;
  /** messageId → true once counted */
  seenMessageIds: Record<string, true>;
  hitWindow: Record<string, number[]>;
  muteCountToday: {
    date: string;
    byMember: Record<string, number>;
  };
};
