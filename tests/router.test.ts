import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadPack } from "../src/policy/load.js";
import { evaluate } from "../src/policy/router.js";
import type { InboundMessage } from "../src/types.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function msg(partial: Partial<InboundMessage>): InboundMessage {
  return {
    messageId: "m1",
    groupOpenId: "C3E939C7B5642D6C67C990CFB945967E",
    memberOpenId: "MEMBER1",
    text: "",
    mentioned: false,
    timestampMs: Date.now(),
    ...partial,
  };
}

describe("PolicyRouter + addiction-mute pack", () => {
  const pack = loadPack(root, "addiction-mute");
  if (!pack) throw new Error("pack missing");

  it("loads keywords from yaml", () => {
    expect(pack.keywords.length).toBeGreaterThan(20);
    expect(pack.keywords.some((k) => k.includes("槟榔") || k.includes("檳榔"))).toBe(true);
  });

  it("wakes on mention without keyword", () => {
    const d = evaluate(msg({ text: "你好", mentioned: true }), pack);
    expect(d.matchedRule).toBe("mention");
    expect(d.wake).toBe(true);
    expect(d.buffer).toBe(true); // addiction-mute：@ 也入缓冲，供唤醒拼聊天记录
  });

  it("wakes on keyword and schedules mute action", () => {
    const d = evaluate(msg({ text: "谁有槟榔" }), pack);
    expect(d.matchedRule).toBe("keyword");
    expect(d.wake).toBe(false);
    expect(d.buffer).toBe(true);
    expect(d.actions[0]?.type).toBe("countAndMaybeMute");
  });

  it("buffers and swallows default chatter", () => {
    const d = evaluate(msg({ text: "今天天气不错" }), pack);
    expect(d.matchedRule).toBe("default");
    expect(d.wake).toBe(false);
    expect(d.buffer).toBe(true);
  });
});
