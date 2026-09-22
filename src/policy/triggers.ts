/**
 * 批决策触发条件求值。
 * 联动：BufferStore 追加后由 Intake 调用 → 写入 .batch.json；
 * cron / qq_group_policy.batch_status 读取 ready 决定是否唤醒模型。
 */

import type { BatchDecisionPolicy, BatchTrigger } from "../types.js";

export type BatchSnapshot = {
  pendingCount: number;
  lastMessageAtMs: number;
  lastDecisionAtMs: number;
  nowMs: number;
};

export type TriggerEval = {
  ready: boolean;
  reasons: string[];
  combine: "any" | "all";
};

export function normalizeBatchPolicy(
  raw: BatchDecisionPolicy | undefined,
): BatchDecisionPolicy | undefined {
  if (!raw) return undefined;
  const triggers = raw.triggers?.length
    ? raw.triggers
    : raw.intervalMinutes
      ? ([{ type: "interval", everyMinutes: raw.intervalMinutes }] as BatchTrigger[])
      : [];
  return {
    ...raw,
    combine: raw.combine === "all" ? "all" : "any",
    pollEveryMinutes: raw.pollEveryMinutes ?? 1,
    triggers,
  };
}

export function evaluateBatchTriggers(
  policy: BatchDecisionPolicy,
  snap: BatchSnapshot,
): TriggerEval {
  const p = normalizeBatchPolicy(policy)!;
  const combine = p.combine ?? "any";
  const reasons: string[] = [];
  const results: boolean[] = [];

  if (snap.pendingCount <= 0) {
    return { ready: false, reasons: ["no_pending"], combine };
  }

  for (const t of p.triggers ?? []) {
    if (t.type === "interval") {
      const elapsed = snap.nowMs - (snap.lastDecisionAtMs || 0);
      const need = t.everyMinutes * 60 * 1000;
      const ok = snap.lastDecisionAtMs === 0 || elapsed >= need;
      results.push(ok);
      if (ok) reasons.push(`interval>=${t.everyMinutes}m`);
    } else if (t.type === "messageCount") {
      const ok = snap.pendingCount >= t.threshold;
      results.push(ok);
      if (ok) reasons.push(`pending>=${t.threshold}`);
    } else if (t.type === "idle") {
      const idle = snap.nowMs - (snap.lastMessageAtMs || 0);
      const ok = idle >= t.idleMinutes * 60 * 1000;
      results.push(ok);
      if (ok) reasons.push(`idle>=${t.idleMinutes}m`);
    }
  }

  if (results.length === 0) {
    return { ready: false, reasons: ["no_triggers"], combine };
  }

  const ready = combine === "all" ? results.every(Boolean) : results.some(Boolean);
  return { ready, reasons: ready ? reasons : [], combine };
}
