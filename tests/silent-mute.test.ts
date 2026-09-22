import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Intake } from "../src/intake.js";
import { PackRegistry, writeKeywordsData, writePackObject } from "../src/policy/load.js";
import { BufferStore } from "../src/store/buffer.js";
import { buildMuteEventRecord, formatMuteEventText } from "../src/actions/mute-event.js";
import type { MuteAction } from "../src/actions/mute.js";

describe("mute-event formatting", () => {
  it("builds readable system text", () => {
    const text = formatMuteEventText({
      memberOpenId: "M1",
      seconds: 60,
      keywords: ["槟榔"],
      hitCount: 4,
      extended: false,
    });
    expect(text).toContain("[系统·自动禁言]");
    expect(text).toContain("槟榔");
    expect(text).toContain("60");
  });

  it("sets kind mute_event", () => {
    const rec = buildMuteEventRecord({
      groupOpenId: "G1",
      memberOpenId: "M1",
      packId: "demo",
      matchedRule: "keyword",
      timestampMs: 1,
      seconds: 60,
      keywords: ["槟榔"],
      hitCount: 4,
      extended: false,
    });
    expect(rec.kind).toBe("mute_event");
    expect(rec.mute?.seconds).toBe(60);
  });
});

describe("Intake silent mute → buffer", () => {
  const tmpDirs: string[] = [];
  afterEach(() => {
    for (const d of tmpDirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
  });

  function setup() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "qgl-silent-"));
    tmpDirs.push(root);
    const dataDir = path.join(root, "data");
    fs.mkdirSync(path.join(root, "config"), { recursive: true });
    fs.mkdirSync(path.join(root, "packs", "demo"), { recursive: true });
    fs.writeFileSync(
      path.join(root, "config", "groups.yaml"),
      "groups:\n  GROUP1: demo\n",
      "utf8",
    );
    writePackObject(root, "demo", {
      id: "demo",
      version: "1",
      route: {
        order: ["keyword", "default"],
        keyword: {
          wake: false,
          buffer: true,
          keywordsRef: "keywords.yaml",
          onHit: "countAndMaybeMute",
        },
        default: { wake: false, buffer: true },
      },
      mute: {
        timezone: "Asia/Shanghai",
        windowMinutes: 30,
        hitsBeforeMute: 1,
        muteSeconds: 60,
        dailyMuteThreshold: 3,
        extendedMuteSeconds: 600,
      },
    });
    writeKeywordsData(path.join(root, "packs", "demo", "keywords.yaml"), {
      version: "1",
      categories: { betel: ["槟榔"] },
      keywords: [],
      excludeCategories: [],
    });

    const registry = new PackRegistry(root);
    const buffer = new BufferStore(path.join(dataDir, "buffer"));
    const maybeMute = vi.fn(async (args: { hitCount: number }) => {
      if (args.hitCount <= 1) return { muted: false as const };
      return {
        muted: true as const,
        seconds: 60,
        extended: false,
        priorMutes: 0,
      };
    });
    const mute = { maybeMute } as unknown as MuteAction;
    const intake = new Intake(registry, buffer, path.join(dataDir, "state"), mute);
    return { intake, buffer, maybeMute };
  }

  it("does not wake and records mute_event after threshold", async () => {
    const { intake, buffer, maybeMute } = setup();
    // hitsBeforeMute=1 → 第 2 次命中才禁言
    const r1 = await intake.handle({
      body: "有槟榔吗",
      channel: "qqbot",
      senderId: "MEMBER1",
      sessionKey: "agent:main:qqbot:group:GROUP1",
      isGroup: true,
      messageId: "m1",
    });
    expect(r1).toEqual({ handled: true });
    expect(maybeMute).toHaveBeenCalledOnce();
    await expect(maybeMute.mock.results[0]?.value).resolves.toEqual({ muted: false });

    const r2 = await intake.handle({
      body: "再来点槟榔",
      channel: "qqbot",
      senderId: "MEMBER1",
      sessionKey: "agent:main:qqbot:group:GROUP1",
      isGroup: true,
      messageId: "m2",
    });
    expect(r2).toEqual({ handled: true });
    expect(maybeMute).toHaveBeenCalledTimes(2);

    const { records } = buffer.readSince("GROUP1");
    expect(records.some((r) => r.kind === "message" && r.text.includes("槟榔"))).toBe(true);
    const muteEv = records.find((r) => r.kind === "mute_event");
    expect(muteEv).toBeTruthy();
    expect(muteEv?.text).toContain("[系统·自动禁言]");
  });
});
