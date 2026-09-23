/**
 * 策略包引擎的共享类型。
 * 联动：load.ts 解析 YAML → PolicyPack；router / match-policy 求值；
 * PackEditor + Control UI 经 PackEdit / PackView 读写；Intake / Actions 消费路由结果。
 *
 * 注意：扁平 keywords 已扣全局 excludeCategories；有 match 时以 AST 为准。
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

export type RouteRuleKind = "mention" | "summon" | "keyword" | "default";

/** 多条匹配规则如何合并。 */
export type MatchCombine = "any" | "all";

/** 单条规则内部：任一词 / 每类至少一词。 */
export type MatchWithin = "any" | "all";

/**
 * 关键词匹配规则（落盘于 route.keyword.match.rules）。
 * 联动：evaluateMatchPolicy 求值；Control UI / PackEditor 结构化编辑。
 */
export type MatchRule =
  | {
      type: "category";
      categories: string[];
      /** 从本规则词表中剔除这些分类（叠加 keywords.yaml 的全局 excludeCategories）。 */
      exclude?: string[];
      within?: MatchWithin;
    }
  | {
      type: "terms";
      terms: string[];
      within?: MatchWithin;
    }
  | {
      type: "regex";
      pattern: string;
    };

export type MatchPolicy = {
  combine: MatchCombine;
  rules: MatchRule[];
};

/** keywords.yaml 的结构化形态（UI / 编辑器读写）。 */
export type KeywordsFileData = {
  version?: string;
  categories: Record<string, string[]>;
  /** 未归类词条。 */
  keywords: string[];
  excludeCategories: string[];
};

export type RouteRule = {
  wake: boolean;
  buffer: boolean;
  keywordsRef?: string;
  onHit?: "countAndMaybeMute" | "none";
  /**
   * 命中本规则时是否立即撤回该条群消息（官方 DELETE，须管理员且通常 <2 分钟）。
   * 可与 countAndMaybeMute 同时开启：先撤消息，再按 mute 阈值计数/禁言。
   */
  recallHitMessage?: boolean;
  /** 可组合匹配；缺省时扁平合并全部词条（兼容旧 pack）。 */
  match?: MatchPolicy;
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
    /** 喊名字即唤醒（无需 @）：按规则内 match 命中正文即 wake，不计数、不禁言。 */
    summon?: RouteRule;
    keyword?: RouteRule;
    default: RouteRule;
  };
  mute?: MutePolicy;
  batchDecision?: BatchDecisionPolicy;
  /**
   * 唤醒时注入近期缓冲聊天记录（泄流闸：只控时机，不限内容）。
   * 缺省：enabled=true, maxMessages=40, maxChars=12000。
   */
  wakeContext?: {
    enabled?: boolean;
    maxMessages?: number;
    maxChars?: number;
  };
  /**
   * 扁平词表（兼容缓存 / 旧逻辑）。
   * 已排除 keywords.yaml 的 excludeCategories；无 match 时 router 直接用此列表。
   */
  keywords: string[];
  /** 分类词表（含被全局 exclude 的分类，供 UI 与 category 规则引用）。 */
  categories: Record<string, string[]>;
  /** keywords.yaml 顶层未归类词。 */
  looseKeywords: string[];
  /** keywords.yaml 的 excludeCategories。 */
  excludeCategories: string[];
  packDir: string;
};

/** Control UI / get_pack 返回的结构化视图。 */
export type PackView = {
  packId: string;
  version: string;
  description: string;
  keywordCount: number;
  categories: Record<string, string[]>;
  looseKeywords: string[];
  excludeCategories: string[];
  match: MatchPolicy | null;
  route: PolicyPack["route"];
  mute: MutePolicy | null;
  batchDecision: BatchDecisionPolicy | null;
  /** 绑定到本包的群 OpenID 列表。 */
  boundGroups: string[];
  /** 兼容工具：完整 pack.yaml 文本。 */
  yamlText: string;
};

/** PackEditor.applyEdit 的判别联合。 */
export type PackEdit =
  | { op: "set_meta"; description?: string; version?: string }
  | { op: "set_keywords_category"; category: string; keywords: string[] }
  | { op: "add_keyword"; category: string; term: string }
  | { op: "remove_keyword"; category: string; term: string }
  | { op: "delete_category"; category: string }
  | { op: "set_exclude_categories"; excludeCategories: string[] }
  | { op: "set_match"; match: MatchPolicy | null }
  | {
      op: "set_route_mute";
      route?: Partial<{
        order: RouteRuleKind[];
        mention: RouteRule | null;
        summon: RouteRule | null;
        keyword: RouteRule | null;
        default: RouteRule;
      }>;
      mute?: MutePolicy | null;
    }
  | { op: "set_batch"; batchDecision: BatchDecisionPolicy | null };

export type PendingAction =
  | {
      type: "countAndMaybeMute";
      matchedKeywords: string[];
    }
  | {
      type: "recallMessage";
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
  /**
   * message=普通群消息（默认）；mute_event=插件自动禁言后写入的系统记录，
   * recall_event=插件自动撤回后写入的系统记录。批决策应知悉且勿重复操作。
   */
  kind?: "message" | "mute_event" | "recall_event";
  mute?: {
    seconds: number;
    keywords: string[];
    hitCount: number;
    extended: boolean;
  };
  recall?: {
    sourceMessageId: string;
    keywords: string[];
  };
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
