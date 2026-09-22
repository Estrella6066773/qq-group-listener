/**
 * 禁言系统记录：写入 BufferStore，供批决策 agent 事后阅读。
 * 联动：Intake 在 MuteAction.maybeMute 成功后调用；不唤醒即时 agent。
 */

import type { BufferRecord, RouteRuleKind } from "../types.js";

export function formatMuteEventText(args: {
  memberOpenId: string;
  seconds: number;
  keywords: string[];
  hitCount: number;
  extended: boolean;
}): string {
  const kw = args.keywords.length > 0 ? args.keywords.join("、") : "（未标注）";
  const tier = args.extended ? "延长档" : "基础档";
  return (
    `[系统·自动禁言] 成员 ${args.memberOpenId} 已被禁言 ${args.seconds} 秒（${tier}）；` +
    `窗口命中 ${args.hitCount} 次；触发词：${kw}。` +
    `此为插件自动执行，无需模型再发禁言指令。`
  );
}

export function buildMuteEventRecord(args: {
  groupOpenId: string;
  memberOpenId: string;
  packId: string;
  matchedRule: RouteRuleKind;
  timestampMs: number;
  seconds: number;
  keywords: string[];
  hitCount: number;
  extended: boolean;
}): BufferRecord {
  return {
    messageId: `mute:${args.groupOpenId}:${args.memberOpenId}:${args.timestampMs}`,
    groupOpenId: args.groupOpenId,
    memberOpenId: args.memberOpenId,
    text: formatMuteEventText(args),
    mentioned: false,
    timestampMs: args.timestampMs,
    packId: args.packId,
    matchedRule: args.matchedRule,
    kind: "mute_event",
    mute: {
      seconds: args.seconds,
      keywords: args.keywords,
      hitCount: args.hitCount,
      extended: args.extended,
    },
  };
}
