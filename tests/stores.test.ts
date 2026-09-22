import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { BufferStore } from "../src/store/buffer.js";
import { StateStore } from "../src/store/state.js";
import type { MutePolicy } from "../src/types.js";

const tmpDirs: string[] = [];

afterEach(() => {
  for (const d of tmpDirs.splice(0)) {
    fs.rmSync(d, { recursive: true, force: true });
  }
});

function tmp(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "qgl-"));
  tmpDirs.push(d);
  return d;
}

const mutePolicy: MutePolicy = {
  timezone: "Asia/Shanghai",
  windowMinutes: 30,
  hitsBeforeMute: 3,
  muteSeconds: 60,
  dailyMuteThreshold: 3,
  extendedMuteSeconds: 600,
};

describe("BufferStore", () => {
  it("appends and reads since cursor", () => {
    const store = new BufferStore(tmp());
    const g = "C3E939C7B5642D6C67C990CFB945967E";
    store.append({
      messageId: "a",
      groupOpenId: g,
      memberOpenId: "m",
      text: "hi",
      mentioned: false,
      timestampMs: 1,
      packId: "addiction-mute",
      matchedRule: "default",
    });
    store.append({
      messageId: "b",
      groupOpenId: g,
      memberOpenId: "m",
      text: "yo",
      mentioned: false,
      timestampMs: 2,
      packId: "addiction-mute",
      matchedRule: "default",
    });
    const first = store.readSince(g);
    expect(first.records.map((r) => r.messageId)).toEqual(["a", "b"]);
    store.setCursor(g, first.nextCursor);
    store.append({
      messageId: "c",
      groupOpenId: g,
      memberOpenId: "m",
      text: "new",
      mentioned: false,
      timestampMs: 3,
      packId: "addiction-mute",
      matchedRule: "default",
    });
    const second = store.readSince(g);
    expect(second.records.map((r) => r.messageId)).toEqual(["c"]);
  });
});

describe("StateStore", () => {
  it("is idempotent on same messageId", () => {
    const s = new StateStore(path.join(tmp(), "s.json"), "Asia/Shanghai");
    const w = 30 * 60 * 1000;
    const a = s.recordHit("mem", "msg-1", 1000, w);
    const b = s.recordHit("mem", "msg-1", 2000, w);
    expect(a.isNew).toBe(true);
    expect(b.isNew).toBe(false);
    expect(b.count).toBe(1);
  });

  it("mutes on 4th hit and extends after 3 mutes today", () => {
    const s = new StateStore(path.join(tmp(), "s.json"), "Asia/Shanghai");
    const w = 30 * 60 * 1000;
    let count = 0;
    for (let i = 1; i <= 4; i++) {
      count = s.recordHit("mem", `m${i}`, i * 1000, w).count;
    }
    expect(count).toBe(4);
    const d1 = s.shouldMute("mem", count, mutePolicy);
    expect(d1.mute).toBe(true);
    expect(d1.seconds).toBe(60);
    expect(d1.extended).toBe(false);

    s.recordMute("mem");
    s.recordMute("mem");
    s.recordMute("mem");
    const d2 = s.shouldMute("mem", 4, mutePolicy);
    expect(d2.extended).toBe(true);
    expect(d2.seconds).toBe(600);
  });

  it("persists across reload", () => {
    const file = path.join(tmp(), "s.json");
    const s1 = new StateStore(file, "Asia/Shanghai");
    s1.recordHit("mem", "x", Date.now(), 30 * 60 * 1000);
    s1.recordMute("mem");
    s1.save();
    const s2 = new StateStore(file, "Asia/Shanghai");
    expect(s2.mutesToday("mem")).toBe(1);
  });
});
