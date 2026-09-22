/**
 * BufferStore：按群追加 JSONL，游标落盘。
 * 联动：wake=false 时 Intake 调用 append；cron 经 readSince / setCursor 批处理；
 * BatchTrigger 用 pendingCount / lastBufferedAtMs。
 * 注意：append 用追加写；游标用 tmp+rename 原子写，避免半截 JSON。
 */

import fs from "node:fs";
import path from "node:path";
import type { BufferRecord } from "../types.js";

export type CursorFile = {
  lastMessageId: string | null;
  lastTimestampMs: number;
  consumedLines: number;
  /** 上次批决策完成时间（触发 interval 用） */
  lastDecisionAtMs?: number;
};

export class BufferStore {
  constructor(private baseDir: string) {
    fs.mkdirSync(this.baseDir, { recursive: true });
  }

  get dir(): string {
    return this.baseDir;
  }

  private bufferPath(groupOpenId: string): string {
    return path.join(this.baseDir, `${groupOpenId.toUpperCase()}.jsonl`);
  }

  private cursorPath(groupOpenId: string): string {
    return path.join(this.baseDir, `${groupOpenId.toUpperCase()}.cursor.json`);
  }

  private batchPath(groupOpenId: string): string {
    return path.join(this.baseDir, `${groupOpenId.toUpperCase()}.batch.json`);
  }

  append(record: BufferRecord): void {
    const file = this.bufferPath(record.groupOpenId);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, `${JSON.stringify(record)}\n`, "utf8");
  }

  readCursor(groupOpenId: string): CursorFile {
    const file = this.cursorPath(groupOpenId);
    if (!fs.existsSync(file)) {
      return { lastMessageId: null, lastTimestampMs: 0, consumedLines: 0, lastDecisionAtMs: 0 };
    }
    try {
      const c = JSON.parse(fs.readFileSync(file, "utf8")) as CursorFile;
      return { lastDecisionAtMs: 0, ...c };
    } catch {
      return { lastMessageId: null, lastTimestampMs: 0, consumedLines: 0, lastDecisionAtMs: 0 };
    }
  }

  setCursor(groupOpenId: string, cursor: CursorFile): void {
    atomicWriteJson(this.cursorPath(groupOpenId), cursor);
  }

  /** 批决策完成后推进游标并记录 lastDecisionAtMs。 */
  acknowledgeDecision(groupOpenId: string, nextCursor: CursorFile, nowMs = Date.now()): void {
    this.setCursor(groupOpenId, { ...nextCursor, lastDecisionAtMs: nowMs });
  }

  lineCount(groupOpenId: string): number {
    const file = this.bufferPath(groupOpenId);
    if (!fs.existsSync(file)) return 0;
    return fs.readFileSync(file, "utf8").split(/\r?\n/).filter((l) => l.trim()).length;
  }

  pendingCount(groupOpenId: string): number {
    const total = this.lineCount(groupOpenId);
    const cursor = this.readCursor(groupOpenId);
    return Math.max(0, total - cursor.consumedLines);
  }

  /** 最新一条缓冲消息时间；无则 0。 */
  lastBufferedAtMs(groupOpenId: string): number {
    const file = this.bufferPath(groupOpenId);
    if (!fs.existsSync(file)) return 0;
    const lines = fs.readFileSync(file, "utf8").split(/\r?\n/).filter((l) => l.trim());
    if (lines.length === 0) return 0;
    try {
      const last = JSON.parse(lines[lines.length - 1]!) as BufferRecord;
      return last.timestampMs || 0;
    } catch {
      return 0;
    }
  }

  batchStatusPath(groupOpenId: string): string {
    return this.batchPath(groupOpenId);
  }

  readSince(groupOpenId: string): { records: BufferRecord[]; nextCursor: CursorFile } {
    const file = this.bufferPath(groupOpenId);
    const cursor = this.readCursor(groupOpenId);
    if (!fs.existsSync(file)) {
      return { records: [], nextCursor: cursor };
    }
    const lines = fs.readFileSync(file, "utf8").split(/\r?\n/).filter((l) => l.trim());
    const records: BufferRecord[] = [];
    for (let i = cursor.consumedLines; i < lines.length; i++) {
      try {
        records.push(JSON.parse(lines[i]!) as BufferRecord);
      } catch {
        /* skip corrupt line */
      }
    }
    const last = records[records.length - 1];
    const nextCursor: CursorFile = last
      ? {
          lastMessageId: last.messageId,
          lastTimestampMs: last.timestampMs,
          consumedLines: lines.length,
          lastDecisionAtMs: cursor.lastDecisionAtMs ?? 0,
        }
      : cursor;
    return { records, nextCursor };
  }
}

export function atomicWriteJson(file: string, data: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), "utf8");
  fs.renameSync(tmp, file);
}
