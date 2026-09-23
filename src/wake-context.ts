/**
 * 唤醒上下文：把插件缓冲里的近期群聊天拼成 prependContext。
 * 联动：before_prompt_build 在放行唤醒时注入；泄流闸只决定「何时」响应，不限制回复内容。
 * 注意：静默消息曾被 before_dispatch 吞掉，不会进入 OpenClaw 会话历史，必须由此旁路补回。
 */

import type { BufferRecord } from "./types.js";

export type WakeContextOptions = {
  enabled?: boolean;
  /** 最多注入多少条缓冲记录（含系统 mute/recall 事件）。默认 40。 */
  maxMessages?: number;
  /** 注入文本总字符上限。默认 12000。 */
  maxChars?: number;
};

const DEFAULT_MAX_MESSAGES = 40;
const DEFAULT_MAX_CHARS = 12_000;

export function pickRecentRecords(
  records: BufferRecord[],
  maxMessages = DEFAULT_MAX_MESSAGES,
): BufferRecord[] {
  if (maxMessages <= 0 || records.length === 0) return [];
  return records.slice(-maxMessages);
}

function formatTs(ms: number): string {
  try {
    return new Date(ms).toLocaleString("zh-CN", { hour12: false });
  } catch {
    return String(ms);
  }
}

function lineFor(rec: BufferRecord): string {
  const kind = rec.kind ?? "message";
  if (kind === "mute_event" || kind === "recall_event") {
    return `- [${formatTs(rec.timestampMs)}] ${rec.text}`;
  }
  const who = rec.memberOpenId || "未知成员";
  return `- [${formatTs(rec.timestampMs)}] ${who}: ${rec.text}`;
}

/**
 * 生成注入到 agent 的群聊上下文。无记录时返回 null（不注入空块）。
 */
export function formatWakeContext(
  records: BufferRecord[],
  opts: WakeContextOptions = {},
): string | null {
  if (opts.enabled === false) return null;
  const maxMessages = opts.maxMessages ?? DEFAULT_MAX_MESSAGES;
  const maxChars = opts.maxChars ?? DEFAULT_MAX_CHARS;
  const picked = pickRecentRecords(records, maxMessages);
  if (picked.length === 0) return null;

  const header =
    "【群近期聊天记录（插件旁路缓冲）】\n" +
    "以下消息在静默期间未进入会话历史；现一并提供给你理解语境。\n" +
    "本插件只控制「何时」唤醒你，不限制你回复的话题或内容范围。\n";

  const footer =
    "\n【记录结束】请结合当前用户消息作答；默认可保持简洁，无需自我审查话题范围。";

  const lines: string[] = [];
  let used = header.length + footer.length;
  // 从旧到新；超限时丢弃更旧的
  for (let i = picked.length - 1; i >= 0; i--) {
    const line = lineFor(picked[i]!);
    if (used + line.length + 1 > maxChars) break;
    lines.unshift(line);
    used += line.length + 1;
  }
  if (lines.length === 0) return null;
  return `${header}${lines.join("\n")}${footer}`;
}
