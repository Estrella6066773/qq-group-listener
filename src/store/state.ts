/**
 * StateStore：成员命中滑动窗口 + 当日禁言次数。
 * 联动：MuteAction / Intake 在 keyword onHit 时调用 recordHit / shouldMute / recordMute。
 * 注意：messageId 幂等；跨 Asia/Shanghai 自然日重置 muteCountToday。
 */

import fs from "node:fs";
import path from "node:path";
import { atomicWriteJson } from "./buffer.js";
import type { HitStateFile, MutePolicy } from "../types.js";

export function dayKeyInTz(timeZone: string, d = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

function freshState(timezone: string): HitStateFile {
  // 注意：不可浅拷贝 DEFAULT_STATE，否则 hitWindow/seenMessageIds 会跨实例串数据
  return {
    seenMessageIds: {},
    hitWindow: {},
    muteCountToday: { date: dayKeyInTz(timezone), byMember: {} },
  };
}

export class StateStore {
  private data: HitStateFile;

  constructor(
    private file: string,
    private timezone: string,
  ) {
    this.data = freshState(timezone);
    this.load();
  }

  load(): void {
    try {
      if (fs.existsSync(this.file)) {
        const parsed = JSON.parse(fs.readFileSync(this.file, "utf8")) as HitStateFile;
        this.data = {
          keywordsVersion: parsed.keywordsVersion,
          seenMessageIds: { ...(parsed.seenMessageIds ?? {}) },
          hitWindow: Object.fromEntries(
            Object.entries(parsed.hitWindow ?? {}).map(([k, v]) => [k, [...(v ?? [])]]),
          ),
          muteCountToday: {
            date: parsed.muteCountToday?.date || dayKeyInTz(this.timezone),
            byMember: { ...(parsed.muteCountToday?.byMember ?? {}) },
          },
        };
      }
    } catch {
      /* corrupt → fresh */
    }
    this.rolloverIfNeeded();
  }

  save(): void {
    try {
      atomicWriteJson(this.file, this.data);
    } catch {
      /* never break message flow */
    }
  }

  rolloverIfNeeded(now = new Date()): void {
    const today = dayKeyInTz(this.timezone, now);
    if (this.data.muteCountToday.date !== today) {
      this.data.muteCountToday = { date: today, byMember: {} };
    }
  }

  /**
   * 记录一次命中。同一 messageId 不重复计数，返回窗口内命中数（含本次；幂等时返回当前数）。
   */
  recordHit(
    memberId: string,
    messageId: string,
    nowMs: number,
    windowMs: number,
  ): { count: number; isNew: boolean } {
    this.rolloverIfNeeded(new Date(nowMs));
    if (messageId && this.data.seenMessageIds[messageId]) {
      const list = (this.data.hitWindow[memberId] ?? []).filter((t) => nowMs - t < windowMs);
      this.data.hitWindow[memberId] = list;
      return { count: list.length, isNew: false };
    }
    if (messageId) this.data.seenMessageIds[messageId] = true;

    // prune seen map if huge (keep last ~5000 keys)
    const ids = Object.keys(this.data.seenMessageIds);
    if (ids.length > 5000) {
      for (const id of ids.slice(0, ids.length - 4000)) {
        delete this.data.seenMessageIds[id];
      }
    }

    const list = (this.data.hitWindow[memberId] ?? []).filter((t) => nowMs - t < windowMs);
    list.push(nowMs);
    this.data.hitWindow[memberId] = list;
    return { count: list.length, isNew: true };
  }

  mutesToday(memberId: string): number {
    this.rolloverIfNeeded();
    return this.data.muteCountToday.byMember[memberId] ?? 0;
  }

  /** 根据 MutePolicy 与当前窗口计数，决定是否禁言及时长（秒）。 */
  shouldMute(
    memberId: string,
    hitCountInWindow: number,
    policy: MutePolicy,
  ): { mute: boolean; seconds: number; extended: boolean; priorMutes: number } {
    if (hitCountInWindow <= policy.hitsBeforeMute) {
      return { mute: false, seconds: 0, extended: false, priorMutes: this.mutesToday(memberId) };
    }
    const priorMutes = this.mutesToday(memberId);
    const extended = priorMutes >= policy.dailyMuteThreshold;
    const seconds = extended ? policy.extendedMuteSeconds : policy.muteSeconds;
    return { mute: true, seconds, extended, priorMutes };
  }

  recordMute(memberId: string): void {
    this.rolloverIfNeeded();
    this.data.muteCountToday.byMember[memberId] =
      (this.data.muteCountToday.byMember[memberId] ?? 0) + 1;
  }
}

export function stateFileForGroup(stateDir: string, groupOpenId: string): string {
  return path.join(stateDir, `${groupOpenId.toUpperCase()}.json`);
}
