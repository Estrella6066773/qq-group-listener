import { describe, expect, it } from "vitest";
import { evaluateBatchTriggers, normalizeBatchPolicy } from "../src/policy/triggers.js";
import type { BatchDecisionPolicy } from "../src/types.js";

describe("batch triggers", () => {
  const base: BatchDecisionPolicy = {
    promptFile: "x.md",
    deliveryChannelPrefix: "qqbot:group:",
    combine: "any",
    triggers: [
      { type: "interval", everyMinutes: 10 },
      { type: "messageCount", threshold: 5 },
      { type: "idle", idleMinutes: 5 },
    ],
  };

  it("normalizes legacy intervalMinutes into triggers", () => {
    const p = normalizeBatchPolicy({
      intervalMinutes: 10,
      promptFile: "x.md",
      deliveryChannelPrefix: "qqbot:group:",
    });
    expect(p?.triggers?.[0]).toEqual({ type: "interval", everyMinutes: 10 });
  });

  it("is not ready with zero pending", () => {
    const ev = evaluateBatchTriggers(base, {
      pendingCount: 0,
      lastMessageAtMs: Date.now(),
      lastDecisionAtMs: 0,
      nowMs: Date.now(),
    });
    expect(ev.ready).toBe(false);
  });

  it("fires on messageCount", () => {
    const now = 1_000_000;
    const ev = evaluateBatchTriggers(base, {
      pendingCount: 5,
      lastMessageAtMs: now,
      lastDecisionAtMs: now,
      nowMs: now,
    });
    expect(ev.ready).toBe(true);
    expect(ev.reasons.some((r) => r.startsWith("pending>="))).toBe(true);
  });

  it("fires on interval when never decided", () => {
    const now = 1_000_000;
    const ev = evaluateBatchTriggers(base, {
      pendingCount: 1,
      lastMessageAtMs: now,
      lastDecisionAtMs: 0,
      nowMs: now,
    });
    expect(ev.ready).toBe(true);
    expect(ev.reasons).toContain("interval>=10m");
  });

  it("fires on idle", () => {
    const now = 1_000_000;
    const ev = evaluateBatchTriggers(
      { ...base, combine: "any", triggers: [{ type: "idle", idleMinutes: 5 }] },
      {
        pendingCount: 2,
        lastMessageAtMs: now - 6 * 60 * 1000,
        lastDecisionAtMs: now,
        nowMs: now,
      },
    );
    expect(ev.ready).toBe(true);
  });

  it("requires all when combine=all", () => {
    const now = 1_000_000;
    const policy: BatchDecisionPolicy = {
      ...base,
      combine: "all",
      triggers: [
        { type: "messageCount", threshold: 5 },
        { type: "idle", idleMinutes: 5 },
      ],
    };
    const onlyCount = evaluateBatchTriggers(policy, {
      pendingCount: 5,
      lastMessageAtMs: now,
      lastDecisionAtMs: now,
      nowMs: now,
    });
    expect(onlyCount.ready).toBe(false);

    const both = evaluateBatchTriggers(policy, {
      pendingCount: 5,
      lastMessageAtMs: now - 6 * 60 * 1000,
      lastDecisionAtMs: now,
      nowMs: now,
    });
    expect(both.ready).toBe(true);
  });
});
