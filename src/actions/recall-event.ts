/**
 * 撤回系统记录：写入 BufferStore，供批决策 agent 事后阅读。
 * 联动：Intake 在 RecallAction.recallMessage 成功后调用；不唤醒即时 agent。
 */

import type { BufferRecord, RouteRuleKind } from "../types.js";

export function formatRecallEventText(args: {
  memberOpenId: string;
  messageId: string;
  keywords: string[];
}): string {
  const kw = args.keywords.length > 0 ? args.keywords.join("、") : "（未标注）";
  return (
    `[系统·自动撤回] 已撤回成员 ${args.memberOpenId} 的消息（id=${args.messageId.slice(0, 32)}…）；` +
    `触发词：${kw}。此为插件自动执行，无需模型再发撤回指令。`
  );
}

export function buildRecallEventRecord(args: {
  groupOpenId: string;
  memberOpenId: string;
  packId: string;
  matchedRule: RouteRuleKind;
  timestampMs: number;
  messageId: string;
  keywords: string[];
}): BufferRecord {
  return {
    messageId: `recall:${args.groupOpenId}:${args.messageId}:${args.timestampMs}`,
    groupOpenId: args.groupOpenId,
    memberOpenId: args.memberOpenId,
    text: formatRecallEventText(args),
    mentioned: false,
    timestampMs: args.timestampMs,
    packId: args.packId,
    matchedRule: args.matchedRule,
    kind: "recall_event",
    recall: {
      sourceMessageId: args.messageId,
      keywords: args.keywords,
    },
  };
}
