import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Intake } from "../src/intake.js";
import { PackRegistry, writeKeywordsData, writePackObject } from "../src/policy/load.js";
import { BufferStore } from "../src/store/buffer.js";
import { buildRecallEventRecord, formatRecallEventText } from "../src/actions/recall-event.js";
import { evaluate } from "../src/policy/router.js";
import type { MuteAction } from "../src/actions/mute.js";
import type { RecallAction } from "../src/actions/recall.js";
import type { InboundMessage, PolicyPack } from "../src/types.js";

describe("recall-event formatting", () => {
  it("builds readable system text", () => {
    const text = formatRecallEventText({
      memberOpenId: "M1",
      messageId: "ROBOT1.0_abcdefghijklmnop",
      keywords: ["槟榔"],
    });
    expect(text).toContain("[系统·自动撤回]");
    expect(text).toContain("槟榔");
  });

  it("sets kind recall_event", () => {
    const rec = buildRecallEventRecord({
      groupOpenId: "G1",
      memberOpenId: "M1",
      packId: "demo",
      matchedRule: "keyword",
      timestampMs: 1,
      messageId: "mid-1",
      keywords: ["槟榔"],
    });
    expect(rec.kind).toBe("recall_event");
    expect(rec.recall?.sourceMessageId).toBe("mid-1");
  });
});

describe("router recallHitMessage", () => {
  it("emits recallMessage action when flag set", () => {
    const pack = {
      id: "demo",
      version: "1",
      route: {
        order: ["keyword", "default"] as const,
        keyword: {
          wake: false,
          buffer: true,
          onHit: "none" as const,
          recallHitMessage: true,
        },
        default: { wake: false, buffer: true },
      },
      keywords: ["槟榔"],
      categories: { betel: ["槟榔"] },
      looseKeywords: [],
      excludeCategories: [],
      packDir: "/tmp",
    } as unknown as PolicyPack;
    const msg: InboundMessage = {
      messageId: "m1",
      groupOpenId: "G1",
      memberOpenId: "M1",
      text: "有槟榔",
      mentioned: false,
      timestampMs: Date.now(),
    };
    const d = evaluate(msg, pack);
    expect(d.actions.some((a) => a.type === "recallMessage")).toBe(true);
    expect(d.actions.some((a) => a.type === "countAndMaybeMute")).toBe(false);
  });
});

describe("Intake recall → buffer", () => {
  const tmpDirs: string[] = [];
  afterEach(() => {
    for (const d of tmpDirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
  });

  it("records recall_event without waking", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "qgl-recall-"));
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
          onHit: "none",
          recallHitMessage: true,
        },
        default: { wake: false, buffer: true },
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
    const recallMessage = vi.fn(async () => ({ recalled: true as const }));
    const recall = { recallMessage } as unknown as RecallAction;
    const mute = { maybeMute: vi.fn() } as unknown as MuteAction;
    const intake = new Intake(
      registry,
      buffer,
      path.join(dataDir, "state"),
      mute,
      {},
      undefined,
      recall,
    );

    const r = await intake.handle({
      body: "有槟榔吗",
      channel: "qqbot",
      senderId: "MEMBER1",
      sessionKey: "agent:main:qqbot:group:GROUP1",
      isGroup: true,
      messageId: "msg-hit-1",
    });
    expect(r).toEqual({ handled: true });
    expect(recallMessage).toHaveBeenCalledWith("GROUP1", "msg-hit-1");

    const { records } = buffer.readSince("GROUP1");
    const recallEv = records.find((x) => x.kind === "recall_event");
    expect(recallEv).toBeTruthy();
    expect(recallEv?.text).toContain("[系统·自动撤回]");
  });
});
