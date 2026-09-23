import { describe, expect, it } from "vitest";
import { formatWakeContext, pickRecentRecords } from "../src/wake-context.js";
import type { BufferRecord } from "../src/types.js";

function msg(partial: Partial<BufferRecord> & { text: string }): BufferRecord {
  return {
    messageId: partial.messageId ?? "m",
    groupOpenId: "G1",
    memberOpenId: partial.memberOpenId ?? "U1",
    text: partial.text,
    mentioned: false,
    timestampMs: partial.timestampMs ?? 1,
    packId: "demo",
    matchedRule: "default",
    kind: partial.kind ?? "message",
  };
}

describe("wake-context", () => {
  it("picks the newest N records", () => {
    const all = [1, 2, 3, 4, 5].map((n) => msg({ text: `t${n}`, timestampMs: n }));
    expect(pickRecentRecords(all, 3).map((r) => r.text)).toEqual(["t3", "t4", "t5"]);
  });

  it("formats a floodgate-style context block", () => {
    const text = formatWakeContext([
      msg({ text: "你好", memberOpenId: "A", timestampMs: 1000 }),
      msg({ text: "在吗", memberOpenId: "B", timestampMs: 2000 }),
    ]);
    expect(text).toContain("群近期聊天记录");
    expect(text).toContain("不限制你回复的话题或内容范围");
    expect(text).toContain("你好");
    expect(text).toContain("在吗");
  });

  it("returns null when disabled or empty", () => {
    expect(formatWakeContext([], {})).toBeNull();
    expect(formatWakeContext([msg({ text: "x" })], { enabled: false })).toBeNull();
  });
});
