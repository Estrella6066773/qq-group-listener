/**
 * 批决策门闩：根据 pack.batchDecision.triggers 写 .batch.json。
 * 联动：Intake 缓冲后 refresh；cron/工具读 ready；acknowledge 清门闩。
 */

import fs from "node:fs";
import { atomicWriteJson, type BufferStore } from "./buffer.js";
import { evaluateBatchTriggers } from "../policy/triggers.js";
import type { BatchDecisionPolicy, BatchStatusFile, PolicyPack } from "../types.js";

export class BatchGate {
  constructor(private buffer: BufferStore) {}

  refresh(groupOpenId: string, pack: PolicyPack, nowMs = Date.now()): BatchStatusFile {
    const policy = pack.batchDecision as BatchDecisionPolicy | undefined;
    const pendingCount = this.buffer.pendingCount(groupOpenId);
    const lastMessageAtMs = this.buffer.lastBufferedAtMs(groupOpenId);
    const cursor = this.buffer.readCursor(groupOpenId);
    const lastDecisionAtMs = cursor.lastDecisionAtMs ?? 0;

    let ready = false;
    let reasons: string[] = [];
    let combine: "any" | "all" = "any";

    if (policy) {
      const ev = evaluateBatchTriggers(policy, {
        pendingCount,
        lastMessageAtMs,
        lastDecisionAtMs,
        nowMs,
      });
      ready = ev.ready;
      reasons = ev.reasons;
      combine = ev.combine;
    }

    const status: BatchStatusFile = {
      groupOpenId: groupOpenId.toUpperCase(),
      packId: pack.id,
      ready,
      reasons,
      pendingCount,
      lastMessageAtMs,
      lastDecisionAtMs,
      updatedAtMs: nowMs,
      combine,
    };
    atomicWriteJson(this.buffer.batchStatusPath(groupOpenId), status);
    return status;
  }

  read(groupOpenId: string): BatchStatusFile | null {
    const file = this.buffer.batchStatusPath(groupOpenId);
    if (!fs.existsSync(file)) return null;
    try {
      return JSON.parse(fs.readFileSync(file, "utf8")) as BatchStatusFile;
    } catch {
      return null;
    }
  }

  /** 决策完成后推进游标并刷新门闩（ready 应变 false）。 */
  acknowledge(groupOpenId: string, pack: PolicyPack, nowMs = Date.now()): BatchStatusFile {
    const { nextCursor } = this.buffer.readSince(groupOpenId);
    this.buffer.acknowledgeDecision(groupOpenId, nextCursor, nowMs);
    return this.refresh(groupOpenId, pack, nowMs);
  }
}
