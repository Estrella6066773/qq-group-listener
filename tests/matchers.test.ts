import { describe, expect, it } from "vitest";
import {
  isLatinToken,
  isMentioned,
  matchKeywords,
  normalizeForMatch,
  toSimplified,
} from "../src/policy/matchers.js";

describe("isMentioned", () => {
  it("detects OpenClaw qqbot (@you) marker in body text", () => {
    expect(isMentioned({ text: "[成员] 你好 (@you)" })).toBe(true);
    expect(isMentioned({ text: "(@you)" })).toBe(true);
    expect(isMentioned({ text: "普通闲聊" })).toBe(false);
  });

  it("still honors raw event / mentions / appId", () => {
    expect(isMentioned({ rawEventType: "GROUP_AT_MESSAGE_CREATE" })).toBe(true);
    expect(isMentioned({ mentions: [{ is_you: true }] })).toBe(true);
    expect(isMentioned({ text: "hi <@bot-app>", appId: "bot-app" })).toBe(true);
  });
});

describe("matchers", () => {
  it("matches Chinese substring", () => {
    expect(matchKeywords("今天去嚼槟榔了", ["槟榔"])).toContain("槟榔");
  });

  it("normalizes traditional to simplified for betel", () => {
    expect(toSimplified("檳榔")).toBe("槟榔");
    expect(matchKeywords("来点檳榔", ["槟榔"])).toContain("槟榔");
  });

  it("does not match 烟囱 for tobacco compounds", () => {
    const tobacco = ["抽烟", "吸烟", "香烟", "烟瘾"];
    expect(matchKeywords("烟囱坏了", tobacco)).toEqual([]);
    expect(matchKeywords("别抽烟了", tobacco)).toContain("抽烟");
  });

  it("uses word boundary for English tokens", () => {
    expect(isLatinToken("ice")).toBe(true);
    expect(matchKeywords("this is nice", ["ice"])).toEqual([]);
    expect(matchKeywords("buy some ice now", ["ice"])).toContain("ice");
    expect(matchKeywords("smoking weed tonight", ["weed"])).toContain("weed");
  });

  it("is case-insensitive", () => {
    expect(normalizeForMatch("THC")).toBe("thc");
    expect(matchKeywords("contains THC here", ["thc"])).toContain("thc");
  });
});
